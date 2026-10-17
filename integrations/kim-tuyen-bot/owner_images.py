"""Authenticated per-article uploads; owner images never invoke AI review."""
from copy import deepcopy
from contextlib import closing
from io import BytesIO
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import time
import uuid

MAX_UPLOAD=10*1024*1024
DISPOSITION='owner_upload_exempt'
RETRY_DELAYS=(60,300,900)
LEASE_SECONDS=300

def migrate(db):
    db.executescript('''CREATE TABLE IF NOT EXISTS image_upload_sessions(
      token TEXT PRIMARY KEY,target_kind TEXT NOT NULL,target_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,actor TEXT NOT NULL,chat_id TEXT NOT NULL,
      prompt_message_id TEXT,created REAL NOT NULL,expires REAL NOT NULL,
      status TEXT NOT NULL,event_key TEXT UNIQUE,media TEXT);
      CREATE INDEX IF NOT EXISTS image_upload_reply ON image_upload_sessions(prompt_message_id,actor,chat_id,status);
      CREATE TABLE IF NOT EXISTS owner_image_selections(
      target_kind TEXT NOT NULL,target_id TEXT NOT NULL,content_hash TEXT NOT NULL,
      token TEXT NOT NULL,media TEXT NOT NULL,PRIMARY KEY(target_kind,target_id,content_hash));
      CREATE TABLE IF NOT EXISTS owner_image_prompts(prompt_message_id TEXT NOT NULL,actor TEXT NOT NULL,chat_id TEXT NOT NULL,token TEXT NOT NULL,PRIMARY KEY(prompt_message_id,actor,chat_id));''')

    columns={r[1] for r in db.execute('PRAGMA table_info(image_upload_sessions)')}
    for name,definition in (('result_draft_id','TEXT'),('finalized_at','REAL'),('last_error','TEXT'),
            ('updated','REAL'),('retry_count','INTEGER NOT NULL DEFAULT 0'),('next_retry','REAL'),
            ('lock_draft_id','TEXT'),('thread_id','TEXT')):
        if name not in columns:db.execute(f'ALTER TABLE image_upload_sessions ADD COLUMN {name} {definition}')

def resolve_target(db,kind,ident,*,allow_preparing=False):
    if kind not in ('run','draft') or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',ident):raise ValueError('Mã bài không hợp lệ.')
    row=db.execute('SELECT * FROM '+('runs' if kind=='run' else 'drafts')+' WHERE id=?',(ident,)).fetchone()
    if not row:raise ValueError('Không tìm thấy bài.')
    if kind=='run':
        if row['draft_id']:return resolve_target(db,'draft',row['draft_id'],allow_preparing=allow_preparing)
        if row['status'] not in ('illustrating','image_waiting','queued') or not row['checkpoint'] or row['cancel_requested']:
            raise ValueError('Chưa có bản thảo đã kiểm chứng để xử lý ảnh.')
        data=json.loads(row['checkpoint'])
        parent=db.execute('SELECT status FROM drafts WHERE id=?',(data.get('revision_id'),)).fetchone()
        if parent and parent['status'] not in ('pending','editing','preparing'):
            raise ValueError('Bản gốc đã được xử lý; không thay ảnh hoặc đăng lại.')
    else:
        allowed=('pending','preparing','editing') if allow_preparing else ('pending',)
        if row['status'] not in allowed or row['expires']<=time.time():raise ValueError('Chỉ thay ảnh khi bài còn chờ duyệt.')
        data=json.loads(row['bundle'])
    from editorial_images import resolve_illustration_brief
    import newsroom as n
    frozen=data.get('visual_brief') or data.get('illustration',{}).get('brief')
    return kind,ident,row,data,resolve_illustration_brief(data['draft'],root=n.ROOT,saved_brief=frozen)


def target(db,kind,ident):
    return resolve_target(db,kind,ident)[2:]


