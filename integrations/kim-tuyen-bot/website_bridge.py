"""Signed server-to-server requests. This module never invents an approval."""
import hashlib
import hmac
import json
from pathlib import Path
import time
from urllib.parse import urlsplit
import requests
from contextlib import contextmanager
from contextvars import ContextVar
from workflow_control import ensure_active

ROOT = Path(__file__).resolve().parent
PREFIX = '/api/editorial/integrations/hermes'
_creation_deadline = ContextVar('creation_deadline', default=None)

@contextmanager
def creation_budget(deadline):
    token = _creation_deadline.set(deadline)
    try:yield
    finally:_creation_deadline.reset(token)

def request_timeout(default=30):
    deadline = _creation_deadline.get()
    if deadline is None:return default
    remaining = deadline-time.monotonic()
    if remaining <= 0:raise TimeoutError('Đã hết thời gian xử lý được cấu hình trước khi gọi website.')
    return min(default,remaining)

class BridgeError(RuntimeError):
    def __init__(self, message, status=503):
        super().__init__(message)
        self.status = status

def settings():
    value = json.loads((ROOT/'bridge-secret.json').read_text(encoding='utf-8'))
    if value.get('origin') != 'https://www.vanghomnay.online':
        raise BridgeError('Website bridge origin is not the approved destination', 400)
    return value

def enabled():
    path=ROOT/'bridge-secret.json'
    return path.exists() and bool(json.loads(path.read_text(encoding='utf-8')).get('enabled'))

def signature(secret,method,path,timestamp,body):
    data='\n'.join([method.upper(),path,str(timestamp),hashlib.sha256(body).hexdigest()])
    return hmac.new(secret.encode(),data.encode(),hashlib.sha256).hexdigest()

def send(method,path,body=None,files=None):
    ensure_active()
    config=settings()
    if not config.get('enabled'): raise BridgeError('Tích hợp hai kênh chưa bật',503)
    url=config['origin']+PREFIX+path
    req=requests.Request(method,url,json=body,files=files).prepare()
    raw=req.body or b''
    if isinstance(raw,str):raw=raw.encode()
    ts=str(int(time.time()))
    req.headers.update({'x-editorial-client':'kim-tuyen-newsroom','x-editorial-timestamp':ts,
                        'x-editorial-signature':signature(config['secret'],method,urlsplit(url).path+('?' + urlsplit(url).query if urlsplit(url).query else ''),ts,raw)})
    with requests.Session() as session:
        response=session.send(req,timeout=request_timeout(),allow_redirects=False)
    if response.status_code!=200:
        try:detail=response.json().get('error','Website chưa sẵn sàng')
        except ValueError:detail='Website chưa sẵn sàng'
        raise BridgeError(str(detail)[:400],response.status_code)
    return response

def prepare(manifest,image):
    return send('POST','/prepare',files={'manifest':(None,json.dumps(manifest,ensure_ascii=False,separators=(',',':')),'application/json'),
                                     'image':('approved.png',image,'image/png')}).json()
def status(package_id):return send('GET','/packages/'+package_id).json()
def media(package_id):return send('GET','/packages/'+package_id+'/media').content
def publish(package_id,approval):return send('POST','/packages/'+package_id+'/publish',body=approval).json()

def verify_public(receipt):
    config=settings();url=receipt['url'];image=receipt['imageUrl']
    if urlsplit(url).netloc!=urlsplit(config['origin']).netloc or urlsplit(image).netloc!=urlsplit(config['origin']).netloc:
        raise BridgeError('Public URL is not the approved website',409)
    page=requests.get(url,timeout=30,allow_redirects=False)
    if page.status_code!=200 or ('data-revision-id="'+receipt['revisionId']+'"') not in page.text or ('data-content-sha256="'+receipt['contentSha256']+'"') not in page.text:
        raise BridgeError('Website đã lưu nhưng chưa đọc lại đúng revision',503)
    photo=requests.get(image,timeout=30,allow_redirects=False)
    if photo.status_code!=200 or photo.headers.get('content-type','').split(';')[0]!='image/png' or hashlib.sha256(photo.content).hexdigest()!=receipt['imageSha256']:
        raise BridgeError('Ảnh website chưa truy cập được hoặc sai hash',503)
    return True
