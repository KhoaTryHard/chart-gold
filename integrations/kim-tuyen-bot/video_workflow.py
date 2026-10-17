"""Owner-triggered, resumable narrated videos; no synthesis in article schedules."""
from __future__ import annotations
import asyncio
from copy import deepcopy
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
import uuid

ROOT=Path(__file__).resolve().parent
PROJECT=Path('D:/KinhDoanh/chart-gold')
SETTINGS=ROOT/'data/video-settings.local.json'
TIMEOUT=900
KINDS={'opening','explanation','spread','accumulation','comparison','interest','closing'}


def settings():
    # Use the provider adapter's validated hard ceilings before any worker
    # dispatch, rather than accepting a local value above the approved budget.
    import elevenlabs_video
    return elevenlabs_video.load_settings(SETTINGS)


def migrate(db):
    db.executescript('''CREATE TABLE IF NOT EXISTS video_jobs(
        id TEXT PRIMARY KEY,draft_id TEXT NOT NULL,source_digest TEXT NOT NULL,
        status TEXT NOT NULL,stage TEXT NOT NULL DEFAULT 'preflight',
        checkpoint TEXT NOT NULL DEFAULT '{}',created REAL NOT NULL,updated REAL NOT NULL,
        actor TEXT,review_draft_id TEXT,error TEXT,progress_message TEXT);
        CREATE INDEX IF NOT EXISTS video_jobs_draft ON video_jobs(draft_id,created);
    ''')


def digest(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def write_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        with temporary.open('x',encoding='utf-8') as stream:
            json.dump(value,stream,ensure_ascii=False,indent=2)
            stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path)
    finally:temporary.unlink(missing_ok=True)


def patch_job(db,job_id,**values):
    values['updated']=time.time()
    if 'checkpoint' in values:values['checkpoint']=json.dumps(values['checkpoint'],ensure_ascii=False)
    with db:
        db.execute('UPDATE video_jobs SET '+','.join(key+'=?' for key in values)+' WHERE id=?',(*values.values(),job_id))
    if 'status' in values:queue_job_report(db,job_id)


def queue_job_report(db,job_id):
    """Reporting is best effort and never rolls back a publication/video state."""
    import newsroom as n
    row=db.execute('SELECT draft_id,review_draft_id FROM video_jobs WHERE id=?',(job_id,)).fetchone()
    if not row:return
    for ident in {value for value in row if value}:
        try:n.queue_reporting(db,ident)
        except Exception:pass


def current_job(db,ident):
    migrate(db)
    return db.execute('SELECT * FROM video_jobs WHERE draft_id=? ORDER BY created DESC LIMIT 1',(ident,)).fetchone()


def controls(db,ident):
    job=current_job(db,ident)
    if not job:return []
    if job['status'] in ('queued','running'):
        return [[{'text':'Đang tạo video','callback_data':'kt:video_status:'+job['id']}]]
    if job['status'] in ('blocked','failed','needs_script'):
        if job['review_draft_id']:
            return [[{'text':'Tiếp tục gửi bản video','callback_data':'kt:video_resume:'+job['id']}],
                    [{'text':'Mở bản video','callback_data':'kt:open:'+job['review_draft_id']}]]
        return [[{'text':'Tiếp tục video','callback_data':'kt:video_resume:'+job['id']}],
                [{'text':'Sửa kịch bản','callback_data':'kt:video_script:'+job['id']}],
                [{'text':'Dùng bài ảnh','callback_data':'kt:video_photo:'+job['id']}]]
    return []


