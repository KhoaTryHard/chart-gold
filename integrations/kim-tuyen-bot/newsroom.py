"""Durable editorial workflow; only an authenticated Telegram owner can approve."""
from __future__ import annotations
from copy import deepcopy
import argparse
import asyncio
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import time
import unicodedata
import inspect
import traceback
from urllib.parse import urlsplit, urlunsplit
import uuid
import dual_channel as dual
import media_storage
import website_bridge
import editorial_policy as policy
import creation_runtime
import workflow_control as control
from editorial_runtime import (save_editor_checkpoint,load_editor_checkpoint,evidence_hashes,
    PROVIDER_NAMES)
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
PAGE_ID = "1262243656966414"
DAILY_SLOTS = ("07:00", "12:00", "18:00")
MAX_SLOT_ATTEMPTS = 3
SLOT_RETRY_SECONDS = 15 * 60
CREATION_SECONDS = 900  # Legacy compatibility only; creation policy owns runtime limits.


def local_datetime(value=None):
    """Return a timezone-aware Vietnam datetime for a timestamp or now."""
    if value is None:
        return datetime.now(ZoneInfo("Asia/Ho_Chi_Minh"))
    if isinstance(value, datetime):
        return value.astimezone(ZoneInfo("Asia/Ho_Chi_Minh"))
    return datetime.fromtimestamp(float(value), ZoneInfo("Asia/Ho_Chi_Minh"))


def slot_datetime(slot_date, slot_time):
    return datetime.fromisoformat(f"{slot_date}T{slot_time}:00").replace(
        tzinfo=ZoneInfo("Asia/Ho_Chi_Minh"))

def config():
    c = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
    if c["page_id"] != PAGE_ID:
        raise ValueError("Fanpage đích không khớp cấu hình đã xác minh.")
    return c

def database(path=None):
    p = Path(path or ROOT / "data/newsroom.sqlite3")
    p.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(p, timeout=30, factory=control.FencedConnection)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    dual.migrate(db)
    __import__("facebook_story").migrate(db)
    import video_workflow
    video_workflow.migrate(db)
    db.executescript("""
    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY, content TEXT NOT NULL, digest TEXT NOT NULL UNIQUE,
      bundle TEXT NOT NULL, status TEXT NOT NULL, created REAL NOT NULL,
      expires REAL NOT NULL, review_message TEXT, approved_by TEXT,
      approval_message TEXT, approved_at REAL, post_id TEXT, error TEXT,
      revision_of TEXT, root_id TEXT, version INTEGER NOT NULL DEFAULT 1,
      content_type TEXT NOT NULL DEFAULT 'news', slot_date TEXT, slot_time TEXT,
      review_image_message TEXT, review_sent_at REAL,
      publish_status_message TEXT);
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, started REAL NOT NULL,
      finished REAL, details TEXT);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, at REAL NOT NULL, draft_id TEXT,
      action TEXT NOT NULL, actor TEXT, message_id TEXT);
    CREATE TABLE IF NOT EXISTS incoming (event_key TEXT PRIMARY KEY, received REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS leases (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS daily_slots (
      slot_date TEXT NOT NULL, slot_time TEXT NOT NULL,
      status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt REAL, next_retry REAL, draft_id TEXT, error TEXT,
      created REAL NOT NULL, updated REAL NOT NULL,
      PRIMARY KEY(slot_date, slot_time));
    CREATE TABLE IF NOT EXISTS edit_sessions (
      token TEXT PRIMARY KEY, draft_id TEXT NOT NULL, mode TEXT NOT NULL,
      actor TEXT NOT NULL, chat_id TEXT NOT NULL, prompt_message_id TEXT,
      created REAL NOT NULL, expires REAL NOT NULL, status TEXT NOT NULL,
      request TEXT);
    CREATE TABLE IF NOT EXISTS verification_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL, draft_id TEXT, attempt INTEGER NOT NULL,
      caption_digest TEXT NOT NULL, check_json TEXT NOT NULL,
      dropped_json TEXT NOT NULL, created REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS publication_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_id TEXT NOT NULL, attempt INTEGER NOT NULL,
      step TEXT NOT NULL, state TEXT NOT NULL,
      started REAL NOT NULL, updated REAL NOT NULL,
      post_id TEXT, error_type TEXT, error_message TEXT,
      traceback TEXT, retryable INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_drafts_status_created ON drafts(status, created DESC);
    CREATE INDEX IF NOT EXISTS idx_edit_sessions_prompt ON edit_sessions(prompt_message_id, status);
    CREATE INDEX IF NOT EXISTS idx_verification_runs_run ON verification_runs(run_id, attempt);
    CREATE INDEX IF NOT EXISTS idx_publication_attempts_draft ON publication_attempts(draft_id, attempt);
    CREATE TABLE IF NOT EXISTS creation_stages (
      id TEXT PRIMARY KEY,run_id TEXT NOT NULL,stage TEXT,attempt INTEGER,status TEXT,
      started REAL,finished REAL,seconds REAL,request_path TEXT,result_path TEXT,metadata TEXT);
    CREATE INDEX IF NOT EXISTS idx_creation_stages_run ON creation_stages(run_id,started);
    CREATE TABLE IF NOT EXISTS creation_requests (
      event_key TEXT PRIMARY KEY,run_id TEXT NOT NULL,received REAL NOT NULL);
    """)
    # Existing databases predate the versioned draft and edit-session UI.
    # SQLite has no IF NOT EXISTS form for columns, so migrate each column
    # independently and keep all existing rows intact.
    existing = {row["name"] for row in db.execute("PRAGMA table_info(drafts)")}
    for name, definition in (("revision_of", "TEXT"), ("root_id", "TEXT"),
                             ("version", "INTEGER NOT NULL DEFAULT 1"),
                             ("content_type", "TEXT NOT NULL DEFAULT 'news'"),
                             ("slot_date", "TEXT"), ("slot_time", "TEXT"),
                             ("review_image_message", "TEXT"),
                             ("review_sent_at", "REAL"),
                             ("publish_status_message", "TEXT")):
        if name not in existing:
            db.execute(f"ALTER TABLE drafts ADD COLUMN {name} {definition}")
    run_columns = {row['name'] for row in db.execute('PRAGMA table_info(runs)')}
    for name, definition in (("source", "TEXT"), ("trigger_key", "TEXT"),
                             ("actor", "TEXT"), ("chat_id", "TEXT"),
                             ("message_id", "TEXT"), ("callback_id", "TEXT"),
                             ("progress_message", "TEXT"), ("draft_id", "TEXT"),
                             ("step", "TEXT"), ("updated", "REAL"), ("issues", "TEXT"),
                             ("requested_topic", "TEXT"), ("checkpoint", "TEXT"),
                             ("research_checkpoint", "TEXT"), ("editor_checkpoint", "TEXT"),
                             ("audience_checkpoint", "TEXT"), ("created_at", "REAL"),
                             ("attempt_started", "REAL"), ("heartbeat_at", "REAL"),
                             ("worker_token", "TEXT"), ("next_step", "TEXT"),
                             ("cancel_requested", "INTEGER NOT NULL DEFAULT 0"),
                             ("resume_automatic", "INTEGER NOT NULL DEFAULT 0"),
                             ("recovery_attempts", "INTEGER NOT NULL DEFAULT 0")):
        if name not in run_columns:
            db.execute(f'ALTER TABLE runs ADD COLUMN {name} {definition}')
    slot_columns={row['name'] for row in db.execute('PRAGMA table_info(daily_slots)')}
    if 'run_id' not in slot_columns:db.execute('ALTER TABLE daily_slots ADD COLUMN run_id TEXT')
    db.execute('UPDATE runs SET created_at=started WHERE created_at IS NULL')
    db.execute("UPDATE drafts SET root_id=id WHERE root_id IS NULL")
    db.execute("UPDATE drafts SET version=1 WHERE version IS NULL")
    db.execute("UPDATE drafts SET content_type='news' WHERE content_type IS NULL OR content_type='' ")
    # Preserve legacy uncertain publications as non-retryable records. Their
    # old worker did not persist a step boundary, so recovery must wait for an
    # explicit read-only reconciliation and owner click.
    db.execute("""INSERT INTO publication_attempts
        (draft_id,attempt,step,state,started,updated,error_type,error_message,retryable)
        SELECT d.id,1,'legacy_unknown','uncertain',COALESCE(d.approved_at,d.created),
               COALESCE(d.approved_at,d.created),'LegacyUncertain',d.error,0
        FROM drafts d WHERE d.status='uncertain' AND NOT EXISTS
          (SELECT 1 FROM publication_attempts p WHERE p.draft_id=d.id)""")
    # Before the 24-hour policy, an existing delivered review had a two-hour
    # expiry. Extend only still-live reviews from their original creation time;
    # already-expired rows remain expired and are never revived.
    now = time.time()
    ttl = config()["approval_ttl_minutes"] * 60
    db.execute("""UPDATE drafts SET review_sent_at=created
        WHERE review_message IS NOT NULL AND review_sent_at IS NULL""")
    db.execute("""UPDATE drafts SET expires=review_sent_at+?
        WHERE review_sent_at IS NOT NULL AND expires>? AND expires>?""",
               (ttl, now, now-ttl))
    import owner_images
    owner_images.migrate(db)
    db.commit()
    return db

def digest(content):
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _dedupe_key(value):
    """Stable Vietnamese-insensitive key for recent topic/caption checks."""
    return re.sub(r"\s+", " ", re.sub(r"[^\wÀ-ỹ]+", " ", str(value or "").casefold())).strip()

_MOJIBAKE_MARKERS = ("Ã", "Â", "Ä", "Å", "Æ", "áº", "á»", "â€", "ðŸ", "�")

def _mojibake_score(text):
    score = text.count("\ufffd") * 5
    # Vietnamese text legitimately contains uppercase “ĐÃ ...” in phrases
    # such as “ĐÃ XUẤT BẢN”; count only corruption signatures where the marker
    # is immediately followed by a byte-like lowercase/extended character.
    score += len(re.findall(r"(?:Ã\S|Â\S|Ä\S|Å\S|Æ\S|áº\S|á»\S|â€\S|ðŸ\S)", text))
    return score

def repair_text(text):
    """Repair unambiguous UTF-8 decoded as Windows-1252/Latin-1."""
    if not isinstance(text, str):
        return text
    best = unicodedata.normalize("NFC", text)
    for _ in range(2):
        try:
            candidate = best.encode("latin1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            break
        if _mojibake_score(candidate) < _mojibake_score(best):
            best = candidate
        else:
            break
    return unicodedata.normalize("NFC", best)

def repair_json(value):
    if isinstance(value, str): return repair_text(value)
    if isinstance(value, list): return [repair_json(item) for item in value]
    if isinstance(value, dict): return {key: repair_json(item) for key, item in value.items()}
    return value

def assert_clean_text(text, label="nội dung"):
    text = repair_text(text)
    if _mojibake_score(text):
        raise ValueError(f"{label} còn lỗi mã hóa tiếng Việt; đã chặn gửi.")
    if any(ord(ch) < 32 and ch not in "\n\r\t" for ch in text):
        raise ValueError(f"{label} chứa ký tự điều khiển không hợp lệ.")
    return text

def load_media(draft=None, **context):
    if draft is not None:
        from editorial_images import prepare_illustration
        media = prepare_illustration(draft, root=ROOT, config=config(), **context)
        verify_media(media)
        return media
    # Retained only for legacy callers. New articles always pass their content.
    media = json.loads((ROOT/"assets/media.json").read_text(encoding="utf-8"))
    verify_media(media)
    return media

def verify_media(media):
    path = (ROOT/media["path"]).resolve()
    if not path.is_relative_to((ROOT/"assets").resolve()):
        raise ValueError("Ảnh minh họa nằm ngoài thư viện của tòa soạn.")
    media_storage.ensure_local(path,media['sha256'],root=ROOT)
    if hashlib.sha256(path.read_bytes()).hexdigest() != media["sha256"]:
        raise ValueError("Ảnh đã thay đổi sau khi tạo bản duyệt.")
    if media.get("mimeType") != "image/png" and not media.get("photo",{}).get("s3key"):
        raise ValueError("Ảnh chưa được chuẩn bị cho Composio.")
    return path

def package_digest(content, media):
    return digest(content+"\n"+json.dumps(media,sort_keys=True,ensure_ascii=False))

def source_comment(research):
    from publication_preview import source_comment as render
    return assert_clean_text(render(research,url_normalizer=canonical_url if not research.get('research_contract_version') else None),'bình luận nguồn')


def audit(db, ident, action, actor=None, message_id=None):
    db.execute("INSERT INTO audit(at,draft_id,action,actor,message_id) VALUES(?,?,?,?,?)",
               (time.time(), ident, action, actor, message_id))


def exception_detail(exc):
    """Return bounded, token-scrubbed details for a publication failure."""
    def flatten(error):
        if isinstance(error, BaseExceptionGroup):
            items = []
            for child in error.exceptions:
                items.extend(flatten(child))
            return items
        return [error]
    errors = flatten(exc)
    rendered = []
    for error in errors[:12]:
        message = re.sub(r"(?i)(?:bearer\s+|token[=:]\s*|access[_ -]?token[=:]\s*)\S+",
                         "[redacted]", str(error))
        message = re.sub(r"[A-Za-z0-9+/=_-]{80,}", "[redacted]", message)
        rendered.append({"type": type(error).__name__, "message": message[:700]})
    try:
        stack = "".join(traceback.format_exception(exc))
    except Exception:
        stack = ""
    stack = re.sub(r"(?i)(bearer\s+|token[=:]\s*|access[_ -]?token[=:]\s*)\S+",
                   r"\1[redacted]", stack)
    stack = re.sub(r"[A-Za-z0-9+/=_-]{80,}", "[redacted]", stack)
    return {"type": type(exc).__name__, "errors": rendered,
            "traceback": stack[-4000:]}


def _publication_error_text(detail):
    if isinstance(detail, str):
        return detail[:1200]
    errors = detail.get("errors", []) if isinstance(detail, dict) else []
    if not errors:
        return str(detail)[:1200]
    return " | ".join(f"{item.get('type')}: {item.get('message')}" for item in errors)[:1200]

def canonical_url(url):
    u = urlsplit(url)
    if u.scheme != "https" or not u.hostname or u.username or u.password:
        raise ValueError("URL nguồn phải là HTTPS công khai.")
    return urlunsplit((u.scheme, u.netloc.lower(), u.path.rstrip("/"), u.query, ""))


def check_issues(check):
    """Normalize verifier v1/v2 output into blocking issues and warnings."""
    if not isinstance(check, dict):
        return ["Kết quả kiểm chứng không phải JSON đối tượng."], []
    verdict = str(check.get("verdict", "")).upper()
    if "blocking_issues" in check or "warnings" in check or "claim_results" in check:
        blocking = check.get("blocking_issues")
        warnings = check.get("warnings")
        if not isinstance(blocking, list) or not isinstance(warnings, list):
            return ["Kết quả kiểm chứng thiếu blocking_issues hoặc warnings dạng danh sách."], []
        if verdict not in {"PASS", "FAIL"}:
            return ["Kết quả kiểm chứng thiếu verdict PASS/FAIL."], []
        if verdict == "PASS" and blocking:
            return [str(x) for x in blocking], [str(x) for x in warnings]
        if verdict != "PASS" and not blocking:
            blocking = [check.get("summary", "Kiểm chứng không đạt.")]
        return ([str(x) for x in blocking] if verdict != "PASS" else []), [str(x) for x in warnings]
    # Backward-compatible v1: PASS with issues is a warning-only result.
    old_issues = check.get("issues", [])
    if not isinstance(old_issues, list):
        old_issues = [str(old_issues)]
    if verdict == "PASS":
        return [], [str(x) for x in old_issues]
    return [str(x) for x in old_issues] or [str(check.get("summary", "Kiểm chứng không đạt."))], []


def verifier_claim_maps(check):
    """Return claim/source status maps for verifier v2, or empty maps for v1."""
    claims = check.get("claim_results") if isinstance(check, dict) else None
    sources = check.get("source_results") if isinstance(check, dict) else None
    if not isinstance(claims, list) or not isinstance(sources, list):
        return {}, {}
    claim_map = {str(x.get("id")): x for x in claims if isinstance(x, dict) and x.get("id")}
    source_map = {str(x.get("id")): x for x in sources if isinstance(x, dict) and x.get("id")}
    return claim_map, source_map


def independent_source_groups(sources, source_ids):
    return policy.independent_source_groups(sources, source_ids)


def filter_verified_bundle(research, draft, check):
    return policy.filter_verified_bundle(research,draft,check)


def record_verification(db, run_id, attempt, draft, check, dropped=None, draft_id=None):
    db.execute("""INSERT INTO verification_runs
        (run_id,draft_id,attempt,caption_digest,check_json,dropped_json,created)
        VALUES(?,?,?,?,?,?,?)""",
               (run_id, draft_id, attempt, digest(str(draft.get("content", ""))),
                json.dumps(check, ensure_ascii=False), json.dumps(dropped or [], ensure_ascii=False), time.time()))


def validate_bundle(research, draft, check, now=None):
    now = now or time.time()
    if isinstance(draft.get("website"),dict):
        for result in (policy.research_preflight(research,now=now),policy.draft_preflight(research,draft,now=now)):
            if not result["eligible"]:
                raise ValueError("; ".join(item["reason"] for item in result["issues"]))
        verification_issues = policy.verifier_issues(check,research=research,draft=draft)
        if verification_issues:
            raise ValueError("; ".join(item["reason"] for item in verification_issues))
    content_type = str(draft.get("content_type") or research.get("content_type") or "news").lower()
    if content_type not in {"news", "evergreen"}:
        raise ValueError("Loại bài không hợp lệ; chỉ nhận news hoặc evergreen.")
    sources = research.get("sources", [])
    from editorial_rules import sufficient, rules, version, CURRENT
    selected_rules=rules(research)
    if policy.normalize_research(research).get("eligible") is not True or not sufficient(research):
        raise ValueError("Không đủ ít nhất hai nguồn đã đọc.")
    ids, hosts, urls = set(), set(), []
    for source in sources:
        url = canonical_url(source["url"])
        if (content_type == 'evergreen' or selected_rules['date_days']) and re.fullmatch(r'\d{4}-\d{2}-\d{2}',source['published_at']) and isinstance(draft.get('website'),dict):
            stamp = None  # shared policy compared the raw date without creating a timestamp
        else:stamp = datetime.fromisoformat(source["published_at"].replace("Z", "+00:00"))
        age_limit = selected_rules["age_hours"] * 3600 if content_type == "news" else (float("inf") if isinstance(draft.get("website"),dict) else 10 * 365 * 86400)
        if stamp is not None and (stamp.tzinfo is None or not -300 <= now-stamp.timestamp() <= age_limit):
            raise ValueError("Nguồn thiếu múi giờ, quá cũ hoặc ở tương lai.")
        if source.get("read_full_text") is not True or not source.get("publisher", "").strip():
            raise ValueError("Chưa đọc đủ nguồn hoặc thiếu nhà xuất bản.")
        if source["id"] in ids:
            raise ValueError("Mã nguồn bị trùng.")
        ids.add(source["id"])
        hosts.add(urlsplit(url).hostname.removeprefix("www."))
        urls.append(url)
    if (version(research)!=CURRENT and len(hosts) < 2) or len(set(urls)) != len(urls):
        raise ValueError("Cần hai miền nguồn khác nhau, không trùng URL.")
    claims = research.get("claims", [])
    claim_ids = {x["id"] for x in claims}
    if not claims or len(claim_ids) != len(claims):
        raise ValueError("Thiếu dữ kiện hoặc mã dữ kiện bị trùng.")
    for claim in claims:
        if not claim.get("evidence") or not claim.get("source_ids") or not set(claim["source_ids"]) <= ids:
            raise ValueError("Dữ kiện thiếu bằng chứng hoặc tham chiếu sai.")
    used = set(draft.get("used_claim_ids", [])) | set(draft.get("website", {}).get("used_claim_ids", []))
    content = assert_clean_text(str(draft.get("content", "")), "caption")
    # Persist the repaired NFC/UTF-8-safe value, so the digest, Telegram copy,
    # Facebook caption, and later approval all use exactly the same text.
    draft["content"] = content
    if not used or not used <= claim_ids or not 90 <= len(content) <= 1500:
        raise ValueError("Bản thảo thiếu dữ kiện hoặc chưa đủ tinh gọn.")
    if "http://" in content or "https://" in content:
        raise ValueError("Caption không được chứa URL; nguồn sẽ nằm trong bình luận.")
    evergreen_original = content
    if content_type == "evergreen":
        # The page name is branding, not a current-price claim.
        content = re.sub(r"(?i)Kim Tuyến\s*-\s*Giá Vàng Hôm Nay", "", content)
        content = re.sub(r"#\S+", "", content)
    if content_type == "evergreen" and not isinstance(draft.get('website'),dict) and re.search(r"(?i)giá\s*vàng\s+hôm\s+nay|giá\s+hiện\s+tại|niêm\s*yết|hôm\s*nay|tăng\s*\d|giảm\s*\d", content):
        raise ValueError("Bài kiến thức không được chứa giá hoặc diễn biến hiện tại chưa có mốc thời gian.")
    if content_type == "evergreen":
        content = evergreen_original
    if "#" not in content or not re.search(r"(?i)theo\s*dõi|theo\s*doi", content):
        raise ValueError("Caption thiếu hashtag hoặc CTA theo dõi.")
    required = {s for x in claims if x["id"] in used for s in x["source_ids"]}
    if not required:
        raise ValueError("Bản thảo không có nguồn tham khảo.")
    if not sufficient(research,required,used):
        raise ValueError("Phần nội dung giữ lại chưa có hai nguồn gốc thông tin độc lập.")
    comment = source_comment(research)
    if "http" not in comment:
        raise ValueError("Bình luận nguồn không có URL.")
    blocking, _warnings = check_issues(check)
    if blocking:
        raise ValueError("Kiểm chứng không đạt: " + "; ".join(blocking)[:500])
    if not used <= set(check.get("checked_claim_ids", [])) or not required <= set(check.get("checked_source_ids", [])):
        raise ValueError("Kiểm chứng chưa bao phủ dữ kiện/nguồn được dùng.")
    claim_map, source_map = verifier_claim_maps(check)
    if claim_map:
        missing = [cid for cid in used if str(claim_map.get(cid, {}).get("status", "")).lower() not in {"verified", "pass"}]
        if missing:
            raise ValueError("Caption còn dữ kiện chưa được kiểm chứng: " + ", ".join(missing))
        missing_sources = [sid for sid in required if str(source_map.get(sid, {}).get("status", "")).lower() not in {"verified", "pass"}]
        if missing_sources:
            raise ValueError("Caption còn nguồn chưa được kiểm chứng: " + ", ".join(sorted(missing_sources)))
        expected_digest = check.get("caption_digest")
        if expected_digest and expected_digest != digest(content):
            raise ValueError("Kết quả kiểm chứng không khớp đúng caption cuối cùng.")
    return urls, comment

def _markup(*, inline_keyboard=None, force_reply=False):
    if inline_keyboard is not None:
        return {"inline_keyboard": inline_keyboard}
    if force_reply:
        return {"force_reply": True, "selective": True}
    return None


def telegram(role, text, *, photo=None, video=None, document=None, reply_to=None, keyboard=None,
             inline_keyboard=None, force_reply=False, thread_id=None):
    control.ensure_active()
    import requests
    from dotenv import dotenv_values
    if media_storage.enabled(ROOT):
        for artifact in (photo,video):
            if artifact:
                media_storage.prepare_managed(artifact,root=ROOT,archive_first=True)
    c = config()
    profile = c["research_profile"] if role == "research" else c["editor_profile"]
    token = dotenv_values(Path(c["hermes_home"])/"profiles"/profile/".env").get("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("Thiếu thông tin đăng nhập Telegram.")
    text = assert_clean_text(text, "tin nhắn Telegram")
    payload = {"chat_id": c["chat_id"], "text": text, "link_preview_options": {"is_disabled": True}}
    if thread_id:payload["message_thread_id"]=int(thread_id)
    if keyboard:
        payload["reply_markup"] = {"keyboard": keyboard, "resize_keyboard": True, "is_persistent": True}
    markup = _markup(inline_keyboard=inline_keyboard, force_reply=force_reply)
    if markup:
        payload["reply_markup"] = markup
    if reply_to:
        payload["reply_parameters"] = {"message_id":int(reply_to)}
    try:
        if document:
            with Path(document).open("rb") as file:
                result=requests.post(f"https://api.telegram.org/bot{token}/sendDocument",data={"chat_id":c["chat_id"],"caption":text[:1000]},files={"document":(Path(document).name,file,"text/plain; charset=utf-8")},timeout=website_bridge.request_timeout(45)).json()
        elif video:
            if Path(video).stat().st_size>45*1024*1024:
                raise ValueError('Video vượt giới hạn xem trước 45 MB.')
            with Path(video).open('rb') as file:
                data={'chat_id':c['chat_id'],'caption':text[:1000],'supports_streaming':'true'}
                if markup:data['reply_markup']=json.dumps(markup,ensure_ascii=False)
                result=requests.post(f'https://api.telegram.org/bot{token}/sendVideo',data=data,
                    files={'video':('kim-tuyen.mp4',file,'video/mp4')},timeout=website_bridge.request_timeout(60)).json()
        elif photo:
            with Path(photo).open("rb") as file:
                data = {"chat_id": c["chat_id"], "caption": text}
                if markup:
                    data["reply_markup"] = json.dumps(markup, ensure_ascii=False)
                result = requests.post(f"https://api.telegram.org/bot{token}/sendPhoto",
                    data=data,
                    files={"photo":("kim-tuyen.png",file,"image/png")},timeout=website_bridge.request_timeout(45)).json()
        else:
            result = requests.post(f"https://api.telegram.org/bot{token}/sendMessage", json=payload, timeout=website_bridge.request_timeout()).json()
    except Exception as exc:
        raise RuntimeError("Không xác nhận được việc gửi Telegram: " + type(exc).__name__) from None
    if not result.get("ok"):
        raise RuntimeError("Telegram từ chối gửi tin: " + str(result.get("description", ""))[:160])
    return str(result["result"]["message_id"])


def telegram_edit(message_id, text, *, inline_keyboard=None, timeout=30):
    """Best-effort edit used for progress/status messages.

    A failed visual update must never change approval or publishing state.
    """
    control.ensure_active()
    import requests
    from dotenv import dotenv_values
    c = config()
    profile = c["editor_profile"]
    token = dotenv_values(Path(c["hermes_home"])/"profiles"/profile/".env").get("TELEGRAM_BOT_TOKEN")
    if not token:
        return False
    payload = {"chat_id": c["chat_id"], "message_id": int(message_id),
               "text": assert_clean_text(text, "tin nhắn Telegram"),
               "link_preview_options": {"is_disabled": True}}
    if inline_keyboard is not None:
        payload["reply_markup"] = {"inline_keyboard": inline_keyboard}
    try:
        result = requests.post(f"https://api.telegram.org/bot{token}/editMessageText",
                               json=payload, timeout=timeout).json()
        return bool(result.get("ok")) or 'message is not modified' in str(result.get('description','')).lower()
    except Exception:
        return False


def telegram_edit_markup(message_id, inline_keyboard, *, timeout=30):
    """Refresh existing controls without sending another approval message."""
    control.ensure_active()
    import requests
    from dotenv import dotenv_values
    c = config()
    token = dotenv_values(Path(c['hermes_home'])/'profiles'/c['editor_profile']/'.env').get('TELEGRAM_BOT_TOKEN')
    if not token: return False
    payload = {'chat_id': c['chat_id'], 'message_id': int(message_id),
               'reply_markup': {'inline_keyboard': inline_keyboard}}
    try:
        result = requests.post(f'https://api.telegram.org/bot{token}/editMessageReplyMarkup',
                               json=payload, timeout=timeout).json()
        return bool(result.get('ok')) or 'message is not modified' in str(result.get('description','')).lower()
    except Exception:
        return False


def telegram_pin(message_id):
    """Pin the dashboard when the bot has group-management permission."""
    import requests
    from dotenv import dotenv_values
    c = config()
    token = dotenv_values(Path(c["hermes_home"])/"profiles"/c["editor_profile"]/".env").get("TELEGRAM_BOT_TOKEN")
    if not token:
        return False
    try:
        result = requests.post(
            f"https://api.telegram.org/bot{token}/pinChatMessage",
            json={"chat_id": c["chat_id"], "message_id": int(message_id),
                  "disable_notification": True}, timeout=20).json()
        return bool(result.get("ok"))
    except Exception:
        return False


def telegram_clear_reply_keyboard():
    """Remove the persistent command keyboard from the previous UI."""
    import requests
    from dotenv import dotenv_values
    c = config()
    token = dotenv_values(Path(c["hermes_home"])/"profiles"/c["editor_profile"]/".env").get("TELEGRAM_BOT_TOKEN")
    if not token:
        return False
    try:
        result = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": c["chat_id"], "text": "Đã chuyển sang bảng điều khiển nút.",
                  "reply_markup": {"remove_keyboard": True}}, timeout=20).json()
        return bool(result.get("ok"))
    except Exception:
        return False

