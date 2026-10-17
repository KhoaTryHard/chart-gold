"""Private R2 originals with a verified, seven-day local cache.

The registry is separate from publication JSON and the newsroom database. File
paths, approval digests, render timelines and publication receipts never change.
"""
from __future__ import annotations
import argparse
import base64
from contextlib import contextmanager, closing
import ctypes
import functools
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import sqlite3
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parent
EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.mp3', '.mp4', '.wav', '.m4a'}
TERMINAL = {'published', 'expired', 'rejected', 'superseded', 'cancelled', 'canceled', 'closed', 'complete', 'completed', 'done', 'no_news', 'skipped_insufficient_evidence'}


def enabled(root=ROOT):
    try:
        return json.loads((Path(root)/'data/media-storage.json').read_text('utf-8')).get('enabled') is True
    except FileNotFoundError:
        return False


def settings(root=ROOT):
    explicit = {key: os.environ.get(key) for key in ('R2_ACCOUNT_ID','R2_ENDPOINT','R2_BUCKET','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY')}
    if all(explicit.values()):
        value = explicit
    else:
        if os.name != 'nt': raise RuntimeError('R2 credential is not configured.')
        class Blob(ctypes.Structure):
            _fields_ = [('size',ctypes.c_uint32),('data',ctypes.POINTER(ctypes.c_ubyte))]
        encrypted = base64.b64decode((Path(root)/'data/r2-storage.secret').read_bytes(), validate=True)
        buffer = (ctypes.c_ubyte*len(encrypted)).from_buffer_copy(encrypted)
        source, output = Blob(len(encrypted),buffer), Blob()
        crypt = ctypes.WinDLL('crypt32',use_last_error=True)
        kernel = ctypes.WinDLL('kernel32',use_last_error=True)
        crypt.CryptUnprotectData.argtypes = [ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_uint32,ctypes.POINTER(Blob)]
        crypt.CryptUnprotectData.restype = ctypes.c_int
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        try:
            if not crypt.CryptUnprotectData(ctypes.byref(source),None,None,None,None,1,ctypes.byref(output)):
                raise RuntimeError('Cannot unlock the Windows R2 credential.')
            if not output.data or not 20 < output.size < 16384: raise RuntimeError('Invalid R2 credential envelope.')
            value = json.loads(ctypes.string_at(output.data,output.size).decode('utf-8'))
        finally:
            if output.data:
                ctypes.memset(output.data,0,output.size)
                kernel.LocalFree(ctypes.cast(output.data,ctypes.c_void_p))
    import re
    account = value.get('R2_ACCOUNT_ID','')
    if not re.fullmatch('[a-f0-9]{32}',account) or value.get('R2_ENDPOINT') != f'https://{account}.r2.cloudflarestorage.com':
        raise RuntimeError('Invalid R2 endpoint.')
    if value.get('R2_BUCKET') not in ('chart-gold-media-prod','chart-gold-media-staging'):
        raise RuntimeError('Unexpected R2 bucket.')
    return value


def client(root=ROOT):
    import boto3
    from botocore.config import Config
    value = settings(root)
    return boto3.client('s3', endpoint_url=value['R2_ENDPOINT'], region_name='auto',
        aws_access_key_id=value['R2_ACCESS_KEY_ID'], aws_secret_access_key=value['R2_SECRET_ACCESS_KEY'],
        config=Config(connect_timeout=10,read_timeout=90,retries={'max_attempts':3},
                      request_checksum_calculation='when_required',response_checksum_validation='when_required'))


def database(root=ROOT):
    path = Path(root)/'data/media-storage.sqlite3'
    path.parent.mkdir(parents=True,exist_ok=True)
    db = sqlite3.connect(path,timeout=30)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL')
    db.executescript('''
      CREATE TABLE IF NOT EXISTS media_objects(sha256 TEXT PRIMARY KEY,object_key TEXT UNIQUE NOT NULL,
        mime TEXT NOT NULL,bytes INTEGER NOT NULL,verified_at REAL,last_error TEXT);
      CREATE TABLE IF NOT EXISTS media_cache(relative_path TEXT PRIMARY KEY,sha256 TEXT NOT NULL,
        last_access REAL NOT NULL,unpinned_at REAL NOT NULL,pinned INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS media_refs(owner_type TEXT,owner_id TEXT,role TEXT,relative_path TEXT,
        PRIMARY KEY(owner_type,owner_id,role,relative_path));
      CREATE TABLE IF NOT EXISTS media_leases(relative_path TEXT,owner TEXT,expires REAL,
        PRIMARY KEY(relative_path,owner));
      CREATE TABLE IF NOT EXISTS media_state(name TEXT PRIMARY KEY,value TEXT);
    ''')
    return db