def start(db,ident,actor):
    import newsroom as n
    migrate(db)
    if str(actor)!=n.config()['owner_id']:raise ValueError('Chỉ chủ trang được tạo video.')
    if not settings().get('enabled'):return {'status':'disabled','reason':'Tính năng video đang tắt; cần bật sau kiểm tra kết nối và giọng đọc.'}
    now=time.time();job_id=uuid.uuid4().hex[:16]
    db.execute('BEGIN IMMEDIATE')
    try:
        row=db.execute('SELECT * FROM drafts WHERE id=?',(ident,)).fetchone()
        if not row or row['status']!='pending' or row['expires']<=now:
            raise ValueError('Video chỉ tạo cho bản đang chờ duyệt và còn hạn.')
        active=db.execute("SELECT * FROM video_jobs WHERE status IN ('queued','running') ORDER BY created LIMIT 1").fetchone()
        if active:
            db.commit();return {'status':'busy','job_id':active['id'],'reason':'Một video khác đang được xử lý; thử lại khi hoàn tất.'}
        bundle=json.loads(row['bundle'])
        if bundle.get('schema_version') not in (2,3):raise ValueError('Cần bài website đã chuẩn bị để tạo video.')
        db.execute("UPDATE drafts SET status='video_preparing' WHERE id=? AND status='pending'",(ident,))
        db.execute("INSERT INTO video_jobs(id,draft_id,source_digest,status,created,updated,actor) VALUES(?,?,?,'queued',?,?,?)",
                   (job_id,ident,row['digest'],now,now,str(actor)))
        n.audit(db,ident,'video_requested',actor,job_id)
        db.commit()
    except Exception:db.rollback();raise
    queue_job_report(db,job_id)
    try:n.background('video',job_id)
    except Exception:
        patch_job(db,job_id,status='failed',error='Không khởi động được worker video.');raise
    return {'status':'queued','job_id':job_id}


def resume(db,job_id,actor):
    import newsroom as n
    migrate(db)
    if str(actor)!=n.config()['owner_id']:raise ValueError('Chỉ chủ trang được tiếp tục video.')
    row=db.execute('SELECT * FROM video_jobs WHERE id=?',(job_id,)).fetchone()
    if not row or row['status'] not in ('blocked','failed','needs_script'):
        return {'status':'busy','job_id':job_id}
    draft=db.execute('SELECT * FROM drafts WHERE id=?',(row['draft_id'],)).fetchone()
    if row['review_draft_id']:
        prepared=db.execute('SELECT * FROM drafts WHERE id=?',(row['review_draft_id'],)).fetchone()
        if not prepared or prepared['status'] not in ('preparing','pending'):
            raise ValueError('Bản video đã được xử lý; không gửi lại gói mới.')
    elif not draft or draft['status']!='video_preparing' or draft['digest']!=row['source_digest']:
        raise ValueError('Bài đã đổi hoặc được xử lý; video cũ không thể tiếp tục.')
    db.execute('BEGIN IMMEDIATE')
    try:
        active=db.execute("SELECT id FROM video_jobs WHERE status IN ('queued','running') LIMIT 1").fetchone()
        if active:
            db.commit();return {'status':'busy','job_id':active['id']}
        changed=db.execute("UPDATE video_jobs SET status='queued',error=NULL,updated=? WHERE id=? AND status IN ('blocked','failed','needs_script')",(time.time(),job_id))
        db.commit()
    except Exception:db.rollback();raise
    if changed.rowcount:queue_job_report(db,job_id)
    if changed.rowcount:n.background('video',job_id)
    return {'status':'queued','job_id':job_id}


def use_photo(db,job_id,actor):
    import newsroom as n
    if str(actor)!=n.config()['owner_id']:raise ValueError('Chỉ chủ trang được chọn hình thức đăng.')
    db.execute('BEGIN IMMEDIATE')
    try:
        job=db.execute('SELECT * FROM video_jobs WHERE id=?',(job_id,)).fetchone()
        if (not job or job['status'] not in ('blocked','failed','needs_script') or job['review_draft_id']):
            raise ValueError('Chỉ dùng bài ảnh khi video đã dừng và chưa có bản duyệt mới; hãy mở bản hiện tại.')
        source=db.execute('SELECT status,digest FROM drafts WHERE id=?',(job['draft_id'],)).fetchone()
        if not source or source['status']!='video_preparing' or source['digest']!=job['source_digest']:
            raise ValueError('Bản nguồn đã được xử lý; hãy mở bản duyệt hiện tại.')
        db.execute("UPDATE video_jobs SET status='cancelled',updated=? WHERE id=?",(time.time(),job_id))
        db.execute("UPDATE drafts SET status='pending' WHERE id=? AND status='video_preparing'",(job['draft_id'],))
        n.audit(db,job['draft_id'],'video_cancelled_use_photo',actor,job_id)
        db.commit()
    except Exception:db.rollback();raise
    queue_job_report(db,job_id)
    return job['draft_id']


