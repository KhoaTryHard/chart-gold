"""Two-channel publication ledger. Approval and remote writes are separate steps."""
import asyncio
import hashlib
import json
from pathlib import Path
import sqlite3
import time
import uuid
import website_bridge as web
import media_storage

ROOT=Path(__file__).resolve().parent
STATES=('pending','publishing','published','retryable_failed','needs_reconcile','blocked')

def migrate(db):
    db.executescript('''CREATE TABLE IF NOT EXISTS publication_channels (
      draft_id TEXT NOT NULL,channel TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',
      step TEXT NOT NULL DEFAULT 'pending',attempt INTEGER NOT NULL DEFAULT 0,
      artifact_id TEXT,url TEXT,comment_id TEXT,error TEXT,next_retry REAL,
      updated REAL NOT NULL,PRIMARY KEY(draft_id,channel));
      CREATE TABLE IF NOT EXISTS dual_approvals (draft_id TEXT PRIMARY KEY,provenance TEXT NOT NULL);
    ''')
    columns={row[1] for row in db.execute('PRAGMA table_info(publication_channels)')}
    if 'video_id' not in columns:db.execute('ALTER TABLE publication_channels ADD COLUMN video_id TEXT')

def is_dual(row):return json.loads(row['bundle']).get('schema_version') in (2,3)
def review_digest(bundle):return hashlib.sha256(bundle['bridge']['canonicalPackage'].encode('utf-8')).hexdigest()
def validate_package(bundle):
    import newsroom
    newsroom.verify_illustration_binding(bundle)
    package=json.loads(bundle['bridge']['canonicalPackage'])
    if package['schemaVersion'] not in (2,3) or package['facebook']!=bundle['facebook'] or package['website']!=bundle['website']:
        raise ValueError('Nội dung hai kênh khác bản đã duyệt')
    if package.get('imageOrigin')=='owner_upload':
        import owner_images
        owner_images.verify(ROOT,dict(bundle['media'],illustration=bundle['illustration']))
    if package.get('imageOrigin')!=('owner_upload' if bundle.get('illustration',{}).get('origin')=='owner_upload' else None):
        raise ValueError('Nguồn gốc ảnh khác bản đã duyệt')
    if package['image']['sha256']!=bundle['media']['sha256'] or package['image']['url']!=bundle['bridge']['imageUrl']:
        raise ValueError('Ảnh khác bản đã duyệt')
    if hashlib.sha256(bundle['bridge']['canonicalPackage'].encode()).hexdigest()!=bundle['bridge']['reviewDigest']:
        raise ValueError('Digest bridge đã thay đổi')
    if package['schemaVersion']==3:
        if package.get('facebookMode')=='photo':
            if bundle.get('facebook_mode','photo')!='photo' or package.get('video') or bundle.get('video'):
                raise ValueError('Gói ảnh v3 có metadata video không hợp lệ.')
            return package
        import video_workflow
        if package.get('facebookMode')!='video' or bundle.get('facebook_mode')!='video' or package.get('video')!=bundle.get('video'):
            raise ValueError('Hình thức đăng hoặc asset video khác gói được duyệt.')
        video=package['video']
        video_workflow.validate_file(bundle['videoLocal']['path'],video['sha256'])
        if video_workflow.digest(bundle['videoScript'])!=video['scriptSha256']:
            raise ValueError('Kịch bản khác bản video được xem trước.')
        if video_workflow.digest(bundle['videoAudioHashes'])!=video['audioSha256']:
            raise ValueError('Audio khác bản được duyệt.')
        if video_workflow.digest(bundle['videoTimeline'])!=video['sceneSha256']:
            raise ValueError('Các cảnh khác bản được duyệt.')
        video_workflow.check_script_review(bundle['videoScriptReview'],bundle['videoScript'])
    return package

