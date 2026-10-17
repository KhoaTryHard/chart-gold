"""Explicit ElevenLabs backends with shared durable credit accounting.

Composio restrictions remain enforced in that backend. The separately selected
direct_api backend uses only an independently supplied local API credential;
neither backend automatically falls back to the other.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
from datetime import datetime
import hashlib
import html
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import unicodedata
import uuid
from zoneinfo import ZoneInfo

import publisher

ROOT = Path(__file__).resolve().parent
SETTINGS_PATH = ROOT / "data/video-settings.local.json"
TTS_SLUG = "ELEVENLABS_TEXT_TO_SPEECH"
DEFAULT_SETTINGS = {"schema_version": 1, "enabled": False, "backend": "composio", "voice_id": None,
                    "model_id": "eleven_flash_v2_5", "monthly_credit_limit": 20000,
                    "video_credit_limit": 2000}


class ElevenLabsBlocked(RuntimeError):
    """Safe operational failure; remote SDK exceptions are never surfaced."""


class CreditBudgetExceeded(ElevenLabsBlocked):
    pass


class TTSReconciliationRequired(ElevenLabsBlocked):
    pass


def load_settings(path=None):
    target = Path(path or SETTINGS_PATH)
    value = {**DEFAULT_SETTINGS}
    if target.exists():
        loaded = json.loads(target.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict) or loaded.get("schema_version", 1) != 1:
            raise ElevenLabsBlocked("Cấu hình video không hợp lệ")
        _check_safe(loaded)
        value.update(loaded)
    if value["model_id"] != "eleven_flash_v2_5":
        raise ElevenLabsBlocked("Model video v1 phải là Flash v2.5")
    if value.get("backend") not in {"composio", "direct_api"}:
        raise ElevenLabsBlocked("Backend ElevenLabs không hợp lệ")
    for key, cap in (("monthly_credit_limit", 20000), ("video_credit_limit", 2000)):
        amount = value.get(key)
        if isinstance(amount, bool) or not isinstance(amount, int) or not 0 < amount <= cap:
            raise ElevenLabsBlocked("Hạn mức credits video không hợp lệ")
    return value


def _check_safe(value):
    if isinstance(value, dict):
        if any(str(k).lower() in {"api_key", "token", "access_token", "refresh_token", "secret", "email"} for k in value):
            raise ElevenLabsBlocked("Cấu hình chỉ lưu ID và bằng chứng; credential phải nằm trong kho bí mật riêng")
        for item in value.values():
            _check_safe(item)
    elif isinstance(value, list):
        for item in value:
            _check_safe(item)


def save_settings(value, path=None):
    _check_safe(value)
    target = Path(path or SETTINGS_PATH)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + "." + uuid.uuid4().hex + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, target)


def _unwrap(value):
    while isinstance(value, dict) and len(value) == 1 and isinstance(next(iter(value.values())), (dict, list)):
        value = next(iter(value.values()))
    return value


def _rows(value, key):
    value = _unwrap(value)
    if isinstance(value, list):
        return [x for x in value if isinstance(x, dict)]
    if isinstance(value, dict):
        return _rows(value.get(key, value.get("response_data", value.get("data", []))), key)
    return []


class ElevenSession:
    def __init__(self, call):
        self.call, self.sid, self.account = call, None, None
        self.schemas, self.restricted = {}, set()
        self.connection = {}
        self.selected_voice_id = None

    async def discover(self):
        data = await self.call("COMPOSIO_SEARCH_TOOLS", {
            "queries": [{"use_case": "ElevenLabs subscription credits account remaining voices and model rates"},
                        {"use_case": "Convert Vietnamese text to speech using ElevenLabs Flash v2.5 with a selected voice"}],
            "search_strategy": "tool_search", "session": {"generate_id": True}})
        self.sid = data["session"]["id"]
        self.schemas.update(data.get("tool_schemas", {}))
        for result in data.get("results", []):
            guidance = result.get("execution_guidance", "")
            # Restricted names may appear in guidance, but are not capabilities.
            if "Restricted tools" in guidance:
                restricted = guidance.split("Restricted tools", 1)[1].split("Found", 1)[0]
                self.restricted.update(re.findall(r"ELEVENLABS_[A-Z_]+", restricted))
        self.connection = next((s for s in data.get("toolkit_connection_statuses", []) if s.get("toolkit") == "elevenlabs"), {})
        accounts = [a for a in self.connection.get("accounts", []) if a.get("status") == "ACTIVE"]
        defaults = [a for a in accounts if a.get("is_default")]
        self.account = defaults[0]["id"] if len(defaults) == 1 else accounts[0]["id"] if len(accounts) == 1 else None
        return data

    async def ensure_schema(self, slug):
        if slug in self.restricted or slug not in self.schemas:
            raise ElevenLabsBlocked("Công cụ ElevenLabs chưa được phép trong runtime: " + slug)
        if "input_schema" not in self.schemas[slug]:
            data = await self.call("COMPOSIO_GET_TOOL_SCHEMAS", {"tool_slugs": [slug], "session_id": self.sid})
            self.schemas.update(data.get("tool_schemas", {}))
        if "input_schema" not in self.schemas.get(slug, {}):
            raise ElevenLabsBlocked("Thiếu schema ElevenLabs đầy đủ")
        return self.schemas[slug]["input_schema"]

    async def execute(self, slug, arguments):
        if not self.account:
            raise ElevenLabsBlocked("ElevenLabs chưa có tài khoản ACTIVE được chọn")
        schema = await self.ensure_schema(slug)
        import jsonschema
        jsonschema.validate(arguments, schema)
        result = await self.call("COMPOSIO_MULTI_EXECUTE_TOOL", {
            "tools": [{"tool_slug": slug, "arguments": arguments, "account": self.account}],
            "session_id": self.sid, "sync_response_to_workbench": False, "current_step": "VIDEO_ELEVENLABS"})
        rows = result.get("results", [])
        if len(rows) != 1 or rows[0].get("response", {}).get("successful") is not True:
            raise ElevenLabsBlocked("Composio chưa xác nhận ElevenLabs thành công")
        if "data" not in rows[0]["response"] and result.get("remote_file_info", {}).get("file_path"):
            return await self.hydrate_read_result(result, slug)
        return rows[0]["response"].get("data", {})

    async def hydrate_read_result(self, result, slug):
        """Read externalized *allowed read action* results, with a safe projection.

        Composio often returns data_preview for voice libraries; treating that
        preview as a complete empty list would give false connection evidence.
        This never invokes provider APIs or generates speech remotely.
        """
        if slug not in {"ELEVENLABS_GET_VOICES", "ELEVENLABS_GET_SHARED_VOICES", "ELEVENLABS_GET_MODELS", "ELEVENLABS_GET_USER_SUBSCRIPTION_INFO"}:
            raise TTSReconciliationRequired("Kết quả audio bị externalize; cần đối soát asset trước khi tiếp tục")
        path = result["remote_file_info"]["file_path"]
        if not isinstance(path, str) or not re.fullmatch(r"/mnt/[A-Za-z0-9_./-]+\.json", path) or ".." in path.split("/"):
            raise ElevenLabsBlocked("Composio trả đường dẫn kết quả không hợp lệ")
        fields = {"voices", "models", "model_id", "can_do_text_to_speech", "languages", "language_id", "model_rates",
                  "character_cost_multiplier", "cost_discount_multiplier", "voice_id", "labels", "gender", "language",
                  "accent", "name", "preview_url", "category", "sharing", "credit_multiplier", "verified_languages",
                  "rate", "fiat_rate", "financial_rewards_enabled",
                  "use_case", "tier", "character_count", "character_limit", "can_extend_character_limit",
                  "next_character_count_reset_unix", "public_owner_id", "maximum_text_length_per_request"}
        filtering = "data=r.get('data',{})\n"
        if slug in {"ELEVENLABS_GET_VOICES", "ELEVENLABS_GET_SHARED_VOICES"}:
            filtering += ("def candidate(v):\n l=v.get('labels') or {}\n"
                " lang={str(l.get('language',v.get('language',''))).lower()}\n"
                " lang.update(str(x.get('language',x.get('language_id',''))).lower() for x in v.get('verified_languages',[]) if isinstance(x,dict))\n"
                " return str(l.get('gender',v.get('gender',''))).lower()=='female' and bool(lang & {'vi','vietnamese','vi-vn'})\n"
                "items=data.get('voices',[]) if isinstance(data,dict) else data\n"
                "data={'voices':[v for v in items if candidate(v) or v.get('voice_id')==" + repr(self.selected_voice_id) + "][:10]}\n")
        elif slug == "ELEVENLABS_GET_MODELS":
            filtering += ("items=data.get('models',[]) if isinstance(data,dict) else data\n"
                          "data={'models':[v for v in items if v.get('model_id')=='eleven_flash_v2_5']}\n")
        code = ("import json\nv=json.load(open(" + repr(path) + "))\n"
                "rows=v.get('results',[])\nassert len(rows)==1 and rows[0].get('tool_slug')==" + repr(slug) + "\n"
                "r=rows[0]['response']\nassert r.get('successful') is True\n"
                + filtering +
                "allowed=" + repr(fields) + "\n"
                "def safe(x):\n if isinstance(x,dict):return {k:safe(v) for k,v in x.items() if k in allowed}\n"
                " if isinstance(x,list):return [safe(v) for v in x]\n return x\n"
                "print(json.dumps({'elevenlabs_result':safe(data)},ensure_ascii=False))")
        hydrated = await self.call("COMPOSIO_REMOTE_WORKBENCH", {
            "code_to_execute": code, "session_id": self.sid, "current_step": "READING_ALLOWED_ELEVENLABS_RESULT"})
        def find(value):
            if isinstance(value, dict):
                if "elevenlabs_result" in value: return value["elevenlabs_result"]
                for child in value.values():
                    found = find(child)
                    if found is not None: return found
            elif isinstance(value, list):
                for child in value:
                    found = find(child)
                    if found is not None: return found
            elif isinstance(value, str):
                for line in value.splitlines():
                    try: parsed = json.loads(line)
                    except ValueError: continue
                    if isinstance(parsed, (dict, list)):
                        found = find(parsed)
                        if found is not None: return found
            return None
        data = find(hydrated)
        if data is None: raise ElevenLabsBlocked("Chưa đọc được dữ liệu ElevenLabs đầy đủ")
        return data


def voice_candidates(data):
    candidates = []
    for voice in _rows(data, "voices"):
        labels = {**{k: voice.get(k) for k in ("gender", "language", "accent", "use_case")}, **(voice.get("labels") or {})}
        languages = {str(labels.get("language", "")).lower()}
        languages.update(str(x.get("language", x.get("language_id", ""))).lower() for x in voice.get("verified_languages", []) if isinstance(x, dict))
        gender = str(labels.get("gender", "")).lower()
        if gender in {"female", "woman", "nữ"} and languages & {"vi", "vietnamese", "vi-vn", "vietnam", "tiếng việt"}:
            candidates.append({"voice_id": voice.get("voice_id"), "name": voice.get("name"),
                               "labels": {k: labels.get(k) for k in ("gender", "language", "accent", "use_case")},
                               "preview_url": voice.get("preview_url"), "category": voice.get("category")})
    return candidates


def standard_voice_metadata(voice):
    sharing = voice.get("sharing") or {}
    return {"category": voice.get("category"),
            "sharing_rate": sharing.get("rate"),
            "fiat_rate_present": "fiat_rate" in sharing,
            "fiat_rate": sharing.get("fiat_rate"),
            "financial_rewards_enabled": sharing.get("financial_rewards_enabled")}


def verified_standard_voice(verification, model, voice, account_id, tier):
    """Bind an observed custom-rate exclusion to current account/voice metadata.

    The generic sharing.rate field alone is not a credit multiplier. This proof
    comes from finding the exact voice in the authenticated library with custom
    rates excluded, and expires within 24 hours. Changed metadata requires a new
    observation rather than silently carrying a cheaper price forward.
    """
    if not isinstance(verification, dict): return False
    observed, expires = verification.get("observed_at"), verification.get("expires_at")
    if any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x)
           for x in (observed, expires)): return False
    now = time.time()
    metadata = standard_voice_metadata(voice)
    return bool(verification.get("source") == "authenticated_voice_library_custom_rates_excluded"
                and account_id and verification.get("account_id") == account_id
                and tier and verification.get("subscription_tier") == tier
                and voice.get("voice_id") and verification.get("voice_id") == voice["voice_id"]
                and model.get("model_id") and verification.get("model_id") == model["model_id"]
                and verification.get("voice_multiplier") == 1
                and not isinstance(verification.get("voice_multiplier"), bool)
                and 0 < expires - observed <= 86400 and observed <= now + 300 and now <= expires
                and metadata["category"] == "professional"
                and metadata["sharing_rate"] == 1 and not isinstance(metadata["sharing_rate"], bool)
                and metadata["fiat_rate_present"] and metadata["fiat_rate"] is None
                and metadata["financial_rewards_enabled"] is False
                and verification.get("voice_metadata") == metadata)


def rate_evidence(model, voice, *, standard_verification=None, account_id=None, tier=None):
    """Use account-returned rates, including an explicit voice multiplier.