def photo_revision(db,ident,actor):
    """Switch an unapproved video package back to a fresh v2 photo review."""
    import newsroom as n
    if str(actor)!=n.config()['owner_id']:raise ValueError('Chỉ chủ trang được chọn hình thức đăng.')
    row=db.execute('SELECT * FROM drafts WHERE id=?',(ident,)).fetchone()
    if not row or row['status']!='pending' or row['expires']<=time.time():
        raise ValueError('Chỉ đổi hình thức cho bản chưa duyệt và còn hạn.')
    bundle=deepcopy(json.loads(row['bundle']))
    if bundle.get('facebook_mode')!='video':raise ValueError('Bản này đã là bài ảnh.')
    for key in ('schema_version','bridge','website','facebook','prepare_manifest','prepare_attempts','prepare_next_retry',
                'prepare_blocked','video','videoLocal','videoScript','videoScriptReview','videoAudioHashes','videoTimeline','videoJobId','facebook_mode'):
        bundle.pop(key,None)
    bundle['dual_pending']=True;new_id=uuid.uuid4().hex[:10].upper();now=time.time()
    db.execute('BEGIN IMMEDIATE')
    try:
        changed=db.execute("UPDATE drafts SET status='superseded' WHERE id=? AND status='pending'",(ident,))
        if changed.rowcount!=1:raise ValueError('Bản này vừa được xử lý ở nơi khác.')
        db.execute('''INSERT INTO drafts(id,content,digest,bundle,status,created,expires,revision_of,root_id,version,content_type)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)''',(new_id,row['content'],n.package_digest(row['content'],bundle['media']),json.dumps(bundle,ensure_ascii=False),
            'preparing',now,now+n.config()['approval_ttl_minutes']*60,ident,row['root_id'] or ident,row['version']+1,row['content_type']))
        n.audit(db,new_id,'video_switch_to_photo',actor,ident);db.commit()
    except Exception:db.rollback();raise
    n.request_review(db,new_id)
    return new_id


def number_words(value):
    ones=['không','một','hai','ba','bốn','năm','sáu','bảy','tám','chín']
    n=int(value)
    if n<0:return 'âm '+number_words(-n)
    if n<10:return ones[n]
    if n<100:
        tens,unit=divmod(n,10)
        text='mười' if tens==1 else ones[tens]+' mươi'
        if unit:text+=' '+('mốt' if unit==1 and tens>1 else 'lăm' if unit==5 else ones[unit])
        return text
    if n<1000:
        hundred,left=divmod(n,100);text=ones[hundred]+' trăm'
        if left:text+=' '+('linh ' if left<10 else '')+number_words(left)
        return text
    for divisor,label in [(1000000000,'tỷ'),(1000000,'triệu'),(1000,'nghìn')]:
        if n>=divisor:
            head,left=divmod(n,divisor)
            return number_words(head)+' '+label+(' '+number_words(left) if left else '')
    raise ValueError('Unsupported number')


def spoken_text(text):
    text=str(text)
    # Normalize currency boundaries before number matching: đ is a Unicode
    # word character, so an attached amount otherwise bypasses the end boundary.
    text=re.sub(r'(?i)[đ₫]\s*/\s*(lượng|chỉ)\b',lambda m:' đồng mỗi '+m[1].lower(),text)
    text=re.sub(r'(?i)\bđồng\s*/\s*(lượng|chỉ)\b',lambda m:'đồng mỗi '+m[1].lower(),text)
    text=re.sub(r'(?<=\d)\s*[đ₫](?=[\s/.,;:!?)]|$)',' đồng',text)
    # Four nines describe purity when attached to a gold product, not a price.
    text=re.sub(r'(?i)(\bvàng(?:\s+(?:nhẫn|miếng|trang sức))?)\s+9999\b',r'\1 bốn số chín',text)
    def date_words(day,month,year):
        try:datetime(int(year),int(month),int(day))
        except ValueError:raise ValueError('Ngày trong lời đọc không hợp lệ; cần sửa trước khi tạo giọng.') from None
        return 'ngày '+number_words(day)+' tháng '+number_words(month)+' năm '+number_words(year)
    text=re.sub(r'\b(\d{4})-(\d{1,2})-(\d{1,2})\b',lambda m:date_words(m[3],m[2],m[1]),text)
    text=re.sub(r'\b(\d{1,2})([/.])(\d{1,2})\2(\d{4})\b',lambda m:date_words(m[1],m[3],m[4]),text)
    # Vietnamese dot grouping includes a single thousands separator. A comma
    # with one group is a decimal; multi-group comma notation is also accepted.
    text=re.sub(r'\b\d{1,3}(?:\.\d{3})+\b',lambda m:number_words(m[0].replace('.','')),text)
    text=re.sub(r'\b\d{1,3}(?:,\d{3}){2,}\b',lambda m:number_words(m[0].replace(',','')),text)
    text=re.sub(r'\b\d{1,3}(?:[ \u00a0\u202f]\d{3})+\b',lambda m:number_words(re.sub(r'\s','',m[0])),text)
    text=re.sub(r'\b(\d+)[.,](\d+)\b',lambda m:number_words(m[1])+' phẩy '+' '.join(number_words(x) for x in m[2]),text)
    text=re.sub(r'\b\d+\b',lambda m:number_words(m[0]),text)
    text=text.replace('%',' phần trăm').replace('₫',' đồng')
    for word,speech in [('SJC','ét giây xi'),('PNJ','pi en giây'),('USD','đô la Mỹ'),('ETF','i ti ép'),('Fed','Cục Dự trữ Liên bang Mỹ')]:
        text=re.sub(r'\b'+word+r'\b',speech,text,flags=re.I)
    return re.sub(r'\s+',' ',text).strip()