def prepare_record(ident,root_id,version,research,draft,check,data,db=None):
    website=draft.get('website')
    if not isinstance(website,dict) or check.get('website_verdict')!='PASS':
        raise ValueError('Bài website chưa có bản thảo và kiểm chứng độc lập PASS.')
    from publication_preview import website_sources
    sources=check.get('publication_preview',{}).get('website',{}).get('sources') or website_sources(research)
    used=set(draft['used_claim_ids'])|set(website.get('used_claim_ids',[]))
    claim_map={item['id']:item for item in check.get('claim_results',[])}
    if not used or any(claim_map.get(ident,{}).get('status') not in ('verified','pass') for ident in used):
        raise ValueError('Một trong hai bản còn claim chưa kiểm chứng.')
    if check.get('website_issues') or not isinstance(check.get('website_claim_ids'),list):
        raise ValueError('Kiểm chứng website thiếu kết quả chi tiết.')
    evidence=[{'label':claim['id'],'value':claim['text'],'sourceUrl':next((s['url'] for s in research['sources'] if s['id'] in claim['source_ids']),sources[0]['url'])}
              for claim in research['claims'] if claim['id'] in used]
    payload={'title':website['title'].strip(),'excerpt':website['excerpt'].strip(),'contentMarkdown':website['contentMarkdown'].strip(),
             'category':'explain' if data.get('content_type')=='evergreen' else 'news','sources':sources,'evidence':evidence,
             'seoTitle':website['seoTitle'].strip(),'seoDescription':website['seoDescription'].strip(),'coverAlt':website['coverAlt'].strip()}
    caption=draft['content'].strip()
    manifest={'draftId':ident,'rootId':root_id,'externalRevision':version,'website':payload,
              'facebook':{'pageId':'1262243656966414','caption':caption,'sourceComment':data['source_comment'].strip()},
              'verification':{'verdict':'PASS','websiteDigest':hashlib.sha256(payload['contentMarkdown'].encode()).hexdigest(),
                              'captionDigest':hashlib.sha256(caption.encode()).hexdigest()}}
    if data.get('illustration',{}).get('origin')=='owner_upload': manifest['imageOrigin']='owner_upload'
    if data.get('facebook_mode')=='video':
        manifest.update(schemaVersion=3,facebookMode='video',video=data['video'])
    # The same raw request must survive a lost prepare response. Freeze the
    # manifest before the first network call; retries reuse its timestamps.
    if data.get('prepare_manifest'):manifest=data['prepare_manifest']
    else:
        data['prepare_manifest']=manifest
        if db:
            with db:db.execute('UPDATE drafts SET bundle=? WHERE id=?',(json.dumps(data,ensure_ascii=False),ident))
    import media_storage
    media_storage.ensure_local(ROOT/data['media']['path'],data['media']['sha256'],root=ROOT)
    original=(ROOT/data['media']['path']).read_bytes()
    bridge=web.prepare(manifest,original)
    canonical=bridge['canonicalPackage'];package=json.loads(canonical)
    if hashlib.sha256(canonical.encode()).hexdigest()!=bridge['reviewDigest']:raise ValueError('Website review digest mismatch')
    normalized=web.media(bridge['packageId'])
    sha=hashlib.sha256(normalized).hexdigest()
    if sha!=package['image']['sha256']:raise ValueError('Website review image mismatch')
    directory=ROOT/'assets/approved';directory.mkdir(exist_ok=True)
    path=directory/(sha+'.png')
    if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest()!=sha:raise ValueError('Immutable image corrupted')
    if not path.exists():path.write_bytes(normalized)
    media_storage.archive(path,sha,root=ROOT)
    data.update(schema_version=package['schemaVersion'],bridge=bridge,website=package['website'],facebook=package['facebook'],
                media={'path':str(path.relative_to(ROOT)).replace('\\','/'),'sha256':sha,'mimeType':'image/png'})
    if package['schemaVersion']==3:
        data.update(video=package['video'],facebook_mode=package['facebookMode'])
    data.pop('dual_pending',None)
    import newsroom
    newsroom.verify_illustration_binding(data)
    if package['schemaVersion']==3:validate_package(data)
    return package['facebook']['caption'],bridge['reviewDigest'],data