No price inferred from a paid tier, website screenshot or model name. Default
library voices have no surcharge; professional/community voices must expose
their actual multiplier before a budget can be reserved.
"""
    rates = model.get("model_rates", {})
    character = rates.get("character_cost_multiplier")
    discount = rates.get("cost_discount_multiplier")
    sharing = voice.get("sharing") or {}
    voice_rate = voice.get("credit_multiplier", sharing.get("credit_multiplier"))
    if voice_rate is None and voice.get("category") == "premade":
        voice_rate = 1.0
    ui_verified = False
    if voice_rate is None and verified_standard_voice(standard_verification, model, voice, account_id, tier):
        voice_rate, ui_verified = 1.0, True
    parts = (character, discount, voice_rate)
    if any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) or x <= 0 for x in parts):
        return {"status": "unknown_rate", "credits_per_character": None}
    result = {"status": "verified", "credits_per_character": float(character * discount * voice_rate),
            "model_character_multiplier": character, "model_discount_multiplier": discount,
            "voice_multiplier": voice_rate, "source": "Composio account models/voices", "checked_at": time.time()}
    if ui_verified:
        result.update(source="Composio model rates + authenticated Voice Library standard-rate verification",
                      voice_rate_verified_at=standard_verification["observed_at"],
                      voice_rate_expires_at=standard_verification["expires_at"])
    return result


async def _preflight(client, settings, initiate=False):
    client.selected_voice_id = settings.get("voice_id")
    await client.discover()
    tts_available = TTS_SLUG in client.schemas and TTS_SLUG not in client.restricted
    result = {"status": "blocked", "reason": None, "tts_available": tts_available, "can_synthesize": False,
              "voice_id": settings.get("voice_id"), "model_id": settings["model_id"],
              "credit_rate_evidence": {"status": "unknown_rate", "credits_per_character": None},
              "voice_candidates": [], "auth_links": [], "account_id": client.account,
              "checked_at": time.time()}
    if not client.account:
        result.update(status="needs_connection", reason="ElevenLabs chưa có kết nối ACTIVE")
        if initiate:
            created = await client.call("COMPOSIO_MANAGE_CONNECTIONS", {
                "session_id": client.sid, "toolkits": [{"name": "elevenlabs", "action": "add"}]})
            def collect(item):
                if isinstance(item, dict):
                    if item.get("redirect_url"):
                        result["auth_links"].append({"toolkit": "elevenlabs", "redirect_url": item["redirect_url"]})
                    for child in item.values(): collect(child)
                elif isinstance(item, list):
                    for child in item: collect(child)
            collect(created)
        if not tts_available:
            result["restricted_reason"] = "TTS bị hạn chế trong runtime Composio hiện tại; kết nối không bỏ hạn chế"
        return result
    try:
        subscription = _unwrap(await client.execute("ELEVENLABS_GET_USER_SUBSCRIPTION_INFO", {}))
        models = _rows(await client.execute("ELEVENLABS_GET_MODELS", {}), "models")
        voices = _rows(await client.execute("ELEVENLABS_GET_VOICES", {}), "voices")
    except Exception:
        result["reason"] = "Chưa đọc được subscription, model hoặc giọng từ Composio"
        return result
    # Deliberately expose only fields that cannot contain API credentials/user email.
    used, limit = subscription.get("character_count"), subscription.get("character_limit")
    result["subscription"] = {k: subscription.get(k) for k in ("tier", "character_count", "character_limit", "can_extend_character_limit", "next_character_count_reset_unix")}
    remaining = limit - used if all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in (used, limit)) else None
    result["account_credits_remaining"] = max(0, remaining) if remaining is not None else None
    result["voice_candidates"] = voice_candidates(voices)
    if not result["voice_candidates"]:
        # Shared previews are existing library files: reading them costs no TTS
        # credits. Do not add a voice or select it without an owner choice.
        found = await client.call("COMPOSIO_SEARCH_TOOLS", {
            "queries": [{"use_case": "List ElevenLabs shared voices by Vietnamese language and female gender"}],
            "search_strategy": "tool_search", "session": {"id": client.sid}})
        client.schemas.update(found.get("tool_schemas", {}))
        if "ELEVENLABS_GET_SHARED_VOICES" in client.schemas:
            try:
                shared = await client.execute("ELEVENLABS_GET_SHARED_VOICES", {"language": "vi", "gender": "female", "page_size": 10, "sort": "usage_character_count_1y"})
                result["shared_voice_candidates"] = voice_candidates(shared)[:3]
                result["shared_voice_candidates_require_add"] = True
            except Exception:
                result["shared_voice_candidates"] = []
    model = next((m for m in models if m.get("model_id") == settings["model_id"]), None)
    voice = next((v for v in voices if v.get("voice_id") == settings.get("voice_id")), None)
    if model and voice:
        result["credit_rate_evidence"] = rate_evidence(model, voice,
            standard_verification=settings.get("voice_standard_rate_verification"),
            account_id=client.account, tier=subscription.get("tier"))
    reasons = []
    if not tts_available: reasons.append("TTS bị hạn chế hoặc chưa được khám phá trong Composio")
    if not settings.get("enabled"): reasons.append("Tính năng video đang tắt")
    if not settings.get("voice_id") or not settings.get("voice_approved_at") or voice is None:
        reasons.append("Cần chủ trang nghe mẫu và chọn giọng nữ tiếng Việt")
    elif settings["voice_id"] not in {v["voice_id"] for v in result["voice_candidates"]}:
        reasons.append("Giọng đã chọn chưa xác minh là nữ tiếng Việt")
    if model is None or not model.get("can_do_text_to_speech") or "vi" not in {x.get("language_id") for x in model.get("languages", [])}:
        reasons.append("Flash v2.5 chưa xác minh hỗ trợ TTS tiếng Việt trong tài khoản")
    if remaining is None: reasons.append("Chưa xác định số dư credits tài khoản")
    elif remaining <= 0: reasons.append("Tài khoản hết credits")
    if subscription.get("can_extend_character_limit") is not False:
        reasons.append("Chưa xác minh đã tắt trả phí vượt mức ElevenLabs")
    if result["credit_rate_evidence"]["status"] != "verified": reasons.append("Chưa xác định mức tính credits của model/giọng")
    result.update(status="blocked" if reasons else "ready", reason="; ".join(reasons) if reasons else None,
                  can_synthesize=not reasons)
    return result


async def preflight(settings_path=None, initiate=False):
    settings = load_settings(settings_path)
    if settings["backend"] == "direct_api":
        return await direct_preflight(settings)
    try:
        async with publisher.connect() as call:
            return await _preflight(ElevenSession(call), settings, initiate)
    except Exception as exc:
        return {"status": "blocked", "reason": "Không xác minh được runtime Composio", "error_type": type(exc).__name__,
                "can_synthesize": False, "tts_available": False, "voice_id": settings.get("voice_id"), "model_id": settings["model_id"]}


async def _direct_preflight(client, settings):
    """Read official provider metadata; this never dispatches paid speech."""
    result = {"backend":"direct_api", "status":"blocked", "can_synthesize":False,
        "tts_available":True, "tts_authorization_status":"not_tested_by_generation",
        "voice_id":settings.get("voice_id"), "model_id":settings["model_id"],
        "checked_at":time.time(), "credit_rate_evidence":{"status":"unknown_rate","credits_per_character":None}}
    if not settings.get("voice_id") or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}",str(settings["voice_id"])):
        result["reason"]="Cần chọn giọng trước khi kiểm tra ElevenLabs trực tiếp";return result
    subscription = await client.get_json("/v1/user/subscription")
    models = _rows(await client.get_json("/v1/models"), "models")
    voice = await client.get_json("/v1/voices/" + settings["voice_id"])
    if not isinstance(subscription,dict) or not isinstance(voice,dict) or voice.get("voice_id")!=settings["voice_id"]:
        result["reason"]="Metadata ElevenLabs không khớp tài khoản/giọng cần kiểm tra";return result
    result["subscription"]={k:subscription.get(k) for k in ("tier","character_count","character_limit","can_extend_character_limit","next_character_count_reset_unix")}
    used,limit=subscription.get("character_count"),subscription.get("character_limit")
    numeric=lambda x:isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x) and x>=0
    remaining=max(0,limit-used) if numeric(used) and numeric(limit) else None
    result["account_credits_remaining"]=remaining
    result["voice_candidates"]=voice_candidates({"voices":[voice]})
    model=next((m for m in models if m.get("model_id")==settings["model_id"]),None)
    if model:
        result["credit_rate_evidence"]=rate_evidence(model,voice)
        if result["credit_rate_evidence"]["status"]=="verified":
            result["credit_rate_evidence"]["source"]="ElevenLabs authenticated API models/voice"
        if result["credit_rate_evidence"]["status"]!="verified":
            # The official API offers this filter even where the MCP toolkit
            # schema does not. A positive exact-ID match proves standard rate;
            # missing/ambiguous results remain unknown rather than assumed free.
            found=False
            name=str(voice.get("name") or "").split(" - ",1)[0][:100]
            if name:
                for page in range(3):
                    library=await client.get_json("/v1/shared-voices",params={"search":name,
                        "language":"vi","gender":"female","include_custom_rates":False,"page_size":100,"page":page})
                    if any(item.get("voice_id")==settings["voice_id"] for item in _rows(library,"voices")):
                        found=True;break
                    if not isinstance(library,dict) or library.get("has_more") is not True:break
            if found:
                standard=dict(voice,credit_multiplier=1.0)
                result["credit_rate_evidence"]=rate_evidence(model,standard)
                result["credit_rate_evidence"].update(source="ElevenLabs authenticated API models + shared voices excluding custom rates",
                    standard_voice_verified=True,voice_id=settings["voice_id"])
            result["standard_voice_verified"]=found
    reasons=[]
    if not settings.get("enabled"):reasons.append("Tính năng video đang tắt")
    if not settings.get("voice_approved_at") or not result["voice_candidates"]:reasons.append("Giọng nữ Việt chưa được chủ trang chọn/xác minh")
    if not model or not model.get("can_do_text_to_speech") or "vi" not in {x.get("language_id") for x in model.get("languages",[])}:
        reasons.append("Model chưa được xác minh hỗ trợ TTS tiếng Việt")
    if remaining is None:reasons.append("Chưa đọc được số dư credits")
    elif remaining<=0:reasons.append("Tài khoản hết credits")
    if subscription.get("can_extend_character_limit") is not False:reasons.append("Chưa xác minh đã tắt trả phí vượt mức")
    if result["credit_rate_evidence"]["status"]!="verified":reasons.append("Chưa xác minh được giá credits giọng/model")
    result.update(status="blocked" if reasons else "ready",can_synthesize=not reasons,reason="; ".join(reasons) if reasons else None)
    return result


async def direct_preflight(settings):
    from elevenlabs_secrets import load_api_key, CredentialError
    from elevenlabs_direct import DirectClient, DirectAPIError
    try:
        async with DirectClient(load_api_key()) as client:
            return await _direct_preflight(client,settings)
    except (CredentialError,DirectAPIError) as exc:
        return {"backend":"direct_api","status":"blocked","can_synthesize":False,"tts_available":False,
                "reason":str(exc),"voice_id":settings.get("voice_id"),"model_id":settings["model_id"]}
    except Exception:
        return {"backend":"direct_api","status":"blocked","can_synthesize":False,"tts_available":False,
                "reason":"Chưa xác minh được kết nối ElevenLabs trực tiếp","voice_id":settings.get("voice_id"),"model_id":settings["model_id"]}


def initialize_credit_ledger(db):
    db.execute("""CREATE TABLE IF NOT EXISTS video_credit_calls (
        job_id TEXT NOT NULL, scene_index INTEGER NOT NULL, text_sha256 TEXT NOT NULL,
        model_id TEXT NOT NULL, voice_id TEXT NOT NULL, budget_month TEXT NOT NULL,
        reserved_credits INTEGER NOT NULL, actual_credits REAL, state TEXT NOT NULL,
        history_id TEXT, request_id TEXT, audio_path TEXT, audio_sha256 TEXT, duration REAL,
        created REAL NOT NULL, updated REAL NOT NULL, PRIMARY KEY(job_id, scene_index))""")
    db.commit()


def sanitize_text(text):
    if not isinstance(text, str): raise ElevenLabsBlocked("Lời đọc phải là văn bản")
    text = re.sub(r"<[^>]*>", " ", text)
    text = html.unescape(text)
    text = unicodedata.normalize("NFC", text)
    text = "".join(c for c in text if c in "\n\t" or unicodedata.category(c) not in {"Cc", "Cf"})
    text = re.sub(r"\s+", " ", text).strip()
    if not text or len(text) > 4000: raise ElevenLabsBlocked("Lời đọc cảnh phải từ 1 đến 4.000 ký tự")
    return text


def reserve_credits(db, job_id, scene_index, text, settings, evidence, remaining):
    for key,cap in (("monthly_credit_limit",20000),("video_credit_limit",2000)):
        value=settings.get(key)
        if isinstance(value,bool) or not isinstance(value,int) or not 0<value<=cap:
            raise CreditBudgetExceeded("Hạn mức credits vượt trần đã chốt; không gửi TTS")
    if isinstance(scene_index, bool) or not isinstance(scene_index, int) or not 0 <= scene_index < 6:
        raise ElevenLabsBlocked("Chỉ số cảnh phải từ 0 đến 5")
    if not isinstance(job_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", job_id):
        raise ElevenLabsBlocked("Mã job video không hợp lệ")
    rate = evidence.get("credits_per_character")
    if evidence.get("status") != "verified" or isinstance(rate, bool) or not isinstance(rate, (int, float)) or not math.isfinite(rate) or rate <= 0:
        raise ElevenLabsBlocked("Chưa xác minh được giá credits; không gọi TTS")
    if isinstance(remaining, bool) or not isinstance(remaining, (int, float)) or remaining <= 0:
        raise CreditBudgetExceeded("Chưa có số dư credits được xác minh")
    amount = math.ceil(len(text) * rate)
    text_sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    month = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).strftime("%Y-%m")
    initialize_credit_ledger(db)
    try:
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute("SELECT * FROM video_credit_calls WHERE job_id=? AND scene_index=?", (job_id, scene_index)).fetchone()
        if existing is not None:
            names = [x[1] for x in db.execute("PRAGMA table_info(video_credit_calls)")]
            row = dict(zip(names, existing))
            if row["text_sha256"] != text_sha or row["voice_id"] != settings["voice_id"] or row["model_id"] != settings["model_id"]:
                raise TTSReconciliationRequired("Cảnh/giọng đã thay đổi; cần phiên bản job mới")
            db.commit()
            return row
        total = db.execute("SELECT COALESCE(SUM(MAX(reserved_credits,COALESCE(actual_credits,0))),0) FROM video_credit_calls WHERE budget_month=?", (month,)).fetchone()[0]
        video = db.execute("SELECT COALESCE(SUM(MAX(reserved_credits,COALESCE(actual_credits,0))),0) FROM video_credit_calls WHERE job_id=?", (job_id,)).fetchone()[0]
        outstanding = db.execute("SELECT COALESCE(SUM(reserved_credits),0) FROM video_credit_calls WHERE state IN ('reserved','calling','uncertain')").fetchone()[0]
        if total + amount > settings["monthly_credit_limit"] or video + amount > settings["video_credit_limit"] or outstanding + amount > remaining:
            raise CreditBudgetExceeded("Không đủ ngân sách tháng, ngân sách video hoặc credits tài khoản")
        now = time.time()
        db.execute("INSERT INTO video_credit_calls(job_id,scene_index,text_sha256,model_id,voice_id,budget_month,reserved_credits,state,created,updated) VALUES(?,?,?,?,?,?,?,'reserved',?,?)", (job_id, scene_index, text_sha, settings["model_id"], settings["voice_id"], month, amount, now, now))
        db.commit()
        return {"state": "reserved", "reserved_credits": amount, "text_sha256": text_sha}
    except BaseException:
        db.rollback()
        raise


def _audio_payload(data):
    data = _unwrap(data)
    if not isinstance(data, dict): raise TTSReconciliationRequired("TTS thành công nhưng chưa nhận asset audio")
    payload = data.get("audio_base64") or data.get("audio_base64_encoded")
    if not isinstance(payload, str): raise TTSReconciliationRequired("TTS chưa trả MP3 base64 đã xác minh; cần đối soát asset")
    try:
        blob = base64.b64decode(payload, validate=True)
    except ValueError:
        raise TTSReconciliationRequired("Asset audio base64 không hợp lệ") from None
    if not blob or len(blob) > 20 * 1024 * 1024: raise TTSReconciliationRequired("Asset audio thiếu hoặc quá lớn")
    return blob


def measure_audio(path):
    binary = shutil.which("ffprobe")
    if not binary:
        raise ElevenLabsBlocked("Không tìm thấy ffprobe để đo audio")
    result = subprocess.run([binary, "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name", "-of", "json", str(path)], capture_output=True, text=True, timeout=20)
    try:
        value = json.loads(result.stdout)
        duration = float(value["format"]["duration"])
    except (ValueError, KeyError):
        raise TTSReconciliationRequired("Không xác minh được audio đã tạo") from None
    if result.returncode or not math.isfinite(duration) or duration <= 0 or not any(s.get("codec_type") == "audio" and s.get("codec_name") == "mp3" for s in value.get("streams", [])):
        raise TTSReconciliationRequired("Audio không phải MP3 hợp lệ")
    return duration


def cached_scene(db, job_id, scene_index, text, settings):
    exists = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='video_credit_calls'").fetchone()
    if not exists: return None
    names = [x[1] for x in db.execute("PRAGMA table_info(video_credit_calls)")]
    fetched = db.execute("SELECT * FROM video_credit_calls WHERE job_id=? AND scene_index=?", (job_id, scene_index)).fetchone()
    if fetched is None: return None
    row = dict(zip(names, fetched))
    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    if row["text_sha256"] != sha or row["voice_id"] != settings.get("voice_id") or row["model_id"] != settings.get("model_id"):
        raise TTSReconciliationRequired("Nội dung/giọng khác checkpoint; cần phiên bản job mới")
    if row["state"] not in {"complete", "audio_stored"}: return None
    path = Path(row["audio_path"])
    import media_storage
    media_storage.prepare_managed(path,row['audio_sha256'],archive_first=True)
    if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != row["audio_sha256"]:
        raise TTSReconciliationRequired("Audio checkpoint bị thiếu hoặc đổi checksum; không tạo lại TTS")
    duration = row["duration"]
    if row["state"] == "audio_stored":
        duration = measure_audio(path)
        with db:
            db.execute("UPDATE video_credit_calls SET state='complete',duration=?,updated=? WHERE job_id=? AND scene_index=? AND state='audio_stored'", (duration, time.time(), job_id, scene_index))
    return {"path": str(path), "sha256": row["audio_sha256"], "duration": duration,
            "credits": row.get("actual_credits"), "reserved_credits": row["reserved_credits"],
            "history_id": row.get("history_id"), "request_id": row.get("request_id")}


async def synthesize_scene(db, job_id, scene_index, text, out_dir, settings=None, progress=None):
    """Exactly one dispatch per scene. Uncertain calls require reconciliation."""
    settings = dict(settings or load_settings())
    text = sanitize_text(text)
    # A render/worker retry can use already-paid immutable audio even if the
    # provider is now unavailable. No remote connection or charge is needed.
    cached = cached_scene(db, job_id, scene_index, text, settings)
    if cached is not None: return cached
    if settings.get("backend", "composio") == "direct_api":
        return await _synthesize_direct_scene(db,job_id,scene_index,text,out_dir,settings,progress)
    async with publisher.connect() as call:
        client = ElevenSession(call)
        checked = await _preflight(client, settings)
        if not checked["can_synthesize"]:
            raise ElevenLabsBlocked(checked["reason"])
        # Determine arguments from the discovered schema, not a remembered API.
        schema = await client.ensure_schema(TTS_SLUG)
        properties = schema.get("properties", {})
        if not {"voice_id", "text", "model_id"} <= set(properties):
            raise ElevenLabsBlocked("Schema TTS chưa hỗ trợ voice/text/model đã chọn")
        args = {"voice_id": settings["voice_id"], "text": text, "model_id": settings["model_id"]}
        if "output_format" in properties: args["output_format"] = "mp3_44100_192"
        import jsonschema
        jsonschema.validate(args, schema)
        record = reserve_credits(db, job_id, scene_index, text, settings, checked["credit_rate_evidence"], checked["account_credits_remaining"])
        if record["state"] == "complete":
            path = Path(record["audio_path"])
            import media_storage
            media_storage.prepare_managed(path,record['audio_sha256'],archive_first=True)
            if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == record["audio_sha256"]:
                return {"path": str(path), "sha256": record["audio_sha256"], "duration": record["duration"], "credits": record.get("actual_credits"), "reserved_credits": record["reserved_credits"], "history_id": record.get("history_id"), "request_id": record.get("request_id")}
            raise TTSReconciliationRequired("Audio đã tạo bị thiếu hoặc đổi checksum; không tạo lại TTS")
        if record["state"] != "reserved":
            raise TTSReconciliationRequired("Lời gọi TTS trước chưa đối soát; không phát sinh lần gọi mới")
        # Durable marker precedes the irreversible/paid call. Callback failures
        # stop before dispatch and may be retried from the reserved state.
        if progress: progress("tts_reserved", {"scene_index": scene_index, "credits": record["reserved_credits"]})
        with db:
            changed = db.execute("UPDATE video_credit_calls SET state='calling',updated=? WHERE job_id=? AND scene_index=? AND state='reserved'", (time.time(), job_id, scene_index)).rowcount
        if changed != 1: raise TTSReconciliationRequired("Một worker khác đã nhận cảnh TTS")
        try:
            data = _unwrap(await client.execute(TTS_SLUG, args))
            history_id = data.get("history_item_id") or data.get("history_id") if isinstance(data, dict) else None
            request_id = data.get("request_id") if isinstance(data, dict) else None
            actual = data.get("character_cost", data.get("credits")) if isinstance(data, dict) else None
            if isinstance(actual, bool) or not isinstance(actual, (int, float)) or not math.isfinite(actual) or actual < 0: actual = None
            with db:
                db.execute("UPDATE video_credit_calls SET state='uncertain',history_id=?,request_id=?,actual_credits=?,updated=? WHERE job_id=? AND scene_index=?", (history_id, request_id, actual, time.time(), job_id, scene_index))
            if progress: progress("tts_response_received", {"scene_index": scene_index, "history_id": history_id, "request_id": request_id, "credits": actual})
            audio = _audio_payload(data)
            target = Path(out_dir).resolve()
            target.mkdir(parents=True, exist_ok=True)
            path = target / f"scene-{scene_index:02d}.mp3"
            temporary = path.with_suffix(".mp3.part")
            temporary.write_bytes(audio)
            os.replace(temporary, path)
            sha = hashlib.sha256(audio).hexdigest()
            with db:
                db.execute("UPDATE video_credit_calls SET state='audio_stored',audio_path=?,audio_sha256=?,updated=? WHERE job_id=? AND scene_index=?", (str(path), sha, time.time(), job_id, scene_index))
            duration = measure_audio(path)
            with db:
                db.execute("UPDATE video_credit_calls SET state='complete',audio_path=?,audio_sha256=?,duration=?,updated=? WHERE job_id=? AND scene_index=?", (str(path), sha, duration, time.time(), job_id, scene_index))
            return {"path": str(path), "sha256": sha, "duration": duration, "credits": actual, "reserved_credits": record["reserved_credits"], "history_id": history_id, "request_id": request_id}
        except BaseException:
            with db:
                db.execute("UPDATE video_credit_calls SET state='uncertain',updated=? WHERE job_id=? AND scene_index=? AND state='calling'", (time.time(), job_id, scene_index))
            raise TTSReconciliationRequired("TTS đã dispatch; giữ ngân sách và checkpoint để đối soát trước khi tiếp tục") from None


async def _synthesize_direct_scene(db,job_id,scene_index,text,out_dir,settings,progress):
    from elevenlabs_direct import DirectClient, DirectAPIError
    from elevenlabs_secrets import load_api_key, CredentialError
    try:key=load_api_key()
    except CredentialError as exc:raise ElevenLabsBlocked(str(exc)) from None
    async with DirectClient(key) as client:
        checked=await _direct_preflight(client,settings)
        if not checked["can_synthesize"]:raise ElevenLabsBlocked(checked["reason"])
        record=reserve_credits(db,job_id,scene_index,text,settings,checked["credit_rate_evidence"],checked["account_credits_remaining"])
        if record['state']=='rejected':
            raise ElevenLabsBlocked("Yêu cầu TTS trước bị API từ chối; sửa key/quyền và tạo lượt mới, không tự gửi lại")
        if record["state"]!="reserved":
            raise TTSReconciliationRequired("Lời gọi giọng trước chưa đối soát; không tạo lại qua API trực tiếp")
        if progress:progress("tts_reserved",{"scene_index":scene_index,"credits":record["reserved_credits"]})
        with db:
            changed=db.execute("UPDATE video_credit_calls SET state='calling',updated=? WHERE job_id=? AND scene_index=? AND state='reserved'",
                               (time.time(),job_id,scene_index)).rowcount
        if changed!=1:raise TTSReconciliationRequired("Một worker khác đã nhận cảnh TTS")
        def on_headers(metadata):
            with db:
                db.execute("UPDATE video_credit_calls SET state='uncertain',history_id=?,request_id=?,actual_credits=?,updated=? WHERE job_id=? AND scene_index=?",
                    (metadata.get('history_id'),metadata.get('request_id'),metadata.get('actual_credits'),time.time(),job_id,scene_index))
            if progress:progress("tts_response_received",{"scene_index":scene_index,**metadata})
        try:
            result=await client.speech(settings["voice_id"],text,settings["model_id"],on_headers=on_headers)
            target=Path(out_dir).resolve();target.mkdir(parents=True,exist_ok=True)
            path=target/f"scene-{scene_index:02d}.mp3"
            temporary=target/(path.name+'.'+uuid.uuid4().hex+'.part')
            try:
                with temporary.open('xb') as stream:
                    stream.write(result['audio']);stream.flush();os.fsync(stream.fileno())
                os.replace(temporary,path)
            finally:temporary.unlink(missing_ok=True)
            sha=hashlib.sha256(result['audio']).hexdigest()
            with db:
                db.execute("UPDATE video_credit_calls SET state='audio_stored',audio_path=?,audio_sha256=?,updated=? WHERE job_id=? AND scene_index=?",
                    (str(path),sha,time.time(),job_id,scene_index))
            duration=measure_audio(path)
            with db:
                db.execute("UPDATE video_credit_calls SET state='complete',duration=?,updated=? WHERE job_id=? AND scene_index=?",
                    (duration,time.time(),job_id,scene_index))
            return {"path":str(path),"sha256":sha,"duration":duration,"credits":result.get('actual_credits'),
                "reserved_credits":record['reserved_credits'],"history_id":result.get('history_id'),"request_id":result.get('request_id')}
        except BaseException as exc:
            rejected=isinstance(exc,DirectAPIError) and exc.certainty=='rejected'
            with db:
                db.execute("UPDATE video_credit_calls SET state=?,updated=? WHERE job_id=? AND scene_index=? AND state='calling'",
                    ('rejected' if rejected else 'uncertain',time.time(),job_id,scene_index))
            if isinstance(exc,asyncio.CancelledError):raise
            reason=str(exc) if isinstance(exc,DirectAPIError) else "Lượt tạo giọng bị gián đoạn"
            if rejected:raise ElevenLabsBlocked(reason+"; yêu cầu đã bị từ chối, cần sửa key/quyền trước lượt mới") from None
            raise TTSReconciliationRequired(reason+"; giữ checkpoint để đối soát, không tự gọi lại TTS") from None


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["status", "connect"])
    parser.add_argument("--settings", type=Path, default=SETTINGS_PATH)
    args = parser.parse_args()
    result = asyncio.run(preflight(args.settings, initiate=args.command == "connect"))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