def agent(stage, payload, *, run_id=None, deadline=None, heartbeat=None, on_stage=None):
    return repair_json(creation_runtime.run_agent(
        stage, payload, root=ROOT, config=config(), run_id=run_id,
        deadline=deadline, heartbeat=heartbeat, on_stage=on_stage))


def normalize_requested_topic(value):
    if value is None or not str(value).strip():
        return None
    value = str(value).strip()
    if len(value) > 600 or any(ord(char) < 32 and char not in '\n\t' for char in value):
        raise ValueError('Chủ đề tối đa 600 ký tự và không chứa ký tự điều khiển.')
    return value


def topic_matches(requested, actual):
    def tokens(value):
        folded=unicodedata.normalize('NFKD',str(value).lower()).replace('đ','d')
        folded=''.join(char for char in folded if not unicodedata.combining(char))
        stop={'vang','va','la','cua','cho','ve','voi','the','nao','nhu','co','toi','tai','anh','huong','mot','trong','duoc','bi','khi'}
        return set(re.findall(r'[a-z0-9]+',folded))-stop
    wanted,found=tokens(requested),tokens(actual)
    return bool(wanted and found and len(wanted & found)>=min(2,len(wanted)))


def save_verified_checkpoint(db,run_id,research,draft,check,**context):
    from editorial_images import article_content_hash, resolve_illustration_brief, reserve_illustration_brief
    old=db.execute('SELECT checkpoint FROM runs WHERE id=?',(run_id,)).fetchone()
    previous=json.loads(old[0]) if old and old[0] else {}
    frozen=previous.get('visual_brief')
    if (frozen and (frozen.get('contentHash')!=article_content_hash(draft) or
            previous.get('draft',{}).get('imageHeadline')!=draft.get('imageHeadline'))):
        frozen=None
    visual_brief=(reserve_illustration_brief(draft,root=ROOT,run_id=run_id,saved_brief=frozen)
                  if 'imageHeadline' in draft else resolve_illustration_brief(draft,root=ROOT,saved_brief=frozen))
    saved={'schemaVersion':1,'research':research,'draft':draft,'check':check,
           'visual_brief':visual_brief,
           'verifiedAt':time.time(),**context}
    with db:
        db.execute("UPDATE runs SET checkpoint=?,next_step='illustration',updated=? WHERE id=?",
                   (json.dumps(saved,ensure_ascii=False),time.time(),run_id))


def save_research_checkpoint(db,run_id,research,*,evidence_path=None,metadata=None,**context):
    """Persist source handles privately, without extending the publication JSON."""
    saved={'schemaVersion':1,'research':research,'evidence_path':evidence_path,
           'research_metadata':metadata or {},'savedAt':time.time(),**context}
    with db:
        db.execute('UPDATE runs SET research_checkpoint=?,next_step=?,updated=? WHERE id=?',
                   (json.dumps(saved,ensure_ascii=False),'editor' if context.get('eligible') else context.get('next_step') or (metadata or {}).get('next_step','collection'),time.time(),run_id))
    return saved


def has_public_receipt(db,row,bundle):
    return bool(row['status']=='published' or ('post_id' in row.keys() and row['post_id']) or bundle.get('publication_receipt') or db.execute("SELECT 1 FROM publication_channels WHERE draft_id=? AND state='published'",(row['id'],)).fetchone())

def recent_post_summaries(db,now):
    """Give research dedupe hints without repeatedly resending full captions."""
    summaries=[]
    for row in db.execute('SELECT id,bundle,status,created,post_id FROM drafts WHERE created>? ORDER BY created DESC LIMIT 100',(now-7*86400,)):
        bundle=json.loads(row['bundle'])
        research=bundle.get('research',{})
        website=bundle.get('website') or bundle.get('draft',{}).get('website') or {}
        if row['status'] in ('failed','rejected','expired','superseded','cancelled') and not has_public_receipt(db,row,bundle): continue
        summaries.append({**({'event_keys':list(__import__('editorial_rules').event_keys(research)),'published':has_public_receipt(db,row,bundle)} if research.get('editorial_policy_version') else {}),'id':row['id'],'title':website.get('title') or research.get('topic') or '',
                          'topic':research.get('topic') or '',
                          'urls':bundle.get('urls') or [item['url'] for item in research.get('sources',[]) if item.get('url')],
                          'date':datetime.fromtimestamp(row['created'],timezone.utc).isoformat(),
                          'status':row['status']})
    return summaries


def creation_retry_keyboard(run_id, connection=False):
    rows=[]
    with closing(database()) as current_db:
        if not connection and __import__('owner_images').available(current_db,'run',run_id):
            rows=__import__('owner_images').controls('run',run_id)
        run=current_db.execute('SELECT checkpoint,status FROM runs WHERE id=?',(run_id,)).fetchone()
        if run and run['status']=='image_waiting' and json.loads(run['checkpoint'] or '{}').get('revision_id'):
            rows+=[[{'text':'Hủy thay ảnh','callback_data':'kt:creation_cancel:'+run_id}]]
    return rows+[[{'text':'🔄 Thử lại kết nối công cụ' if connection else '▶️ Tiếp tục phần còn thiếu','callback_data':'kt:creation_resume:'+run_id}],
            [{'text':'↩️ Về menu','callback_data':'kt:menu'}]]


def queue_reporting(db,ident):
    try:
        import composio_reporting
        row=db.execute('SELECT * FROM drafts WHERE id=?',(ident,)).fetchone()
        if row:composio_reporting.enqueue_draft(db,row)
        kick_reporting(db)
    except Exception:
        # The publication ledger remains authoritative; a reporting error is
        # never permission to recreate any public content.
        pass


def kick_reporting(db):
    import composio_reporting
    # Unit tests and one-off SQLite copies must never dispatch a live worker.
    location=next((row[2] for row in db.execute('PRAGMA database_list') if row[1]=='main'),'')
    if not location or Path(location).resolve()!=(ROOT/'data/newsroom.sqlite3').resolve():
        return
    settings=composio_reporting.load_settings(ROOT/'data/composio-integrations.local.json')
    if not settings.get('sheets',{}).get('headers_verified'):
        return
    if db.execute("SELECT 1 FROM reporting_leases WHERE name='sheets_sync' AND expires>?",(time.time(),)).fetchone():
        return
    options={'cwd':ROOT,'stdin':subprocess.DEVNULL,
             'env':dict(os.environ,PYTHONIOENCODING='utf-8',PYTHONUTF8='1')}
    if os.name=='nt':options['creationflags']=getattr(subprocess,'CREATE_NO_WINDOW',0)
    with (ROOT/'data/reporting-worker.log').open('a',encoding='utf-8') as log:
        executable=str(Path(config()['hermes_home'])/'hermes-agent/venv/Scripts/python.exe')
        subprocess.Popen([executable,str(ROOT/'connect_composio_channels.py'),'sync','--limit','5'],
                         stdout=log,stderr=log,**options)


def illustration_binding(bundle):
    return digest(json.dumps({'draft':bundle['draft'],'imageSha256':bundle['illustration'].get('generatedImageSha256',bundle['media']['sha256']),
                              'illustration':bundle['illustration']},ensure_ascii=False,sort_keys=True))


def media_pixel_hash(media):
    from PIL import Image
    with Image.open(verify_media(media)) as source:
        pixels=source.convert('RGB')
        return digest(str(pixels.size)+':'+hashlib.sha256(pixels.tobytes()).hexdigest())


def verify_illustration_binding(bundle):
    if bundle.get('illustration',{}).get('origin')=='owner_upload':
        from editorial_images import article_content_hash
        __import__('owner_images').verify(ROOT,dict(bundle['media'],illustration=bundle['illustration']),article_content_hash(bundle['draft']))
    if bundle.get('illustration',{}).get('briefVersion') in (2,3) and not bundle.get('illustrationBinding'):
        raise ValueError('Thiếu ràng buộc bài và ảnh đã kiểm chứng.')
    if bundle.get('illustrationBinding') and illustration_binding(bundle)!=bundle['illustrationBinding']:
        raise ValueError('Bài, mô tả hoặc ảnh đã thay đổi sau khi chuẩn bị duyệt.')
    expected=bundle.get('illustration',{}).get('pixelSha256')
    if expected and media_pixel_hash(bundle['media'])!=expected:
        raise ValueError('Ảnh chuẩn hóa khác pixels đã được kiểm tra với bài.')


def _start_resume_if_idle(run_id,trigger=None):
    trigger=trigger or {}
    db=database();now=time.time()
    try:
        db.execute('BEGIN IMMEDIATE')
        db.execute('DELETE FROM leases WHERE expires<?',(now,))
        row=db.execute('SELECT * FROM runs WHERE id=?',(run_id,)).fetchone()
        if not row:
            rows=db.execute('SELECT id FROM runs WHERE id LIKE ?',(run_id+'%',)).fetchall()
            if len(rows)==1:
                run_id=rows[0]['id'];row=db.execute('SELECT * FROM runs WHERE id=?',(run_id,)).fetchone()
        if (not row or row['cancel_requested'] or not (row['checkpoint'] or row['research_checkpoint'] or row['editor_checkpoint']) or row['status'] not in ('image_waiting','research_waiting','editor_waiting','failed','skipped_insufficient_evidence','blocked_content') or
                db.execute("SELECT 1 FROM leases WHERE name='pipeline'").fetchone()):
            db.commit();return False
        upload=db.execute("SELECT 1 FROM image_upload_sessions WHERE target_kind='run' AND target_id=? AND status IN ('awaiting','processing','accepted') AND finalized_at IS NULL",(run_id,)).fetchone()
        if upload:
            db.commit();return False
        key=trigger.get('event_key')
        if key and db.execute('SELECT 1 FROM creation_requests WHERE event_key=?',(key,)).fetchone():
            db.commit();return False
        db.execute("INSERT INTO leases VALUES('pipeline',?,?)",(run_id,now+control.settings(config())['lease_seconds']))
        automatic=trigger.get('source')=='auto_recovery'
        if not automatic and row['editor_checkpoint']:
            try:checkpoint=load_editor_checkpoint(row['editor_checkpoint'])
            except ValueError:
                db.rollback();return False
            structural=policy.draft_preflight(checkpoint['research'],checkpoint['draft'],now=now)
            details=json.loads(row['details'] or '{}')
            only_verifier_schema=bool(details.get('issues')) and all(x.get('code') in ('VERIFIER_SCHEMA_PRIMARY','VERIFIER_SHAPE','VERIFIER_RESULT_IDS') for x in details['issues'])
            needs_repair=not only_verifier_schema and (not structural['eligible'] or checkpoint.get('next_step')=='repair' or bool(checkpoint.get('repair_inflight')) or bool(details.get('check') and details.get('issues')))
            checkpoint['previous_round_repairs']=checkpoint['repair_count']
            checkpoint.setdefault('round_history',[]).append({'round':checkpoint.get('manual_round',0),
                'structure_repairs':checkpoint.get('structure_repairs',0),'content_repairs':checkpoint.get('content_repairs',0),
                'details':details,'issues':json.loads(row['issues'] or '[]')})
            checkpoint['repair_count']=0
            checkpoint['structure_repairs']=0;checkpoint['content_repairs']=0
            checkpoint['manual_round']=checkpoint.get('manual_round',0)+1
            checkpoint['repair_inflight']=None
            checkpoint['next_step']='repair' if needs_repair else 'validate'
            if needs_repair and not checkpoint.get('repair_payload'):
                check=details.get('check')
                if structural['eligible'] and isinstance(check,dict) and check.get('caption_digest')==digest(checkpoint['draft']['content']):
                    filtered=policy.filter_verified_bundle(checkpoint['research'],checkpoint['draft'],check)
                    checkpoint['repair_payload']=policy.repair_context(checkpoint['research'],checkpoint['draft'],filtered=filtered)
                    if filtered['eligible']:
                        checkpoint['research']=filtered['research']
                        checkpoint['researchHash']=__import__('editorial_runtime').fingerprint(filtered['research'])
                else:
                    checkpoint['repair_payload']=policy.repair_context(checkpoint['research'],checkpoint['draft'],
                        issues=structural['issues'] or details.get('issues',[]))
            db.execute('UPDATE runs SET editor_checkpoint=? WHERE id=?',(json.dumps(checkpoint,ensure_ascii=False),run_id))
        db.execute("UPDATE runs SET status='queued',worker_token=NULL,finished=NULL,issues=NULL,step='Tiếp tục phần còn thiếu',updated=?,resume_automatic=?,recovery_attempts=? WHERE id=?",
                   (now,int(automatic),row['recovery_attempts']+1 if automatic else 0,run_id))
        if key:db.execute('INSERT INTO creation_requests VALUES(?,?,?)',(key,run_id,now))
        db.commit()
        try:background('resume',run_id)
        except Exception:
            with db:
                db.execute("UPDATE runs SET status=?,finished=? WHERE id=?",('image_waiting' if row['checkpoint'] else 'editor_waiting' if row['editor_checkpoint'] else 'research_waiting',time.time(),run_id))
                db.execute("DELETE FROM leases WHERE name='pipeline' AND owner=?",(run_id,))
            raise
        return True
    finally:db.close()


def resume_creation(run_id):
    return pipeline(run_id=run_id,resume=True)


def _start_image_revision(db,ident,actor,message_id=None):
    now=time.time()
    db.execute('BEGIN IMMEDIATE')
    with db:
        __import__('owner_images').assert_unlocked(db,ident)
        row=db.execute('SELECT * FROM drafts WHERE id=?',(ident,)).fetchone()
        if not row or row['status']!='pending' or row['expires']<=now:
            raise ValueError('Chỉ đổi ảnh cho bản còn chờ duyệt; bản đã đăng được giữ nguyên.')
        if db.execute("SELECT 1 FROM leases WHERE name='pipeline' AND expires>?",(now,)).fetchone():
            raise ValueError('Một lượt tạo đang chạy; hãy đổi ảnh sau khi lượt đó kết thúc.')
        changed=db.execute("UPDATE drafts SET status='editing' WHERE id=? AND status='pending'",(ident,))
        if changed.rowcount!=1:raise ValueError('Bản nháp vừa được xử lý ở nơi khác.')
        audit(db,ident,'image_revision_requested',actor,message_id)
    try:background('regenerate-image',ident)
    except Exception:
        with db:db.execute("UPDATE drafts SET status='pending' WHERE id=? AND status='editing'",(ident,))
        raise


def regenerate_illustration(ident):
    db=database();run_id=uuid.uuid4().hex;now=time.time()
    try:
        row=db.execute('SELECT * FROM drafts WHERE id=?',(ident,)).fetchone()
        if not row or row['status']!='editing':raise ValueError('Không có yêu cầu đổi ảnh đang chờ.')
        bundle=json.loads(row['bundle'])
        draft=json.loads(json.dumps(bundle['draft']))
        if dual.is_dual(row):
            # Public payload omits claim references; preserve verified metadata.
            for field in ('title','excerpt','contentMarkdown','seoTitle','seoDescription','coverAlt'):
                if field in bundle['website']:draft['website'][field]=bundle['website'][field]
        draft['_force_new_illustration']=True
        with db:
            db.execute("DELETE FROM leases WHERE expires<?",(now,))
            if db.execute("SELECT 1 FROM leases WHERE name='pipeline'").fetchone():raise ValueError('Lượt tạo khác đang chạy.')
            db.execute("INSERT INTO leases VALUES('pipeline',?,?)",(run_id,now+control.settings(config())['lease_seconds']))
            db.execute("INSERT INTO runs(id,status,started,source,updated) VALUES(?,'queued',?,'image_revision',?)",(run_id,now,now))
        save_verified_checkpoint(db,run_id,bundle['research'],draft,bundle['check'],
                                 content_type=row['content_type'],revision_id=ident,filter_notes=bundle.get('filter_notes',[]))
        db.close();db=None
        return resume_creation(run_id)
    finally:
        if db:db.close()