def contained(path, root=ROOT):
    root = Path(root).resolve()
    path = (root/Path(path)).resolve()
    if not path.is_relative_to(root/'assets') or path == root/'assets' or path.suffix.lower() not in EXTENSIONS:
        raise ValueError('Media path is outside the asset library.')
    return path, path.relative_to(root).as_posix()


def checksum(data): return hashlib.sha256(data).hexdigest()


@contextmanager
def lease(paths, root=ROOT):
    if not enabled(root): yield; return
    owner = uuid.uuid4().hex
    relative = [contained(path,root)[1] for path in paths]
    with closing(database(root)) as db, db:
        for name in relative: db.execute('INSERT INTO media_leases VALUES(?,?,?)',(name,owner,time.time()+3600))
    try: yield
    finally:
        with closing(database(root)) as db, db: db.execute('DELETE FROM media_leases WHERE owner=?',(owner,))


def archive(path, expected=None, root=ROOT, force=False):
    if not enabled(root) and not force: return None
    path, relative = contained(path,root)
    with lease([path],root):
        data = path.read_bytes()
        sha = checksum(data)
        if expected and sha != expected: raise ValueError('Local media checksum changed.')
        mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        key = 'bot/objects/sha256/'+sha
        now = time.time()
        with closing(database(root)) as db, db:
            old = db.execute('SELECT * FROM media_objects WHERE sha256=?',(sha,)).fetchone()
            db.execute('INSERT OR IGNORE INTO media_objects(sha256,object_key,mime,bytes) VALUES(?,?,?,?)',(sha,key,mime,len(data)))
            db.execute('INSERT INTO media_cache VALUES(?,?,?,?,1) ON CONFLICT(relative_path) DO UPDATE SET sha256=excluded.sha256,last_access=excluded.last_access', (relative,sha,now,now))
        if old and old['verified_at'] and not force: return dict(old)
        storage = client(root); bucket = settings(root)['R2_BUCKET']
        try:
            try:
                storage.put_object(Bucket=bucket,Key=key,Body=data,ContentType=mime,ContentLength=len(data),
                    StorageClass='STANDARD',IfNoneMatch='*',Metadata={'sha256':sha})
            except Exception as error:
                if getattr(error,'response',{}).get('ResponseMetadata',{}).get('HTTPStatusCode') != 412: raise
            remote = storage.get_object(Bucket=bucket,Key=key)
            try: recovered = remote['Body'].read(len(data)+1)
            finally: remote['Body'].close()
            if len(recovered) != len(data) or checksum(recovered) != sha: raise ValueError('R2 round-trip checksum mismatch.')
            with closing(database(root)) as db, db:
                db.execute('UPDATE media_objects SET verified_at=?,last_error=NULL WHERE sha256=?',(time.time(),sha))
            return {'sha256':sha,'object_key':key,'bytes':len(data),'verified_at':time.time()}
        except Exception as error:
            with closing(database(root)) as db, db: db.execute('UPDATE media_objects SET last_error=? WHERE sha256=?',(type(error).__name__,sha))
            raise RuntimeError('Media cloud archive is not verified; keep the local file and retry.') from None


def ensure_local(path, expected=None, root=ROOT):
    if not enabled(root): return Path(path) if Path(path).is_absolute() else Path(root)/path
    path, relative = contained(path,root)
    with lease([path],root), closing(database(root)) as db:
        row = db.execute('SELECT c.*,o.object_key,o.bytes,o.verified_at FROM media_cache c JOIN media_objects o USING(sha256) WHERE relative_path=?',(relative,)).fetchone()
        if path.exists():
            sha = checksum(path.read_bytes())
            if (expected and sha != expected) or (row and sha != row['sha256']): raise ValueError('Cached media checksum changed.')
            # Archive happens before review or by the maintenance worker, never
            # implicitly while an approval transaction is holding its DB lock.
            if row:
                with db: db.execute('UPDATE media_cache SET last_access=? WHERE relative_path=?',(time.time(),relative))
            return path
        if not row or not row['verified_at'] or (expected and expected != row['sha256']):
            raise RuntimeError('Missing verified media; reconcile storage instead of regenerating content.')
        storage = client(root)
        response = storage.get_object(Bucket=settings(root)['R2_BUCKET'],Key=row['object_key'])
        try: data = response['Body'].read(row['bytes']+1)
        finally: response['Body'].close()
        if len(data) != row['bytes'] or checksum(data) != row['sha256']: raise ValueError('Cloud media checksum mismatch.')
        path.parent.mkdir(parents=True,exist_ok=True)
        temporary = path.with_name(path.name+'.'+uuid.uuid4().hex+'.partial')
        try:
            with temporary.open('xb') as handle:
                handle.write(data); handle.flush(); os.fsync(handle.fileno())
            with db:
                db.execute('BEGIN IMMEDIATE')
                if path.exists() and checksum(path.read_bytes()) != row['sha256']: raise ValueError('Concurrent media replacement.')
                os.replace(temporary,path)
                db.execute('UPDATE media_cache SET last_access=? WHERE relative_path=?',(time.time(),relative))
        finally: temporary.unlink(missing_ok=True)
        return path