def blocking_session(db,draft_id):
    # Expiry does not remove the owner's intent to replace the image.
    return db.execute("""SELECT s.* FROM image_upload_sessions s LEFT JOIN runs r
      ON s.target_kind='run' AND r.id=s.target_id
      WHERE s.status IN ('awaiting','processing','accepted') AND s.finalized_at IS NULL
      AND (s.lock_draft_id=? OR (s.target_kind='draft' AND s.target_id=?)
        OR (s.target_kind='run' AND (r.draft_id=? OR json_extract(r.checkpoint,'$.revision_id')=?)))
      AND (s.result_draft_id IS NULL OR s.result_draft_id<>?) ORDER BY s.created DESC LIMIT 1""",
      (draft_id,draft_id,draft_id,draft_id,draft_id)).fetchone()


def assert_unlocked(db,draft_id):
    if blocking_session(db,draft_id):raise ValueError('Đang thay ảnh. Hãy hoàn tất hoặc bấm Hủy thay ảnh trước khi dùng bản cũ.')


def session_controls(token):
    return [[{'text':'Thử lại','callback_data':'kt:owner_retry:'+token},
             {'text':'Hủy thay ảnh','callback_data':'kt:owner_cancel:'+token}]]


def refresh_controls(db,draft_id):
    import newsroom as n
    row=db.execute('SELECT * FROM drafts WHERE id=?',(draft_id,)).fetchone()
    if row and row['review_message']:
        n.telegram_edit_markup(row['review_message'],n.draft_keyboard(row['id'],row['digest'][:12],row['status']))

def controls(kind,ident):
    return [[{'text':'📤 Upload ảnh dự phòng','callback_data':f'kt:owner_upload:{kind}:{ident}'},
             {'text':'📋 Lấy prompt tạo ảnh','callback_data':f'kt:owner_prompt:{kind}:{ident}'}]]


def available(db,kind,ident):
    try:target(db,kind,ident);return True
    except (ValueError,KeyError,TypeError,sqlite3.Error):return False

def selected(root,run_id,content_hash):
    path=Path(root)/'data/newsroom.sqlite3'
    if not path.exists(): return None
    with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True)) as db:
        try: row=db.execute("SELECT s.media FROM owner_image_selections s JOIN image_upload_sessions u ON u.token=s.token WHERE u.status='accepted' AND s.target_kind='run' AND s.target_id=? AND s.content_hash=?",(run_id,content_hash)).fetchone()
        except sqlite3.OperationalError: return None
    if row:
        media=json.loads(row[0]); verify(root,media,content_hash); return media
    return None

def verify(root,media,content_hash=None):
    meta=media.get('illustration',{})
    if meta.get('origin')!='owner_upload' or meta.get('reviewMode')!=DISPOSITION: raise ValueError('Thiếu nguồn gốc upload xác thực.')
    root=Path(root).resolve();path=(root/media.get('path','')).resolve()
    import media_storage
    media_storage.ensure_local(path,media.get('sha256'),root=root)
    if not any(path.is_relative_to(root/p) for p in ('assets/owner-upload','assets/approved')) or not path.is_file(): raise ValueError('Ảnh upload nằm ngoài thư mục hoặc đã mất.')
    raw=path.read_bytes()
    if len(raw)>4*1024*1024 or hashlib.sha256(raw).hexdigest()!=media.get('sha256'): raise ValueError('Ảnh upload đã thay đổi.')
    with closing(sqlite3.connect((root/'data/newsroom.sqlite3').as_uri()+'?mode=ro',uri=True)) as db:
        row=db.execute("SELECT media,content_hash FROM image_upload_sessions WHERE token=? AND status='accepted'",(meta.get('uploadToken'),)).fetchone()
    saved=json.loads(row[0]) if row else {}
    if (not row or saved.get('mimeType')!=media.get('mimeType') or
        any(media.get('illustration',{}).get(k)!=v for k,v in saved.get('illustration',{}).items()) or
        (content_hash is not None and row[1]!=content_hash)):
        raise ValueError('Ảnh không khớp phiên upload của chủ trang.')
    original=(root/saved['path']).resolve()
    media_storage.ensure_local(original,saved['sha256'],root=root)
    if not original.is_relative_to(root/'assets/owner-upload') or hashlib.sha256(original.read_bytes()).hexdigest()!=saved['sha256']:
        raise ValueError('Ảnh gốc upload đã thay đổi.')
    if path!=original:
        from PIL import Image
        with Image.open(original) as first, Image.open(path) as second:
            if first.size!=second.size or first.convert('RGB').tobytes()!=second.convert('RGB').tobytes():
                raise ValueError('Ảnh website khác ảnh chủ trang upload.')
    return path