def validate_script(script,bundle):
    if not isinstance(script,dict) or not isinstance(script.get('scenes'),list) or not 5<=len(script['scenes'])<=6:
        raise ValueError('Kịch bản video cần 5–6 cảnh.')
    allowed={x['id'] for x in bundle['research']['claims']}
    scenes=[]
    for index,item in enumerate(script['scenes']):
        if not isinstance(item,dict) or item.get('kind') not in KINDS:raise ValueError('Loại cảnh không hợp lệ.')
        ids=item.get('claimIds',[])
        if not isinstance(ids,list) or not set(ids)<=allowed:raise ValueError('Kịch bản dùng claim không có nguồn.')
        if item['kind'] not in ('opening','closing') and not ids:raise ValueError('Cảnh giải thích cần tham chiếu claim.')
        title=str(item.get('title','')).strip();shown=str(item.get('displayText','')).strip();narration=str(item.get('narration','')).strip()
        if not title or len(title)>100 or not shown or len(shown)>220 or not narration or len(narration)>650:
            raise ValueError('Tiêu đề, lời đọc hoặc nội dung cảnh vượt giới hạn.')
        scenes.append({'id':str(index+1),'kind':item['kind'],'title':title,'displayText':shown,
                       'narration':narration,'spokenText':spoken_text(narration),'claimIds':ids})
    if scenes[0]['kind']!='opening' or scenes[-1]['kind']!='closing':raise ValueError('Thiếu cảnh mở đầu hoặc kết thúc.')
    return {'title':str(script.get('title') or bundle['website']['title'])[:180],'scenes':scenes}


def check_script_review(review,script):
    used={x for scene in script['scenes'] for x in scene['claimIds']}
    if (not isinstance(review,dict) or review.get('verdict')!='PASS' or review.get('blockingIssues') or
            not used<=set(review.get('checkedClaimIds',[]))):
        raise ValueError('Bản rút gọn/lời đọc chưa đạt kiểm chứng độc lập.')


def validate_file(path,expected):
    p=Path(path)
    import media_storage
    media_storage.ensure_local(p,expected,root=ROOT)
    if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=expected:
        raise ValueError('Artifact video/audio đã đổi; cần đối soát trước khi tiếp tục.')


async def bounded_call(coroutine,deadline):
    remaining=deadline-time.monotonic()
    if remaining<=0:
        coroutine.close()
        raise TimeoutError('Lượt video hết 15 phút; artifact đã lưu để tiếp tục.')
    return await asyncio.wait_for(coroutine,timeout=remaining)