def prepare_managed(path, expected=None, root=ROOT, archive_first=False):
    """External provider caches retain their existing caller's file checks."""
    candidate=Path(path)
    try: contained(candidate,root)
    except ValueError: return candidate
    ensure_local(candidate,expected,root=root)
    if archive_first: archive(candidate,expected,root=root)
    return candidate


def paths_in(value, root=ROOT):
    result = set()
    def walk(item):
        if isinstance(item,dict):
            raw_sha = item.get('originalSha256')
            registry = (Path(root)/'data/media-storage.sqlite3').resolve()
            if isinstance(raw_sha,str) and len(raw_sha)==64 and registry.exists():
                with closing(sqlite3.connect(registry.as_uri()+'?mode=ro',uri=True)) as db:
                    for alias in db.execute("SELECT relative_path FROM media_cache WHERE sha256=? AND relative_path LIKE 'assets/owner-original/%'",(raw_sha,)):
                        result.add(contained(alias[0],root)[0])
            for child in item.values(): walk(child)
        elif isinstance(item,(list,tuple)):
            for child in item: walk(child)
        elif isinstance(item,str) and (item.replace('\\','/').startswith('assets/') or Path(item).is_absolute()):
            try: result.add(contained(item,root)[0])
            except (ValueError,OSError): pass
    walk(value)
    return result


def prepare_bundle(bundle, root=ROOT, archive_first=False):
    if not enabled(root): return
    paths = paths_in(bundle,root)
    # Owner provenance references its original normalized upload in the ledger.
    token = bundle.get('media',{}).get('illustration',{}).get('uploadToken') or bundle.get('illustration',{}).get('uploadToken')
    ledger = Path(root)/'data/newsroom.sqlite3'
    if token and ledger.exists():
        with closing(sqlite3.connect(ledger.as_uri()+'?mode=ro',uri=True)) as db:
            saved = db.execute('SELECT media FROM image_upload_sessions WHERE token=?',(token,)).fetchone()
            if saved and saved[0]: paths |= paths_in(json.loads(saved[0]),root)
    for path in paths:
        ensure_local(path,root=root)
        if archive_first: archive(path,root=root)


def draft_cache(function):
    @functools.wraps(function)
    def wrapped(db, ident, *args, **kwargs):
        root = function.__globals__['ROOT']
        if not enabled(root): return function(db,ident,*args,**kwargs)
        row = db.execute('SELECT bundle FROM drafts WHERE id=?',(ident,)).fetchone()
        bundle = json.loads(row[0]) if row else {}
        paths = paths_in(bundle,root)
        with lease(paths,root):
            prepare_bundle(bundle,root,archive_first=function.__name__=='request_review')
            return function(db,ident,*args,**kwargs)
    return wrapped