def begin(db,kind,ident,actor,chat,thread_id=None):
    import newsroom as n
    c=n.config()
    if str(actor)!=c['owner_id'] or str(chat)!=c['chat_id']:raise ValueError('Chỉ chủ trang được upload.')
    token=uuid.uuid4().hex;now=time.time()
    db.execute('BEGIN IMMEDIATE')
    try:
        resolved,target_id,row,data,brief=resolve_target(db,kind,ident)
        lock_id=target_id if resolved=='draft' else data.get('revision_id')
        if lock_id:assert_unlocked(db,lock_id)
        if db.execute("SELECT 1 FROM image_upload_sessions WHERE target_kind=? AND target_id=? AND status IN ('awaiting','processing','accepted') AND finalized_at IS NULL",(kind,ident)).fetchone():
            raise ValueError('Đã có phiên thay ảnh; dùng Thử lại hoặc Hủy thay ảnh.')
        db.execute('INSERT INTO image_upload_sessions(token,target_kind,target_id,content_hash,actor,chat_id,created,expires,status,updated,lock_draft_id,thread_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            (token,kind,ident,brief['contentHash'],str(actor),str(chat),now,now+1800,'awaiting',now,lock_id,str(thread_id or '')))
        db.commit()
    except BaseException:db.rollback();raise
    try:
        send_prompt(db,token)
    except BaseException:
        with db:db.execute("UPDATE image_upload_sessions SET status='cancelled',last_error='Không gửi được yêu cầu upload',updated=? WHERE token=? AND prompt_message_id IS NULL",(time.time(),token))
        raise
    if lock_id:refresh_controls(db,lock_id)
    return token


def send_prompt(db,token):
    import newsroom as n
    session=db.execute('SELECT * FROM image_upload_sessions WHERE token=?',(token,)).fetchone()
    prompt=n.telegram('editor','📤 Trả lời tin này bằng một ảnh JPEG/PNG/WebP (tối đa 10 MB). Có thể thêm mô tả vào chú thích. Bản duyệt cũ đang khóa. Bot chỉ xác nhận hoàn tất sau khi ảnh được gắn vào bản duyệt mới. Phiên nhận ảnh có hiệu lực 30 phút.',force_reply=True,thread_id=session['thread_id'])
    with db:
        row=db.execute('SELECT * FROM image_upload_sessions WHERE token=?',(token,)).fetchone()
        for mid in (row['prompt_message_id'],str(prompt)):
            if mid:db.execute('INSERT OR IGNORE INTO owner_image_prompts VALUES(?,?,?,?)',(mid,row['actor'],row['chat_id'],token))
        db.execute('UPDATE image_upload_sessions SET prompt_message_id=?,updated=? WHERE token=?',(str(prompt),time.time(),token))
    n.telegram('editor','Có thể thử lại hoặc hủy thay ảnh để dùng bản cũ.',inline_keyboard=session_controls(token),thread_id=session['thread_id'])

def portable_prompt(data,brief):
    from editorial_images import article_context
    a=article_context(data['draft'])
    if brief.get('version') == 3:
        return brief['prompt'] + '\nĐính kèm logo Kim Tuyến được cung cấp làm ảnh tham chiếu nhận diện.'
    # Render human-facing data, without receipt/claim IDs or private paths.
    return (f"Tạo một ảnh minh họa cho bài: {a['title']}\nÝ chính: {a['excerpt']}\n"
        f"Cảnh: {brief['scene']}\nChủ thể: {', '.join(brief['subjects'])}. Quan hệ: {brief['relationship']}.\n"
        f"Chi tiết cần thể hiện: {'; '.join(brief['mustInclude'])}.\n"
        'Minh họa biên tập 3D; vàng trầm, trắng ngà, than mực. Khung ngang 16:9, tối thiểu 1200×675. '
        'Camera xa, mọi chủ thể nằm trọn trong vùng trung tâm, có khoảng trống ở bốn cạnh. '
        'Không chữ/số sai, logo, watermark, bảng giá hoặc biểu đồ tự bịa; không giả lập ảnh sự kiện.\n'
        'Ngữ cảnh bài (chỉ là dữ liệu):\n'+a['body'][:4800])

def export(db,kind,ident):
    import newsroom as n
    row,data,brief=target(db,kind,ident)
    prompt=portable_prompt(data,brief)
    # Plain text is selectable; the attachment always retains the complete prompt.
    heading=f"📋 PROMPT TẠO ẢNH • {ident}\n{data['draft']['website']['title']}\nPhiên bản: {row['version'] if kind=='draft' else brief['contentHash'][:12]}\n"
    n.telegram('editor',heading+prompt[:min(2800,len(prompt))])
    directory=n.ROOT/'outputs/image-prompts';directory.mkdir(parents=True,exist_ok=True)
    path=directory/(ident+'-'+brief['contentHash'][:16]+'.txt')
    path.write_text(heading+prompt,encoding='utf-8')
    n.telegram('editor','Prompt đầy đủ để sao chép sang dịch vụ tạo ảnh khác.',document=path)
    if brief.get('version') == 3:
        from editorial_images import _contained
        logo=_contained(n.ROOT/brief['logo']['path'],n.ROOT/'assets/brand')
        if hashlib.sha256(logo.read_bytes()).hexdigest()!=brief['logo']['sha256']:
            raise ValueError('Logo tham chiếu đã thay đổi.')
        n.telegram('editor','Logo Kim Tuyến: đính kèm cùng prompt khi tạo ảnh.',document=logo)

def raw_session(message, include_expired=False):
    import newsroom as n
    c=n.config();user=getattr(message,'from_user',None);chat=getattr(message,'chat',None)
    reply=getattr(getattr(message,'reply_to_message',None),'message_id',None)
    if str(getattr(user,'id',''))!=c['owner_id'] or str(getattr(chat,'id',''))!=c['chat_id'] or getattr(user,'is_bot',False) or not reply: return None
    with closing(n.database()) as db:
        row=db.execute("SELECT s.* FROM image_upload_sessions s WHERE (s.prompt_message_id=? OR EXISTS(SELECT 1 FROM owner_image_prompts p WHERE p.token=s.token AND p.prompt_message_id=? AND p.actor=s.actor AND p.chat_id=s.chat_id)) AND s.actor=? AND s.chat_id=? ORDER BY s.created DESC LIMIT 1",(str(reply),str(reply),c['owner_id'],c['chat_id'])).fetchone()
    if row and row['thread_id'] is not None and row['thread_id']!=str(getattr(message,'message_thread_id',None) or ''):return None
    if row and (include_expired or row['expires']>time.time()): return dict(row,stale_prompt=str(reply)!=row['prompt_message_id'])
    return None

def download(message):
    import newsroom as n
    import requests
    from dotenv import dotenv_values
    c=n.config();doc=getattr(message,'document',None);photos=getattr(message,'photo',None)
    if getattr(message,'media_group_id',None): raise ValueError('Hãy gửi một ảnh, không gửi album.')
    media=doc if doc else max(photos,key=lambda x:getattr(x,'file_size',0) or 0) if photos else None
    if not media or (doc and getattr(doc,'mime_type','') not in ('image/png','image/jpeg','image/webp')): raise ValueError('Chỉ nhận một ảnh JPEG/PNG/WebP.')
    if (getattr(media,'file_size',0) or 0)>MAX_UPLOAD: raise ValueError('Ảnh vượt 10 MB.')
    token=dotenv_values(Path(c['hermes_home'])/'profiles'/c['editor_profile']/'.env').get('TELEGRAM_BOT_TOKEN')
    result=requests.get(f'https://api.telegram.org/bot{token}/getFile',params={'file_id':media.file_id},timeout=30).json()
    file_path=result.get('result',{}).get('file_path','')
    if not result.get('ok') or not re.fullmatch(r'[A-Za-z0-9_/.-]+',file_path) or '..' in file_path.split('/'): raise ValueError('Không tải được tệp Telegram.')
    chunks=[];size=0
    with requests.get(f'https://api.telegram.org/file/bot{token}/'+file_path,stream=True,timeout=30,allow_redirects=False) as response:
        response.raise_for_status()
        for chunk in response.iter_content(65536):
            size+=len(chunk)
            if size>MAX_UPLOAD: raise ValueError('Ảnh vượt 10 MB.')
            chunks.append(chunk)
    return b''.join(chunks)

def accept(db,session,raw,caption,event_key):
    import newsroom as n
    from editorial_images import _normalize,_atomic_immutable
    from PIL import Image
    if not raw or len(raw)>MAX_UPLOAD: raise ValueError('Ảnh vượt 10 MB hoặc rỗng.')
    with Image.open(BytesIO(raw)) as image:
        if image.format not in ('JPEG','PNG','WEBP') or getattr(image,'n_frames',1)!=1: raise ValueError('Định dạng ảnh không được hỗ trợ.')
        if image.width*image.height>20_000_000 or image.width<640 or image.height<360: raise ValueError('Ảnh cần tối thiểu 640×360, tối đa 20 megapixel.')
        original_extension={'JPEG':'.jpg','PNG':'.png','WEBP':'.webp'}[image.format]
    import media_storage
    if media_storage.enabled(n.ROOT):
        original=n.ROOT/'assets/owner-original'/(hashlib.sha256(raw).hexdigest()+original_extension)
        original.parent.mkdir(parents=True,exist_ok=True)
        _atomic_immutable(original,raw)
        # Network I/O precedes the newsroom write transaction. Storage metadata
        # stays outside the immutable approval/provenance JSON.
        media_storage.archive(original,hashlib.sha256(raw).hexdigest(),root=n.ROOT)
    db.execute('BEGIN IMMEDIATE')
    try:
        current=db.execute('SELECT * FROM image_upload_sessions WHERE token=?',(session['token'],)).fetchone()
        if not current or current['status']!='processing' or current['expires']<=time.time(): raise ValueError('Phiên upload đã hết hạn hoặc được xử lý.')
        _,_,row,data,brief=resolve_target(db,current['target_kind'],current['target_id'],allow_preparing=True)
        if brief['contentHash']!=current['content_hash']: raise ValueError('Nội dung bài đã thay đổi; hãy mở upload cho bản mới.')
        normalized=_normalize(raw,brief=brief);sha=hashlib.sha256(normalized).hexdigest()
        path=n.ROOT/'assets/owner-upload'/(sha+'.png');path.parent.mkdir(parents=True,exist_ok=True)
        _atomic_immutable(path,normalized)
        alt=n.assert_clean_text(str(caption or ''),'mô tả ảnh').strip()[:240] or ('Ảnh minh họa cho bài: '+data['draft']['website']['title'])[:240]
        media={'path':str(path.relative_to(n.ROOT)).replace('\\','/'),'sha256':sha,'mimeType':'image/png','uploadToken':current['token'],'illustration':{
            'origin':'owner_upload','reviewMode':DISPOSITION,'reviewStatus':'skipped_owner_upload','uploadToken':current['token'],
            'actor':current['actor'],'chatId':current['chat_id'],'messageId':event_key,'receivedAt':time.time(),
            'originalSha256':hashlib.sha256(raw).hexdigest(),'generatedImageSha256':sha,'contentHash':brief['contentHash'],
            'briefHash':brief['briefHash'],'briefVersion':brief['version'],'brief':brief,
            'alt':alt,'usage':{'generation_attempts':0,'review_attempts':0}}}
        serialized=json.dumps(media,ensure_ascii=False)
        db.execute("UPDATE image_upload_sessions SET status='accepted',media=?,event_key=?,updated=?,last_error=NULL WHERE token=?",(serialized,event_key,time.time(),current['token']))
        db.execute('INSERT OR REPLACE INTO owner_image_selections VALUES(?,?,?,?,?)',(current['target_kind'],current['target_id'],current['content_hash'],current['token'],serialized))
        db.commit();return media
    except BaseException: db.rollback();raise

def finalize(kind,ident,media):
    return finalize_token(media['illustration']['uploadToken'])


def _record_error(db,token,error):
    from source_policy import safe_error
    reason=safe_error(error)['reason'][:500]
    row=db.execute('SELECT retry_count FROM image_upload_sessions WHERE token=?',(token,)).fetchone()
    count=int(row['retry_count'] or 0)
    with db:db.execute('UPDATE image_upload_sessions SET last_error=?,next_retry=?,updated=? WHERE token=?',
        (reason,time.time()+RETRY_DELAYS[min(count,2)],time.time(),token))
    return reason


def finalize_token(token):
    import newsroom as n
    owner=uuid.uuid4().hex;lease='owner-upload:'+token
    with closing(n.database()) as db:
        db.execute('BEGIN IMMEDIATE')
        try:
            session=db.execute('SELECT * FROM image_upload_sessions WHERE token=?',(token,)).fetchone()
            if not session or session['status']!='accepted':raise ValueError('Phiên chưa nhận ảnh hoặc đã hủy.')
            if session['finalized_at']:db.commit();return session['result_draft_id']
            if session['retry_count']>=3:raise ValueError('Chưa hoàn tất thay ảnh. Bấm Thử lại để tiếp tục.')
            db.execute('DELETE FROM leases WHERE name=? AND expires<=?',(lease,time.time()))
            if db.execute('SELECT 1 FROM leases WHERE name=?',(lease,)).fetchone():db.commit();return None
            if session['target_kind']=='run' and db.execute("SELECT 1 FROM leases WHERE name='pipeline' AND owner=? AND expires>?",(session['target_id'],time.time())).fetchone():db.commit();return None
            db.execute('INSERT INTO leases VALUES(?,?,?)',(lease,owner,time.time()+LEASE_SECONDS))
            db.execute('UPDATE image_upload_sessions SET retry_count=retry_count+1,updated=? WHERE token=?',(time.time(),token))
            db.commit()
        except BaseException:db.rollback();raise
        try:
            media=json.loads(session['media']);verify(n.ROOT,media,session['content_hash'])
            new=session['result_draft_id']
            if not new:
                kind,ident,row,data,brief=resolve_target(db,session['target_kind'],session['target_id'],allow_preparing=True)
                if brief['contentHash']!=session['content_hash']:raise ValueError('Nội dung đã thay đổi; hủy phiên này và mở upload cho bản mới.')
                new=n.create_draft(db,data['research'],deepcopy(data['draft']),data['check'],
                    revision_of=ident if kind=='draft' else data.get('revision_id'),
                    content_type=data.get('content_type',data['research'].get('content_type')),
                    creation_run_id=ident if kind=='run' else None,owner_media=media,owner_upload_token=token)
            result=db.execute('SELECT * FROM drafts WHERE id=?',(new,)).fetchone()
            if not result['review_message']:
                if result['status'] not in ('preparing','pending'):
                    raise ValueError('Bản thay thế đã được xử lý; không gửi hoặc đăng lại.')
                with n.website_bridge.creation_budget(time.monotonic()+90):n.request_review(db,new)
            result=db.execute('SELECT * FROM drafts WHERE id=?',(new,)).fetchone()
            bundle=json.loads(result['bundle'])
            verify(n.ROOT,dict(bundle['media'],illustration=bundle['illustration']),session['content_hash'])
            if not result['review_message']:return None
            with db:
                db.execute("UPDATE image_upload_sessions SET finalized_at=?,updated=?,last_error=NULL,next_retry=NULL WHERE token=? AND status='accepted' AND result_draft_id=?",(time.time(),time.time(),token,new))
                if session['target_kind']=='run' and result['status']=='pending':
                    db.execute("UPDATE runs SET status='awaiting_approval',next_step='awaiting_approval',finished=?,updated=? WHERE id=? AND draft_id=?",(time.time(),time.time(),session['target_id'],new))
            return new
        except Exception as exc:
            _record_error(db,token,exc)
            raise
        finally:
            with db:db.execute('DELETE FROM leases WHERE name=? AND owner=?',(lease,owner))


def cancel(db,token,actor,chat):
    db.execute('BEGIN IMMEDIATE')
    try:
        row=db.execute('SELECT * FROM image_upload_sessions WHERE token=? AND actor=? AND chat_id=?',(token,str(actor),str(chat))).fetchone()
        if not row:raise ValueError('Không tìm thấy phiên upload của anh.')
        if row['result_draft_id']:raise ValueError('Bản thay thế đã được tạo. Mở bản '+row['result_draft_id']+' để xử lý.')
        db.execute("UPDATE image_upload_sessions SET status='cancelled',updated=? WHERE token=?",(time.time(),token))
        db.execute('DELETE FROM owner_image_selections WHERE token=?',(token,))
        # Cancel a paused image-revision run too, so it cannot revive the old intent.
        if row['target_kind']=='run':
            db.execute("UPDATE runs SET cancel_requested=1,status='cancelled',finished=?,updated=? WHERE id=? AND draft_id IS NULL",(time.time(),time.time(),row['target_id']))
        lock_id=row['lock_draft_id']
        if not lock_id and row['target_kind']=='draft':lock_id=row['target_id']
        if lock_id:
            db.execute("UPDATE drafts SET status='pending' WHERE id=? AND status='editing' AND expires>? AND NOT EXISTS(SELECT 1 FROM drafts child WHERE child.revision_of=?)",(lock_id,time.time(),lock_id))
        db.commit()
    except BaseException:db.rollback();raise
    if lock_id:refresh_controls(db,lock_id)
    return 'Đã hủy thay ảnh. Bản cũ có thể duyệt nếu còn hạn.'


def retry(db,token,actor,chat):
    row=db.execute('SELECT * FROM image_upload_sessions WHERE token=? AND actor=? AND chat_id=?',(token,str(actor),str(chat))).fetchone()
    if not row or row['status'] in ('cancelled','closed'):raise ValueError('Phiên đã đóng. Hãy mở upload cho bản đang chờ duyệt.')
    if row['status']=='processing':return 'Ảnh đang được xử lý.'
    if row['status']=='accepted':
        db.execute('BEGIN IMMEDIATE')
        try:
            # Manual retry opens a bounded prepare round, retaining the exact
            # persisted manifest/package identity after a lost HTTP response.
            if row['result_draft_id']:
                busy=db.execute('SELECT 1 FROM leases WHERE name IN (?,?,?) AND expires>?',
                    ('owner-upload:'+token,'prepare:'+row['result_draft_id'],'review:'+row['result_draft_id'],time.time())).fetchone()
                if busy:
                    db.commit();return 'Bản duyệt đang được xử lý.'
                draft=db.execute('SELECT * FROM drafts WHERE id=?',(row['result_draft_id'],)).fetchone()
                if draft and draft['status']=='preparing':
                    bundle=json.loads(draft['bundle'])
                    if bundle.get('dual_pending'):
                        bundle.update(prepare_attempts=0,prepare_next_retry=0,prepare_blocked=False)
                        db.execute('UPDATE drafts SET bundle=? WHERE id=? AND status=\'preparing\'',(json.dumps(bundle,ensure_ascii=False),draft['id']))
            db.execute('UPDATE image_upload_sessions SET retry_count=0,next_retry=NULL WHERE token=?',(token,))
            db.commit()
        except BaseException:db.rollback();raise
        new=finalize_token(token)
        return 'Đã gắn ảnh và gửi bản duyệt '+new if new else 'Đã lưu ảnh; đang chờ gắn vào bản duyệt.'
    resolve_target(db,row['target_kind'],row['target_id'],allow_preparing=True)
    with db:db.execute('UPDATE image_upload_sessions SET expires=?,updated=?,last_error=NULL WHERE token=?',(time.time()+1800,time.time(),token))
    send_prompt(db,token)
    return 'Đã mở lại phiên nhận ảnh.'


def recover(db,now=None):
    now=now or time.time()
    # A crashed download has not accepted bytes. Retain the lock and allow resend.
    with db:db.execute("UPDATE image_upload_sessions SET status='awaiting',updated=?,last_error='Tải ảnh bị gián đoạn; hãy gửi lại hoặc hủy thay ảnh.' WHERE status='processing' AND COALESCE(updated,created)<?",(now,now-LEASE_SECONDS))
    for row in db.execute("SELECT * FROM image_upload_sessions WHERE status IN ('awaiting','accepted') AND finalized_at IS NULL").fetchall():
        if not row['result_draft_id']:
            # Backfill old accepted uploads by their immutable provenance token.
            found=db.execute("SELECT id,review_message,status FROM drafts WHERE json_extract(bundle,'$.illustration.uploadToken')=? ORDER BY created LIMIT 1",(row['token'],)).fetchone()
            if found and row['status']=='accepted':
                # Backfill identity only. finalize_token still validates the
                # immutable file/package before declaring the upload complete.
                with db:db.execute('UPDATE image_upload_sessions SET result_draft_id=?,updated=? WHERE token=?',(found['id'],now,row['token']))
            else:
                try:resolve_target(db,row['target_kind'],row['target_id'],allow_preparing=True)
                except ValueError as exc:
                    # Only a terminal article/run closes the intent. Validation,
                    # stale content or TTL errors keep the old approval locked
                    # until the owner explicitly cancels the replacement.
                    ids={row['lock_draft_id']}
                    run=None
                    if row['target_kind']=='draft':ids.add(row['target_id'])
                    else:
                        run=db.execute('SELECT * FROM runs WHERE id=?',(row['target_id'],)).fetchone()
                        if run:
                            ids.add(run['draft_id'])
                            ids.add(json.loads(run['checkpoint'] or '{}').get('revision_id'))
                    terminal=bool(run and run['cancel_requested'])
                    for ident in ids-{None}:
                        parent=db.execute('SELECT status FROM drafts WHERE id=?',(ident,)).fetchone()
                        if parent and parent['status'] in ('published','approved','publishing','rejected','superseded','cancelled','archived'):
                            terminal=True
                    with db:
                        if terminal:
                            db.execute("UPDATE image_upload_sessions SET status='closed',last_error='Bài đích không còn nhận thay ảnh.',updated=? WHERE token=?",(now,row['token']))
                        else:
                            db.execute('UPDATE image_upload_sessions SET last_error=?,updated=? WHERE token=?',(str(exc)[:500],now,row['token']))
                    continue
        if row['status']=='accepted' and row['retry_count']<3 and (not row['next_retry'] or row['next_retry']<=now):
            try:finalize_token(row['token'])
            except Exception:pass

def handle_event(event,probe=False):
    message=getattr(event,'raw_message',None)
    session=raw_session(message,include_expired=True)
    if not session:return False
    if probe:return True
    import newsroom as n
    key='owner-upload:'+session['chat_id']+':'+str(getattr(message,'message_id',''))
    token=session['token']
    with closing(n.database()) as db:
        db.execute('BEGIN IMMEDIATE')
        try:
            if db.execute('SELECT 1 FROM incoming WHERE event_key=?',(key,)).fetchone():db.commit();return True
            db.execute('INSERT INTO incoming VALUES(?,?)',(key,time.time()))
            changed=0 if session.get('stale_prompt') else db.execute("UPDATE image_upload_sessions SET status='processing',updated=? WHERE token=? AND status='awaiting' AND expires>?",(time.time(),token,time.time())).rowcount
            db.commit()
        except BaseException:db.rollback();raise
        if not changed:
            text='Phiên upload đã hết hạn hoặc đang được xử lý. Bản cũ vẫn khóa; bấm Thử lại hoặc Hủy thay ảnh.'
            if session['status'] in ('cancelled','closed'):text='Phiên upload đã đóng; hãy mở phiên mới cho bản đang chờ duyệt.'
            elif session['finalized_at']:text='Ảnh đã gắn vào bản duyệt '+str(session['result_draft_id'])+'.'
            elif session['status']=='accepted':text='Ảnh đã được lưu; bấm Thử lại để hoàn tất bản duyệt.'
            n.telegram('editor',text,inline_keyboard=session_controls(token) if session['status'] not in ('cancelled','closed') else None)
            return True
        try:
            raw=download(message);media=accept(db,session,raw,getattr(message,'caption',''),key)
            new=finalize(session['target_kind'],session['target_id'],media)
            text='Đã gắn ảnh của anh và gửi bản duyệt '+new+'.' if new else 'Đã lưu ảnh của anh; đang chờ gắn vào bản duyệt. Bản cũ vẫn khóa.'
            n.telegram('editor',text,inline_keyboard=None if new else session_controls(token))
        except Exception as exc:
            with db:db.execute("UPDATE image_upload_sessions SET status='awaiting',updated=? WHERE token=? AND status='processing'",(time.time(),token))
            reason=_record_error(db,token,exc)
            n.telegram('editor','Chưa hoàn tất thay ảnh: '+reason,inline_keyboard=session_controls(token))
    return True