def ensure_prepared(db,ident):
    row=db.execute('SELECT * FROM drafts WHERE id=?',(ident,)).fetchone();data=json.loads(row['bundle'])
    if not data.get('dual_pending'):return row
    if data.get('prepare_blocked') or data.get('prepare_next_retry',0)>time.time():raise RuntimeError('Chuẩn bị gói đang chờ kiểm tra hoặc retry.')
    lease='prepare:'+ident;owner=uuid.uuid4().hex
    with db:
        db.execute('DELETE FROM leases WHERE name=? AND expires<?',(lease,time.time()))
        try:db.execute('INSERT INTO leases VALUES(?,?,?)',(lease,owner,time.time()+180))
        except sqlite3.IntegrityError:raise RuntimeError('Một worker đang chuẩn bị đúng gói này.') from None
    try:
        data['prepare_attempts']=data.get('prepare_attempts',0)+1
        with db:db.execute('UPDATE drafts SET bundle=? WHERE id=?',(json.dumps(data,ensure_ascii=False),ident))
        content,digest,bundle=prepare_record(row['id'],row['root_id'],row['version'],data['research'],data['draft'],data['check'],data,db)
        with db:db.execute('UPDATE drafts SET content=?,digest=?,bundle=?,error=NULL WHERE id=? AND status=?',(content,digest,json.dumps(bundle,ensure_ascii=False),ident,'preparing'))
        return db.execute('SELECT * FROM drafts WHERE id=?',(ident,)).fetchone()
    except Exception as error:
        data['prepare_blocked']=getattr(error,'status',0) in (400,401,403,409) or data['prepare_attempts']>3
        data['prepare_next_retry']=time.time()+[60,300,900][min(data['prepare_attempts']-1,2)]
        with db:db.execute('UPDATE drafts SET bundle=?,error=? WHERE id=?',(json.dumps(data,ensure_ascii=False),type(error).__name__+': '+str(error)[:400],ident))
        raise
    finally:
        with db:db.execute('DELETE FROM leases WHERE name=? AND owner=?',(lease,owner))

def init_approval(db,row,actor,chat,message,callback):
    if not is_dual(row):return
    from datetime import datetime,timezone
    bundle=json.loads(row['bundle'])
    validate_package(bundle)
    if review_digest(bundle)!=row['digest']:raise ValueError('Gói duyệt đã thay đổi')
    provenance={'reviewDigest':row['digest'],'actorId':str(actor),'chatId':str(chat),'reviewMessageId':str(message),
                'callbackId':str(callback),'approvedAt':datetime.now(timezone.utc).isoformat()}
    db.execute('INSERT OR IGNORE INTO dual_approvals VALUES(?,?)',(row['id'],json.dumps(provenance)))
    for channel in ['website','facebook']:
        db.execute('INSERT OR IGNORE INTO publication_channels(draft_id,channel,updated) VALUES(?,?,?)',(row['id'],channel,time.time()))

def channel(db,ident,name):return db.execute('SELECT * FROM publication_channels WHERE draft_id=? AND channel=?',(ident,name)).fetchone()
def save(db,ident,name,**values):
    if 'state' in values and values['state'] not in STATES:raise ValueError('Invalid channel state')
    values['updated']=time.time()
    with db:db.execute('UPDATE publication_channels SET '+','.join(k+'=?' for k in values)+' WHERE draft_id=? AND channel=?',(*values.values(),ident,name))

def status_text(db,row):
    lines=['BẢN DUYỆT '+row['id']+' · Website + Facebook']
    labels={'pending':'Chờ đăng','publishing':'Đang xử lý','published':'Đã đăng và xác nhận','retryable_failed':'Lỗi tạm thời; sẽ tiếp tục','needs_reconcile':'Cần đối soát, không tự đăng lại','blocked':'Cần xử lý'}
    for name in ['website','facebook']:
        c=channel(db,row['id'],name)
        lines.append(('Website' if name=='website' else 'Facebook')+': '+labels.get(c['state'] if c else 'pending','Chờ đăng'))
        if c and c['url']:lines.append(c['url'])
        if c and c['error']:lines.append(c['error'][:300])
    complete=all(channel(db,row['id'],name) and channel(db,row['id'],name)['state']=='published' for name in ['website','facebook'])
    if complete:lines.insert(0,'✅ Đã đăng cả hai nơi.')
    lines.extend(__import__('facebook_story').status_lines(db,row['id']))
    return '\n'.join(lines)