def refresh_references(root=ROOT):
    """Unknown/pending states pin files. A finished draft overrides stale run state."""
    ledger = (Path(root)/'data/newsroom.sqlite3').resolve()
    refs, pins = [], set()
    if ledger.exists():
        with closing(sqlite3.connect(ledger.as_uri()+'?mode=ro',uri=True)) as source:
            source.row_factory = sqlite3.Row
            names = {row[0] for row in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            draft_states = {row['id']:row['status'] for row in source.execute('SELECT id,status FROM drafts')} if 'drafts' in names else {}
            run_states = {row['id']:dict(row) for row in source.execute('SELECT id,status,draft_id FROM runs')} if 'runs' in names else {}
            for table in ('drafts','runs','video_jobs','video_credit_calls','image_upload_sessions','owner_image_selections'):
                if table not in names: continue
                for fetched in source.execute('SELECT * FROM '+table):
                    row = dict(fetched)
                    ident = str(row.get('id') or row.get('token') or row.get('job_id') or row.get('target_id') or 'unknown')
                    state = row.get('status',row.get('state','unknown'))
                    active = state not in TERMINAL
                    linked = row.get('draft_id') or row.get('result_draft_id')
                    if table!='video_jobs' and linked in draft_states and draft_states[linked] in TERMINAL: active = False
                    if table=='owner_image_selections':
                        target=row.get('target_id');run=run_states.get(target,{})
                        active = (draft_states.get(target,run.get('status')) not in TERMINAL and draft_states.get(run.get('draft_id')) not in TERMINAL)
                    value = dict(row)
                    for key,item in row.items():
                        if isinstance(item,str) and item.startswith(('{','[')):
                            try: value[key] = json.loads(item)
                            except ValueError: pass
                    for path in paths_in(value,root):
                        relative = contained(path,root)[1]
                        refs.append((table,ident,'media',relative))
                        if active: pins.add(relative)
                    if table=='video_jobs' and active:
                        # A resumable renderer also owns chunk/poster files not
                        # individually embedded in its immutable timeline JSON.
                        prefix='assets/video/'+ident+'/'
                        with closing(database(root)) as cache:
                            pins.update(row[0] for row in cache.execute('SELECT relative_path FROM media_cache WHERE relative_path LIKE ?',(prefix+'%',)))
            if 'publication_channels' in names:
                for channel in source.execute("SELECT draft_id FROM publication_channels WHERE state NOT IN ('published')"):
                    row = source.execute('SELECT bundle FROM drafts WHERE id=?',(channel[0],)).fetchone()
                    if row: pins.update(contained(path,root)[1] for path in paths_in(json.loads(row[0]),root))
            if 'facebook_story_jobs' in names:
                columns = {row[1] for row in source.execute('PRAGMA table_info(facebook_story_jobs)')}
                for fetched in source.execute('SELECT * FROM facebook_story_jobs'):
                    row = dict(fetched)
                    if row.get('status',row.get('state')) not in TERMINAL:
                        draft = source.execute('SELECT bundle FROM drafts WHERE id=?',(row.get('draft_id'),)).fetchone() if 'draft_id' in columns else None
                        if draft: pins.update(contained(path,root)[1] for path in paths_in(json.loads(draft[0]),root))
    now = time.time()
    with closing(database(root)) as db, db:
        db.execute('DELETE FROM media_refs')
        db.executemany('INSERT OR IGNORE INTO media_refs VALUES(?,?,?,?)',refs)
        for row in db.execute('SELECT relative_path,pinned FROM media_cache').fetchall():
            pinned = row['relative_path'] in pins
            db.execute('UPDATE media_cache SET pinned=?,unpinned_at=CASE WHEN pinned=1 AND ?=0 THEN ? ELSE unpinned_at END WHERE relative_path=?',(int(pinned),int(pinned),now,row['relative_path']))
    return pins


def inventory(root=ROOT):
    files = [path for path in (Path(root)/'assets').rglob('*') if path.is_file() and path.suffix.lower() in EXTENSIONS]
    with closing(database(root)) as db:
        rows = list(db.execute('SELECT c.*,o.verified_at,o.bytes FROM media_cache c JOIN media_objects o USING(sha256)'))
        missing = [row[0] for row in db.execute('SELECT DISTINCT relative_path FROM media_refs') if not (Path(root)/row[0]).exists() and not any(item['relative_path']==row[0] and item['verified_at'] for item in rows)]
    return {'files':len(files),'localBytes':sum(path.stat().st_size for path in files),
            'registered':len(rows),'verified':sum(bool(row['verified_at']) for row in rows),
            'pinned':sum(bool(row['pinned']) for row in rows),'missingReferenced':missing}


def backfill(root=ROOT, limit=None, force=False):
    results = []
    files = sorted(path for path in (Path(root)/'assets').rglob('*') if path.is_file() and path.suffix.lower() in EXTENSIONS)
    for path in files:
        if limit is not None and len(results) >= limit: break
        with closing(database(root)) as db:
            row = db.execute('SELECT c.sha256,o.verified_at FROM media_cache c JOIN media_objects o USING(sha256) WHERE relative_path=?',(contained(path,root)[1],)).fetchone()
        if row and row['verified_at']:
            if checksum(path.read_bytes()) != row['sha256']:
                results.append({'path':contained(path,root)[1],'state':'error','error':'LocalChecksumChanged'})
            continue
        try:
            record = archive(path,root=root,force=force)
            results.append({'path':contained(path,root)[1],'state':'verified','sha256':record['sha256']})
        except Exception as error: results.append({'path':contained(path,root)[1],'state':'error','error':type(error).__name__})
    refresh_references(root)
    return results


def prune(root=ROOT, dry_run=True, now=None):
    now = now or time.time()
    refresh_references(root)
    removed = []
    with closing(database(root)) as db:
        candidates = db.execute('SELECT c.*,o.verified_at,o.bytes,o.object_key FROM media_cache c JOIN media_objects o USING(sha256) WHERE c.pinned=0 AND o.verified_at IS NOT NULL').fetchall()
        for row in candidates:
            if max(row['last_access'],row['unpinned_at']) > now-7*86400: continue
            path, relative = contained(row['relative_path'],root)
            if not path.exists(): continue
            if dry_run: removed.append({'path':relative,'bytes':row['bytes']}); continue
            # Confirm cloud availability immediately before eviction. Hold a
            # lease while checking, then recheck all local guards under a lock.
            with lease([path],root):
                remote = client(root).get_object(Bucket=settings(root)['R2_BUCKET'],Key=row['object_key'])
                try: recovered = remote['Body'].read(row['bytes']+1)
                finally: remote['Body'].close()
                if len(recovered)!=row['bytes'] or checksum(recovered)!=row['sha256']: raise ValueError('Cloud copy not recoverable; local retained.')
            refresh_references(root)
            with db:
                db.execute('BEGIN IMMEDIATE')
                current = db.execute('SELECT * FROM media_cache WHERE relative_path=?',(relative,)).fetchone()
                leased = db.execute('SELECT 1 FROM media_leases WHERE relative_path=? AND expires>?',(relative,time.time())).fetchone()
                if not current or current['pinned'] or leased or max(current['last_access'],current['unpinned_at']) > now-7*86400: continue
                if checksum(path.read_bytes()) != current['sha256']: raise ValueError('Local cache changed; retained.')
                path.unlink(); removed.append({'path':relative,'bytes':row['bytes']})
    return removed


def maintenance(root=ROOT):
    if not enabled(root): return
    now = time.time()
    with closing(database(root)) as db, db:
        db.execute('BEGIN IMMEDIATE')
        last = db.execute("SELECT value FROM media_state WHERE name='maintenance-at'").fetchone()
        if last and now-float(last[0])<86400: return
        db.execute("INSERT OR REPLACE INTO media_state VALUES('maintenance-at',?)",(str(now),))
    def run():
        try:
            results = backfill(root,limit=8)
            config = json.loads((Path(root)/'data/media-storage.json').read_text('utf-8'))
            deleted = prune(root,dry_run=not config.get('cleanupEnabled'))
            status = {'at':time.time(),'results':results,'pruned':deleted}
            if config.get('retireBlob'):
                import website_bridge
                status['blobRetirement'] = website_bridge.send('POST','/storage',body={'operation':'retire'}).json()
        except Exception as error: status = {'at':time.time(),'error':type(error).__name__}
        with closing(database(root)) as db, db: db.execute("INSERT OR REPLACE INTO media_state VALUES('maintenance-result',?)",(json.dumps(status),))
    # The existing five-minute scheduler is a short-lived Python process.
    # Keep it alive until the daily cache/retirement worker has checkpointed.
    threading.Thread(target=run,name='media-storage-maintenance',daemon=False).start()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation',choices=['inventory','backfill','verify','prune'])
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--root',default=str(ROOT))
    args = parser.parse_args()
    root=Path(args.root).resolve()
    if args.operation=='inventory':
        refresh_references(root)
        result=inventory(root)
    elif args.operation=='backfill': result=backfill(root,force=True) if args.apply else inventory(root)
    elif args.operation=='prune': result=prune(root,dry_run=not args.apply)
    else:
        result=[]
        with closing(database(root)) as db:
            for row in db.execute('SELECT * FROM media_objects WHERE verified_at IS NOT NULL').fetchall():
                response=client(root).get_object(Bucket=settings(root)['R2_BUCKET'],Key=row['object_key'])
                try: data=response['Body'].read(row['bytes']+1)
                finally: response['Body'].close()
                if len(data)!=row['bytes'] or checksum(data)!=row['sha256']: raise ValueError('R2 media verification failed.')
                result.append({'sha256':row['sha256'],'verified':True})
    print(json.dumps(result,ensure_ascii=True))


if __name__=='__main__': main()
