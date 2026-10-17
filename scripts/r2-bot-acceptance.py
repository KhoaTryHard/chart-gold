"""Round-trip real media in staging without AI, TTS, Telegram or Facebook."""
from contextlib import closing
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import time
import uuid
from PIL import Image

project=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('r2_acceptance_storage',Path('C:/Users/LENOVO/kim-tuyen-ai/media_storage.py'))
media=importlib.util.module_from_spec(spec);spec.loader.exec_module(media)
root=project/'work'/('r2-bot-acceptance-'+uuid.uuid4().hex)
(root/'data').mkdir(parents=True)
shutil.copy2(project/'work/r2-staging.secret',root/'data/r2-storage.secret')
(root/'data/media-storage.json').write_text(json.dumps({'enabled':True,'cleanupEnabled':True}))
folder=root/'assets/approved';folder.mkdir(parents=True)
image=folder/'probe.png';Image.new('RGB',(640,360),(121,83,47)).save(image)
source=Path('C:/Users/LENOVO/kim-tuyen-ai/assets')
paths=[image]
for suffix in ('.mp3','.mp4'):
    original=next(source.rglob('*'+suffix))
    target=folder/('probe'+suffix);shutil.copy2(original,target);paths.append(target)
storage=media.client(root);bucket=media.settings(root)['R2_BUCKET']
assert bucket=='chart-gold-media-staging'
created=[]
checks=[]
try:
    for path in paths:
        original=path.read_bytes();sha=hashlib.sha256(original).hexdigest();key='bot/objects/sha256/'+sha
        try: storage.head_object(Bucket=bucket,Key=key)
        except Exception as error:
            if error.response['ResponseMetadata']['HTTPStatusCode']!=404:raise
            created.append(key)
        media.archive(path,sha,root=root)
        path.unlink()
        media.ensure_local(path,sha,root=root)
        assert path.read_bytes()==original
        checks.append({'type':path.suffix,'bytes':len(original),'sha256':sha,'restored':True})
    media.refresh_references(root)
    with closing(media.database(root)) as db,db:
        db.execute('UPDATE media_cache SET last_access=?,unpinned_at=?',(time.time()-9*86400,time.time()-9*86400))
    pruned=media.prune(root,dry_run=False)
    assert len(pruned)==3
    for path in paths:
        assert not path.exists()
        media.ensure_local(path,root=root)
    report={'passed':True,'bucket':bucket,'checks':checks,'evictedAndRestored':len(pruned),'aiCalls':0,'ttsCalls':0,'publicationCalls':0}
    (project/'outputs/r2-migration-20261017/bot-staging-acceptance.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report))
finally:
    for key in created:storage.delete_object(Bucket=bucket,Key=key)
