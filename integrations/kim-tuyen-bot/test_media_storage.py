import hashlib
from contextlib import closing
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import media_storage as media


class Storage:
    def __init__(self): self.objects = {}; self.puts = 0
    def put_object(self, **kwargs):
        self.puts += 1
        self.objects.setdefault(kwargs['Key'], kwargs['Body'])
    def get_object(self, **kwargs): return {'Body':io.BytesIO(self.objects[kwargs['Key']])}


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root/'data').mkdir();(self.root/'assets/approved').mkdir(parents=True)
        (self.root/'data/media-storage.json').write_text(json.dumps({'enabled':True,'cleanupEnabled':True}))
        self.path = self.root/'assets/approved/photo.png'
        self.original = b'approved-photo-bytes';self.path.write_bytes(self.original)
        self.sha = hashlib.sha256(self.original).hexdigest()
        self.remote = Storage()
        self.patches = [patch.object(media,'client',return_value=self.remote),patch.object(media,'settings',return_value={'R2_BUCKET':'chart-gold-media-staging'})]
        [p.start() for p in self.patches]
    def tearDown(self):
        [p.stop() for p in self.patches];self.temp.cleanup()
    def archive(self): return media.archive(self.path,self.sha,root=self.root)
    def age(self):
        with closing(media.database(self.root)) as db, db:
            db.execute('UPDATE media_cache SET last_access=?,unpinned_at=?,pinned=0',(time.time()-9*86400,time.time()-9*86400))
    def test_verified_roundtrip_restores_same_path_and_bytes(self):
        self.archive();self.path.unlink()
        self.assertEqual(media.ensure_local(self.path,self.sha,root=self.root),self.path)
        self.assertEqual(self.path.read_bytes(),self.original)
    def test_cloud_corruption_never_installs_a_local_file(self):
        record=self.archive();self.path.unlink();self.remote.objects[record['object_key']]=b'bad'
        with self.assertRaises(ValueError):media.ensure_local(self.path,self.sha,root=self.root)
        self.assertFalse(self.path.exists());self.assertFalse(list(self.path.parent.glob('*.partial')))
    def test_changed_local_bytes_are_not_silently_replaced(self):
        self.archive();self.path.write_bytes(b'changed')
        with self.assertRaises(ValueError):media.ensure_local(self.path,self.sha,root=self.root)
        self.assertEqual(self.path.read_bytes(),b'changed')
    def test_dry_run_does_not_evict_and_apply_can_restore(self):
        self.archive();self.age()
        self.assertEqual(len(media.prune(self.root)),1);self.assertTrue(self.path.exists())
        self.assertEqual(len(media.prune(self.root,dry_run=False)),1);self.assertFalse(self.path.exists())
        media.ensure_local(self.path,self.sha,root=self.root);self.assertEqual(self.path.read_bytes(),self.original)
    def test_active_reader_lease_prevents_eviction(self):
        self.archive();self.age()
        with media.lease([self.path],self.root):self.assertEqual(media.prune(self.root,dry_run=False),[])
        self.assertTrue(self.path.exists())
    def test_recent_access_prevents_eviction(self):
        self.archive();self.age();media.ensure_local(self.path,self.sha,root=self.root)
        self.assertEqual(media.prune(self.root,dry_run=False),[])
    def test_pending_draft_and_unknown_state_pin_but_published_can_age_out(self):
        self.archive();self.age()
        db=sqlite3.connect(self.root/'data/newsroom.sqlite3')
        db.execute('CREATE TABLE drafts(id TEXT,status TEXT,bundle TEXT)')
        bundle=json.dumps({'media':{'path':'assets/approved/photo.png','sha256':self.sha}})
        db.execute('INSERT INTO drafts VALUES(?,?,?)',('draft','pending',bundle));db.commit()
        self.assertEqual(media.prune(self.root,dry_run=False),[])
        db.execute("UPDATE drafts SET status='future-state'");db.commit()
        self.assertEqual(media.prune(self.root,dry_run=False),[])
        db.execute("UPDATE drafts SET status='published'");db.commit();db.close()
        media.refresh_references(self.root);self.age()
        self.assertEqual(len(media.prune(self.root,dry_run=False)),1)
    def test_paid_audio_restore_does_not_dispatch_tts(self):
        audio=self.root/'assets/approved/audio.mp3';audio.write_bytes(b'paid-audio')
        sha=hashlib.sha256(audio.read_bytes()).hexdigest()
        media.archive(audio,sha,root=self.root);audio.unlink()
        media.ensure_local(audio,sha,root=self.root)
        self.assertEqual(audio.read_bytes(),b'paid-audio');self.assertEqual(self.remote.puts,1)
    def test_approval_bundle_and_timeline_are_not_changed(self):
        bundle={'media':{'path':'assets/approved/photo.png','sha256':self.sha},'videoTimeline':[{'audioPath':str(self.path)}]}
        before=json.dumps(bundle,sort_keys=True)
        media.prepare_bundle(bundle,self.root,archive_first=True)
        self.assertEqual(json.dumps(bundle,sort_keys=True),before)
    def test_no_delete_when_cloud_copy_is_corrupt(self):
        record=self.archive();self.age();self.remote.objects[record['object_key']]=b'corrupt'
        with self.assertRaises(ValueError):media.prune(self.root,dry_run=False)
        self.assertTrue(self.path.exists())
    def test_path_traversal_is_rejected(self):
        with self.assertRaises(ValueError):media.ensure_local('../escape.png',root=self.root)
    def test_provider_cache_outside_assets_keeps_its_existing_bounded_reader(self):
        import editorial_images
        source=self.root/'provider-cache.png';source.write_bytes(b'provider-image')
        with patch.object(media,'ROOT',self.root):
            self.assertEqual(editorial_images._read_image(source),b'provider-image')
    def test_image_reader_hydrates_a_managed_cache_miss(self):
        import editorial_images
        self.archive();self.path.unlink()
        with patch.object(media,'ROOT',self.root):
            self.assertEqual(editorial_images._read_image(self.path),self.original)
    def test_resumable_video_job_pins_its_render_chunks(self):
        chunk=self.root/'assets/video/job/.render-state/chunk.mp4';chunk.parent.mkdir(parents=True);chunk.write_bytes(b'render-chunk')
        media.archive(chunk,root=self.root)
        db=sqlite3.connect(self.root/'data/newsroom.sqlite3')
        db.execute('CREATE TABLE drafts(id TEXT,status TEXT,bundle TEXT)')
        db.execute('CREATE TABLE video_jobs(id TEXT,draft_id TEXT,status TEXT,checkpoint TEXT)')
        db.execute('INSERT INTO drafts VALUES(?,?,?)',('parent','published','{}'))
        db.execute('INSERT INTO video_jobs VALUES(?,?,?,?)',('job','parent','failed','{}'));db.commit();db.close()
        self.assertIn('assets/video/job/.render-state/chunk.mp4',media.refresh_references(self.root))
    def test_short_lived_scheduler_waits_for_maintenance_checkpoint(self):
        code="""import sys,time,json
from pathlib import Path
from unittest.mock import patch
import media_storage as m
def backfill(*args,**kwargs):time.sleep(0.2);return []
with patch.object(m,'backfill',side_effect=backfill),patch.object(m,'prune',return_value=[]):
 m.maintenance(Path(sys.argv[1]))
"""
        result=subprocess.run([sys.executable,'-c',code,str(self.root)],capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)
        with closing(media.database(self.root)) as db:
            row=db.execute("SELECT value FROM media_state WHERE name='maintenance-result'").fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(json.loads(row[0])['pruned'],[])


if __name__=='__main__':unittest.main()
