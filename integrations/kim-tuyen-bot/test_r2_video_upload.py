import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import Mock, patch
import website_bridge as web
import video_bridge


class UploadProtocolTests(unittest.TestCase):
    def test_query_capability_is_covered_by_bridge_signature(self):
        response=Mock(status_code=200)
        config={'enabled':True,'origin':'https://www.vanghomnay.online','secret':'test-secret-at-least-32-characters'}
        with patch.object(web,'settings',return_value=config),patch.object(web.requests,'Session') as sessions:
            sessions.return_value.__enter__.return_value.send.return_value=response
            web.send('POST','/videos/upload-token?uploadProtocol=r2-put-v1',body={'test':'body'})
            request=sessions.return_value.__enter__.return_value.send.call_args.args[0]
        raw=request.body.encode() if isinstance(request.body,str) else request.body
        path='/api/editorial/integrations/hermes/videos/upload-token?uploadProtocol=r2-put-v1'
        expected=web.signature(config['secret'],'POST',path,request.headers['x-editorial-timestamp'],raw)
        self.assertEqual(request.headers['x-editorial-signature'],expected)

    def test_lost_upload_response_reads_existing_asset_before_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);job={'id':'job'};row={'id':'draft','root_id':'root','version':1}
            checkpoint={'render':{'outputPath':str(root/'assets/video/probe.mp4'),'sha256':'a'*64,'duration':60,'bytes':10},
                'voice':{'voice_id':'voice','model_id':'model'},'scriptSha256':'b'*64,'audioSha256':'c'*64,'sceneSha256':'d'*64,'plannedReviewDraftId':'child'}
            grant={'assetId':'asset','pathname':'editorial/video.mp4','status':'uploading','clientToken':None,'upload':{'provider':'r2','url':'https://private.example/signed'}}
            ready={'assetId':'asset','status':'ready'}
            responses=[Mock(json=lambda:grant),Mock(json=lambda:ready)]
            with patch.object(video_bridge,'ROOT',root),patch.object(web,'send',side_effect=responses) as send,patch.object(subprocess,'run',return_value=Mock(returncode=1,stdout='{"success":false}')) as helper:
                result=video_bridge.upload_video(job,row,checkpoint,time.monotonic()+100)
            self.assertEqual(result,ready);self.assertEqual(helper.call_count,1)
            self.assertEqual(send.call_args_list[1].args[1],'/videos/asset/complete')
            saved=json.loads((root/'assets/video/job/upload.json').read_text())
            self.assertEqual(set(saved),{'sha256','assetId','uploaded'})
            self.assertNotIn('private.example',json.dumps(saved))


class NodeGrantTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runtime=Path('C:/Users/LENOVO/kim-tuyen-ai')
        files=list((cls.runtime/'assets/video').rglob('*.mp4'))
        if not files:raise unittest.SkipTest('Existing local MP4 fixture is required')
        cls.file=files[0];cls.data=cls.file.read_bytes()
    def body(self):
        return {'path':str(self.file),'pathname':'editorial/videos/test.mp4','sha256':hashlib.sha256(self.data).hexdigest(),'bytes':len(self.data),
            'upload':{'provider':'r2','method':'PUT','url':'https://'+'a'*32+'.r2.cloudflarestorage.com/chart-gold-media-prod/editorial/videos/test.mp4?signature=test',
            'headers':{'content-type':'video/mp4','if-none-match':'*','content-length':str(len(self.data))}}}
    def run_helper(self,body):
        helper=(Path(__file__).parent/'video_upload.mjs').as_uri()
        program='globalThis.fetch=async()=>({ok:true,status:200});await import('+json.dumps(helper)+');'
        result=subprocess.run(['node','--input-type=module','-e',program],input=json.dumps(body),text=True,capture_output=True,timeout=10)
        return result,json.loads(result.stdout)
    def test_valid_grant_uses_stdin_and_retains_object_identity(self):
        result,value=self.run_helper(self.body())
        self.assertEqual(result.returncode,0);self.assertTrue(value['success']);self.assertEqual(value['pathname'],'editorial/videos/test.mp4')
    def test_sdk_virtual_host_grant_is_accepted(self):
        body=self.body()
        body['upload']['url']='https://chart-gold-media-prod.'+'a'*32+'.r2.cloudflarestorage.com/editorial/videos/test.mp4?signature=test'
        result,value=self.run_helper(body)
        self.assertEqual(result.returncode,0);self.assertTrue(value['success'])
    def test_virtual_host_for_another_bucket_is_rejected(self):
        body=self.body()
        body['upload']['url']='https://other-bucket.'+'a'*32+'.r2.cloudflarestorage.com/editorial/videos/test.mp4?signature=test'
        self.assertFalse(self.run_helper(body)[1]['success'])
    def test_untrusted_endpoint_is_rejected_before_network(self):
        body=self.body();body['upload']['url']='https://example.com/upload?signature=DO_NOT_LOG'
        result,value=self.run_helper(body)
        self.assertNotEqual(result.returncode,0);self.assertFalse(value['success']);self.assertNotIn('DO_NOT_LOG',result.stdout)
    def test_wrong_hash_and_overwrite_grants_are_rejected(self):
        body=self.body();body['sha256']='0'*64
        self.assertFalse(self.run_helper(body)[1]['success'])
        body=self.body();body['upload']['headers']['if-none-match']=''
        self.assertFalse(self.run_helper(body)[1]['success'])


if __name__=='__main__':unittest.main()
