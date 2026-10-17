"""Transfer immutable MP4s without sending large bodies through Next.js."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import uuid
import website_bridge as web

ROOT=Path(__file__).resolve().parent


def descriptor(row,checkpoint):
    rendering=checkpoint['render'];voice=checkpoint['voice']
    return {'sha256':rendering['sha256'],'scriptSha256':checkpoint['scriptSha256'],
        'audioSha256':checkpoint['audioSha256'],'sceneSha256':checkpoint['sceneSha256'],
        'voiceId':voice['voice_id'],'modelId':voice['model_id'],'duration':rendering['duration'],
        'width':1080,'height':1920,'fps':30,'bytes':rendering['bytes']}


def upload_video(job,row,checkpoint,deadline=None):
    video=descriptor(row,checkpoint)
    import media_storage
    media_storage.ensure_local(checkpoint['render']['outputPath'],video['sha256'],root=ROOT)
    media_storage.archive(checkpoint['render']['outputPath'],video['sha256'],root=ROOT)
    folder=ROOT/'assets/video'/job['id'];state_path=folder/'upload.json'
    if state_path.exists():
        state=json.loads(state_path.read_text(encoding='utf-8'))
        if state.get('sha256')!=video['sha256']:raise ValueError('Video đã thay đổi sau khi xin quyền upload.')
    else:state={'sha256':video['sha256']}
    token=web.send('POST','/videos/upload-token?uploadProtocol=r2-put-v1',body={'rootId':row['root_id'] or row['id'],
        'draftId':checkpoint['plannedReviewDraftId'],'externalRevision':row['version']+1,'video':video}).json()
    if state.get('assetId') and state['assetId']!=token['assetId']:
        raise ValueError('Asset đã đổi identity; cần đối soát upload.')
    state['assetId']=token['assetId']
    if token.get('status')=='ready':state['uploaded']=True
    from video_workflow import write_json
    write_json(state_path,state)
    if not state.get('uploaded'):
        options={'cwd':ROOT,'text':True,'encoding':'utf-8',
                 'stdout':subprocess.PIPE,'stderr':subprocess.PIPE,
                 'env':dict(os.environ,PYTHONIOENCODING='utf-8')}
        if os.name=='nt':options['creationflags']=subprocess.CREATE_NO_WINDOW
        timeout=min(180,max(1,deadline-time.monotonic())) if deadline else 180
        body={'path':checkpoint['render']['outputPath'],'pathname':token['pathname'],'clientToken':token.get('clientToken'),
              'upload':token.get('upload'),'sha256':video['sha256'],'bytes':video['bytes']}
        # Only the child stdin receives the scoped token, never argv/logs/files.
        process=subprocess.run(['node',str(ROOT/'video_upload.mjs')],input=json.dumps(body),timeout=timeout,**options)
        try:result=json.loads(process.stdout)
        except ValueError:raise RuntimeError('Upload video chưa trả kết quả; cần đọc lại asset trước khi thử.') from None
        if process.returncode or not result.get('success'):
            # Lost upload response may still have completed. Ask server to read
            # the immutable asset before any further upload attempt.
            try:
                completed=web.send('POST','/videos/'+token['assetId']+'/complete',body={}).json()
                state['uploaded']=True;write_json(state_path,state);return completed
            except Exception:raise RuntimeError('Chưa xác nhận upload video; giữ file và asset để tiếp tục.') from None
        state['uploaded']=True;write_json(state_path,state)
    return web.send('POST','/videos/'+token['assetId']+'/complete',body={}).json()


def playback_url(asset_id,package_id):
    return web.send('POST','/videos/'+asset_id+'/url',body={'packageId':package_id}).json()['url']