def render(manifest,path,output,deadline,on_progress=None):
    import media_storage
    media_storage.prepare_bundle(manifest,root=ROOT,archive_first=True)
    if deadline-time.monotonic()<=15:raise TimeoutError('Lượt video không còn đủ thời gian để dựng; tiếp tục từ audio đã lưu.')
    manifest=dict(manifest,renderTimeoutSeconds=max(5,min(900,int(deadline-time.monotonic())-10)))
    write_json(path,manifest)
    env=dict(os.environ,PYTHONIOENCODING='utf-8',PYTHONUTF8='1')
    options={'cwd':ROOT,'env':env,'stdin':subprocess.DEVNULL,'stdout':subprocess.PIPE,'stderr':subprocess.PIPE,
             'text':True,'encoding':'utf-8','errors':'replace'}
    if os.name=='nt':options['creationflags']=subprocess.CREATE_NO_WINDOW|subprocess.CREATE_NEW_PROCESS_GROUP
    else:options['start_new_session']=True
    process=subprocess.Popen(['node',str(ROOT/'video_renderer.mjs'),str(path),str(output)],**options)
    started=time.monotonic();last=started
    try:
        while True:
            if time.monotonic()>=deadline:
                import creation_runtime
                creation_runtime._terminate_tree(process)
                raise TimeoutError('Dựng video hết thời gian; audio đã lưu để tiếp tục.')
            try:stdout,stderr=process.communicate(timeout=1);break
            except subprocess.TimeoutExpired:
                if on_progress and time.monotonic()-last>=20:
                    on_progress('Đang dựng HTML thành MP4');last=time.monotonic()
        if process.returncode:raise RuntimeError('Dựng video thất bại; xem log cục bộ, không gọi lại giọng đọc.')
        result=None
        for line in stdout.splitlines():
            try:item=json.loads(line)
            except ValueError:continue
            if item.get('event')=='complete':result=item
        if not result:raise RuntimeError('Worker dựng video chưa xác nhận MP4 hoàn tất.')
        validate_file(result['outputPath'],result['sha256'])
        if not 60<=result['duration']<=90 or result['bytes']>45*1024*1024:
            raise ValueError('Video cần sửa kịch bản: thời lượng 60–90 giây, dung lượng tối đa 45 MB.')
        return result
    except BaseException:
        if process.poll() is None:
            import creation_runtime
            creation_runtime._terminate_tree(process)
        raise


def status_text(db,job_id):
    row=db.execute('SELECT * FROM video_jobs WHERE id=?',(job_id,)).fetchone()
    if not row:raise ValueError('Không có lượt video này.')
    return 'VIDEO '+job_id+'\n'+row['stage']+'\nTrạng thái: '+row['status']+('\n'+row['error'] if row['error'] else '')