def keyboard(db,row):
    buttons=[]
    for name in ['website','facebook']:
        c=channel(db,row['id'],name)
        if c and c['state']=='published' and c['url']:buttons.append([{'text':'🌐 Mở '+name.title(),'url':c['url']}])
    buttons.append([{'text':'🔄 Cập nhật trạng thái','callback_data':'kt:open:'+row['id']}])
    buttons.append([{'text':'▶️ Tiếp tục phần chưa hoàn tất','callback_data':'kt:dual_resume:'+row['id']}])
    buttons.extend(__import__('facebook_story').controls(db,row['id']))
    buttons.append([{'text':'↩️ Về menu','callback_data':'kt:menu'}])
    return buttons

@media_storage.draft_cache
def run(db,ident):
    import newsroom as n
    row=db.execute('SELECT * FROM drafts WHERE id=?',(ident,)).fetchone()
    if not row or not is_dual(row):raise ValueError('Không phải gói hai kênh')
    provenance=db.execute('SELECT provenance FROM dual_approvals WHERE draft_id=?',(ident,)).fetchone()
    if not provenance or row['approved_by']!=n.config()['owner_id']:raise ValueError('Không có duyệt hai kênh hợp lệ')
    bundle=json.loads(row['bundle'])
    from editorial_compliance import require_release
    require_release(bundle,n.config())
    validate_package(bundle);n.verify_media(bundle['media'])
    if review_digest(bundle)!=row['digest']:raise ValueError('Gói đã thay đổi sau duyệt')
    owner=uuid.uuid4().hex;lease='dual:'+ident
    with db:
        db.execute('DELETE FROM leases WHERE name=? AND expires<?',(lease,time.time()))
        try:db.execute('INSERT INTO leases VALUES(?,?,?)',(lease,owner,time.time()+360))
        except sqlite3.IntegrityError:return {'status':'busy'}
    try:
        for name in ['website','facebook']:
            c=channel(db,ident,name)
            if c['state']=='published':continue
            if c['state']=='blocked' or (c['next_retry'] and c['next_retry']>time.time()):return {'status':'waiting'}
            save(db,ident,name,state='publishing',attempt=c['attempt']+1,error=None)
            try:
                if name=='website':
                    save(db,ident,name,step='publish_dispatched')
                    result=web.publish(bundle['bridge']['packageId'],json.loads(provenance[0]))
                    if not result['websitePublic']:raise web.BridgeError('Website chưa công khai',409)
                    web.verify_public(result['receipt'])
                    save(db,ident,name,state='published',step='readback_confirmed',artifact_id=result['revisionId'],url=result['url'],next_retry=None)
                else:
                    receipt=web.status(bundle['bridge']['packageId'])
                    if not receipt['websitePublic'] or not receipt['contentUnchanged']:raise web.BridgeError('Bài website đã gỡ hoặc sửa; dừng Facebook.',409)
                    web.verify_public(receipt['receipt'])
                    import publisher
                    def progress(step,metadata):
                        values={'step':step}
                        if metadata.get('video_id'):values['video_id']=str(metadata['video_id'])
                        if metadata.get('post_id'):values.update(artifact_id=metadata['post_id'],url='https://www.facebook.com/'+metadata['post_id'])
                        if metadata.get('comment_id'):values['comment_id']=metadata['comment_id']
                        save(db,ident,'facebook',**values)
                    # Previous dispatch without an ID must be read-only reconciled.
                    if bundle.get('facebook_mode')=='video':
                        import facebook_video,video_bridge
                        url=video_bridge.playback_url(bundle['video']['assetId'],bundle['bridge']['packageId'])
                        existing={'video_id':c['video_id'],'post_id':c['artifact_id'],'comment_id':c['comment_id'],'previous_step':c['step']}
                        result=asyncio.run(asyncio.wait_for(facebook_video.publish(bundle['facebook']['caption'],url,
                            bundle['facebook']['sourceComment'],progress=progress,existing=existing),timeout=180))
                        save(db,ident,name,state='published',step='readback_confirmed',artifact_id=result['post_id'],
                             video_id=result['video_id'],comment_id=result['comment_id'],url=result['url'],next_retry=None)
                        continue
                    if c['step'] in ('create_dispatched','needs_reconcile') and not c['artifact_id']:
                        match=asyncio.run(publisher.reconcile_page(bundle['facebook']['caption']))
                        if len(match['matches'])!=1 or not match['complete']:
                            save(db,ident,name,state='needs_reconcile',step='needs_reconcile',error='Chưa xác nhận duy nhất bài Facebook; không tự gửi lại.',next_retry=None);return {'status':'needs_reconcile'}
                        found=match['matches'][0]['id'];save(db,ident,name,artifact_id=found,url=match['matches'][0]['permalink_url']);c=channel(db,ident,name)
                    result=asyncio.run(asyncio.wait_for(publisher.publish_url(bundle['facebook']['caption'],bundle['bridge']['imageUrl'],bundle['facebook']['sourceComment'],
                        progress=progress,post_id=c['artifact_id'],comment_id=c['comment_id'],previous_step=c['step']),timeout=180))
                    save(db,ident,name,state='published',step='readback_confirmed',artifact_id=result['post_id'],comment_id=result['comment_id'],url=result['url'],next_retry=None)
            except BaseException as error:
                current=channel(db,ident,name)
                safe=name=='website' or current['step'] not in ('create_dispatched','comment_dispatched','needs_reconcile')
                is_blocked=getattr(error,'status',None) in (400,401,403,409) or getattr(error,'blocked',False)
                if (current['artifact_id'] or current['video_id']) and name=='facebook':safe=True
                attempts=current['attempt'];delay=[60,300,900][min(attempts-1,2)]
                state='blocked' if is_blocked or (safe and attempts>3) else 'retryable_failed' if safe else 'needs_reconcile'
                save(db,ident,name,state=state,error=n._publication_error_text(n.exception_detail(error))[:600],next_retry=time.time()+delay if state=='retryable_failed' else None)
                return {'status':state}
        with db:
            db.execute("UPDATE drafts SET status='published',post_id=?,error=NULL WHERE id=?",(channel(db,ident,'facebook')['artifact_id'],ident))
            n.audit(db,ident,'dual_publish_confirmed')
            __import__('facebook_story').safe_enqueue(db,ident)
        try:__import__('facebook_story').kick(db)
        except Exception:pass
        return {'status':'published'}
    finally:
        with db:db.execute('DELETE FROM leases WHERE name=? AND owner=?',(lease,owner))
        try:n.update_publish_ui(db,ident)
        except Exception:pass
        n.queue_reporting(db,ident)

def recover(db):
    # Preparation is allowed before approval, publication is not. Missing
    # prepare receipts can be recovered with the same durable request identity.
    preparing=db.execute("SELECT id FROM drafts WHERE status='preparing' AND json_extract(bundle,'$.dual_pending')=1").fetchall()
    import newsroom as n
    for row in preparing:
        try:ensure_prepared(db,row['id']);n.request_review(db,row['id'])
        except Exception:pass
    rows=db.execute("SELECT DISTINCT c.draft_id FROM publication_channels c JOIN dual_approvals a ON a.draft_id=c.draft_id WHERE c.state IN ('pending','publishing','retryable_failed') AND (c.next_retry IS NULL OR c.next_retry<=?) AND NOT EXISTS (SELECT 1 FROM publication_channels b WHERE b.draft_id=c.draft_id AND b.channel='website' AND b.state='blocked')",(time.time(),)).fetchall()
    for row in rows:
        live=db.execute('SELECT 1 FROM leases WHERE name=? AND expires>?',('dual:'+row['draft_id'],time.time())).fetchone()
        if not live:n.background('publish',row['draft_id'])
