"""Install the tested bot source while its dedicated gateway is stopped."""
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import time

project=Path(__file__).resolve().parent.parent
stage=project/'integrations/kim-tuyen-bot'
runtime=Path('C:/Users/LENOVO/kim-tuyen-ai')
baseline=project/'outputs/r2-migration-20261017/bot-baseline'
changed=['newsroom.py','dual_channel.py','editorial_images.py','owner_images.py',
         'video_workflow.py','elevenlabs_video.py','website_bridge.py','video_bridge.py','video_upload.mjs']
added=['media_storage.py','test_media_storage.py','test_r2_video_upload.py','requirements-storage.txt']
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
active=sqlite3.connect((runtime/'data/newsroom.sqlite3').as_uri()+'?mode=ro',uri=True)
if active.execute('SELECT count(*) FROM leases WHERE expires>?',(time.time(),)).fetchone()[0]:
    active.close();raise RuntimeError('A newsroom worker is still holding a live lease.')
active.close()
for name in changed:
    if sha(runtime/name)!=sha(baseline/name):raise RuntimeError('Bot source changed since baseline: '+name)
registry=sqlite3.connect(runtime/'data/media-storage.sqlite3')
pending=registry.execute('SELECT count(*) FROM media_objects WHERE verified_at IS NULL OR last_error IS NOT NULL').fetchone()[0]
if pending:raise RuntimeError('Unverified media remains; do not activate eviction.')
registry.close()
backup=runtime/'backups'/('r2-storage-'+str(int(time.time())))
backup.mkdir(parents=True)
for name in changed:shutil.copy2(runtime/name,backup/name)
db=sqlite3.connect(runtime/'data/newsroom.sqlite3');copy=sqlite3.connect(backup/'newsroom.sqlite3');db.backup(copy);copy.close();db.close()
for name in changed+added:shutil.copy2(stage/name,runtime/name)
(runtime/'data/media-storage.json').write_text(json.dumps({'enabled':True,'cleanupEnabled':True,'retentionDays':7,'retireBlob':False},indent=2))
report={'at':time.time(),'backup':str(backup),'files':{name:sha(runtime/name) for name in changed+added},'enabled':True,'retentionDays':7}
(project/'outputs/r2-migration-20261017/bot-installation.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'installed':len(changed+added),'backup':str(backup),'cacheRetentionDays':7}))