def run(job_id):
    import newsroom as n
    import elevenlabs_video as eleven
    db=n.database();migrate(db);now=time.time();owner=uuid.uuid4().hex
    job=db.execute('SELECT * FROM video_jobs WHERE id=?',(job_id,)).fetchone()
    if not job or job['status'] not in ('queued','failed','blocked'):db.close();return {'status':'already_running'}
    db.execute('BEGIN IMMEDIATE')
    try:
        db.execute("DELETE FROM leases WHERE name='video_worker' AND expires<?",(now,))
        db.execute("INSERT INTO leases VALUES('video_worker',?,?)",(owner,now+TIMEOUT+60))
        db.execute("UPDATE video_jobs SET status='running',error=NULL,updated=? WHERE id=?",(now,job_id));db.commit()
    except sqlite3.IntegrityError:db.rollback();db.close();return {'status':'busy'}
    deadline=time.monotonic()+TIMEOUT
    cp=json.loads(job['checkpoint']);folder=ROOT/'assets/video'/job_id;folder.mkdir(parents=True,exist_ok=True)
    progress_id=job['progress_message']
    def progress(label):
        nonlocal progress_id
        if time.monotonic()>=deadline:raise TimeoutError('Lượt video hết 15 phút; tiếp tục từ checkpoint.')
        patch_job(db,job_id,stage=label)
        with db:db.execute("UPDATE leases SET expires=? WHERE name='video_worker' AND owner=?",(time.time()+TIMEOUT+60,owner))
        if progress_id:n.telegram_edit(progress_id,'VIDEO '+job_id+'\n'+label,timeout=5)
        else:
            try:
                progress_id=n.telegram('editor','VIDEO '+job_id+'\n'+label)
                patch_job(db,job_id,progress_message=progress_id)
            except Exception:pass
    try:
        row=db.execute('SELECT * FROM drafts WHERE id=?',(job['draft_id'],)).fetchone()
        if job['review_draft_id']:
            prepared=db.execute('SELECT * FROM drafts WHERE id=?',(job['review_draft_id'],)).fetchone()
            if not prepared or prepared['status'] not in ('preparing','pending'):
                raise ValueError('Bản video đã được xử lý; không gửi bản khác.')
            saved=json.loads(prepared['bundle'])
            n.validate_bundle(saved['research'],saved['draft'],saved['check'])
            with n.website_bridge.creation_budget(deadline):n.request_review(db,prepared['id'])
            patch_job(db,job_id,status='ready',stage='Đã gửi video; chờ chủ trang duyệt')
            return {'status':'ready','job_id':job_id,'draft_id':prepared['id']}
        if not row or row['status']!='video_preparing' or row['digest']!=job['source_digest']:
            raise ValueError('Bản nguồn đã thay đổi; không tạo video từ bản cũ.')
        bundle=json.loads(row['bundle']);n.validate_bundle(bundle['research'],bundle['draft'],bundle['check'])
        n.verify_illustration_binding(bundle)
        conf=settings()
        if cp.get('script'):
            cp.setdefault('audio',[])
            while len(cp['audio'])<len(cp['script']['scenes']):
                index=len(cp['audio']);scene=cp['script']['scenes'][index]
                paid=eleven.cached_scene(db,job_id,index,scene['spokenText'],conf)
                if paid is None:break
                cp['audio'].append(paid);patch_job(db,job_id,checkpoint=cp)
        needs_audio=not cp.get('script') or len(cp.get('audio',[]))<len(cp['script']['scenes'])
        preflight=None
        if needs_audio:
            progress('Kiểm tra ElevenLabs và ngân sách')
            preflight=asyncio.run(bounded_call(eleven.preflight(),deadline))
            if not preflight.get('can_synthesize'):
                patch_job(db,job_id,status='blocked',error=preflight.get('reason') or 'ElevenLabs chưa sẵn sàng; cần kết nối, giọng và quyền TTS.')
                n.telegram('editor',status_text(db,job_id),inline_keyboard=controls(db,row['id']))
                return {'status':'blocked','job_id':job_id,'reason':preflight.get('reason')}
        identity={'voice_id':conf['voice_id'],'model_id':conf['model_id']}
        if cp.get('voice') and cp['voice']!=identity:raise ValueError('Giọng/model đã đổi; cần tạo phiên bản mới, không dùng audio lẫn giọng.')
        cp['voice']=identity
        if not cp.get('script'):
            progress('Đang soạn lời đọc và cảnh giải thích')
            script=n.agent('video_script',{'research':bundle['research'],'website':bundle['website'],
                'caption':bundle['facebook']['caption'],'concept':bundle.get('illustration',{}).get('brief',{}).get('concept'),
                'previousScript':cp.get('previousScript'),'revisionInstruction':cp.get('revisionInstruction')},
                run_id=job_id,deadline=deadline,heartbeat=lambda _:progress('Đang soạn lời đọc'))
            cp['script']=validate_script(script,bundle);cp['scriptSha256']=digest(cp['script'])
            patch_job(db,job_id,checkpoint=cp)
        if not cp.get('scriptReview'):
            progress('Kiểm chứng lời đọc trước khi dùng credits')
            review=n.agent('video_verify',{'script':cp['script'],'research':bundle['research'],'website':bundle['website']},
                run_id=job_id,deadline=deadline,heartbeat=lambda _:progress('Đang kiểm chứng lời đọc'))
            check_script_review(review,cp['script']);cp['scriptReview']=review;patch_job(db,job_id,checkpoint=cp)
        else:check_script_review(cp['scriptReview'],cp['script'])
        cp.setdefault('audio',[])
        if preflight:
            evidence=preflight.get('credit_rate_evidence',{})
            rate=evidence.get('credits_per_character')
            if evidence.get('status')!='verified' or not isinstance(rate,(int,float)) or rate<=0:
                raise ValueError('Chưa xác minh giá credits trước khi tạo giọng.')
            import math
            projected=sum(math.ceil(len(scene['spokenText'])*rate) for scene in cp['script']['scenes'])
            if projected>conf['video_credit_limit']:
                patch_job(db,job_id,status='needs_script',error='Kịch bản vượt 2.000 credits/video; rút gọn trước khi gọi TTS.')
                n.telegram('editor',status_text(db,job_id),inline_keyboard=controls(db,row['id']))
                return {'status':'needs_script','job_id':job_id}
        for index,scene in enumerate(cp['script']['scenes']):
            if index<len(cp['audio']):validate_file(cp['audio'][index]['path'],cp['audio'][index]['sha256']);continue
            progress('Đang tạo giọng đọc cảnh '+str(index+1))
            result=asyncio.run(bounded_call(eleven.synthesize_scene(db,job_id,index,scene['spokenText'],folder,settings=conf,
                                                       progress=lambda *_:progress('Đang tạo giọng đọc')),deadline))
            cp['audio'].append(result);patch_job(db,job_id,checkpoint=cp)
        duration=sum(item['duration'] for item in cp['audio'])
        if not 60<=duration<=90:
            patch_job(db,job_id,status='needs_script',error=f'Lời đọc dài {duration:.1f} giây; cần sửa kịch bản về 60–90 giây, chưa tự gọi lại TTS.')
            n.telegram('editor',status_text(db,job_id),inline_keyboard=controls(db,row['id']))
            return {'status':'needs_script','job_id':job_id}
        scenes=[dict(scene,audioPath=cp['audio'][i]['path'],duration=cp['audio'][i]['duration']) for i,scene in enumerate(cp['script']['scenes'])]
        manifest={'width':1080,'height':1920,'fps':30,'templateVersion':'html-v1','imagePath':str(n.verify_media(bundle['media'])),
                  'scenes':scenes,'nodeModulesPath':str(PROJECT/'node_modules')}
        if not cp.get('render'):
            progress('Đang dựng chuyển động HTML thành MP4')
            cp['render']=render(manifest,folder/'manifest.json',folder/'video.mp4',deadline,on_progress=progress)
            cp['sceneSha256']=digest(scenes);cp['audioSha256']=digest([x['sha256'] for x in cp['audio']])
            patch_job(db,job_id,checkpoint=cp)
        validate_file(cp['render']['outputPath'],cp['render']['sha256'])
        # A render can outlive the remaining validity of market news sources.
        # Preserve the paid artifacts, but never renew their evidence timestamps.
        n.validate_bundle(bundle['research'],bundle['draft'],bundle['check'])
        if not cp.get('uploaded'):
            if not cp.get('plannedReviewDraftId'):
                cp['plannedReviewDraftId']=uuid.uuid4().hex[:10].upper()
                patch_job(db,job_id,checkpoint=cp)
            progress('Đang lưu video riêng tư và kiểm tra asset')
            import video_bridge
            with n.website_bridge.creation_budget(deadline):
                cp['uploaded']=video_bridge.upload_video(job,row,cp,deadline=deadline)
            patch_job(db,job_id,checkpoint=cp)
        if not job['review_draft_id']:
            progress('Đang chuẩn bị bản video để chủ trang xem và duyệt')
            new_id=create_video_revision(db,row,cp,job_id)
            patch_job(db,job_id,review_draft_id=new_id)
        else:new_id=job['review_draft_id']
        with n.website_bridge.creation_budget(deadline):n.request_review(db,new_id)
        patch_job(db,job_id,status='ready',stage='Đã gửi video; chờ chủ trang duyệt')
        n.queue_reporting(db,new_id)
        return {'status':'ready','job_id':job_id,'draft_id':new_id}
    except Exception as exc:
        reason=str(exc)[:600] if isinstance(exc,(ValueError,RuntimeError,TimeoutError)) else type(exc).__name__
        patch_job(db,job_id,status='failed',error=reason,checkpoint=cp)
        try:n.telegram('editor',status_text(db,job_id),inline_keyboard=controls(db,job['draft_id']))
        except Exception:pass
        return {'status':'failed','job_id':job_id,'reason':reason}
    finally:
        with db:db.execute("DELETE FROM leases WHERE name='video_worker' AND owner=?",(owner,))
        db.close()