def create_draft(db, research, draft, check, now=None, revision_of=None,
                 content_type=None, slot_date=None, slot_time=None,
                 filter_notes=None, creation_run_id=None, deadline=None,
                 heartbeat=None, on_stage=None, owner_media=None, owner_upload_token=None):
    live_clock = now is None
    now = now or time.time()
    content_type = str(content_type or draft.get("content_type") or research.get("content_type") or "news").lower()
    draft["content_type"] = content_type
    urls, comment = validate_bundle(research, draft, check, now)
    new_topic = _dedupe_key(research.get("topic"))
    new_content = _dedupe_key(draft.get("content"))
    parent_root=None
    if revision_of:
        original=db.execute('SELECT root_id FROM drafts WHERE id=?',(revision_of,)).fetchone()
        if original:parent_root=original['root_id'] or revision_of
    for row in db.execute("SELECT id,root_id,bundle,status,post_id FROM drafts WHERE created>?", (now-7*86400,)):
        if revision_of and row["id"] == revision_of:
            continue
        if parent_root and (row['root_id'] or row['id'])==parent_root:
            continue
        previous = json.loads(row["bundle"])
        previous_research = previous.get("research", {})
        if row['status'] in ('failed','rejected','expired','superseded','cancelled') and not has_public_receipt(db,row,previous): continue
        if __import__('editorial_rules').version(research)==__import__('editorial_rules').CURRENT:
            summary={'topic':previous_research.get('topic'),'urls':previous.get('urls',[]),'content':previous.get('draft',{}).get('content'),'status':row['status'],'published':has_public_receipt(db,row,previous),'event_keys':list(__import__('editorial_rules').event_keys(previous_research))}
            if __import__('editorial_rules').duplicate(research,summary,draft.get('content')): raise ValueError('Dữ kiện/sự kiện này đã có bài trong bảy ngày.')
            continue
        if new_content and new_content == _dedupe_key(previous.get("draft", {}).get("content")):
            raise ValueError("Nội dung này đã được dùng trong 7 ngày gần đây.")
        previous_topic = _dedupe_key(previous_research.get("topic"))
        if new_topic and previous_topic and new_topic == previous_topic:
            raise ValueError("Chủ đề này đã được dùng trong 7 ngày gần đây.")
        if content_type != "evergreen" and set(urls) == set(previous.get("urls", [])):
            raise ValueError("Bộ nguồn này đã có bài trong 7 ngày gần đây.")
    ident = uuid.uuid4().hex[:10].upper()
    root_id, version = ident, 1
    illustration = None
    if revision_of:
        parent = db.execute("SELECT root_id,version,bundle FROM drafts WHERE id=?", (revision_of,)).fetchone()
        if not parent:
            raise ValueError("Không tìm thấy bản gốc để tạo phiên bản sửa.")
        root_id = parent["root_id"] or revision_of
        version = int(parent["version"] or 1) + 1
        # Reuse only pixels whose content identity AND visual review still match.
        previous_bundle = json.loads(parent["bundle"])
        illustration = previous_bundle.get("illustration")
        from editorial_images import article_content_hash, resolve_illustration_brief
        same_article = illustration and illustration.get('contentHash') == article_content_hash(draft)
        same_headline = previous_bundle.get('draft',{}).get('imageHeadline') == draft.get('imageHeadline')
        frozen = illustration.get('brief') if same_article and same_headline else None
        brief = resolve_illustration_brief(draft,root=ROOT,saved_brief=frozen)
        owner_reuse=bool(not draft.get('_force_new_illustration') and illustration and illustration.get('origin')=='owner_upload' and illustration.get('contentHash')==brief['contentHash'])
        if owner_reuse:
            __import__('owner_images').verify(ROOT,dict(previous_bundle['media'],illustration=illustration),brief['contentHash'])
        can_reuse = owner_reuse or bool(not draft.get('_force_new_illustration') and same_headline and illustration and illustration.get("contentHash") == brief["contentHash"]
                         and illustration.get("visualReview", {}).get("pass") is True
                         and illustration.get("visualReview", {}).get("imageSha256") == illustration.get('generatedImageSha256',previous_bundle["media"]["sha256"])
                         and illustration.get("briefHash") == brief.get("briefHash"))
        if can_reuse:
            verify_illustration_binding(previous_bundle)
            if not owner_reuse:
                from editorial_images import _review_matches
                reviewed_media=dict(previous_bundle['media'],sha256=illustration.get('generatedImageSha256',previous_bundle['media']['sha256']))
                if not _review_matches(illustration.get('visualReview'),reviewed_media,brief):
                    raise ValueError('Kết quả kiểm ảnh đã lưu không hợp lệ; giữ bản cũ để đối soát.')
            media = dict(previous_bundle["media"])
        else:
            illustration = None
    if owner_media is not None:
        from owner_images import verify
        from editorial_images import article_content_hash
        verify(ROOT,owner_media,article_content_hash(draft))
        media=deepcopy(owner_media)
        illustration=media.pop('illustration')
    elif not revision_of or illustration is None:
        frozen = None
        if creation_run_id:
            run = db.execute('SELECT checkpoint FROM runs WHERE id=?',(creation_run_id,)).fetchone()
            frozen = json.loads(run[0]).get('visual_brief') if run and run[0] else None
        media = dict(load_media(draft, run_id=creation_run_id or ident, deadline=deadline,
                                heartbeat=heartbeat, on_stage=on_stage, saved_brief=frozen))
        illustration = media.pop("illustration", None)
    if creation_run_id:
        from editorial_images import article_content_hash
        chosen=__import__('owner_images').selected(ROOT,creation_run_id,article_content_hash(draft))
        if chosen:
            media=dict(chosen);illustration=media.pop('illustration')
    if deadline is not None and time.monotonic() >= deadline:
        raise TimeoutError("Lượt tạo bài hết giới hạn trước khi lưu bản duyệt có ảnh.")
    # Image generation can cross a source expiry or midnight. Check again after
    # it completes, before freezing the content/image package in the database.
    urls, comment = validate_bundle(research, draft, check,
                                    time.time() if live_clock or creation_run_id or deadline is not None else now)
    if illustration and isinstance(draft.get("website"), dict):
        draft = dict(draft, website=dict(draft["website"], coverAlt=illustration["alt"]))
    draft=dict(draft)
    draft.pop('_force_new_illustration',None)
    data = {"research": research, "draft": draft, "check": check, "urls": urls,
            "source_comment":comment,"media":media,"content_type":content_type,
            "filter_notes": filter_notes or []}
    if illustration:
        if illustration.get('briefVersion') in (2,3):
            illustration['sourceRevision']=version
            illustration['generatedImageSha256']=illustration.get('generatedImageSha256',media['sha256'])
            illustration['pixelSha256']=media_pixel_hash(media)
        data["illustration"] = illustration
        if illustration.get('briefVersion') in (2,3):
            data['illustrationBinding']=illustration_binding(data)
    if creation_run_id:
        data['creation_run_id']=creation_run_id
        run=db.execute('SELECT requested_topic,audience_checkpoint FROM runs WHERE id=?',(creation_run_id,)).fetchone()
        if run:data['requested_topic']=run['requested_topic']
    content, reviewed_digest = draft["content"], package_digest(draft["content"], media)
    if website_bridge.enabled() and not os.environ.get('KIM_TUYEN_DUAL_DISABLED'):
        data['dual_pending']=True
    # FencedConnection starts its own transaction before writes; explicit BEGIN
    # must use the base connection to avoid a nested BEGIN in creation workers.
    if not db.in_transaction:sqlite3.Connection.execute(db,'BEGIN IMMEDIATE')
    with db:
        # Recheck after all image work, while the write lock excludes upload/cancel.
        if creation_run_id:
            chosen=db.execute("""SELECT s.media FROM owner_image_selections s JOIN image_upload_sessions u ON u.token=s.token
                WHERE s.target_kind='run' AND s.target_id=? AND s.content_hash=? AND u.status='accepted'""",(creation_run_id,__import__('editorial_images').article_content_hash(draft))).fetchone()
            if chosen and (json.loads(chosen['media'])['sha256']!=data['media']['sha256'] or json.loads(chosen['media'])['illustration']['uploadToken']!=data.get('illustration',{}).get('uploadToken')):
                raise RuntimeError('Ảnh chủ trang vừa được chọn; tiếp tục bằng ảnh đã lưu.')
        upload_token=owner_upload_token
        if not upload_token and creation_run_id and illustration and illustration.get('origin')=='owner_upload':
            upload_token=illustration.get('uploadToken')
        if upload_token:
            upload=db.execute('SELECT * FROM image_upload_sessions WHERE token=?',(upload_token,)).fetchone()
            if not upload or upload['status']!='accepted':raise ValueError('Phiên thay ảnh đã hủy; không tạo bản duyệt.')
            if upload['result_draft_id']:return upload['result_draft_id']
        db.execute("""INSERT INTO drafts
            (id,content,digest,bundle,status,created,expires,revision_of,root_id,version,
             content_type,slot_date,slot_time)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (ident,content,reviewed_digest,json.dumps(data,ensure_ascii=False),
             "preparing",now,now+config()["approval_ttl_minutes"]*60,revision_of,root_id,version,
             content_type,slot_date,slot_time))
        if upload_token:
            updated=db.execute("UPDATE image_upload_sessions SET result_draft_id=?,updated=? WHERE token=? AND status='accepted' AND result_draft_id IS NULL",(ident,time.time(),upload_token))
            if updated.rowcount!=1:raise RuntimeError('Phiên thay ảnh đã được xử lý ở nơi khác.')
            if upload['target_kind']=='run' and not creation_run_id:
                associated=db.execute("UPDATE runs SET draft_id=?,next_step='review_delivery',updated=? WHERE id=? AND draft_id=?",(ident,time.time(),upload['target_id'],revision_of))
                if associated.rowcount!=1:raise RuntimeError('Lượt tạo đã chuyển sang bản khác; không thay liên kết.')
        audit(db, ident, "verified_draft_created")
        if creation_run_id:
            associated=db.execute("UPDATE runs SET draft_id=?,next_step='review_delivery',updated=? WHERE id=? AND draft_id IS NULL",
                                  (ident,time.time(),creation_run_id))
            if associated.rowcount!=1:
                db.rollback()
                raise RuntimeError('Không lưu được liên kết bản duyệt với lượt tạo; không gửi bản rời nhật ký.')
        if revision_of:
            db.execute("UPDATE drafts SET status='superseded' WHERE id=? AND status IN ('pending','editing','preparing')",(revision_of,))
    queue_reporting(db,ident)
    return ident

def review_message_text(db, row, *, expiry=None):
    ident=row['id'];c=config();bundle=json.loads(row['bundle'])
    expiry=row['expires'] if expiry is None else expiry
    expires=datetime.fromtimestamp(expiry,ZoneInfo('Asia/Ho_Chi_Minh'))
    filter_notes = bundle.get("filter_notes", [])
    audience_note = ''
    if bundle.get('research',{}).get('source_policy_version'):
        from editorial_diversity import lane,LANES
        origins=sorted(policy.independent_source_groups(bundle['research'].get('sources',[])))
        result=bundle.get('check',{}).get('compliance',{})
        audience_note='\nNhóm đề tài: '+LANES[lane(bundle['research'].get('topic',''))][0]+'\nNguồn gốc: '+', '.join(origins)+'\nKiểm tra nội dung: '+result.get('status','chưa đạt')
    if bundle.get('creation_run_id'):
        context = db.execute('SELECT audience_checkpoint FROM runs WHERE id=?',(bundle['creation_run_id'],)).fetchone()
        if context and context['audience_checkpoint']:
            from audience_signals import review_note
            audience_note += review_note(json.loads(context['audience_checkpoint']))
    from editorial_compliance import release_advisories
    warnings=release_advisories(bundle,c)
    if warnings:audience_note+='\n'+'\n'.join(warnings)
    omitted = ""
    if filter_notes:
        omitted = "\n\nĐÃ LOẠI KHỎI BẢN NÀY:\n" + "\n".join(
            "• " + str(item.get("claim_id") or item.get("source_id") or "dữ kiện") + ": " + str(item.get("reason", "chưa đủ bằng chứng"))[:220]
            for item in filter_notes
        )
    msg = (f"ĐĂNG • BẢN DUYỆT {ident} · phiên bản {row['version'] or 1}\n"
           f"Loại bài: {row['content_type'] or 'news'}\n"
           f"Fanpage: {c['page_name']}\n"
           + ("Website: " + bundle["website"]["url"] + "\nXem toàn văn bằng nút Xem bản website; một lần duyệt đăng cả hai nơi.\n" if bundle.get("schema_version") in (2,3) else "") +
           f"Kiểm chứng: ĐẠT{audience_note}\n"
           f"Hạn duyệt: {expires:%H:%M %d/%m/%Y} (giờ Việt Nam)\n\n"
           "—— NỘI DUNG SẼ ĐĂNG ——\n" + row["content"] + omitted +
           "\n\nNguồn tham khảo được mở bằng nút bên dưới.")
    return msg


@media_storage.draft_cache
def request_review(db, ident):
    control.ensure_active()
    cancelled=db.execute('SELECT 1 FROM runs WHERE draft_id=? AND cancel_requested=1',(ident,)).fetchone()
    if cancelled:raise control.CreationCancelled('Lượt tạo đã hủy; không gửi bản duyệt.')
    row = db.execute("SELECT * FROM drafts WHERE id=?", (ident,)).fetchone()
    if not row:
        raise ValueError("Không tìm thấy bản nháp để gửi duyệt.")
    if row["status"] not in ("preparing","pending"):
        raise ValueError("Bản duyệt đã được xử lý hoặc thay thế; không gửi lại.")
    if row["review_message"]:
        return str(row["review_message"])
    row=dual.ensure_prepared(db,ident)
    # Serialize Telegram delivery for this draft. The short lease covers the
    # image and text sends while allowing a later tick to resume after a crash;
    # the image message ID is persisted before the text is attempted.
    lease_owner = uuid.uuid4().hex
    lease_name = "review:" + ident
    with db:
        db.execute("DELETE FROM leases WHERE expires<?", (time.time(),))
        try:
            db.execute("INSERT INTO leases(name,owner,expires) VALUES(?,?,?)",
                       (lease_name, lease_owner, time.time() + 300))
        except sqlite3.IntegrityError:
            existing = db.execute("SELECT review_message FROM drafts WHERE id=?", (ident,)).fetchone()
            if existing and existing["review_message"]:
                return str(existing["review_message"])
            raise RuntimeError("Bản duyệt đang được gửi; hệ thống sẽ tự tiếp tục, không gửi trùng.")
    c = config()
    try:
        media = json.loads(row["bundle"])["media"]
        bundle = json.loads(row["bundle"])
        image_message = row["review_image_message"]
        if not image_message:
            if bundle.get('facebook_mode')=='video':
                dual.validate_package(bundle)
                image_message=telegram('editor',f'VIDEO GIỌNG ĐỌC • BẢN DUYỆT {ident}\nXem và nghe đầy đủ trước khi duyệt.',video=bundle['videoLocal']['path'])
            else:
                description = ('Ảnh do chủ trang cung cấp · Bỏ qua kiểm duyệt AI. ' if bundle.get('illustration',{}).get('origin')=='owner_upload' else '')+(bundle.get("illustration", {}).get("alt") or "Ảnh AI minh họa thị trường vàng, không phải bảng giá.")
                image_message = telegram("editor",f"ẢNH MINH HỌA • BẢN DUYỆT {ident}\n{description[:240]}",photo=verify_media(media))
            with db:
                db.execute("UPDATE drafts SET review_image_message=? WHERE id=? AND review_message IS NULL",
                           (str(image_message), ident))
        sent_at = time.time()
        expiry = sent_at + c["approval_ttl_minutes"] * 60
        if bundle.get('schema_version') in (2,3):
            expiry = min(expiry, datetime.fromisoformat(bundle['bridge']['expiresAt'].replace('Z','+00:00')).timestamp())
        expires = datetime.fromtimestamp(expiry, ZoneInfo("Asia/Ho_Chi_Minh"))
        msg=review_message_text(db,row,expiry=expiry)
        if len(msg.encode('utf-16-le'))//2 > 4096:
            raise ValueError("Bản duyệt quá dài cho Telegram.")
        # The row is still `preparing` until this message is delivered; render the
        # controls for the pending state so the first review message is actionable.
        inline = draft_keyboard(ident, row["digest"][:12], "pending")
        mid = telegram("editor",msg,reply_to=image_message,inline_keyboard=inline)
        with db:
            db.execute("""UPDATE drafts SET status='pending',review_message=?,review_sent_at=?,expires=?
                WHERE id=? AND review_message IS NULL AND status IN ('preparing','pending')""",
                       (mid, sent_at, expiry, ident))
            audit(db, ident, "review_delivered", message_id=mid)
            audit(db, ident, "review_image_delivered", message_id=image_message)
        queue_reporting(db,ident)
        return mid
    finally:
        with db:
            db.execute("DELETE FROM leases WHERE name=? AND owner=?", (lease_name, lease_owner))


def draft_release_status(row):
    from editorial_compliance import release_status
    bundle=json.loads(row['bundle'])
    state=release_status(bundle,config())
    if not state['eligible']:return state
    if row['status']=='pending' and row['expires']<=time.time():
        return {**state,'eligible':False,'code':'REVIEW_EXPIRED','reason':'Bản duyệt hết hạn; cần nghiên cứu và duyệt bản mới.'}
    try:
        verify_media(bundle['media'])
        verify_illustration_binding(bundle)
    except (ValueError, OSError) as exc:
        return {**state,'eligible':False,'code':'MEDIA_REVIEW','reason':str(exc)}
    try:
        if dual.is_dual(row):
            dual.validate_package(bundle)
            expected=dual.review_digest(bundle)
        else:expected=package_digest(row['content'],bundle['media'])
        if expected!=row['digest']:raise ValueError('Mã phiên bản không khớp nội dung đã gửi duyệt.')
    except (ValueError,KeyError,TypeError) as exc:
        reason=str(exc) if isinstance(exc,ValueError) else 'Gói phát hành chưa đầy đủ hoặc đã thay đổi; cần chuẩn bị lại.'
        return {**state,'eligible':False,'code':'PACKAGE_CHANGED','reason':reason}
    return state


def release_button_label(state):
    return {'LEGAL_REVIEW':'📋 Chờ hồ sơ pháp lý','CONTENT_REVIEW':'⚠️ Cần kiểm chứng lại nội dung',
            'SOURCE_POLICY':'⚠️ Nguồn chưa đủ điều kiện','MEDIA_REVIEW':'⚠️ Cần kiểm tra lại ảnh',
            'PACKAGE_CHANGED':'⚠️ Phiên bản bài đã thay đổi'}.get(state.get('code'),'⚠️ Chưa đủ điều kiện đăng')


def refresh_pending_reviews(db):
    """Edit existing Telegram messages only; never approve, extend or publish."""
    results=[]
    for saved in db.execute("SELECT id FROM drafts WHERE status='pending' AND review_message IS NOT NULL ORDER BY created").fetchall():
        row=db.execute('SELECT * FROM drafts WHERE id=?',(saved['id'],)).fetchone()
        if row['status']!='pending':continue
        keyboard=draft_keyboard(row['id'],row['digest'][:12],'pending',expired=row['expires']<=time.time())
        text=review_message_text(db,row)
        text_ok=False
        if len(text.encode('utf-16-le'))//2<=4096:
            text_ok=telegram_edit(row['review_message'],text,inline_keyboard=keyboard)
        controls_ok=text_ok or telegram_edit_markup(row['review_message'],keyboard)
        results.append({'id':row['id'],'message_id':row['review_message'],'text_updated':text_ok,
                        'controls_updated':controls_ok,'expired':row['expires']<=time.time(),
                        'approve_visible':any(str(b.get('callback_data','')).startswith('kt:approve:') for line in keyboard for b in line)})
    return results


def draft_keyboard(ident, short_hash, status="pending", post_id=None, expired=False):
    """Inline controls attached to exactly one draft message."""
    dual_row = None
    release_block = None
    story_enabled = False
    try:
        with closing(sqlite3.connect((ROOT/'data/newsroom.sqlite3').as_uri()+'?mode=ro',uri=True)) as lookup:
            lookup.row_factory=sqlite3.Row
            candidate=lookup.execute('SELECT * FROM drafts WHERE id=?',(ident,)).fetchone()
            if candidate:
                upload=__import__('owner_images').blocking_session(lookup,ident)
                if upload and status in ('pending','editing','preparing'):
                    return [[{'text':'Đang thay ảnh · bản cũ đang khóa','callback_data':'kt:noop'}]]+__import__('owner_images').session_controls(upload['token'])
                release_block=draft_release_status(candidate)
                if status=='pending' and candidate['status']=='pending' and candidate['expires']<=time.time():expired=True
            if candidate and dual.is_dual(candidate):
                dual_row=candidate
                story_enabled=__import__('facebook_story').enabled(lookup)
            if dual_row and status in ('approved','publishing','published','uncertain'):
                return dual.keyboard(lookup,dual_row)
    except sqlite3.Error:
        pass
    if status == "expired" or (status == "pending" and expired):
        return [[{"text": "📝 Tạo bản cập nhật", "callback_data": f"kt:revive:{ident}"}],
                [{"text": "↩️ Về menu", "callback_data": "kt:menu"}]]
    if status == "pending":
        is_video=bool(dual_row and json.loads(dual_row["bundle"]).get("facebook_mode")=="video")
        return [
            *([[{"text":release_button_label(release_block),"callback_data":f"kt:checks:{ident}"}]] if release_block and not release_block["eligible"] else [[{"text": "✅ Duyệt và đăng Website + Video Facebook" if is_video else "✅ Duyệt Website + Facebook + Tin ảnh" if dual_row and story_enabled else "✅ Duyệt và đăng Website + Facebook" if dual_row else "✅ Duyệt và đăng", "callback_data": f"kt:approve:{ident}:{short_hash}"}]]),
            [{"text":"Tạo video giọng đọc","callback_data":f"kt:video_create:{ident}"}],
            *([[{"text":"Dùng bài ảnh","callback_data":f"kt:video_photo_ready:{ident}"}]] if is_video else []),
            [{"text": "✏️ Sửa bài", "callback_data": f"kt:edit:{ident}"},
             {"text": "🗑 Hủy bản nháp", "callback_data": f"kt:cancel:{ident}"}],
            *([[{"text":"📰 Xem bản website","callback_data":f"kt:website:{ident}:0"}]] if dual_row else []),
            *(__import__('owner_images').controls('draft',ident)),
            [{"text":"Đổi ảnh","callback_data":f"kt:image:{ident}"}],
            [{"text": "🔎 Chi tiết kiểm chứng", "callback_data": f"kt:checks:{ident}"}],
            [{"text": "🔗 Xem nguồn", "callback_data": f"kt:sources:{ident}"},
             {"text": "↩️ Về menu", "callback_data": "kt:menu"}],
        ]
    if status=='video_preparing':
        try:
            import video_workflow
            with closing(database()) as db:
                return video_workflow.controls(db,ident)+[[{'text':'Cập nhật trạng thái','callback_data':'kt:open:'+ident}]]
        except Exception:
            return [[{'text':'Đang chuẩn bị video','callback_data':'kt:noop'}]]
    if status in ("approved", "publishing"):
        return [[{"text": "⏳ Đang đăng", "callback_data": "kt:noop"}],
                [{"text": "↩️ Về menu", "callback_data": "kt:menu"}]]
    if status == "published":
        return [[{"text": "🌐 Mở Facebook", "url": f"https://www.facebook.com/{post_id or ident}"}],
                [{"text": "↩️ Về menu", "callback_data": "kt:menu"}]]
    if status == "uncertain":
        rows = [[{"text": "🔍 Đối soát Facebook", "callback_data": f"kt:reconcile:{ident}"}]]
        if not post_id:
            rows.append([{"text": "🔁 Gửi lại", "callback_data": f"kt:retry:{ident}"}])
        rows.append([{"text": "↩️ Về menu", "callback_data": "kt:menu"}])
        return rows
    return [[{"text": "↩️ Về menu", "callback_data": "kt:menu"}]]

def pipeline(revision_id=None, revision_note=None, *, slot_date=None,
             slot_time=None, scheduled=False, run_id=None, trigger=None,
             requested_topic=None, resume=False):
    db, c, now = database(), config(), time.time()
    if not c.get("enabled"):
        db.close()
        return {"status": "disabled"}
    run_id = run_id or uuid.uuid4().hex
    trigger = trigger or {"source": "scheduled" if scheduled else "cli"}
    declined = None
    with db:
        db.execute("DELETE FROM leases WHERE expires<?", (now,))
        existing = db.execute('SELECT * FROM runs WHERE id=?', (run_id,)).fetchone()
        lease = db.execute("SELECT owner FROM leases WHERE name='pipeline'").fetchone()
        if existing:
            if existing['status'] != 'queued' or not lease or lease['owner'] != run_id:
                declined = {"status": "already_started", "run_id": run_id}
            else:now = existing['started']
        elif lease:
            declined = {"status": "busy", "run_id": lease['owner']}
        else:
            db.execute("INSERT INTO leases VALUES('pipeline',?,?)", (run_id, now+control.settings(c)['lease_seconds']))
            db.execute("""INSERT INTO runs(id,status,started,source,trigger_key,actor,chat_id,message_id,callback_id,updated)
                VALUES(?, 'queued', ?,?,?,?,?,?,?,?)""",
                (run_id, now, trigger.get('source'), trigger.get('event_key'), trigger.get('actor'),
                 trigger.get('chat_id'), trigger.get('message_id'), trigger.get('callback_id'), now))
        if not declined:
            requested_topic = normalize_requested_topic(requested_topic or (existing['requested_topic'] if existing else None) or trigger.get('requested_topic'))
            db.execute("UPDATE runs SET status='researching',step='Đang nghiên cứu nguồn',updated=?,requested_topic=? WHERE id=?", (time.time(),requested_topic,run_id))
    if declined:
        db.close();return declined
    if slot_date and slot_time:
        with db:db.execute('UPDATE daily_slots SET run_id=?,updated=? WHERE slot_date=? AND slot_time=?',
                           (run_id,time.time(),slot_date,slot_time))
    try:
        owner = control.CreationControl(db,run_id,c)
    except control.OwnershipLost:
        db.close();return {'status':'already_started','run_id':run_id}
    total_seconds=control.settings(c)['total_timeout_seconds']
    deadline = None if total_seconds is None else time.monotonic()+total_seconds
    progress_id = existing['progress_message'] if existing else None
    ident, verify_attempt, repaired = None, 0, False
    structure_repairs, content_repairs = 0, 0
    current_step = 'Đang nghiên cứu nguồn'
    request_trigger = dict(existing) if existing else trigger
    evidence_path, research_metadata, resumed_research = None, {}, None
    resume_context={}
    resumed_editor=None
    editor_spent=0.0
    audience_context = json.loads(existing['audience_checkpoint']) if existing and existing['audience_checkpoint'] else {}

    def remaining():
        owner.check()
        left = float('inf') if deadline is None else deadline-time.monotonic()
        if left <= 0:
            raise TimeoutError('Lượt tạo bài đã hết thời gian xử lý được cấu hình.')
        return left

    def progress(text=None,meta=None):
        owner.check()
        nonlocal progress_id, current_step
        if text:
            current_step = text
        elapsed = max(0,int(time.time()-now))
        details=[]
        if meta:
            if meta.get('substep'):details.append(str(meta['substep']))
            if meta.get('provider'):details.append('AI: '+PROVIDER_NAMES.get(meta['provider'],str(meta['provider'])))
            phases={'worker_ready':'đã khởi động','auth_ready':'đã xác thực','api_dispatched':'đang chờ phản hồi',
                    'stream_progress':'đang nhận nội dung','response_received':'đã nhận kết quả','request_finished':'đã kết thúc yêu cầu'}
            if meta.get('request_phase') in phases:details.append(phases[meta['request_phase']])
            if 'source_count' in meta:details.append(f"Đã đọc {int(meta['source_count'])} nguồn")
            if 'eligible_source_count' in meta:details.append(f"Đủ điều kiện {int(meta['eligible_source_count'])} nguồn")
        detail_text=('\n'+' · '.join(details)) if details else ''
        body = f"📝 TẠO BÀI • {run_id[:8]}\n{current_step}{detail_text}\nĐã chờ {elapsed//60} phút {elapsed%60:02d} giây"
        keyboard=[[{'text':'⏹ Hủy lượt tạo','callback_data':'kt:creation_cancel:'+run_id}],*menu_keyboard()]
        if __import__('owner_images').available(db,'run',run_id): keyboard=__import__('owner_images').controls('run',run_id)+keyboard
        if meta and 'generation_count' in meta: body+=f"\nĐã dùng {meta['generation_count']}/5 lần tạo ảnh"
        with db:
            db.execute('UPDATE runs SET step=?,updated=? WHERE id=?', (current_step,time.time(),run_id))
        if progress_id:
            try:return telegram_edit(progress_id, body, inline_keyboard=keyboard, timeout=5)
            except Exception:return False
        try:
            progress_id = telegram('editor',body,inline_keyboard=keyboard,
                                   reply_to=request_trigger.get('message_id'))
            with db:db.execute('UPDATE runs SET progress_message=? WHERE id=?',(progress_id,run_id))
            return True
        except Exception:
            return False

    def stage_checkpoint(meta):
        stage = meta['stage']
        status = {'audience':'researching','research':'researching','editor':'editing','verify':'verifying',
                  'illustration':'illustrating','visual_review':'illustrating'}.get(stage,stage)
        with db:
            db.execute("""INSERT INTO creation_stages(id,run_id,stage,attempt,status,started,finished,seconds,request_path,result_path,metadata)
                VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,
                finished=excluded.finished,seconds=excluded.seconds,metadata=excluded.metadata""",
                (meta['id'],run_id,stage,meta['attempt'],meta['status'],meta.get('started'),meta.get('finished'),
                 meta.get('seconds'),meta.get('request_path'),meta.get('result_path'),json.dumps(meta,ensure_ascii=False)))
            db.execute('UPDATE runs SET status=?,next_step=COALESCE(?,next_step),updated=? WHERE id=?',(status,meta.get('next_step'),time.time(),run_id))
            if stage=='research' and meta.get('next_step')=='synthesis':
                stored=db.execute('SELECT research_checkpoint FROM runs WHERE id=?',(run_id,)).fetchone()
                if stored and stored[0]:
                    checkpoint=json.loads(stored[0]);checkpoint['research_metadata']=meta
                    checkpoint['evidence_path']=meta.get('evidence_path',checkpoint.get('evidence_path'))
                    db.execute('UPDATE runs SET research_checkpoint=? WHERE id=?',(json.dumps(checkpoint,ensure_ascii=False),run_id))

    def call(stage, payload, label):
        nonlocal editor_spent
        if stage in ('editor','verify') and isinstance(payload,dict):
            payload=dict(payload,evidence_path=evidence_path,research_metadata=research_metadata)
        remaining(); progress(label)
        stage_deadline=deadline
        with db:db.execute('UPDATE runs SET next_step=? WHERE id=?',(stage,run_id))
        began=time.monotonic()
        if stage=='editor' and payload.get('previous_draft'):
            __import__('editorial_runtime').reserve_repair(db,run_id,payload.get('repair_kind','content'))
        try:
            result = agent(stage,payload,run_id=run_id,deadline=stage_deadline,
                           heartbeat=lambda meta:progress(meta=meta),on_stage=stage_checkpoint)
        except creation_runtime.RuntimeStageTimeout as exc:
            if stage=='editor' and (deadline is None or time.monotonic()<deadline):
                raise creation_runtime.RuntimeStageError('Đã dùng hết ngân sách bước viết bài; giữ checkpoint để tiếp tục.',
                    dict(exc.metadata,error_code='EDITOR_BUDGET')) from exc
            raise
        except creation_runtime.RuntimeStageError as exc:
            if stage=='editor':
                __import__('editorial_runtime').record_outcome(db,run_id,
                    {'_worker_error':{'code':exc.metadata.get('error_code','EDITOR_ERROR'),'reason':str(exc)}},exc.metadata.get('id'))
            raise
        finally:
            if stage=='editor':editor_spent+=max(0,time.monotonic()-began)
        remaining()
        if stage=='editor':
            row=db.execute("SELECT id FROM creation_stages WHERE run_id=? AND stage='editor' ORDER BY started DESC LIMIT 1",(run_id,)).fetchone()
            outcome=__import__('editorial_runtime').record_outcome(db,run_id,result,row[0] if row else None)
            if outcome['code'] in ('EDITOR_REFUSED','EDITOR_EMPTY','EDITOR_SHAPE'):
                raise creation_runtime.RuntimeStageError('AI chưa tạo được bản sửa hợp lệ; bản trước đã được giữ lại. '+outcome['reason'],{'error_code':outcome['code']})
        return result

    def verify(research,draft,content_type):
        nonlocal verify_attempt,evidence_path
        verify_attempt += 1
        check = call('verify', {'now':datetime.now(timezone.utc).isoformat(),
            'research':research,'draft':draft,'website':draft.get('website'),
            'content_type':content_type,'caption_digest':digest(draft['content']),
            'evidence_path':evidence_path,'research_metadata':research_metadata,
            'verification_attempt':verify_attempt}, 'Đang kiểm chứng độc lập'+(' bản đã sửa' if repaired else ''))
        check.setdefault('caption_digest',digest(draft['content']))
        evidence_path=check.pop('_evidence_path',None) or evidence_path
        with db:record_verification(db,run_id,verify_attempt,draft,check)
        return check

    def editor_preflight(research,draft):
        extra=draft.pop('_editor_issues',[])
        checked=policy.draft_preflight(research,draft,now=time.time())
        if extra:
            checked['issues'].extend(extra);checked['eligible']=False
        return checked

    def finish(status, issues=None, check=None, dropped=None):
        owner.check()
        saved = db.execute('SELECT checkpoint,research_checkpoint,editor_checkpoint,draft_id FROM runs WHERE id=?',(run_id,)).fetchone()
        if status == 'failed' and saved and saved['checkpoint'] and not saved['draft_id']:
            status = 'image_waiting'
        elif status == 'failed' and saved and saved['editor_checkpoint'] and not saved['draft_id']:
            status='editor_waiting'
        elif status == 'failed' and saved and saved['research_checkpoint'] and not saved['draft_id']:
            checkpoint=json.loads(saved['research_checkpoint'])
            if checkpoint.get('evidence_path'):
                status='research_waiting'
        reasons = [x.get('reason',str(x)) if isinstance(x,dict) else str(x) for x in (issues or [])]
        reason = '; '.join(dict.fromkeys(reasons))[:1200] or 'Không có hồ sơ đủ điều kiện gửi duyệt.'
        web_failure=next((x for x in (issues or []) if str(x.get('code','')).lower().startswith('web_')),None)
        contract_failure=next((x for x in (issues or []) if x.get('code') in ('SOURCE_REFERENCE_INVALID','SOURCE_CONTRACT_INVALID','CLAIM_QUOTE_INVALID')),None)
        if web_failure:reason='Kết nối công cụ đọc nguồn lỗi. '+reason
        details = {'reason':reason,'issues':issues or [],'dropped':dropped or [],'check':check}
        with db:
            db.execute('UPDATE runs SET status=?,finished=?,details=?,issues=?,updated=? WHERE id=?',
                       (status,time.time(),json.dumps(details,ensure_ascii=False),json.dumps(issues or [],ensure_ascii=False),time.time(),run_id))
            if revision_id:
                # Never re-enable a replaced draft or an image revision waiting for retry.
                if status!='image_waiting' and not __import__('owner_images').blocking_session(db,revision_id):
                    db.execute("UPDATE drafts SET status='pending' WHERE id=? AND status='editing' AND NOT EXISTS(SELECT 1 FROM drafts child WHERE child.revision_of=?)",(revision_id,revision_id))
                db.execute("UPDATE edit_sessions SET status='failed' WHERE draft_id=? AND status='processing'",(revision_id,))
        label = 'Cần xử lý để tiếp tục' if status in ('image_waiting','research_waiting','editor_waiting') else 'Không tạo được bản duyệt' if status != 'awaiting_approval' else 'Đã gửi bản duyệt'
        if web_failure:label='Kết nối công cụ đọc nguồn lỗi'
        elif contract_failure:label='Hồ sơ nguồn cần sửa định dạng/chứng cứ'
        shown = progress(f'{label}.\n{reason}\nKhông có bài nào được đăng.')
        if not shown:
            try:telegram('editor',f'ĐĂNG • {label}.\n{reason}\nMã lượt: {run_id}',inline_keyboard=creation_retry_keyboard(run_id) if status in ('image_waiting','research_waiting','editor_waiting') else menu_keyboard())
            except Exception:pass
        if status == 'image_waiting' and progress_id:
            try:telegram_edit(progress_id, f'⚠️ Bài đã được lưu; bước ảnh cần tiếp tục.\n{reason}\nMã lượt: {run_id}', inline_keyboard=creation_retry_keyboard(run_id), timeout=5)
            except Exception:pass
        elif status in ('research_waiting','skipped_insufficient_evidence','blocked_content') and progress_id and not web_failure:
            try:telegram_edit(progress_id, f'⚠️ Hồ sơ nguồn đã được lưu; có thể tiếp tục phần còn thiếu.\n{reason}\nMã lượt: {run_id}', inline_keyboard=creation_retry_keyboard(run_id), timeout=5)
            except Exception:pass
        elif web_failure and progress_id:
            try:telegram_edit(progress_id, f'⚠️ Kết nối công cụ đọc nguồn lỗi.\n{reason}\nHồ sơ đã lưu; thử lại kết nối để tiếp tục.\nMã lượt: {run_id}', inline_keyboard=creation_retry_keyboard(run_id,connection=True),timeout=5)
            except Exception:pass
        elif status == 'editor_waiting' and progress_id:
            try:telegram_edit(progress_id,f'⚠️ Bản thảo chưa kiểm chứng đã được lưu; có thể tiếp tục đúng bước.\n{reason}\nMã lượt: {run_id}',inline_keyboard=creation_retry_keyboard(run_id),timeout=5)
            except Exception:pass
        return {'status':'skipped' if status=='skipped_insufficient_evidence' else 'failed',
                'run_id':run_id,'error':reason[:500],'issues':issues or [],'dropped':dropped or []}

    try:
        if resume and (not existing or not (existing['checkpoint'] or existing['research_checkpoint'] or existing['editor_checkpoint'])):
            raise ValueError('Không có hồ sơ nguồn hoặc nội dung đã kiểm chứng để tiếp tục.')
        if resume and not existing['draft_id']:
            saved_research=json.loads(existing['research_checkpoint'] or existing['checkpoint'] or '{}')
            declared=saved_research.get('research',{})
            if declared.get('eligible'):
                freshness=policy.research_preflight(declared,now=time.time(),max_source_age_hours=c['max_source_age_hours'])
                duplicates=[] if saved_research.get('revision_id') else policy.duplicate_research_issues(declared,recent_post_summaries(db,time.time()))
                if duplicates or any(item['code']=='SOURCE_TOO_OLD' for item in freshness['issues']):
                    existing=dict(existing)
                    saved_research['request_payload']={**saved_research.get('request_payload',{}),
                        'source_issues':duplicates or freshness['issues'],'previous_research':declared}
                    saved_research.update(eligible=False,research={},research_metadata={'next_step':'collection'})
                    existing.update(checkpoint=None,editor_checkpoint=None,research_checkpoint=json.dumps(saved_research,ensure_ascii=False),next_step='collection')
                    with db:db.execute("UPDATE runs SET checkpoint=NULL,editor_checkpoint=NULL,research_checkpoint=?,next_step='collection' WHERE id=?",(existing['research_checkpoint'],run_id))
        readiness=creation_runtime.editor_readiness(c)
        if readiness:
            return finish('failed',[policy.issue(readiness['code'],readiness['reason'],field=readiness['field'])])
        if not resume:
            from audience_signals import load_for_run
            progress('Đang lấy dữ liệu độc giả')
            audience_context = load_for_run(ROOT,c,run_id,deadline,
                heartbeat=lambda meta:progress(meta=meta),on_stage=stage_checkpoint)
            with db:
                db.execute('UPDATE runs SET audience_checkpoint=?,updated=? WHERE id=?',
                    (json.dumps(audience_context,ensure_ascii=False),time.time(),run_id))
            remaining()
        if resume and existing['checkpoint']:
            saved = json.loads(existing['checkpoint'])
            research,draft,check = saved['research'],saved['draft'],saved['check']
            evidence_path=saved.get('evidence_path')
            research_metadata=saved.get('research_metadata',{})
            revision_id = saved.get('revision_id')
            content_type = saved['content_type']
            slot_date,slot_time = saved.get('slot_date'),saved.get('slot_time')
            filter_notes = saved.get('filter_notes',[])
            fresh=policy.research_preflight(research,now=time.time(),max_source_age_hours=c['max_source_age_hours'])
            if not fresh['eligible']:
                return finish('blocked_content',fresh['issues'],check,filter_notes)
            from editorial_images import article_content_hash
            uploaded=__import__('owner_images').selected(ROOT,run_id,article_content_hash(draft))
            if uploaded:
                ident=create_draft(db,research,draft,check,revision_of=revision_id,content_type=content_type,creation_run_id=run_id,owner_media=uploaded)
                with website_bridge.creation_budget(deadline): request_review(db,ident)
                with db: db.execute("UPDATE runs SET draft_id=?,status='awaiting_approval',next_step='awaiting_approval',finished=?,updated=? WHERE id=?",(ident,time.time(),time.time(),run_id))
                return {'status':'awaiting_approval','run_id':run_id,'draft_id':ident,'content_type':content_type}
            from research_worker import refresh_evidence
            progress('Đang đọc lại nguồn đã lưu trước khi tiếp tục')
            evidence_path=refresh_evidence(root=ROOT,config=c,research=research,
                                           evidence_path=evidence_path,deadline=deadline,
                                           heartbeat=lambda meta:progress(meta=meta))
            check=verify(research,draft,content_type)
            issues=policy.verifier_issues(check,research=research,draft=draft)
            if issues:return finish('blocked_content',issues,check,filter_notes)
            save_verified_checkpoint(db,run_id,research,draft,check,content_type=content_type,
                                     filter_notes=filter_notes,revision_id=revision_id,
                                     slot_date=slot_date,slot_time=slot_time,
                                     evidence_path=evidence_path,research_metadata=research_metadata)
            validate_bundle(research,draft,check,time.time())
            if existing['draft_id']:
                ident=existing['draft_id']
            else:
                progress('Đang tiếp tục ảnh từ bài đã kiểm chứng')
                ident=create_draft(db,research,draft,check,revision_of=revision_id,content_type=content_type,
                                  slot_date=slot_date,slot_time=slot_time,filter_notes=filter_notes,creation_run_id=run_id,
                                  deadline=deadline,heartbeat=lambda meta:progress(meta=meta),on_stage=stage_checkpoint)
                with db:
                    db.execute('UPDATE runs SET draft_id=?,updated=? WHERE id=?',(ident,time.time(),run_id))
                    db.execute('UPDATE verification_runs SET draft_id=? WHERE run_id=? AND draft_id IS NULL',(ident,run_id))
            remaining()
            with website_bridge.creation_budget(deadline):request_review(db,ident)
            with db:
                if revision_id:
                    db.execute("UPDATE drafts SET status='superseded' WHERE id=? AND status IN ('editing','pending')",(revision_id,))
                db.execute("UPDATE runs SET status='awaiting_approval',next_step='awaiting_approval',issues=NULL,finished=?,details=?,updated=? WHERE id=?",(time.time(),ident,time.time(),run_id))
                db.execute("UPDATE daily_slots SET status='completed',draft_id=?,error=NULL,next_retry=NULL,updated=? WHERE run_id=?",(ident,time.time(),run_id))
                db.execute('UPDATE verification_runs SET draft_id=? WHERE run_id=? AND draft_id IS NULL',(ident,run_id))
            progress(f'Đã tiếp tục và gửi bản duyệt {ident}. Chờ Admin xem và duyệt.')
            return {'status':'awaiting_approval','run_id':run_id,'draft_id':ident,'content_type':content_type}
        if resume and existing['research_checkpoint'] and json.loads(existing['research_checkpoint']).get('eligible'):
            resume_context=json.loads(existing['research_checkpoint'])
            resumed_research=resume_context['research']
            if existing['editor_checkpoint']:
                resumed_editor=load_editor_checkpoint(existing['editor_checkpoint'])
                resumed_research=resumed_editor['research']
            evidence_path=resume_context.get('evidence_path')
            research_metadata=resume_context.get('research_metadata',{})
            if not resume_context.get('eligible') or not evidence_path:
                raise ValueError('Hồ sơ nguồn chưa đủ điều kiện để tiếp tục biên tập; cần lượt nghiên cứu mới.')
            from research_worker import refresh_evidence
            progress('Đang đọc lại hồ sơ nguồn trước khi tiếp tục biên tập')
            evidence_path=refresh_evidence(root=ROOT,config=c,research=resumed_research,
                                           evidence_path=evidence_path,deadline=deadline,
                                           heartbeat=lambda meta:progress(meta=meta))
            if resumed_editor:
                current_hashes=evidence_hashes(ROOT,resumed_research,evidence_path)
                changed=current_hashes!=resumed_editor.get('sourceHashes',{})
                research_metadata={**research_metadata,'source_changed_on_resume':changed}
                # A saved draft is data only. New full-text verification still
                # runs below, even if all hashes match; previous PASS is absent.
                if changed:progress('Nguồn đã thay đổi; sẽ đối chiếu lại bản thảo với toàn văn mới')
            fresh=policy.research_preflight(resumed_research,now=time.time(),max_source_age_hours=c['max_source_age_hours'])
            if not fresh['eligible']:return finish('blocked_content',fresh['issues'])
            if requested_topic and not topic_matches(requested_topic,resumed_research.get('topic','')):
                return finish('blocked_content',[policy.issue('TOPIC_MISMATCH','Hồ sơ đã lưu không đúng chủ đề được yêu cầu.',field='topic')])
            revision_id=resume_context.get('revision_id')
            revision_note=resume_context.get('revision_note')
            slot_date,slot_time=resume_context.get('slot_date'),resume_context.get('slot_time')
            save_research_checkpoint(db,run_id,resumed_research,evidence_path=evidence_path,metadata=research_metadata,
                                     **{key:value for key,value in resume_context.items() if key not in
                                        ('schemaVersion','research','evidence_path','research_metadata','savedAt')})
        recent = recent_post_summaries(db,now)
        from editorial_diversity import brief, recent_failures
        diversity_context=brief(recent,recent_failures(db,now,exclude_run=run_id))
        payload = {'now':datetime.now(timezone.utc).isoformat(),'previous_posts':recent,'content_type_preference':'news','diversity_brief':diversity_context}
        if resume and existing['research_checkpoint'] and not resumed_research:
            resume_context=json.loads(existing['research_checkpoint'])
            payload.update(resume_context.get('request_payload',{}))
            payload.update(now=datetime.now(timezone.utc).isoformat(),previous_posts=recent)
            phase_file=ROOT/'data/research-evidence'/run_id/'collection-checkpoint.json'
            if phase_file.exists() and existing['next_step'] in ('research','synthesis','repair_contract'):
                phase=json.loads(phase_file.read_text(encoding='utf-8'))
                payload.update(phase.get('payload',{}))
                payload['resume_synthesis']=True
            payload.update(now=datetime.now(timezone.utc).isoformat(),previous_posts=recent)
            revision_id=resume_context.get('revision_id')
            revision_note=resume_context.get('revision_note')
            slot_date,slot_time=resume_context.get('slot_date'),resume_context.get('slot_time')
        if not resume and not revision_id: payload['editorial_policy_version']=__import__('editorial_rules').CURRENT
        elif revision_id and not resume:
            original=db.execute('SELECT bundle FROM drafts WHERE id=?',(revision_id,)).fetchone()
            if original:
                selected=json.loads(original['bundle']).get('research',{}).get('editorial_policy_version')
                if selected: payload['editorial_policy_version']=selected
        payload['diversity_brief']=diversity_context
        if trigger.get('editorial_lane'):payload['editorial_lane']=trigger['editorial_lane']
        if audience_context:
            payload['audience_brief'] = audience_context.get('brief',{})
        if requested_topic:
            payload.update(requested_topic=requested_topic,topic_locked=True,
                           content_type_preference='news' if re.search(r'\b(hôm nay|tin mới|diễn biến)\b',requested_topic,re.I) else 'evergreen')
        if scheduled:payload['schedule_slot']={'date':slot_date,'time':slot_time}
        if revision_id:
            old = db.execute('SELECT * FROM drafts WHERE id=?',(revision_id,)).fetchone()
            if not old:raise ValueError('Không tìm thấy bản gốc cần sửa.')
            old_bundle=json.loads(old['bundle'])
            payload['revision']={'previous_content':old['content'],'previous_website':old_bundle.get('draft',{}).get('website'),'owner_request':revision_note}
            if old_bundle.get('content_type')=='evergreen' or 'evergreen' in str(revision_note).lower():payload['content_type_preference']='evergreen'
        research = resumed_research; source_issues=[]; rejected_topics=set(); research_omitted=[]
        first_session=max(0,int(resume_context.get('sessions_used',1))-1) if existing and existing['resume_automatic'] else 0
        for attempt in range(first_session,0 if resumed_research else 2):
            if not payload.get('resume_synthesis') and not (existing and existing['resume_automatic'] and attempt==first_session):
                payload['_collection_phase']=uuid.uuid4().hex
            payload['phase']=payload.get('content_type_preference','news')
            label = ('Đang tìm và đọc nguồn' if attempt==0 else
                     'Đang bổ sung nguồn đúng chủ đề' if requested_topic else 'Đang tìm đề tài kiến thức khác')
            evidence_path=str(ROOT/'data/research-evidence'/run_id/'index.json')
            save_research_checkpoint(db,run_id,{},evidence_path=evidence_path,metadata={},eligible=False,
                sessions_used=attempt+1,request_payload=payload,revision_id=revision_id,revision_note=revision_note,
                slot_date=slot_date,slot_time=slot_time)
            try:
                result = dict(call('research',payload,label))
            except creation_runtime.RuntimeStageTimeout as exc:
                if exc.metadata.get('error_code')!='STAGE_TIMEOUT':raise
                raise  # Operational timeout retains the current phase; never changes topic.
            evidence_path=result.pop('_evidence_path',None)
            research_metadata=result.pop('_research_metadata',{})
            worker_omissions=result.pop('_omitted_sources',[])
            preflight = policy.select_research_evidence(result,now=time.time(),max_source_age_hours=c['max_source_age_hours'])
            research, source_issues = preflight['research'],preflight['issues']
            if research.get('eligible') is True and audience_context:
                from audience_signals import safe_label
                selected = safe_label(research.get('topic',''))
                signals = audience_context.get('brief',{}).get('signals',[])
                reason = ('Giữ đúng chủ đề bạn yêu cầu; nguồn phải đủ bằng chứng.' if requested_topic else
                          'Tin mới đủ hai nguồn độc lập; tín hiệu Google định hướng truy vấn.' if signals and payload['phase']=='news' else
                          'Chủ đề kiến thức chưa dùng, có đủ nguồn; ưu tiên nhu cầu độc giả.' if signals else
                          'Chọn từ nguồn thị trường vì chưa có tín hiệu Google dùng được.')
                audience_context.update(selected_topic=selected,selection_reason=reason,content_type=research.get('content_type'))
                with db:
                    db.execute('UPDATE runs SET audience_checkpoint=?,updated=? WHERE id=?',
                        (json.dumps(audience_context,ensure_ascii=False),time.time(),run_id))
            if requested_topic and research.get('eligible') is True and not topic_matches(requested_topic,research.get('topic','')):
                source_issues.append(policy.issue('TOPIC_MISMATCH','Nguồn nghiên cứu chưa đúng chủ đề được yêu cầu; không đổi đề tài.',field='topic'))
                preflight['eligible']=False
            if attempt == 1 and not requested_topic and research.get('eligible') is True:
                if research.get('content_type') != 'evergreen':
                    source_issues.append(policy.issue('FALLBACK_CONTENT_TYPE','Lượt chuyển hướng phải là bài kiến thức khác, không tiếp tục dùng tin quá hạn.',field='content_type'))
                if research.get('topic') and _dedupe_key(research.get('topic')) in rejected_topics:
                    source_issues.append(policy.issue('FALLBACK_TOPIC_UNCHANGED','Phải chọn đề tài kiến thức khác; không đổi nhãn đề tài hoặc bảng giá vừa bị loại.',field='topic'))
                preflight['eligible'] = not source_issues
            if attempt == 1 and requested_topic and research.get('eligible') is True and research.get('content_type') != payload.get('content_type_preference'):
                source_issues.append(policy.issue('SUPPLEMENT_CONTENT_TYPE','Lượt bổ sung phải giữ đúng loại bài và chủ đề được yêu cầu.',field='content_type'))
                preflight['eligible'] = False
            save_research_checkpoint(db,run_id,research,evidence_path=evidence_path,metadata=research_metadata,
                                     eligible=bool(preflight['eligible']),sessions_used=attempt+1,
                                     revision_id=revision_id,revision_note=revision_note,
                                     slot_date=slot_date,slot_time=slot_time,issues=source_issues,
                                     research_omitted=worker_omissions+preflight.get('omitted',[]),request_payload=payload,
                                     next_step='editor' if preflight['eligible'] else 'collection')
            if preflight['eligible']:
                research_omitted=worker_omissions+preflight.get('omitted',[])
                if research_omitted:
                    with db:db.execute('UPDATE runs SET issues=? WHERE id=?',(json.dumps(research_omitted,ensure_ascii=False),run_id))
                    progress('Đã bỏ nguồn/claim không đạt; phần còn lại đủ hai nguồn độc lập để viết')
                break
            rejected_topics.add(_dedupe_key(research.get('topic')))
            if attempt==1 or revision_id:
                return finish('skipped_insufficient_evidence',source_issues)
            payload.update(now=datetime.now(timezone.utc).isoformat(),source_issues=source_issues,previous_research=research)
            payload.pop('resume_synthesis',None)
            if requested_topic:
                payload.update(supplement_only=True)
            else:
                payload.update(supplement_only=False,content_type_preference='evergreen',
                               choose_different_topic=True,forbidden_topic=research.get('topic'),
                               fallback_reason='Không đủ tin mới/nguồn hợp lệ; chọn đề tài kiến thức khác, không tái dùng bảng giá cũ.')
        content_type = research['content_type']
        if resumed_research:research_omitted=resume_context.get('research_omitted',[])
        if resumed_editor:
            draft=resumed_editor['draft']
            structure_repairs=resumed_editor.get('structure_repairs',resumed_editor.get('repair_count',0))
            content_repairs=resumed_editor.get('content_repairs',resumed_editor.get('repair_count',0))
            repaired=content_repairs>=1
            if resumed_editor['next_step']=='repair':
                context=resumed_editor.get('repair_payload') or policy.repair_context(research,draft,issues=resumed_editor.get('issues',[]))
                context.update(now=datetime.now(timezone.utc).isoformat(),research=research,requested_topic=requested_topic)
                draft=call('editor',context,'Đang tiếp tục sửa bản thảo đã lưu')
                if resumed_editor.get('repair_kind')=='structure':structure_repairs=1
                else:content_repairs=1;repaired=True
        else:
            draft = call('editor',{'now':datetime.now(timezone.utc).isoformat(),'research':research,
                'evidence_path':evidence_path,'research_metadata':research_metadata,
                'revision':payload.get('revision'),'content_type':content_type,'requested_topic':requested_topic},f'Đang viết bài {"kiến thức" if content_type=="evergreen" else "tin mới"} cho website và Facebook')
        draft['content_type']=content_type
        save_editor_checkpoint(db,run_id,research,draft,root=ROOT,evidence_path=evidence_path,
                               next_step='validate',repair_count=int(repaired),structure_repairs=structure_repairs,content_repairs=content_repairs)
        preflight = editor_preflight(research,draft)
        draft=preflight['draft']
        if not preflight['eligible']:
            if structure_repairs:return finish('blocked_content',preflight['issues'])
            structure_repairs=1
            context=policy.repair_context(research,draft,issues=preflight['issues'])
            context['repair_kind']='structure'
            context['now']=datetime.now(timezone.utc).isoformat()
            context['requested_topic']=requested_topic
            save_editor_checkpoint(db,run_id,research,draft,root=ROOT,evidence_path=evidence_path,
                next_step='repair',repair_count=0,repair_payload=context,structure_repairs=max(0,structure_repairs-1) if context.get('repair_kind')=='structure' else structure_repairs,content_repairs=max(0,content_repairs-1) if context.get('repair_kind')!='structure' else content_repairs,issues=preflight['issues'])
            draft=call('editor',context, 'Đang sửa lỗi cấu trúc trước kiểm chứng')
            draft['content_type']=content_type
            save_editor_checkpoint(db,run_id,research,draft,root=ROOT,evidence_path=evidence_path,
                                   next_step='validate',repair_count=int(repaired),structure_repairs=structure_repairs,content_repairs=content_repairs)
            preflight=editor_preflight(research,draft);draft=preflight['draft']
            if not preflight['eligible']:return finish('blocked_content',preflight['issues'])
        save_editor_checkpoint(db,run_id,research,draft,root=ROOT,evidence_path=evidence_path,
                               next_step='verify',repair_count=int(repaired),structure_repairs=structure_repairs,content_repairs=content_repairs)
        check=verify(research,draft,content_type)
        issues=policy.verifier_issues(check,research=research,draft=draft)
        filter_notes=list(research_omitted)
        if any(x.get('code')=='VERIFIER_SCHEMA_PRIMARY' for x in issues):
            return finish('blocked_content',issues,check)
        if issues:
            filtered=policy.filter_verified_bundle(research,draft,check)
            filter_notes.extend(filtered['dropped'])
            supplemented=False
            if not filtered['eligible']:
                stored=db.execute('SELECT research_checkpoint FROM runs WHERE id=?',(run_id,)).fetchone()
                saved=json.loads(stored[0] or '{}') if stored else {}
                if int(saved.get('sessions_used',2))<2 and not content_repairs:
                    supplement_payload={**payload,'now':datetime.now(timezone.utc).isoformat(),'topic_locked':True,
                        'requested_topic':requested_topic or research.get('topic'),'content_type_preference':content_type,
                        '_collection_phase':uuid.uuid4().hex,'previous_research':filtered['research'],
                        'source_issues':filtered['issues'],'supplement_only':True}
                    supplement_payload.pop('resume_synthesis',None)
                    result=dict(call('research',supplement_payload,'Đang bổ sung nguồn thực sự chứng minh các dữ kiện'))
                    evidence_path=result.pop('_evidence_path',evidence_path)
                    research_metadata=result.pop('_research_metadata',{})
                    fresh=policy.select_research_evidence(result,now=time.time(),max_source_age_hours=c['max_source_age_hours'])
                    save_research_checkpoint(db,run_id,fresh['research'],evidence_path=evidence_path,metadata=research_metadata,
                        eligible=fresh['eligible'],sessions_used=2,request_payload=supplement_payload,issues=fresh['issues'])
                    if fresh['eligible']:
                        filtered={'eligible':True,'research':fresh['research'],'retained':[x['id'] for x in fresh['research']['claims']],'dropped':filtered['dropped']}
                        supplemented=True
                if not filtered['eligible']:return finish('skipped_insufficient_evidence',filtered['issues']+issues,check,filter_notes)

            if content_repairs:
                if not supplemented:
                    context=policy.repair_context(research,draft,filtered=filtered)
                    save_editor_checkpoint(db,run_id,filtered['research'],draft,root=ROOT,evidence_path=evidence_path,
                        next_step='repair',repair_count=1,repair_payload=context,structure_repairs=structure_repairs,
                        content_repairs=content_repairs,issues=filtered['issues'])
                return finish('blocked_content',filtered.get('issues',issues),check,filter_notes)
            content_repairs=1;repaired=True
            research=filtered['research']
            context={'research':research,'content_type':content_type,'previous_draft':draft,'repair_issues':issues} if supplemented else policy.repair_context(research,draft,filtered=filtered)
            context['allowed_claim_ids']=filtered['retained']
            context['dropped_claims']=filter_notes
            context['now']=datetime.now(timezone.utc).isoformat()
            context['requested_topic']=requested_topic
            save_editor_checkpoint(db,run_id,research,draft,root=ROOT,evidence_path=evidence_path,
                next_step='repair',repair_count=0,repair_payload=context,structure_repairs=max(0,structure_repairs-1) if context.get('repair_kind')=='structure' else structure_repairs,content_repairs=max(0,content_repairs-1) if context.get('repair_kind')!='structure' else content_repairs,issues=issues)
            draft=call('editor',context,'Đang sửa đúng lỗi được kiểm chứng; giữ dữ kiện hai kênh')
            draft['content_type']=content_type
            save_editor_checkpoint(db,run_id,research,draft,root=ROOT,evidence_path=evidence_path,
                                   next_step='validate',repair_count=int(repaired),structure_repairs=structure_repairs,content_repairs=content_repairs)
            preflight=editor_preflight(research,draft);draft=preflight['draft']
            if not preflight['eligible']:return finish('blocked_content',preflight['issues'],check,filter_notes)
            save_editor_checkpoint(db,run_id,research,draft,root=ROOT,evidence_path=evidence_path,
                                   next_step='verify',repair_count=int(repaired),structure_repairs=structure_repairs,content_repairs=content_repairs)
            check=verify(research,draft,content_type)
            issues=policy.verifier_issues(check,research=research,draft=draft)
            if issues:return finish('blocked_content',issues,check,filter_notes)
        remaining()
        # Revalidate the source age at the final boundary; a midnight or expiry
        # crossing cannot turn a stale input into an approved review.
        final=policy.research_preflight(research,now=time.time(),max_source_age_hours=c['max_source_age_hours'])
        if not final['eligible']:return finish('skipped_insufficient_evidence',final['issues'],check,filter_notes)
        if requested_topic and not topic_matches(requested_topic,draft.get('website',{}).get('title','')):
            return finish('blocked_content',[policy.issue('TOPIC_MISMATCH','Bản bài không giữ chủ đề đã yêu cầu.',field='website.title')])
        save_verified_checkpoint(db,run_id,research,draft,check,content_type=content_type,
                                 filter_notes=filter_notes,revision_id=revision_id,slot_date=slot_date,slot_time=slot_time,
                                 evidence_path=evidence_path,research_metadata=research_metadata)
        with db:db.execute('UPDATE runs SET editor_checkpoint=NULL WHERE id=?',(run_id,))
        progress('Đã lưu bài kiểm chứng; đang tạo và kiểm tra ảnh theo nội dung')
        ident=create_draft(db,research,draft,check,revision_of=revision_id,content_type=content_type,
                          slot_date=slot_date,slot_time=slot_time,filter_notes=filter_notes,creation_run_id=run_id,
                          deadline=deadline,heartbeat=lambda meta:progress(meta=meta),on_stage=stage_checkpoint)
        with db:
            db.execute('UPDATE runs SET draft_id=?,updated=? WHERE id=?',(ident,time.time(),run_id))
            db.execute('UPDATE verification_runs SET draft_id=? WHERE run_id=? AND draft_id IS NULL',(ident,run_id))
            if slot_date and slot_time:
                db.execute('UPDATE daily_slots SET draft_id=?,updated=? WHERE slot_date=? AND slot_time=?',(ident,time.time(),slot_date,slot_time))
        remaining();progress('Đã kiểm chứng; đang chuẩn bị ảnh và gửi bản duyệt')
        with website_bridge.creation_budget(deadline):request_review(db,ident)
        with db:
            if revision_id:
                db.execute("UPDATE drafts SET status='superseded' WHERE id=? AND status='editing'",(revision_id,))
                db.execute("UPDATE edit_sessions SET status='completed' WHERE draft_id=? AND status='processing'",(revision_id,))
                audit(db,revision_id,'revision_created',message_id=ident)
            db.execute("UPDATE runs SET status='awaiting_approval',next_step='awaiting_approval',issues=NULL,finished=?,details=?,updated=? WHERE id=?",(time.time(),ident,time.time(),run_id))
            db.execute("UPDATE daily_slots SET status='completed',draft_id=?,error=NULL,next_retry=NULL,updated=? WHERE run_id=?",(ident,time.time(),run_id))
        progress(f'Đã gửi bản duyệt {ident} ({"Kiến thức" if content_type=="evergreen" else "Tin mới"}). Chờ Admin xem và duyệt.')
        return {'status':'awaiting_approval','run_id':run_id,'draft_id':ident,'content_type':content_type,
                'warnings':check.get('warnings',[]),'dropped':filter_notes}
    except control.CreationCancelled:
        owner.close(db,cancelled=True);owner=None
        return {'status':'cancelled','run_id':run_id}
    except control.OwnershipLost:
        return {'status':'ownership_lost','run_id':run_id}
    except Exception as exc:
        if owner is not None:
            try:owner.check()
            except control.CreationCancelled:
                owner.close(db,cancelled=True);owner=None
                return {'status':'cancelled','run_id':run_id}
            except control.OwnershipLost:return {'status':'ownership_lost','run_id':run_id}
        note=str(exc)[:1000] if isinstance(exc,(ValueError,RuntimeError,TimeoutError)) else type(exc).__name__
        code='TIMEOUT' if isinstance(exc,TimeoutError) else getattr(getattr(exc,'metadata',{}),'get',lambda *_:None)('error_code') or 'PIPELINE_ERROR'
        return finish('failed',[policy.issue(code,note,field=current_step)])
    finally:
        if owner is not None:owner.close(db)
        db.close()


def manual_revision(db, revision_id, content, now=None):
    """Validate an owner-supplied caption and create a new review version."""
    now = now or time.time()
    row = db.execute("SELECT * FROM drafts WHERE id=?", (revision_id,)).fetchone()
    if not row or row["status"] != "editing":
        raise ValueError("Bản nháp không còn ở trạng thái chờ sửa.")
    if row["expires"] <= now:
        with db:
            db.execute("UPDATE drafts SET status='pending' WHERE id=?", (revision_id,))
        raise ValueError("Bản duyệt hết hạn; cần tạo bản mới.")
    bundle = json.loads(row["bundle"])
    text = assert_clean_text(str(content), "caption")
    draft = {"content": text, "used_claim_ids": bundle["draft"].get("used_claim_ids", []),
             "content_type": row["content_type"] or bundle.get("content_type") or "news"}
    if dual.is_dual(row) or isinstance(bundle.get('draft',{}).get('website'),dict):
        draft['website']=dict(bundle.get('website') or bundle['draft']['website'])
        draft['website'].pop('url',None);draft['website'].pop('revisionId',None)
    for key in ('imageHeadline','imageBriefVersion'):
        if key in bundle.get('draft',{}):draft[key]=bundle['draft'][key]
    if text == row["content"]:
        with db:
            db.execute("UPDATE drafts SET status='pending' WHERE id=?", (revision_id,))
            db.execute("UPDATE edit_sessions SET status='completed' WHERE draft_id=? AND status='processing'", (revision_id,))
            audit(db, revision_id, "manual_revision_unchanged")
        return revision_id, False
    check = agent("verify", {"now": datetime.now(timezone.utc).isoformat(),
                              "research": bundle["research"], "draft": draft,
                              "content_type": draft["content_type"],
                              "caption_digest": digest(text),
                              "verification_attempt": 1, "website": draft.get("website")})
    check.setdefault("caption_digest", digest(text))
    verification_id = "manual:" + uuid.uuid4().hex
    record_verification(db, verification_id, 1, draft, check)
    ident = create_draft(db, bundle["research"], draft, check, now=now, revision_of=revision_id)
    with db:
        db.execute("UPDATE verification_runs SET draft_id=? WHERE run_id=? AND draft_id IS NULL",
                   (ident, verification_id))
    return ident, True

@media_storage.draft_cache
def approve(db, ident, short_hash, actor, message_id, now=None, status_message_id=None, callback_id=None):
    now = now or time.time()
    if str(actor) != config()["owner_id"]:
        raise ValueError("Chỉ chủ trang được duyệt.")
    db.execute("BEGIN IMMEDIATE")
    try:
        __import__("owner_images").assert_unlocked(db,ident)
        row = db.execute("SELECT * FROM drafts WHERE id=?",(ident,)).fetchone()
        if not row or row["status"] != "pending" or not row["review_message"]:
            raise ValueError("Bài không chờ duyệt hoặc đã xử lý.")
        if row["expires"] <= now:
            raise ValueError("Bản duyệt hết hạn; cần nghiên cứu và duyệt bản mới.")
        media = json.loads(row["bundle"])["media"]
        verify_media(media)
        bundle=json.loads(row['bundle'])
        from editorial_compliance import require_release
        require_release(bundle,config())
        verify_illustration_binding(bundle)
        expected=dual.review_digest(bundle) if dual.is_dual(row) else package_digest(row['content'],media)
        if short_hash != row["digest"][:12] or expected != row["digest"]:
            raise ValueError("Mã phiên bản không khớp nội dung đã gửi duyệt.")
        db.execute("""UPDATE drafts SET status='approved',approved_by=?,approval_message=?,
            approved_at=?,publish_status_message=COALESCE(?,publish_status_message) WHERE id=?""",
                   (str(actor),str(message_id),now,
                    str(status_message_id) if status_message_id is not None else None,ident))
        if dual.is_dual(row):
            if not callback_id:raise ValueError('Cần callback duyệt xác thực từ Telegram')
            dual.init_approval(db,row,actor,config()['chat_id'],row['review_message'],callback_id)
        audit(db,ident,"owner_approved",str(actor),str(message_id))
        db.commit()
    except Exception:
        db.rollback()
        raise

def _publication_attempt_start(db, ident, attempt, step="preflight"):
    now = time.time()
    db.execute("""INSERT INTO publication_attempts
        (draft_id,attempt,step,state,started,updated)
        VALUES(?,?,?,?,?,?)""", (ident, attempt, step, "started", now, now))


def _publication_step(db, ident, attempt, step, *, state="running", post_id=None,
                      detail=None, retryable=False):
    now = time.time()
    error_type = detail.get("type") if isinstance(detail, dict) else None
    error_message = _publication_error_text(detail) if detail else None
    db.execute("""UPDATE publication_attempts SET step=?,state=?,updated=?,
        post_id=COALESCE(?,post_id),error_type=?,error_message=?,traceback=?,retryable=?
        WHERE draft_id=? AND attempt=?""",
               (step, state, now, post_id, error_type, error_message,
                detail.get("traceback") if isinstance(detail, dict) else None,
                int(bool(retryable)), ident, attempt))


@media_storage.draft_cache
def publish_once(db, ident, publisher, *, allow_uncertain=False):
    db.execute("BEGIN IMMEDIATE")
    try:
        row = db.execute("SELECT * FROM drafts WHERE id=?",(ident,)).fetchone()
        if row and dual.is_dual(row):raise ValueError("Gói hai kênh phải dùng worker hai kênh.")
        allowed = row and row["status"] == "approved"
        if allow_uncertain and row and row["status"] == "uncertain" and not row["post_id"]:
            allowed = True
        if not allowed or row["approved_by"] != config()["owner_id"]:
            raise ValueError("Không có phê duyệt hợp lệ để đăng bài.")
        from editorial_compliance import require_release
        require_release(json.loads(row['bundle']),config())
        media = json.loads(row["bundle"])["media"]
        verify_media(media)
        approved_in_time = row["approved_at"] is not None and row["approved_at"] <= row["expires"]
        if (not approved_in_time) or package_digest(row["content"],media) != row["digest"]:
            raise ValueError("Bài hết hạn hoặc nội dung thay đổi; không đăng.")
        attempt = int(db.execute("SELECT COALESCE(MAX(attempt),0)+1 FROM publication_attempts WHERE draft_id=?", (ident,)).fetchone()[0])
        db.execute("UPDATE drafts SET status='publishing',error=NULL WHERE id=?",(ident,))
        _publication_attempt_start(db, ident, attempt)
        audit(db,ident,"publish_attempt_started",message_id=str(attempt))
        db.commit()
    except Exception:
        db.rollback()
        raise
    bundle = json.loads(row["bundle"])
    def on_step(step, metadata=None):
        with db:
            metadata = metadata or {}
            _publication_step(db, ident, attempt, step, post_id=metadata.get("post_id"))
            audit(db, ident, "publish_step_" + step, message_id=str(attempt))
    def invoke():
        try:
            parameters = inspect.signature(publisher).parameters
            accepts_progress = "progress" in parameters or any(
                item.kind == inspect.Parameter.VAR_KEYWORD for item in parameters.values())
        except (TypeError, ValueError):
            accepts_progress = False
        if accepts_progress:
            return publisher(row["content"], media, bundle["source_comment"], progress=on_step)
        return publisher(row["content"], media, bundle["source_comment"])
    post_id = None
    for trial in range(3):
        try:
            post_id = invoke()
            if not re.fullmatch(PAGE_ID+r"_\d+",str(post_id)):
                raise RuntimeError("Không nhận được mã bài Facebook hợp lệ.")
            with db:
                _publication_step(db, ident, attempt, "complete", state="confirmed", post_id=post_id)
            break
        except Exception as exc:
            detail = exception_detail(exc)
            preflight = type(exc).__name__ == "PublicationPreflightError" or getattr(exc, "preflight", False)
            if preflight and trial < 2:
                with db:
                    _publication_step(db, ident, attempt, "preflight", state="retrying",
                                      detail=detail, retryable=True)
                    audit(db, ident, "publish_preflight_retry", message_id=str(trial + 1))
                time.sleep(30)
                attempt = int(db.execute("SELECT COALESCE(MAX(attempt),0)+1 FROM publication_attempts WHERE draft_id=?", (ident,)).fetchone()[0])
                with db:
                    _publication_attempt_start(db, ident, attempt, "preflight")
                continue
            if preflight:
                with db:
                    _publication_step(db, ident, attempt, "preflight", state="failed",
                                      detail=detail, retryable=False)
                    db.execute("UPDATE drafts SET status='approved',error=? WHERE id=?",
                               (_publication_error_text(detail), ident))
                    audit(db, ident, "publish_preflight_failed")
                raise RuntimeError("Facebook chưa sẵn sàng: " + _publication_error_text(detail)[:700]) from None
            created_post_id = getattr(exc, "post_id", None)
            with db:
                _publication_step(db, ident, attempt, "uncertain", state="uncertain",
                                  post_id=created_post_id, detail=detail)
                db.execute("UPDATE drafts SET status='uncertain',post_id=COALESCE(?,post_id),error=? WHERE id=?",
                           (created_post_id, json.dumps(detail, ensure_ascii=False), ident))
                audit(db,ident,"publish_result_uncertain")
            raise RuntimeError("Chưa xác nhận kết quả đăng. Không tự đăng lại; cần kiểm tra fanpage để tránh trùng.") from None
    with db:
        db.execute("UPDATE drafts SET status='published',post_id=? WHERE id=?",(post_id,ident))
        audit(db,ident,"publish_confirmed")
    return post_id

def background(*args):
    c = config()
    exe = str(Path(c["hermes_home"])/"hermes-agent/venv/Scripts/python.exe")
    env = os.environ.copy()
    env.update(PYTHONUTF8="1",PYTHONIOENCODING="utf-8")
    log = ROOT/"data/worker.log"
    log.parent.mkdir(exist_ok=True)
    with log.open("a",encoding="utf-8") as stream:
        subprocess.Popen([exe,str(ROOT/"newsroom.py"),*args],cwd=ROOT,env=env,stdin=subprocess.DEVNULL,
                         stdout=stream,stderr=stream,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))


def _event_is_owner_group(event):
    src = getattr(event, "source", None)
    platform = getattr(getattr(src, "platform", None), "value", getattr(src, "platform", None))
    return (platform == "telegram" and str(getattr(src, "chat_id", "")) == config()["chat_id"]
            and str(getattr(src, "user_id", "")) == config()["owner_id"]
            and not getattr(src, "is_bot", False) and not getattr(event, "internal", False))


def _event_text(event):
    raw = getattr(event, "raw_message", None)
    return (getattr(raw, "text", None) or getattr(event, "text", "") or "").strip()


def _review_reply_intent(text):
    return bool(re.search(r"(?i)(?<!\w)(?:đăng|duyệt|xuất bản|publish|post)(?!\w)", text or ""))


def is_review_reply_event(event):
    """Cheap probe for a publish request that replies to a Telegram review."""
    return (_event_is_owner_group(event) and bool(getattr(event, "reply_to_message_id", None))
            and _review_reply_intent(_event_text(event)))


def is_status_query_event(event):
    """Cheap probe for queue/status questions that must use SQLite facts."""
    if not _event_is_owner_group(event):
        return False
    text = _event_text(event).lower()
    if not text or text.startswith("/vang"):
        return False
    return ("hàng đợi" in text or "chờ duyệt" in text or "trạng thái" in text
            or "danh sách" in text and "bài" in text
            or "đã đăng" in text or ("hôm nay" in text and "bài" in text))


def draft_view_text(row):
    """Render one durable draft without asking an LLM to interpret it."""
    expires = datetime.fromtimestamp(row["expires"], ZoneInfo("Asia/Ho_Chi_Minh"))
    state = {"pending": "chờ duyệt", "preparing": "đang chuẩn bị", "editing": "đang sửa", "video_preparing":"đang tạo video, chưa thể duyệt",
             "approved": "đã duyệt", "publishing": "đang đăng", "published": "đã đăng",
             "expired": "hết hạn", "rejected": "đã hủy", "superseded": "đã có bản mới",
             "uncertain": "cần đối soát"}.get(row["status"], row["status"])
    from editorial_compliance import release_advisories
    note='\n'.join(release_advisories(json.loads(row['bundle']),config()))
    return (f"ĐĂNG • BẢN DUYỆT {row['id']} · phiên bản {row['version'] or 1}\n"
            f"Trạng thái: {state}\nHạn duyệt: {expires:%H:%M %d/%m/%Y} (giờ Việt Nam)\n"
            f"Fanpage: {config()['page_name']}\n{note}\n\n{row['content']}")


def verification_detail_text(row):
    bundle = json.loads(row["bundle"])
    check = bundle.get("check", {})
    blocking, warnings = check_issues(check)
    lines = [f"🔎 CHI TIẾT KIỂM CHỨNG {row['id']}"]
    lines.append("Kết quả: " + str(check.get("verdict", "không rõ")))
    release=draft_release_status(row)
    if not release['eligible']:lines.append('\nCHƯA THỂ ĐĂNG: '+release['reason'])
    if release['warnings']:lines.append('\nLƯU Ý: '+' '.join(release['warnings']))
    if blocking:
        lines.append("\nLỖI CHẶN:")
        lines.extend("• " + str(item) for item in blocking)
    if warnings:
        lines.append("\nLƯU Ý:")
        lines.extend("• " + str(item) for item in warnings)
    dropped = bundle.get("filter_notes", [])
    if dropped:
        lines.append("\nĐÃ LOẠI KHỎI BẢN NÀY:")
        lines.extend("• " + str(item.get("claim_id", "dữ kiện")) + ": " +
                     str(item.get("reason", "chưa đủ bằng chứng")) for item in dropped)
    claim_results = check.get("claim_results", [])
    if claim_results:
        lines.append("\nDỮ KIỆN:")
        lines.extend("• " + str(item.get("id")) + " — " + str(item.get("status")) +
                     (": " + str(item.get("reason")) if item.get("reason") else "")
                     for item in claim_results if isinstance(item, dict))
    text = "\n".join(lines)
    return text[:3900]


def publication_status_text(row, note=None):
    status = row["status"]
    ident = row["id"]
    if status == "published":
        text = f"✅ ĐĂNG • Bài {ident} đã đăng trên {config()['page_name']}."
        if row["post_id"]:
            text += f"\nMã bài: {row['post_id']}"
    elif status == "uncertain":
        text = f"⚠️ ĐĂNG • Bài {ident} chưa xác nhận được kết quả Facebook."
        if row["post_id"]:
            text += f"\nFacebook đã trả mã bài: {row['post_id']}; không tạo bài thứ hai."
        else:
            text += "\nĐã kiểm tra lần gửi trước; chỉ bấm Gửi lại sau khi đối soát không thấy bài."
    elif status == "approved":
        text = f"✅ BÀI {ident} ĐÃ ĐƯỢC DUYỆT\nĐang chờ worker đăng lên {config()['page_name']}."
    else:
        text = draft_view_text(row)
    if note:
        text += "\n\n" + str(note)[:900]
    elif row["error"] and status in ("uncertain", "approved"):
        text += "\n\nChi tiết bước lỗi: " + str(row["error"])[:900]
    return text


def update_publish_ui(db, ident, note=None):
    """Refresh the original approval/status message from SQLite facts."""
    row = db.execute("SELECT * FROM drafts WHERE id=?", (ident,)).fetchone()
    if not row:
        return False
    message_id = row["publish_status_message"] or row["review_message"]
    if not message_id:
        return False
    if dual.is_dual(row):
        text=dual.status_text(db,row);keyboard=dual.keyboard(db,row)
        if telegram_edit(message_id,text,inline_keyboard=keyboard):return True
        mid=telegram('editor',text,inline_keyboard=keyboard)
        with db:db.execute('UPDATE drafts SET publish_status_message=? WHERE id=?',(str(mid),ident));audit(db,ident,'dual_status_delivery_fallback',message_id=str(mid))
        return True
    return telegram_edit(message_id, publication_status_text(row, note),
                         inline_keyboard=draft_keyboard(row["id"], row["digest"][:12],
                                                         row["status"], row["post_id"],
                                                         row["status"] == "pending" and row["expires"] <= time.time()))


def _claim_incoming(db, event):
    try:
        db.execute("INSERT INTO incoming VALUES(?,?)",
                   (f"{event.source.chat_id}:{event.message_id}", time.time()))
        db.commit()
        return True
    except sqlite3.IntegrityError:
        return False


def _handle_review_reply(event):
    if not is_review_reply_event(event):
        return False
    db = database()
    try:
        if not _claim_incoming(db, event):
            return True
        expire_pending_drafts(db)
        reply_id = str(event.reply_to_message_id)
        row = db.execute("""SELECT * FROM drafts
            WHERE review_message=? OR review_image_message=?
            ORDER BY created DESC LIMIT 1""", (reply_id, reply_id)).fetchone()
        if row:
            expired = row["status"] == "expired" or row["expires"] <= time.time()
            telegram("editor",
                     "⚠️ Phê duyệt chỉ thực hiện bằng nút Duyệt và đăng bên dưới.\n\n"
                     + draft_view_text(row), reply_to=event.message_id,
                     inline_keyboard=draft_keyboard(row["id"], row["digest"][:12], row["status"],
                                                    row["post_id"], expired))
        else:
            telegram("editor", "⚠️ Không xác định được bản anh đang nói tới. Đây là hàng chờ hiện tại:\n\n"
                     + pending_text(db), reply_to=event.message_id,
                     inline_keyboard=pending_keyboard(db))
        return True
    finally:
        db.close()


def _handle_status_query(event):
    if not is_status_query_event(event):
        return False
    db = database()
    try:
        if not _claim_incoming(db, event):
            return True
        text = _event_text(event).lower()
        if "hàng đợi" in text or "chờ duyệt" in text or "danh sách" in text:
            body, keyboard = pending_text(db), pending_keyboard(db)
        elif "lịch sử" in text or "đã đăng" in text and "hôm nay" not in text:
            body, keyboard = history_text(db), history_keyboard(db)
        else:
            body, keyboard = status_text(db), menu_keyboard()
        telegram("editor", body, reply_to=event.message_id, inline_keyboard=keyboard)
        return True
    finally:
        db.close()


def handle_event(event):
    """Input is the normalized platform event, not text interpreted by an LLM."""
    raw = getattr(event, "raw_message", None)
    # Telegram's adapter removes @bot mentions before this hook. Read the
    # original message first so `/vang@Manager_Dang_bot trangthai` keeps its
    # separator and arguments intact.
    incoming_text = getattr(raw, "text", None) or (event.text or "")
    normalized_input = incoming_text.strip()
    quick_action = QUICK_ACTIONS.get(normalized_input)
    match = re.match(r"^/vang(?:@([\w]+))?(?:\s+(.*))?$", normalized_input, re.I|re.S)
    if not match and not quick_action:
        return None
    c,src = config(),event.source
    if match and match[1] and match[1].lower() != c["manager_username"].lower():
        return None
    platform = getattr(getattr(src,"platform",None),"value",getattr(src,"platform",None))
    skip = {"action":"skip","reason":"newsroom command handled"}
    if platform != "telegram" or str(src.chat_id) != c["chat_id"] or str(src.user_id) != c["owner_id"] or getattr(src,"is_bot",False) or getattr(event,"internal",False):
        return skip
    if raw and any(getattr(raw,k,None) for k in ("forward_origin","sender_chat","via_bot","edit_date")):
        return skip
    author = getattr(raw,"from_user",None)
    if author and (getattr(author,"is_bot",False) or str(author.id) != c["owner_id"]):
        return skip
    if not event.message_id:
        return skip
    db = database()
    try:
        with db:
            try:
                db.execute("INSERT INTO incoming VALUES(?,?)",(f"{src.chat_id}:{event.message_id}",time.time()))
            except sqlite3.IntegrityError:
                return skip
        args = ([quick_action] if quick_action else
                (match[2].split(maxsplit=2) if match[2] else ["menu"]))
        action = args[0].lower()
        if action == "moi":
            requested_topic = normalize_requested_topic(match[2].split(maxsplit=1)[1] if match and match[2] and len(match[2].split(maxsplit=1))>1 else None)
            started = _start_pipeline_if_idle({'source':'telegram_command','actor':str(src.user_id),
                'chat_id':str(src.chat_id),'message_id':str(event.message_id),
                'event_key':f"message:{src.chat_id}:{event.message_id}",'requested_topic':requested_topic})
            if started:
                telegram("editor", "✅ Đã nhận yêu cầu. Đang nghiên cứu → biên tập → kiểm chứng.",
                         reply_to=event.message_id, keyboard=quick_reply_keyboard())
            else:
                telegram("editor", _active_creation_text(db),
                         reply_to=event.message_id, inline_keyboard=menu_keyboard())
        elif action == 'tieptuc' and len(args)>=2:
            started=_start_resume_if_idle(args[1],{'actor':str(src.user_id),'chat_id':str(src.chat_id),'message_id':str(event.message_id)})
            telegram('editor','Đang tiếp tục bước còn thiếu.' if started else _active_creation_text(db),reply_to=event.message_id)
        elif action == 'doi_anh' and len(args)>=2:
            _start_image_revision(db,args[1].upper(),str(src.user_id),str(event.message_id))
            telegram('editor','Đang tạo phiên bản ảnh mới; bản duyệt cũ đã ngừng hiệu lực.',reply_to=event.message_id)
        elif action=='sua_video' and len(args)==3:
            import video_workflow
            new_id=video_workflow.update_script(db,args[1],args[2],str(src.user_id))
            telegram('editor','Đã lưu kịch bản sửa; lượt video '+new_id+' đang được kiểm chứng.',reply_to=event.message_id)
        elif action in ("help", "menu"):
            menu_id = telegram("editor",menu_text()+"\n\n"+help_text(),keyboard=quick_reply_keyboard())
            if action == "menu":
                telegram_pin(menu_id)
        elif action == "pending":
            telegram("editor", pending_text(db), inline_keyboard=pending_keyboard(db))
        elif action == "history":
            telegram("editor", history_text(db), inline_keyboard=history_keyboard(db))
        elif action == "duyet" and len(args) == 3:
            row = db.execute("SELECT * FROM drafts WHERE id=?", (args[1].upper(),)).fetchone()
            if not row:
                raise ValueError("Không tìm thấy bản cần duyệt. Mở Chờ duyệt để chọn bằng nút.")
            expired = row["status"] == "expired" or row["expires"] <= time.time()
            telegram("editor", "⚠️ Lệnh chữ không phê duyệt bài. Anh hãy bấm nút Duyệt và đăng bên dưới.\n\n"
                     + draft_view_text(row), reply_to=event.message_id,
                     inline_keyboard=draft_keyboard(row["id"], row["digest"][:12], row["status"],
                                                    row["post_id"], expired))
        elif action in ("huy","sua") and len(args) >= 2:
            if action == "sua" and len(args) != 3:
                if len(args) == 2:
                    telegram("editor",f"ĐĂNG • Anh hãy gửi yêu cầu sửa theo mẫu:\n/vang@{c['manager_username']} sua {args[1].upper()} <nội dung cần sửa>")
                    return skip
                raise ValueError("Cần ghi yêu cầu sửa sau mã bài.")
            with db:
                result = db.execute("UPDATE drafts SET status=? WHERE id=? AND status IN ('pending','preparing')",("superseded" if action=="sua" else "rejected",args[1].upper()))
                if result.rowcount != 1:
                    raise ValueError("Bài không còn chờ duyệt; không thể sửa/hủy bằng lệnh này.")
                audit(db,args[1].upper(),action,str(src.user_id),str(event.message_id))
            if action == "sua":
                background("revise",args[1].upper(),args[2])
            else:
                telegram("editor","ĐĂNG • Đã hủy bản nháp "+args[1].upper())
        elif action == "trangthai":
            telegram("editor",status_text(db),keyboard=quick_reply_keyboard())
        else:
            telegram("editor",menu_text()+"\n\n"+help_text(),keyboard=quick_reply_keyboard())
    except Exception as exc:
        telegram("editor","ĐĂNG • "+(str(exc) if isinstance(exc,(ValueError,RuntimeError)) else type(exc).__name__)[:500])
    finally:
        db.close()
    return skip

def help_text():
    bot = config()["manager_username"]
    extra='\nẢnh: tối đa 5 lần gọi tạo ảnh. Dùng Upload ảnh dự phòng để gửi ảnh riêng (không kiểm duyệt AI), hoặc Lấy prompt tạo ảnh để dùng dịch vụ khác.\n'
    return extra+("TÒA SOẠN AI KIM TUYẾN\nNhi: nghiên cứu và kiểm chứng độc lập. Đăng: biên tập và xuất bản sau khi anh duyệt.\n"
            "Lịch bản nháp: 07:00, 12:00, 18:00 giờ Việt Nam.\n"
            f"Tạo bài: /vang@{bot} moi [chủ đề]\nTiếp tục ảnh: /vang@{bot} tieptuc <MÃ_LƯỢT>\nĐổi ảnh: /vang@{bot} doi_anh <MÃ_BÀI>\nTrạng thái: /vang@{bot} trangthai\n"
            "Bản nháp có bài website, caption và ảnh minh họa. Bấm Tạo video giọng đọc nếu muốn thêm video dọc 60–90 giây; lịch tạo nháp không tự tạo giọng. Xem và nghe video trước khi bấm Duyệt và đăng Website + Video Facebook. Khi đó Facebook đăng video thay cho ảnh.\n"
            "Nếu video lỗi, bấm Tiếp tục video hoặc Sửa kịch bản rồi trả lời yêu cầu sửa bằng tiếng Việt. Dùng bài ảnh là lựa chọn riêng và vẫn cần duyệt. Nếu ElevenLabs chưa khả dụng, bot báo nguyên nhân và giữ bản nháp.\n"
            "Mỗi bản nháp có nút duyệt, hủy và sửa riêng; chỉ nút Duyệt và đăng mới phê duyệt. Chỉ tài khoản chủ trang được duyệt; bản duyệt hết hạn sau 24 giờ kể từ lúc gửi thành công. Bài được duyệt mới đăng lên Kim Tuyến - Giá Vàng Hôm Nay.")

def menu_keyboard():
    return [
        [{"text": "📝 Tạo bài mới", "callback_data": "kt:menu:new"},
         {"text": "📥 Chờ duyệt", "callback_data": "kt:menu:pending"}],
        [{"text": "📚 Lịch sử", "callback_data": "kt:menu:history"},
         {"text": "📊 Trạng thái", "callback_data": "kt:menu:status"}],
        [{"text": "❔ Hướng dẫn", "callback_data": "kt:menu:help"}],
    ]


def reply_keyboard_legacy():
    """Persistent quick-action keyboard shown above the message composer."""
    return [
        [{"text": "📝 Tạo bài mới"}, {"text": "📥 Chờ duyệt"}],
        [{"text": "📚 Lịch sử"}, {"text": "📊 Trạng thái"}],
        [{"text": "❔ Hướng dẫn"}],
    ]


def quick_reply_keyboard():
    # Descriptive alias used at call sites; keep reply_keyboard_legacy as a
    # compatibility name for deployments that imported it directly.
    return reply_keyboard_legacy()


QUICK_ACTIONS = {
    "📝 Tạo bài mới": "moi",
    "📥 Chờ duyệt": "pending",
    "📚 Lịch sử": "history",
    "📊 Trạng thái": "trangthai",
    "❔ Hướng dẫn": "help",
}


def menu_text():
    c = config()
    return (f"TÒA SOẠN AI KIM TUYẾN\n{c['page_name']}\n\n"
            "Chọn thao tác bên dưới. Bản duyệt chỉ được đăng khi anh bấm nút Duyệt và đăng.")


def _draft_rows(db, statuses, limit=5, offset=0):
    placeholders = ",".join("?" for _ in statuses)
    return db.execute(
        f"SELECT id,status,expires,post_id,version,revision_of FROM drafts "
        f"WHERE status IN ({placeholders}) ORDER BY created DESC LIMIT ? OFFSET ?",
        (*statuses, limit, offset)).fetchall()


def expire_pending_drafts(db, now=None):
    """Persist the 24-hour boundary so expired reviews leave the queue."""
    now = time.time() if now is None else now
    rows = db.execute("SELECT id FROM drafts WHERE status='pending' AND expires<=?", (now,)).fetchall()
    if not rows:
        return 0
    with db:
        for row in rows:
            changed = db.execute(
                "UPDATE drafts SET status='expired' WHERE id=? AND status='pending' AND expires<=?",
                (row["id"], now))
            if changed.rowcount:
                audit(db, row["id"], "review_expired")
    return len(rows)


def _pending_rows(db, limit=5, offset=0, now=None):
    now = time.time() if now is None else now
    expire_pending_drafts(db, now)
    return db.execute("""SELECT id,status,expires,post_id,version,revision_of
        FROM drafts
        WHERE status IN ('preparing','editing')
           OR (status='pending' AND expires>?)
        ORDER BY CASE WHEN status='pending' THEN expires ELSE 9e18 END,
                 created DESC LIMIT ? OFFSET ?""", (now, limit, offset)).fetchall()


def pending_text(db, page=0):
    rows = _pending_rows(db, offset=page*5)
    lines = [f"📥 CHỜ DUYỆT · trang {page+1}"]
    if not rows:
        lines.append("Chưa có bản nháp đang chờ.")
    labels = {"pending": "chờ duyệt", "preparing": "đang chuẩn bị", "editing": "đang sửa"}
    for row in rows:
        expires = datetime.fromtimestamp(row["expires"], ZoneInfo("Asia/Ho_Chi_Minh"))
        lines.append(f"{row['id']} · phiên bản {row['version'] or 1} · {labels[row['status']]} · hạn {expires:%H:%M %d/%m}")
    return "\n".join(lines)


def pending_keyboard(db, page=0):
    rows = _pending_rows(db, offset=page*5)
    buttons = [[{"text": f"{row['id']} · v{row['version'] or 1}",
                 "callback_data": f"kt:open:{row['id']}"}] for row in rows]
    if page > 0 or len(rows) == 5:
        nav = []
        if page > 0:
            nav.append({"text": "‹ Trước", "callback_data": f"kt:pending:{page-1}"})
        if len(rows) == 5:
            nav.append({"text": "Sau ›", "callback_data": f"kt:pending:{page+1}"})
        buttons.append(nav)
    buttons.append([{"text": "↩️ Về menu", "callback_data": "kt:menu"}])
    return buttons


def history_text(db, page=0):
    expire_pending_drafts(db)
    rows = db.execute("""SELECT id,status,expires,post_id,version,revision_of FROM drafts
        WHERE status IN ('published','rejected','superseded','uncertain','expired')
        ORDER BY created DESC LIMIT 5 OFFSET ?""", (page*5,)).fetchall()
    labels = {"published": "đã đăng", "rejected": "đã hủy", "superseded": "đã có bản mới", "uncertain": "cần đối soát", "expired": "hết hạn"}
    lines = [f"📚 LỊCH SỬ · trang {page+1}"]
    if not rows:
        lines.append("Chưa có lịch sử bài.")
    for row in rows:
        extra = f" · https://www.facebook.com/{row['post_id']}" if row["post_id"] else ""
        lines.append(f"{row['id']} · v{row['version'] or 1} · {labels[row['status']]}{extra}")
    return "\n".join(lines)


def history_keyboard(db, page=0):
    expire_pending_drafts(db)
    rows = db.execute("""SELECT id,status,expires,post_id,version,revision_of FROM drafts
        WHERE status IN ('published','rejected','superseded','uncertain','expired')
        ORDER BY created DESC LIMIT 5 OFFSET ?""", (page*5,)).fetchall()
    buttons = []
    for row in rows:
        if row["post_id"]:
            buttons.append([{"text": f"🌐 {row['id']} · Mở Facebook", "url": f"https://www.facebook.com/{row['post_id']}"}])
    if page > 0 or len(rows) == 5:
        nav = []
        if page > 0:
            nav.append({"text": "‹ Trước", "callback_data": f"kt:history:{page-1}"})
        if len(rows) == 5:
            nav.append({"text": "Sau ›", "callback_data": f"kt:history:{page+1}"})
        buttons.append(nav)
    buttons.append([{"text": "↩️ Về menu", "callback_data": "kt:menu"}])
    return buttons

def status_text(db):
    expire_pending_drafts(db)
    rows = db.execute("SELECT id,status,expires,post_id FROM drafts ORDER BY created DESC LIMIT 5").fetchall()
    labels = {"pending":"chờ duyệt","approved":"đã duyệt, chờ đăng","publishing":"đang đăng hoặc cần đối soát","published":"đã đăng","uncertain":"cần đối soát","rejected":"đã hủy","superseded":"đã có bản mới","expired":"hết hạn","preparing":"đang gửi bản duyệt","editing":"đang sửa"}
    lines = ["ĐĂNG • Trạng thái tòa soạn"]
    for row in rows:
        state = labels.get(row["status"], row["status"])
        lines.append(row["id"]+": "+state+(" https://www.facebook.com/"+row["post_id"] if row["post_id"] else ""))
    if not rows:
        lines.append("Chưa có bản nháp. "+f"/vang@{config()['manager_username']} moi")
    run = db.execute("SELECT * FROM runs ORDER BY started DESC LIMIT 1").fetchone()
    if run:
        lines.append(f"Lượt tạo {run['id'][:8]}: {run['step'] or run['status']}")
        if run['finished']:
            lines.append(f"Thời gian: {int(run['finished']-run['started'])} giây")
            if run['issues']:
                for issue in json.loads(run['issues'])[:3]:lines.append('• '+str(issue.get('reason',''))[:240])
    today = local_datetime().date().isoformat()
    try:
        _ensure_daily_slots(db, today)
        slot_rows = db.execute("SELECT slot_time,status,attempts,error FROM daily_slots WHERE slot_date=? ORDER BY slot_time", (today,)).fetchall()
        if slot_rows:
            done = sum(row["status"] == "completed" for row in slot_rows)
            lines.append(f"Hôm nay: {done}/{len(DAILY_SLOTS)} khung đã gửi duyệt")
            for row in slot_rows:
                if row["status"] == "pending":
                    label = ("đang chờ xử lý" if slot_datetime(today, row["slot_time"]) <= local_datetime()
                             else "chưa đến giờ")
                else:
                    label = {"completed": "đã gửi duyệt", "running": "đang xử lý", "failed": "lỗi/chờ thử lại",
                             "skipped": "không tạo được bản duyệt"}.get(row["status"], row["status"])
                suffix = f" — {row['error'][:100]}" if row["status"] in ('failed','skipped') and row["error"] else ""
                lines.append(f"  {row['slot_time']}: {label}{suffix}")
    except sqlite3.OperationalError:
        pass
    lines.append("Lịch tạo nháp: 07:00 · 12:00 · 18:00 (giờ Việt Nam)")
    return "\n".join(lines)


def _callback_authorized(query):
    """Strict server-side gate for inline actions."""
    c = config()
    user = getattr(getattr(query, "from_user", None), "id", None)
    message = getattr(query, "message", None)
    chat = getattr(message, "chat", None)
    chat_id = getattr(message, "chat_id", getattr(chat, "id", None))
    return (str(user) == c["owner_id"] and str(chat_id) == c["chat_id"] and
            not getattr(getattr(query, "from_user", None), "is_bot", False))


def _active_creation_text(db):
    row=db.execute("SELECT r.* FROM leases l JOIN runs r ON r.id=l.owner WHERE l.name='pipeline' AND l.expires>?",(time.time(),)).fetchone()
    if not row:return 'Lượt tạo trước đã kết thúc. Mở Trạng thái để xem kết quả.'
    elapsed=max(0,int(time.time()-row['started']))
    return f"⏳ Lượt {row['id'][:8]} đang chạy: {row['step'] or row['status']}. Đã chờ {elapsed//60} phút {elapsed%60:02d} giây."


def _start_pipeline_if_idle(trigger=None):
    trigger=trigger or {'source':'telegram'}
    db=database();run_id=uuid.uuid4().hex;now=time.time()
    try:
        db.execute('BEGIN IMMEDIATE')
        db.execute("DELETE FROM leases WHERE expires<?",(now,))
        if trigger.get('event_key') and db.execute('SELECT 1 FROM creation_requests WHERE event_key=?',(trigger['event_key'],)).fetchone():
            db.commit();return False
        active=db.execute("SELECT owner FROM leases WHERE name='pipeline'").fetchone()
        if active:
            if trigger.get('event_key'):db.execute('INSERT INTO creation_requests VALUES(?,?,?)',(trigger['event_key'],active['owner'],now))
            db.commit();return False
        db.execute("INSERT INTO leases VALUES('pipeline',?,?)",(run_id,now+control.settings(config())['lease_seconds']))
        db.execute("""INSERT INTO runs(id,status,started,source,trigger_key,actor,chat_id,message_id,callback_id,step,updated,requested_topic)
            VALUES(?, 'queued', ?,?,?,?,?,?,?, 'Đang khởi động', ?,?)""",
            (run_id,now,trigger.get('source'),trigger.get('event_key'),trigger.get('actor'),trigger.get('chat_id'),
             trigger.get('message_id'),trigger.get('callback_id'),now,normalize_requested_topic(trigger.get('requested_topic'))))
        if trigger.get('event_key'):db.execute('INSERT INTO creation_requests VALUES(?,?,?)',(trigger['event_key'],run_id,now))
        db.commit()
        try:background('run',run_id)
        except Exception:
            with db:
                db.execute("UPDATE runs SET status='failed',finished=?,details='Không khởi động được worker',updated=? WHERE id=?",(time.time(),time.time(),run_id))
                db.execute("DELETE FROM leases WHERE name='pipeline' AND owner=?",(run_id,))
            raise
        return True
    finally:db.close()


def _recover_creation_runs(db,now):
    rows=db.execute("""SELECT * FROM runs r WHERE finished IS NULL
        AND status IN ('queued','researching','editing','verifying','illustrating')
        AND NOT EXISTS (SELECT 1 FROM leases l WHERE l.name='pipeline' AND l.owner=r.id AND l.expires>?)
        AND (EXISTS (SELECT 1 FROM leases l WHERE l.name='pipeline' AND l.owner=r.id AND l.expires<=?)
             OR COALESCE(heartbeat_at,updated,started)<?)""",(now,now,now-control.settings(config())['lease_seconds'])).fetchall()
    for row in rows:
        draft = db.execute('SELECT review_message FROM drafts WHERE id=?',(row['draft_id'],)).fetchone() if row['draft_id'] else None
        if draft and draft['review_message']:
            with db:
                db.execute("UPDATE runs SET status='awaiting_approval',issues=NULL,finished=?,updated=?,step='Bản duyệt đã gửi trước khi worker gián đoạn',details=? WHERE id=? AND finished IS NULL",(now,now,row['draft_id'],row['id']))
                db.execute("DELETE FROM leases WHERE name='pipeline' AND owner=?",(row['id'],))
            if row['progress_message']:
                telegram_edit(row['progress_message'],f"✅ Bản duyệt {row['draft_id']} đã được gửi. Mở Chờ duyệt để xem.",inline_keyboard=menu_keyboard(),timeout=5)
            continue
        with db:
            status='image_waiting' if row['checkpoint'] and not row['draft_id'] else 'failed'
            if status=='failed' and row['editor_checkpoint'] and not row['draft_id']:status='editor_waiting'
            if status=='failed' and row['research_checkpoint'] and not row['draft_id']:
                source_saved=json.loads(row['research_checkpoint'])
                if source_saved.get('evidence_path'):status='research_waiting'
            if row['cancel_requested']:status='cancelled'
            db.execute("UPDATE runs SET status=?,worker_token=NULL,finished=?,updated=?,step='Worker gián đoạn',details='Đã lưu phần hoàn tất; có thể tiếp tục đúng bước' WHERE id=? AND finished IS NULL",(status,now,now,row['id']))
            db.execute("DELETE FROM leases WHERE name='pipeline' AND owner=?",(row['id'],))
        if row['progress_message'] and not draft:
            telegram_edit(row['progress_message'],f"⚠️ Lượt {row['id'][:8]} đã dừng: worker gián đoạn hoặc hết thời gian.",inline_keyboard=creation_retry_keyboard(row['id']) if status in ('image_waiting','research_waiting','editor_waiting') else menu_keyboard(),timeout=5)
        if row['worker_token'] and status in ('image_waiting','research_waiting','editor_waiting') and row['recovery_attempts']<3:
            _start_resume_if_idle(row['id'],{'source':'auto_recovery'})
    # A verified, persisted package may have lost the prepare/Telegram response.
    # Resume its delivery only; never spend another AI call or create a new draft.
    pending=db.execute("""SELECT r.id,r.draft_id,r.progress_message FROM runs r JOIN drafts d ON d.id=r.draft_id
        WHERE r.status='failed' AND r.cancel_requested=0 AND d.status='preparing' AND d.expires>?
        AND NOT EXISTS (SELECT 1 FROM leases l WHERE l.name='pipeline' AND l.owner=r.id AND l.expires>?)""",(now,now)).fetchall()
    for row in pending:
        try:
            with website_bridge.creation_budget(time.monotonic()+90):request_review(db,row['draft_id'])
        except Exception:continue
        with db:
            db.execute("UPDATE runs SET status='awaiting_approval',issues=NULL,finished=?,updated=?,step='Đã phục hồi việc gửi bản duyệt',details=? WHERE id=?",(time.time(),time.time(),row['draft_id'],row['id']))
        if row['progress_message']:
            telegram_edit(row['progress_message'],f"✅ Đã phục hồi và gửi bản duyệt {row['draft_id']}. Mở Chờ duyệt để xem.",inline_keyboard=menu_keyboard(),timeout=5)


def _new_edit_session(db, draft_id, mode, actor, chat_id, prompt_message_id=None):
    token = uuid.uuid4().hex[:16]
    now = time.time()
    db.execute("""INSERT INTO edit_sessions
        (token,draft_id,mode,actor,chat_id,prompt_message_id,created,expires,status)
        VALUES(?,?,?,?,?,?,?,?,?)""",
        (token, draft_id, mode, str(actor), str(chat_id),
         str(prompt_message_id) if prompt_message_id else None,
         now, now + 15*60, "awaiting"))
    db.commit()
    return token


def _begin_edit(db, ident, mode, actor, chat_id, reply_to=None):
    row = db.execute("SELECT * FROM drafts WHERE id=?", (ident,)).fetchone()
    if not row or row["status"] != "pending":
        raise ValueError("Bài không còn chờ duyệt; không thể sửa.")
    if row["expires"] <= time.time():
        raise ValueError("Bản duyệt hết hạn; cần tạo bản mới.")
    db.execute("BEGIN IMMEDIATE")
    with db:
        __import__("owner_images").assert_unlocked(db,ident)
        result = db.execute("UPDATE drafts SET status='editing' WHERE id=? AND status='pending'", (ident,))
        if result.rowcount != 1:
            raise ValueError("Bài vừa được thao tác ở nơi khác; hãy mở lại danh sách chờ duyệt.")
        token = _new_edit_session(db, ident, mode, actor, chat_id)
        audit(db, ident, "edit_started_" + mode, str(actor), str(reply_to) if reply_to else None)
    prompt = ("✏️ SỬA BÀI " + ident + "\n"
              + ("Gửi yêu cầu sửa bằng tiếng Việt (ví dụ: rút ngắn phần mở đầu)."
                 if mode == "ai" else
                 "Gửi toàn bộ caption mới (90–1.500 ký tự, có hashtag và dòng Theo dõi).")
              + "\nPhiên nhập có hiệu lực 15 phút.")
    # ForceReply and InlineKeyboardMarkup are mutually exclusive in Telegram.
    # Keep the input prompt reply-anchored, then send a separate compact exit
    # control so both behaviours remain available on mobile and desktop.
    try:
        prompt_id = telegram("editor", prompt, reply_to=reply_to, force_reply=True)
        telegram("editor", "Có thể dừng phiên sửa bất kỳ lúc nào:", reply_to=prompt_id,
                 inline_keyboard=[[{"text": "✖️ Thoát sửa", "callback_data": f"kt:edit_exit:{token}"}]])
    except Exception:
        with db:
            db.execute("UPDATE edit_sessions SET status='failed' WHERE token=?", (token,))
            db.execute("UPDATE drafts SET status='pending' WHERE id=? AND status='editing'", (ident,))
        raise
    with db:
        db.execute("UPDATE edit_sessions SET prompt_message_id=? WHERE token=?", (prompt_id, token))
    return token


def _handle_edit_reply(event):
    src = event.source
    raw = getattr(event, "raw_message", None)
    text = getattr(raw, "text", None) or getattr(event, "text", "") or ""
    if not text.strip() or text.lstrip().startswith("/vang"):
        return False
    platform = getattr(getattr(src, "platform", None), "value", getattr(src, "platform", None))
    if (platform != "telegram" or
            str(getattr(src, "chat_id", "")) != config()["chat_id"] or
            str(getattr(src, "user_id", "")) != config()["owner_id"] or
            getattr(src, "is_bot", False)):
        return False
    reply_id = getattr(event, "reply_to_message_id", None)
    if not reply_id:
        return False
    db = database()
    try:
        now = time.time()
        row = db.execute("""SELECT * FROM edit_sessions
            WHERE prompt_message_id=? AND actor=? AND chat_id=? AND status='awaiting'""",
                         (str(reply_id), str(src.user_id), str(src.chat_id))).fetchone()
        if not row:
            return False
        if row['mode'] == 'video_script':
            import video_script_editor
            try:
                result = video_script_editor.consume(db, row['token'], text,
                                                     str(src.user_id), str(src.chat_id))
                if result['status'] == 'expired':
                    reply = 'Phiên sửa kịch bản đã hết hạn; bài và video đang lưu vẫn được giữ.'
                elif result['status'] == 'queued':
                    reply = ('Đã nhận yêu cầu sửa kịch bản. Bản sửa được kiểm chứng lại '
                             'và video mới sẽ được gửi để bạn xem, nghe và duyệt.')
                elif result['status'] == 'failed':
                    reply = 'Đã lưu yêu cầu sửa nhưng chưa khởi động được; mở Trạng thái video và bấm Tiếp tục.'
                else:
                    reply = 'Yêu cầu sửa này đã được nhận; không tạo thêm video.'
            except ValueError as exc:
                reply = str(exc)
            telegram('editor', reply, reply_to=event.message_id)
            return True
        if row["expires"] <= now:
            with db:
                db.execute("UPDATE edit_sessions SET status='expired' WHERE token=?", (row["token"],))
                db.execute("UPDATE drafts SET status='pending' WHERE id=? AND status='editing'", (row["draft_id"],))
            telegram("editor", "Phiên sửa đã hết hạn; bản cũ vẫn giữ nguyên.", reply_to=event.message_id)
            return True
        with db:
            db.execute("UPDATE edit_sessions SET status='processing',request=? WHERE token=? AND status='awaiting'",
                       (text, row["token"]))
            audit(db, row["draft_id"], "edit_request_received", str(src.user_id), str(event.message_id))
        try:
            telegram("editor", "Đã nhận yêu cầu sửa " + row["draft_id"] + ". Bản cũ đang được khóa trong lúc kiểm tra.",
                     reply_to=event.message_id)
        except Exception:
            pass
        if row["mode"] == "manual":
            background("revise-manual", row["draft_id"], text)
        else:
            background("revise", row["draft_id"], text)
        return True
    finally:
        db.close()


def has_edit_session(event):
    """Cheap non-consuming check used before the gateway hook claims a reply."""
    src = event.source
    reply_id = getattr(event, "reply_to_message_id", None)
    if not reply_id:
        return False
    platform = getattr(getattr(src, "platform", None), "value", getattr(src, "platform", None))
    if (platform != "telegram" or str(getattr(src, "chat_id", "")) != config()["chat_id"] or
            str(getattr(src, "user_id", "")) != config()["owner_id"] or getattr(src, "is_bot", False)):
        return False
    with closing(database()) as db:
        row = db.execute("""SELECT 1 FROM edit_sessions
            WHERE prompt_message_id=? AND actor=? AND chat_id=? AND status='awaiting' AND expires>?""",
                         (str(reply_id), str(src.user_id), str(src.chat_id), time.time())).fetchone()
        return bool(row)


def handle_callback(data, query):
    """Execute a Kim Tuyến inline action and return a small UI update."""
    if not _callback_authorized(query):
        return {"answer": "⛔ Chỉ chủ trang được thao tác.", "edit_text": None}
    message = getattr(query, "message", None)
    message_id = getattr(message, "message_id", None)
    user_id = str(getattr(getattr(query, "from_user", None), "id", ""))
    chat_id = str(getattr(message, "chat_id", ""))
    parts = data.split(":")
    action = parts[1] if len(parts) > 1 else ""
    db = database()
    try:
        if data in ("kt:menu", "kt:menu:status"):
            if data == "kt:menu:status":
                return {"answer": "Đã cập nhật", "edit_text": status_text(db), "keyboard": menu_keyboard()}
            return {"answer": "Menu", "edit_text": menu_text(), "keyboard": menu_keyboard()}
        if data == "kt:menu:new":
            started = _start_pipeline_if_idle({'source':'telegram_callback','actor':user_id,'chat_id':chat_id,
                'message_id':str(message_id),'callback_id':str(getattr(query,'id','')),
                'event_key':'callback:'+str(getattr(query,'id','')) if getattr(query,'id',None) else None})
            text = ("✅ Đã nhận. Tòa soạn bắt đầu nghiên cứu và sẽ gửi bản duyệt sau khi kiểm chứng."
                    if started else _active_creation_text(db))
            return {"answer": text[:180], "edit_text": text, "keyboard": menu_keyboard()}
        if action=='creation_resume' and len(parts)==3:
            started=_start_resume_if_idle(parts[2],{'source':'telegram_callback','event_key':'resume:'+str(getattr(query,'id',''))})
            return {'answer':'Đang tiếp tục phần còn thiếu' if started else 'Lượt đang chạy hoặc không thể tiếp tục','edit_text':None}
        if action=='creation_cancel' and len(parts)==3:
            ident=parts[2]
            with db:
                changed=db.execute("UPDATE runs SET cancel_requested=1,updated=? WHERE id=? AND (finished IS NULL OR status='image_waiting')",(time.time(),ident)).rowcount
                current=db.execute('SELECT checkpoint,draft_id FROM runs WHERE id=?',(ident,)).fetchone()
                parent=json.loads(current['checkpoint'] or '{}').get('revision_id') if current else None
                if parent and not current['draft_id'] and not __import__('owner_images').blocking_session(db,parent):
                    db.execute("UPDATE drafts SET status='pending' WHERE id=? AND status='editing' AND NOT EXISTS(SELECT 1 FROM drafts child WHERE child.revision_of=?)",(parent,parent))
                db.execute("UPDATE runs SET status='cancelled',finished=?,step='Đã hủy lượt tạo' WHERE id=? AND cancel_requested=1 AND worker_token IS NULL",(time.time(),ident))
                db.execute("DELETE FROM leases WHERE name='pipeline' AND owner=? AND EXISTS (SELECT 1 FROM runs WHERE id=? AND status='cancelled')",(ident,ident))
            return {'answer':'Đã yêu cầu hủy' if changed else 'Lượt đã kết thúc',
                    'edit_text':'⏹ Đã yêu cầu hủy lượt tạo. Hồ sơ đã lưu được giữ trong lịch sử.','keyboard':menu_keyboard()}
        if action in ('owner_upload','owner_prompt') and len(parts)==4:
            import owner_images
            if action=='owner_upload': owner_images.begin(db,parts[2],parts[3],user_id,chat_id,getattr(message,'message_thread_id',None))
            else: owner_images.export(db,parts[2],parts[3])
            return {'answer':'Đã mở upload' if action=='owner_upload' else 'Đã gửi prompt và tệp .txt','edit_text':None}
        if action in ('owner_cancel','owner_retry') and len(parts)==3:
            import owner_images
            answer=(owner_images.cancel if action=='owner_cancel' else owner_images.retry)(db,parts[2],user_id,chat_id)
            return {'answer':answer,'edit_text':None}
        if action in ('image','edit','video_create','video_photo_ready') and len(parts)>=3:
            __import__('owner_images').assert_unlocked(db,parts[2])
        if action=='image' and len(parts)==3:
            _start_image_revision(db,parts[2],user_id,str(message_id))
            return {'answer':'Đang đổi ảnh; bản duyệt cũ ngừng hiệu lực','edit_text':None}
        if data == "kt:menu:pending":
            return {"answer": "Danh sách chờ duyệt", "edit_text": pending_text(db),
                    "keyboard": pending_keyboard(db)}
        if data == "kt:menu:history":
            return {"answer": "Lịch sử", "edit_text": history_text(db),
                    "keyboard": history_keyboard(db)}
        if data == "kt:menu:help":
            return {"answer": "Hướng dẫn", "edit_text": help_text(), "keyboard": menu_keyboard()}
        if action in ("pending", "history") and len(parts) == 3:
            page = max(0, int(parts[2]))
            if action == "pending":
                return {"answer": "Đã cập nhật", "edit_text": pending_text(db, page),
                        "keyboard": pending_keyboard(db, page)}
            return {"answer": "Đã cập nhật", "edit_text": history_text(db, page),
                    "keyboard": history_keyboard(db, page)}
        if action == "open" and len(parts) == 3:
            row = db.execute("SELECT * FROM drafts WHERE id=?", (parts[2].upper(),)).fetchone()
            if not row:
                raise ValueError("Không tìm thấy bản nháp.")
            if dual.is_dual(row) and row['status'] in ('approved','publishing','published','uncertain'):
                return {'answer':'Trạng thái hai kênh','edit_text':dual.status_text(db,row),'keyboard':dual.keyboard(db,row)}
            expires = datetime.fromtimestamp(row["expires"], ZoneInfo("Asia/Ho_Chi_Minh"))
            state = {"pending": "chờ duyệt", "preparing": "đang chuẩn bị", "editing": "đang sửa",
                     "approved": "đã duyệt", "publishing": "đang đăng", "published": "đã đăng",
                     "expired": "hết hạn", "rejected": "đã hủy", "superseded": "đã có bản mới",
                     "uncertain": "cần đối soát"}.get(row["status"], row["status"])
            return {"answer": "Đã mở bản nháp", "edit_text": draft_view_text(row),
                    "keyboard": draft_keyboard(row["id"], row["digest"][:12], row["status"], row["post_id"],
                                                row["status"] == "pending" and row["expires"] <= time.time())}
        if action.startswith('video_') and len(parts)==3:
            import video_workflow as video
            if action=='video_create':
                result=video.start(db,parts[2].upper(),user_id)
                reason=result.get('reason') or 'Đang chuẩn bị video; bản ảnh cũ tạm khóa duyệt.'
                return {'answer':reason[:180],'edit_text':reason,'keyboard':[[{'text':'Cập nhật trạng thái','callback_data':'kt:open:'+parts[2].upper()}]]}
            if action=='video_resume':
                result=video.resume(db,parts[2],user_id)
                return {'answer':'Đang tiếp tục video' if result['status']=='queued' else 'Video đang được xử lý','edit_text':None}
            if action=='video_status':
                row=db.execute('SELECT draft_id FROM video_jobs WHERE id=?',(parts[2],)).fetchone()
                return {'answer':'Trạng thái video','edit_text':video.status_text(db,parts[2]),'keyboard':video.controls(db,row['draft_id']) if row else menu_keyboard()}
            if action=='video_photo_ready':
                ident=video.photo_revision(db,parts[2].upper(),user_id)
                return {'answer':'Đã gửi bản ảnh mới để duyệt','edit_text':None}
            if action=='video_photo':
                ident=video.use_photo(db,parts[2],user_id)
                row=db.execute('SELECT * FROM drafts WHERE id=?',(ident,)).fetchone()
                return {'answer':'Đã chọn bài ảnh; vẫn cần duyệt','edit_text':draft_view_text(row),'keyboard':draft_keyboard(ident,row['digest'][:12],row['status'])}
            if action=='video_script':
                import video_script_editor
                result=video_script_editor.begin(db,parts[2],user_id,chat_id,message_id)
                return {'answer':'Đã mở ô nhập yêu cầu sửa' if result['created'] else 'Hãy trả lời tin nhắn nhập yêu cầu đang mở',
                        'edit_text':None}
            if action=='video_edit_exit':
                import video_script_editor
                job_id=video_script_editor.cancel(db,parts[2],user_id,chat_id)
                row=db.execute('SELECT draft_id FROM video_jobs WHERE id=?',(job_id,)).fetchone()
                return {'answer':'Đã thoát sửa kịch bản',
                        'edit_text':'Đã đóng ô nhập. Bài và video đang lưu vẫn được giữ; bản ảnh cũ vẫn khóa duyệt.',
                        'keyboard':video.controls(db,row['draft_id']) if row else menu_keyboard()}
        if action == "checks" and len(parts) == 3:
            row = db.execute("SELECT * FROM drafts WHERE id=?", (parts[2].upper(),)).fetchone()
            if not row:
                raise ValueError("Không tìm thấy bản nháp.")
            return {"answer": "Chi tiết kiểm chứng", "edit_text": verification_detail_text(row),
                    "keyboard": [[{"text": "↩️ Về bản duyệt", "callback_data": f"kt:open:{row['id']}"}],
                                 [{"text": "↩️ Về menu", "callback_data": "kt:menu"}]]}
        if action == 'website' and len(parts) == 4:
            row=db.execute('SELECT * FROM drafts WHERE id=?',(parts[2].upper(),)).fetchone()
            if not row or not dual.is_dual(row):raise ValueError('Bản này chưa có gói website')
            website=json.loads(row['bundle'])['website']
            text=website['title']+'\n\n'+website['excerpt']+'\n\n'+website['contentMarkdown']
            text+='\n\nSEO: '+website['seoTitle']+'\n'+website['seoDescription']+'\nURL sẽ đăng: '+website['url']
            text+='\n\nNguồn website:\n'+'\n'.join(source['title']+'\n'+source['url'] for source in website['sources'])
            pages=[text[i:i+2800] for i in range(0,len(text),2800)]
            page=max(0,min(int(parts[3]),len(pages)-1));buttons=[]
            if page>0:buttons.append({'text':'⬅️ Trước','callback_data':f"kt:website:{row['id']}:{page-1}"})
            if page+1<len(pages):buttons.append({'text':'Tiếp ➡️','callback_data':f"kt:website:{row['id']}:{page+1}"})
            return {'answer':'Toàn văn website','edit_text':f"📰 WEBSITE · {row['id']} · {page+1}/{len(pages)}\n"+pages[page],
                    'keyboard':([buttons] if buttons else [])+[[{'text':'↩️ Về bản duyệt','callback_data':'kt:open:'+row['id']}]]}
        if action == 'story_resume' and len(parts)==3:
            ident=parts[2].upper()
            story=__import__('facebook_story')
            row=db.execute('SELECT * FROM drafts WHERE id=?',(ident,)).fetchone()
            if not row or str(row['approved_by'])!=str(user_id):raise ValueError('Không có bản duyệt hợp lệ của chủ trang.')
            if story.request_resume(db,ident):story.kick(db)
            return {'answer':'Đã yêu cầu kiểm tra riêng phần Tin','edit_text':dual.status_text(db,row),'keyboard':dual.keyboard(db,row)}
        if action == 'dual_resume' and len(parts)==3:
            ident=parts[2].upper();row=db.execute('SELECT * FROM drafts WHERE id=?',(ident,)).fetchone()
            if not row or not dual.is_dual(row) or not db.execute('SELECT 1 FROM dual_approvals WHERE draft_id=?',(ident,)).fetchone():raise ValueError('Chưa có lần duyệt hai kênh')
            with db:
                for name in ['website','facebook']:
                    channel=dual.channel(db,ident,name)
                    if channel and channel['state']=='blocked':
                        state='needs_reconcile' if name=='facebook' and channel['step'] in ('create_dispatched','comment_dispatched','needs_reconcile') else 'retryable_failed'
                        db.execute('UPDATE publication_channels SET state=?,next_retry=NULL,attempt=0 WHERE draft_id=? AND channel=?',(state,ident,name))
            background('publish',ident)
            return {'answer':'Tiếp tục phần chưa hoàn tất','edit_text':dual.status_text(db,row),'keyboard':dual.keyboard(db,row)}
        if action == "approve" and len(parts) == 4:
            ident, short_hash = parts[2].upper(), parts[3]
            existing=db.execute('SELECT * FROM drafts WHERE id=?',(ident,)).fetchone()
            if existing and dual.is_dual(existing) and existing['approved_by']==user_id and short_hash==existing['digest'][:12] and db.execute('SELECT 1 FROM dual_approvals WHERE draft_id=?',(ident,)).fetchone():
                return {'answer':'Bản này đã được duyệt; không đăng trùng','edit_text':dual.status_text(db,existing),'keyboard':dual.keyboard(db,existing)}
            approve(db, ident, short_hash, user_id, message_id, status_message_id=message_id,callback_id=str(getattr(query,"id","")))
            row=db.execute('SELECT * FROM drafts WHERE id=?',(ident,)).fetchone()
            background("publish", ident)
            if dual.is_dual(row):return {'answer':'Đã duyệt cả hai kênh','edit_text':dual.status_text(db,row),'keyboard':dual.keyboard(db,row)}
            return {"answer": "✅ Đã duyệt và đang đăng", "edit_text":
                    f"✅ BÀI {ident} ĐÃ ĐƯỢC DUYỆT\nĐang đăng lên {config()['page_name']}.",
                    "keyboard": [[{"text": "⏳ Đang đăng", "callback_data": "kt:noop"}],
                                 [{"text": "↩️ Về menu", "callback_data": "kt:menu"}]]}
        if action == "reconcile" and len(parts) == 3:
            ident = parts[2].upper()
            row = db.execute("SELECT * FROM drafts WHERE id=?", (ident,)).fetchone()
            if not row or row["status"] != "uncertain":
                raise ValueError("Bài không ở trạng thái cần đối soát.")
            background("reconcile", ident)
            return {"answer": "🔍 Đã bắt đầu đối soát", "edit_text":
                    f"🔍 Đang đối soát bài {ident} trên fanpage; không tự đăng lại.",
                    "keyboard": [[{"text": "🔄 Cập nhật trạng thái", "callback_data": f"kt:open:{ident}"}],
                                 [{"text": "↩️ Về menu", "callback_data": "kt:menu"}]]}
        if action == "retry" and len(parts) == 3:
            ident = parts[2].upper()
            row = db.execute("SELECT * FROM drafts WHERE id=?", (ident,)).fetchone()
            if not row or row["status"] != "uncertain" or row["post_id"]:
                raise ValueError("Chỉ có thể gửi lại bản chưa tìm thấy bài Facebook sau đối soát.")
            if row["approved_by"] != config()["owner_id"]:
                raise ValueError("Bản này chưa có phê duyệt hợp lệ của chủ trang.")
            background("retry-publish", ident)
            return {"answer": "🔁 Đã nhận yêu cầu gửi lại", "edit_text":
                    f"🔁 Đã nhận gửi lại bài {ident}; worker sẽ kiểm tra Facebook ngay trước khi gửi.",
                    "keyboard": [[{"text": "⏳ Đang xử lý", "callback_data": "kt:noop"}],
                                 [{"text": "↩️ Về menu", "callback_data": "kt:menu"}]]}
        if action == "revive" and len(parts) == 3:
            ident = parts[2].upper()
            row = db.execute("SELECT status,expires FROM drafts WHERE id=?", (ident,)).fetchone()
            if not row or row["status"] not in ("expired", "pending") or row["expires"] > time.time():
                raise ValueError("Bản nháp chưa hết hạn hoặc không còn tồn tại.")
            with db:
                audit(db, ident, "expired_draft_update_requested", user_id, str(message_id))
            started = _start_pipeline_if_idle()
            text = ("✅ Đã nhận yêu cầu tạo bản cập nhật; bản hết hạn vẫn được giữ trong lịch sử."
                    if started else "⏳ Đang có một phiên tạo bài chạy; bản cập nhật sẽ thực hiện sau.")
            return {"answer": text[:180], "edit_text": text, "keyboard": menu_keyboard()}
        if action == "cancel" and len(parts) == 3:
            ident = parts[2].upper()
            return {"answer": "Xác nhận hủy", "edit_text": f"Hủy bản nháp {ident}?",
                    "keyboard": [[{"text": "✅ Xác nhận hủy", "callback_data": f"kt:cancel_confirm:{ident}"},
                                  {"text": "↩️ Quay lại", "callback_data": f"kt:open:{ident}"}]]}
        if action == "cancel_confirm" and len(parts) == 3:
            ident = parts[2].upper()
            with db:
                result = db.execute("UPDATE drafts SET status='rejected' WHERE id=? AND status IN ('pending','preparing')", (ident,))
                if result.rowcount != 1:
                    raise ValueError("Bài không còn chờ duyệt; không thể hủy.")
                audit(db, ident, "rejected", user_id, str(message_id))
            return {"answer": "Đã hủy", "edit_text": f"🗑 Đã hủy bản nháp {ident}.", "keyboard": menu_keyboard()}
        if action == "edit" and len(parts) == 3:
            ident = parts[2].upper()
            return {"answer": "Chọn cách sửa", "edit_text": f"✏️ Sửa bài {ident}\nChọn cách nhập nội dung:",
                    "keyboard": [[{"text": "🤖 Nhờ AI sửa", "callback_data": f"kt:edit_ai:{ident}"},
                                  {"text": "📝 Tự nhập nội dung", "callback_data": f"kt:edit_manual:{ident}"}],
                                 [{"text": "↩️ Quay lại", "callback_data": f"kt:open:{ident}"}]]}
        if action in ("edit_ai", "edit_manual") and len(parts) == 3:
            mode = "ai" if action == "edit_ai" else "manual"
            token = _begin_edit(db, parts[2].upper(), mode, user_id, chat_id, message_id)
            return {"answer": "Đã mở ô nhập", "edit_text": f"✏️ Đang chờ yêu cầu sửa {parts[2].upper()} (mã {token}).",
                    "keyboard": [[{"text": "✖️ Thoát sửa", "callback_data": f"kt:edit_exit:{token}"}]]}
        if action == "edit_exit" and len(parts) == 3:
            token = parts[2]
            row = db.execute("SELECT * FROM edit_sessions WHERE token=? AND actor=? AND status IN ('awaiting','processing')",
                             (token, user_id)).fetchone()
            if not row:
                raise ValueError("Phiên sửa không còn hiệu lực.")
            if row['mode']=='video_script':
                import video_script_editor
                job_id=video_script_editor.cancel(db,token,user_id,chat_id)
                import video_workflow
                job=db.execute('SELECT draft_id FROM video_jobs WHERE id=?',(job_id,)).fetchone()
                return {'answer':'Đã thoát sửa kịch bản','edit_text':'Đã đóng ô nhập; bài và video đang lưu vẫn được giữ.',
                        'keyboard':video_workflow.controls(db,job['draft_id']) if job else menu_keyboard()}
            with db:
                db.execute("UPDATE edit_sessions SET status='cancelled' WHERE token=?", (token,))
                db.execute("UPDATE drafts SET status='pending' WHERE id=? AND status='editing'", (row["draft_id"],))
                audit(db, row["draft_id"], "edit_cancelled", user_id, str(message_id))
            return {"answer": "Đã thoát sửa", "edit_text": "↩️ Đã thoát sửa; bản cũ vẫn chờ duyệt.", "keyboard": menu_keyboard()}
        if action == "sources" and len(parts) == 3:
            row = db.execute("SELECT bundle FROM drafts WHERE id=?", (parts[2].upper(),)).fetchone()
            if not row:
                raise ValueError("Không tìm thấy bản nháp.")
            return {"answer": "Nguồn tham khảo", "edit_text": json.loads(row["bundle"])["source_comment"],
                    "keyboard": [[{"text": "↩️ Về menu", "callback_data": "kt:menu"}]]}
        if action == "noop":
            return {"answer": "Đang xử lý", "edit_text": None}
        raise ValueError("Thao tác không hợp lệ hoặc đã hết hạn.")
    except (ValueError, RuntimeError) as exc:
        return {"answer": str(exc)[:180], "edit_text": "⚠️ " + str(exc)[:500], "keyboard": menu_keyboard()}
    finally:
        db.close()


def _ensure_daily_slots(db, slot_date, now=None):
    now = now or time.time()
    with db:
        for slot_time in DAILY_SLOTS:
            db.execute("""INSERT OR IGNORE INTO daily_slots
                (slot_date,slot_time,status,attempts,created,updated)
                VALUES(?,?, 'pending',0,?,?)""", (slot_date, slot_time, now, now))


def _recover_approved_publications(db):
    """Resume approved rows whose publish worker was never started."""
    rows = db.execute("""SELECT id FROM drafts WHERE status='approved'
        AND approved_by=? AND NOT EXISTS
        (SELECT 1 FROM publication_attempts p WHERE p.draft_id=drafts.id)
        AND NOT EXISTS (SELECT 1 FROM dual_approvals a WHERE a.draft_id=drafts.id)
        ORDER BY approved_at""", (config()["owner_id"],)).fetchall()
    for row in rows:
        background("publish", row["id"])


def _set_slot_result(db, slot_date, slot_time, *, status, draft_id=None,
                     error=None, retry_at=None):
    now = time.time()
    with db:
        db.execute("""UPDATE daily_slots SET status=?,draft_id=COALESCE(?,draft_id),
            error=?,next_retry=?,updated=? WHERE slot_date=? AND slot_time=?
            AND status='running'""",
                   (status, draft_id, error, retry_at, now, slot_date, slot_time))


def scheduler_tick(now=None):
    """Run at most one due daily slot; idle ticks make no AI call."""
    now = now or time.time()
    media_storage.maintenance(ROOT)
    local = local_datetime(now)
    slot_date = local.date().isoformat()
    db = database()
    try:
        __import__("owner_images").recover(db,now)
        _recover_creation_runs(db, now)
        _ensure_daily_slots(db, slot_date, now)
        expire_pending_drafts(db, now)
        _recover_approved_publications(db)
        import video_workflow
        video_workflow.recover(db)
        try:
            import composio_reporting
            for snapshot in db.execute('SELECT * FROM drafts ORDER BY created DESC LIMIT 20').fetchall():
                composio_reporting.enqueue_draft(db,snapshot)
            kick_reporting(db)
        except Exception:pass
        dual.recover(db)
        try:
            story=__import__('facebook_story')
            story.recover(db,now);story.kick(db)
        except Exception:
            pass  # Story follow-up must not interrupt research or main publication.
        # A process killed during an old attempt may leave a running slot. The
        # lease timeout makes it eligible again without duplicating a live run.
        with db:
            db.execute("""UPDATE daily_slots SET status='failed',error='worker timeout',
                next_retry=?,updated=? WHERE status='running'
                AND NOT EXISTS (SELECT 1 FROM leases l WHERE l.name='pipeline' AND l.owner=daily_slots.run_id AND l.expires>?)
                AND updated<?""",
                       (now + SLOT_RETRY_SECONDS, now, now, now-control.settings(config())['lease_seconds']))
        if db.execute("SELECT 1 FROM leases WHERE name='pipeline' AND expires>?",(now,)).fetchone():
            return {'status':'busy','slot_date':slot_date}
        due = []
        for row in db.execute("""SELECT * FROM daily_slots
            WHERE (slot_date=? OR run_id IS NOT NULL) AND status NOT IN ('completed','running','skipped','cancelled')
              AND (next_retry IS NULL OR next_retry<=?)
            ORDER BY slot_time""", (slot_date, now)).fetchall():
            if slot_datetime(row["slot_date"], row["slot_time"]) <= local and row["attempts"] < MAX_SLOT_ATTEMPTS:
                due.append(row)
        if not due:
            completed = db.execute("SELECT COUNT(*) AS n FROM daily_slots WHERE slot_date=? AND status='completed'", (slot_date,)).fetchone()["n"]
            return {"status": "idle", "slot_date": slot_date, "completed": completed,
                    "target": len(DAILY_SLOTS)}
        row = due[0]
        slot_date=row['slot_date']
        with db:
            claimed = db.execute("""UPDATE daily_slots SET status='running',attempts=attempts+1,
                last_attempt=?,next_retry=NULL,updated=?
                WHERE slot_date=? AND slot_time=? AND status NOT IN ('completed','running','skipped')
                AND attempts<?""", (now, now, row["slot_date"], row["slot_time"], MAX_SLOT_ATTEMPTS))
            if claimed.rowcount != 1:
                return {"status": "busy", "slot_date": slot_date}
        # Re-open through a fresh connection in the worker functions so the
        # scheduler never holds a write lock while an AI call runs.
        db.close()
        db = None
        if row["draft_id"]:
            check_db = database()
            try:
                draft = check_db.execute("SELECT * FROM drafts WHERE id=?", (row["draft_id"],)).fetchone()
                if draft and draft["review_message"]:
                    _set_slot_result(check_db, slot_date, row["slot_time"], status="completed", draft_id=draft["id"])
                    return {"status": "completed", "draft_id": draft["id"], "slot_time": row["slot_time"]}
                if draft and draft["status"] in ("preparing", "pending"):
                    request_review(check_db, draft["id"])
                    _set_slot_result(check_db, slot_date, row["slot_time"], status="completed", draft_id=draft["id"])
                    return {"status": "completed", "draft_id": draft["id"], "slot_time": row["slot_time"]}
                if draft:
                    # A slot is counted once its draft exists. Cancellation,
                    # expiry, publication, or an uncertain Facebook result
                    # must stay in history and never create a replacement.
                    _set_slot_result(check_db, slot_date, row["slot_time"], status="completed", draft_id=draft["id"])
                    return {"status": "completed", "draft_id": draft["id"], "slot_time": row["slot_time"]}
            except Exception as exc:
                attempt = int(row["attempts"] or 0) + 1
                _set_slot_result(check_db, slot_date, row["slot_time"],
                                 status="failed", error=str(exc)[:500],
                                 retry_at=time.time() + SLOT_RETRY_SECONDS if attempt < MAX_SLOT_ATTEMPTS else None)
                return {"status": "failed", "error": str(exc)[:500], "slot_time": row["slot_time"]}
            finally:
                check_db.close()
        resume_id=None
        if row['run_id']:
            resume_db=database()
            try:
                previous=resume_db.execute('SELECT * FROM runs WHERE id=?',(row['run_id'],)).fetchone()
                if previous and previous['cancel_requested']:
                    _set_slot_result(resume_db,slot_date,row['slot_time'],status='cancelled',error='Chủ trang đã hủy')
                    return {'status':'cancelled','slot_date':slot_date,'slot_time':row['slot_time']}
                if previous and (previous['research_checkpoint'] or previous['editor_checkpoint'] or previous['checkpoint']):
                    with resume_db:
                        resume_db.execute("DELETE FROM leases WHERE expires<?",(time.time(),))
                        if not resume_db.execute("SELECT 1 FROM leases WHERE name='pipeline'").fetchone():
                            resume_db.execute("INSERT INTO leases VALUES('pipeline',?,?)",(previous['id'],time.time()+control.settings(config())['lease_seconds']))
                            resume_db.execute("UPDATE runs SET status='queued',worker_token=NULL,finished=NULL WHERE id=?",(previous['id'],))
                            resume_id=previous['id']
            finally:resume_db.close()
        result = pipeline(slot_date=slot_date, slot_time=row["slot_time"], scheduled=True,
                          **({'run_id':resume_id,'resume':True} if resume_id else {}))
        result = result or {"status": "failed", "error": "pipeline không trả kết quả"}
        final_db = database()
        try:
            if result.get('status') in ('busy','already_started'):
                with final_db:final_db.execute("UPDATE daily_slots SET status='pending',attempts=MAX(0,attempts-1),next_retry=NULL WHERE slot_date=? AND slot_time=?",(slot_date,row['slot_time']))
            elif result.get('status')=='cancelled':
                _set_slot_result(final_db,slot_date,row['slot_time'],status='cancelled',error='Chủ trang đã hủy')
            elif result.get("status") == "awaiting_approval":
                _set_slot_result(final_db, slot_date, row["slot_time"], status="completed", draft_id=result.get("draft_id"))
            elif result.get("status") == "skipped":
                _set_slot_result(final_db, slot_date, row["slot_time"], status="skipped",
                                 error=result.get("error", "Bỏ qua — thiếu bằng chứng"), retry_at=None)
            else:
                attempt = int(row["attempts"] or 0) + 1
                _set_slot_result(final_db, slot_date, row["slot_time"], status="failed",
                                 error=result.get("error", result.get("status")),
                                 retry_at=time.time() + SLOT_RETRY_SECONDS if attempt < MAX_SLOT_ATTEMPTS else None)
        finally:
            final_db.close()
        return {**result, "slot_date": slot_date, "slot_time": row["slot_time"]}
    finally:
        if db is not None:
            db.close()

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("command",choices=["run","resume","story","video","regenerate-image","revise","revise-manual","publish","retry-publish",
                                             "reconcile","status","announce","check-composio"])
    parser.add_argument("args",nargs="*")
    args = parser.parse_args()
    if args.command == "run":
        pipeline(run_id=args.args[0] if args.args else None)
    elif args.command == 'story':
        with database() as db:
            print(json.dumps(__import__('facebook_story').run(db),ensure_ascii=False))
    elif args.command == 'resume':
        print(json.dumps(resume_creation(args.args[0]),ensure_ascii=False))
    elif args.command == 'regenerate-image':
        print(json.dumps(regenerate_illustration(args.args[0]),ensure_ascii=False))
    elif args.command=='video':
        import video_workflow
        print(json.dumps(video_workflow.run(args.args[0]),ensure_ascii=False))
    elif args.command == "revise":
        pipeline(*args.args)
    elif args.command == "revise-manual":
        if len(args.args) < 2:
            raise SystemExit("revise-manual cần mã bài và caption mới")
        with database() as db:
            ident = None
            changed = False
            try:
                parent_id = args.args[0].upper()
                ident, changed = manual_revision(db, parent_id, args.args[1])
                if changed:
                    request_review(db, ident)
                    with db:
                        db.execute("UPDATE drafts SET status='superseded' WHERE id=? AND status='editing'", (parent_id,))
                        db.execute("UPDATE edit_sessions SET status='completed' WHERE draft_id=? AND status='processing'", (parent_id,))
                        audit(db, parent_id, "manual_revision_created", message_id=ident)
                    telegram("editor", f"✅ Đã tạo bản sửa {ident}; anh xem và bấm Duyệt và đăng.",
                             inline_keyboard=menu_keyboard())
                else:
                    telegram("editor", f"ℹ️ Nội dung không đổi; bản {ident} vẫn chờ duyệt.",
                             inline_keyboard=menu_keyboard())
            except (ValueError, RuntimeError) as exc:
                with db:
                    db.execute("UPDATE drafts SET status='pending' WHERE id=? AND status='editing'", (args.args[0].upper(),))
                    if ident and changed:
                        db.execute("UPDATE drafts SET status='rejected',error=? WHERE id=? AND status='preparing'",
                                   (str(exc)[:500], ident))
                    db.execute("UPDATE edit_sessions SET status='failed' WHERE draft_id=? AND status='processing'", (args.args[0].upper(),))
                telegram("editor", "⚠️ " + str(exc)[:500], inline_keyboard=menu_keyboard())
    elif args.command == "status":
        with database() as db:
            print(status_text(db))
    elif args.command == "announce":
        print("Telegram message:",telegram("editor",help_text()))
    elif args.command == "check-composio":
        from publisher import check_connection
        print(json.dumps(asyncio.run(check_connection()),ensure_ascii=False))
    elif args.command in ("publish", "retry-publish"):
        from publisher import publish,verify_post
        with database() as db:
            candidate=db.execute('SELECT * FROM drafts WHERE id=?',(args.args[0].upper(),)).fetchone()
            if candidate and dual.is_dual(candidate):
                print(json.dumps(dual.run(db,candidate['id']),ensure_ascii=False));return
            try:
                if args.command == "retry-publish":
                    # A retry is allowed only after a fresh, complete read of
                    # Facebook confirms that the exact caption is still absent.
                    from publisher import reconcile_page
                    current = db.execute("SELECT * FROM drafts WHERE id=?", (args.args[0].upper(),)).fetchone()
                    if not current or current["status"] != "uncertain" or current["post_id"]:
                        raise RuntimeError("Bản này không đủ điều kiện gửi lại.")
                    check = asyncio.run(reconcile_page(current["content"]))
                    matches = check.get("matches", [])
                    if not check.get("complete") or matches:
                        note = ("Đối soát lại chưa đầy đủ; không gửi lại."
                                if not check.get("complete") else
                                "Đối soát đã thấy bài Facebook; không gửi lại.")
                        with db:
                            if len(matches) == 1:
                                db.execute("UPDATE drafts SET status='published',post_id=?,error=NULL WHERE id=?",
                                           (matches[0]["id"], args.args[0].upper()))
                                audit(db, args.args[0].upper(), "reconciled_before_retry", message_id=matches[0]["id"])
                            else:
                                db.execute("UPDATE drafts SET status='uncertain',error=? WHERE id=?", (note, args.args[0].upper()))
                                audit(db, args.args[0].upper(), "retry_blocked_by_reconciliation")
                        update_publish_ui(db, args.args[0].upper(), note)
                        return
                post_id = publish_once(
                    db, args.args[0],
                    lambda content,media,source_comment,progress=None:
                        asyncio.run(publish(content,media,source_comment,progress=progress)),
                    allow_uncertain=args.command == "retry-publish")
                content=db.execute("SELECT content FROM drafts WHERE id=?",(args.args[0],)).fetchone()[0]
                try:
                    url=asyncio.run(verify_post(post_id,content))
                    with db: audit(db,args.args[0],"post_readback_verified")
                    telegram_edit(db.execute("SELECT publish_status_message FROM drafts WHERE id=?", (args.args[0],)).fetchone()[0],
                                 "✅ ĐĂNG • Đã đăng và kiểm tra lại bài " + args.args[0] + "\n" + url,
                                 inline_keyboard=[[{"text": "🌐 Mở Facebook", "url": url}],
                                                  [{"text": "↩️ Về menu", "callback_data": "kt:menu"}]])
                except Exception:
                    with db: audit(db,args.args[0],"post_created_readback_unavailable")
                    row = db.execute("SELECT * FROM drafts WHERE id=?", (args.args[0],)).fetchone()
                    update_publish_ui(db, args.args[0],
                                      "Facebook đã xác nhận tạo bài, nhưng chưa đọc lại được ảnh/nội dung. Không đăng lại.")
            except Exception as exc:
                update_publish_ui(db, args.args[0], "ĐĂNG • " + str(exc)[:900])
    elif args.command == "reconcile":
        from publisher import reconcile_page
        ident = args.args[0].upper()
        with database() as db:
            row = db.execute("SELECT * FROM drafts WHERE id=?", (ident,)).fetchone()
            if not row:
                raise SystemExit("Không tìm thấy bản nháp.")
            try:
                result = asyncio.run(reconcile_page(row["content"]))
                matches = result.get("matches", [])
                if not result.get("complete"):
                    note = "Đối soát chưa đầy đủ: " + str(result.get("error", "Facebook chưa trả hết dữ liệu."))
                    with db:
                        db.execute("UPDATE drafts SET status='uncertain',error=? WHERE id=?", (note, ident))
                        audit(db, ident, "reconcile_incomplete")
                elif len(matches) == 1:
                    post_id = matches[0]["id"]
                    with db:
                        db.execute("UPDATE drafts SET status='published',post_id=?,error=NULL WHERE id=?", (post_id, ident))
                        audit(db, ident, "reconciled_post_found", message_id=post_id)
                    update_publish_ui(db, ident, "Đã đối soát đúng một bài Facebook; không gửi lại.")
                    print(json.dumps({"status": "published", "post_id": post_id, "match": matches[0]}, ensure_ascii=False))
                    return
                elif len(matches) > 1:
                    note = "Đối soát thấy nhiều bài có cùng caption: " + ", ".join(m["id"] for m in matches)
                    with db:
                        db.execute("UPDATE drafts SET status='uncertain',error=? WHERE id=?", (note, ident))
                        audit(db, ident, "reconcile_multiple_matches")
                else:
                    note = "Đã kiểm tra đầy đủ nhưng chưa thấy bài trên fanpage — chỉ gửi lại khi anh bấm nút."
                    with db:
                        db.execute("UPDATE drafts SET status='uncertain',error=? WHERE id=?", (note, ident))
                        audit(db, ident, "reconcile_no_post")
                update_publish_ui(db, ident)
                print(json.dumps({"status": "uncertain", "matches": matches,
                                  "complete": result.get("complete")}, ensure_ascii=False))
            except Exception as exc:
                note = "Đối soát Facebook thất bại: " + str(exc)[:900]
                with db:
                    db.execute("UPDATE drafts SET status='uncertain',error=? WHERE id=?", (note, ident))
                    audit(db, ident, "reconcile_failed")
                update_publish_ui(db, ident, note)
                raise

if __name__ == "__main__":
    main()