def recover(db):
    """Recover expired local render workers without silently spending credits."""
    migrate(db);now=time.time()
    active=db.execute("SELECT 1 FROM leases WHERE name='video_worker' AND expires>?",(now,)).fetchone()
    if active:return
    with db:
        db.execute("UPDATE video_jobs SET status='failed',error='Worker video gián đoạn; tiếp tục từ artifact đã lưu.',updated=? WHERE status IN ('running','queued') AND updated<?",(now,now-TIMEOUT-60))


def create_video_revision(db,row,checkpoint,job_id):
    import newsroom as n
    ident=checkpoint.get('plannedReviewDraftId') or uuid.uuid4().hex[:10].upper();now=time.time()
    bundle=deepcopy(json.loads(row['bundle']))
    n.validate_bundle(bundle['research'],bundle['draft'],bundle['check'])
    for key in ('schema_version','bridge','website','facebook','prepare_manifest','prepare_attempts','prepare_next_retry','prepare_blocked'):
        bundle.pop(key,None)
    bundle['dual_pending']=True;bundle['facebook_mode']='video';bundle['video']=checkpoint['uploaded']['video']
    bundle['videoJobId']=job_id;bundle['videoLocal']={'path':checkpoint['render']['outputPath'],'sha256':checkpoint['render']['sha256']}
    bundle['videoScript']=checkpoint['script'];bundle['videoScriptReview']=checkpoint['scriptReview']
    bundle['videoAudioHashes']=[x['sha256'] for x in checkpoint['audio']]
    bundle['videoTimeline']=[dict(scene,audioPath=checkpoint['audio'][i]['path'],duration=checkpoint['audio'][i]['duration']) for i,scene in enumerate(checkpoint['script']['scenes'])]
    with db:
        already=db.execute('SELECT * FROM drafts WHERE id=?',(ident,)).fetchone()
        if already:
            stored=json.loads(already['bundle'])
            if (stored.get('videoJobId')!=job_id or stored.get('video')!=bundle['video'] or
                    already['revision_of']!=row['id']):
                raise ValueError('Identity bản duyệt video đã thuộc gói khác; không ghi đè.')
            db.execute('UPDATE video_jobs SET review_draft_id=?,updated=? WHERE id=?',(ident,now,job_id))
            return ident
        current=db.execute('SELECT status,digest FROM drafts WHERE id=?',(row['id'],)).fetchone()
        if not current or current['status']!='video_preparing' or current['digest']!=row['digest']:
            raise ValueError('Bản nguồn vừa được thay đổi; video cần tạo lại từ phiên bản mới.')
        db.execute('''INSERT INTO drafts(id,content,digest,bundle,status,created,expires,revision_of,root_id,version,content_type)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)''',(ident,row['content'],digest({'draft':ident,'video':bundle['video']}),json.dumps(bundle,ensure_ascii=False),
            'preparing',now,now+n.config()['approval_ttl_minutes']*60,row['id'],row['root_id'] or row['id'],row['version']+1,row['content_type']))
        db.execute("UPDATE drafts SET status='superseded' WHERE id=? AND status='video_preparing'",(row['id'],))
        db.execute('UPDATE video_jobs SET review_draft_id=?,updated=? WHERE id=?',(ident,now,job_id))
        n.audit(db,ident,'video_revision_created',message_id=job_id)
    return ident


def update_script(db,job_id,text,actor):
    import newsroom as n
    if str(actor)!=n.config()['owner_id']:raise ValueError('Chỉ chủ trang được sửa kịch bản.')
    supplied=json.loads(text);new_id=uuid.uuid4().hex[:16];now=time.time()
    db.execute('BEGIN IMMEDIATE')
    try:
        job=db.execute('SELECT * FROM video_jobs WHERE id=?',(job_id,)).fetchone()
        if (not job or job['status'] not in ('needs_script','failed','blocked') or job['review_draft_id']):
            raise ValueError('Video không đang chờ sửa kịch bản.')
        if db.execute("SELECT 1 FROM video_jobs WHERE status IN ('queued','running') LIMIT 1").fetchone():
            raise ValueError('Một video khác đang được xử lý; thử lại khi hoàn tất.')
        row=db.execute('SELECT * FROM drafts WHERE id=?',(job['draft_id'],)).fetchone()
        if (not row or row['status']!='video_preparing' or row['digest']!=job['source_digest'] or row['expires']<=now):
            raise ValueError('Bản nguồn đã đổi hoặc hết hạn; hãy mở bản hiện tại.')
        bundle=json.loads(row['bundle']);n.validate_bundle(bundle['research'],bundle['draft'],bundle['check'])
        script=validate_script(supplied,bundle);cp={'script':script,'scriptSha256':digest(script)}
        db.execute("UPDATE video_jobs SET status='superseded' WHERE id=?",(job_id,))
        db.execute('''INSERT INTO video_jobs(id,draft_id,source_digest,status,checkpoint,created,updated,actor)
            VALUES(?,?,?,'queued',?,?,?,?)''',(new_id,row['id'],row['digest'],json.dumps(cp,ensure_ascii=False),now,now,str(actor)))
        db.commit()
    except Exception:db.rollback();raise
    try:n.background('video',new_id)
    except Exception:patch_job(db,new_id,status='failed',error='Không khởi động được worker; bấm Tiếp tục video.')
    return new_id
