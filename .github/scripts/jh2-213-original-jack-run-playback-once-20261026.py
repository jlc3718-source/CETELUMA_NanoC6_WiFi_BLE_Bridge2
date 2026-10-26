"""One original Jack Run playback on 2.0.13. Never erase custom effects or flash firmware."""
import json,base64,subprocess,urllib.request,time,io,hashlib
from collections import Counter
out={'test':'original-eight-pose-Jack-Run-Nano-smooth-2.0.13','firmwareFlashes':0,'erases':0,'nativeEffectWrites':0,'assetCommands':0,'physicalVisualConfirmed':False}
env=dict(v.split('=',1) for v in json.loads(subprocess.check_output(['docker','inspect','jason-home'],text=True))[0]['Config']['Env'] if '=' in v)
cookie=''
def request(path,body=None,binary=False):
 global cookie
 headers={'Content-Type':'application/json',**({'Cookie':cookie} if cookie else {})}
 req=urllib.request.Request('http://127.0.0.1:8081'+path,
      data=json.dumps(body).encode() if body is not None else None,
      headers=headers,method='POST' if body is not None else 'GET')
 with urllib.request.urlopen(req,timeout=65) as r:
  if path=='/api/session':cookie=r.headers['Set-Cookie'].split(';')[0]
  return r.read() if binary else json.load(r)
request('/api/session',{'token':env['JASON_HOME_API_TOKEN']})
def status():return request('/api/curtain/status')
s=status();c=s.get('curtain') or {}
out['before']={'firmware':s.get('firmware'),'connected':c.get('connected'),'mtu':c.get('mtu'),'queued':s.get('queued'),'streaming':s.get('relayStreaming'),'nativeAssetActive':c.get('nativeAssetActive')}
assert s.get('online') and s.get('firmware')=='2.0.13' and c.get('connected') and int(c.get('mtu') or 0)>=500 and s.get('queued')==0 and s.get('relayStreaming')==False,'Refuse playback on abnormal baseline'
try:from PIL import Image
except ImportError:raise RuntimeError('Pillow unavailable on Oracle worker; no BLE command sent')
key='jacklanternanimated-8e3f74948a71e03508d7eaea'
images=[]
for i in range(8):
 raw=request('/api/curtain/internet-art/gif?id='+key+'&frame='+str(i),binary=True)
 img=Image.open(io.BytesIO(raw)).convert('RGBA').resize((40,40),Image.Resampling.NEAREST)
 images.append(img.tobytes())
out['sourceFrames']=len(images)
out['rawDistinctFrames']=len(set(hashlib.sha256(img).digest() for img in images))
assert out['rawDistinctFrames']>=4,'Source animation was unexpectedly static'
bins={}
for im in images:
 for off in range(0,6400,4):
  r,g,b,a=im[off:off+4]
  if a<80 or max(r,g,b)<35:continue
  key=(r>>4,g>>4,b>>4)
  v=bins.setdefault(key,[0,0,0,0]);v[0]+=r;v[1]+=g;v[2]+=b;v[3]+=1
palette=[(0,0,0)]+[tuple(round(v[z]/v[3]) for z in range(3)) for v in sorted(bins.values(),key=lambda v:v[3],reverse=True)[:7]]
frames=[]
for img in images:
 outbytes=bytearray()
 for p in range(0,6400,4):
  r,g,b,a=img[p:p+4]
  best=0
  if a>=80 and max(r,g,b)>=35:
   best=min(range(1,len(palette)),key=lambda c:2*(r-palette[c][0])**2+3*(g-palette[c][1])**2+2*(b-palette[c][2])**2)
  outbytes.extend((*palette[best],255))
 frames.append(base64.b64encode(outbytes).decode('ascii'))
out['quantizedDistinctFrames']=len(set(frames))
assert out['quantizedDistinctFrames']>=4,'Palette collapsed most poses; no BLE command sent'
diff=[]
for i in range(8):
 a=base64.b64decode(frames[i]);b=base64.b64decode(frames[(i+1)%8])
 diff.append(sum(a[k:k+3]!=b[k:k+3] for k in range(0,6400,4)))
out['changedPixelsPerTransition']=diff
out['palette']=palette
# Nine images: eight true source poses and a matching seam-closing first pose.
# Exactly one generated asset and one play command. No retry/erase/firmware.
package=request('/api/curtain/assets',{'name':'Jack Run 8-pose smooth 2.0.13 test','seamlessAnimation':True,'frames':frames+[frames[0]],'delays':[125]*8+[40],'loop':True})
out['package']={k:package.get(k) for k in ('sha256','bytes','frames','format','packetCount','changedPixels')}
if not package.get('ok') or int(package.get('bytes') or 999999)>int(c.get('nanoLocalCacheAvailableBytes') or 0):raise RuntimeError('Compiled package unsafe for Nano current cache capacity')
play=request('/api/curtain/call',{'action':'asset','payload':{'sha256':package['sha256']},'idempotencyKey':'jh2-jack-run-smooth-213-20261026-only'})
out['assetCommands']=1;out['playCommandId']=play.get('commandId')
assert isinstance(play.get('commandId'),int)
for i in range(80):
 time.sleep(0.6)
 command=request('/api/curtain/command?id='+str(play['commandId'])).get('command') or {}
 if command.get('state') in ('applied','failed','expired','superseded'):
  out['ack']={'state':command.get('state'),'result':command.get('result')}
  break
else:out['ack']={'state':'timeout'}
if out['ack'].get('state')=='applied':
 observations=[]
 for i in range(6):
  time.sleep(2)
  st=status();dev=st.get('curtain') or {}
  observations.append({'firmware':st.get('firmware'),'connected':dev.get('connected'),'streaming':st.get('relayStreaming'),'queue':st.get('queued')})
 out['observations']=observations
 out['result']='NANO_CACHED_ANIMATION_STARTED_VISUAL_UNCONFIRMED' if all(x['connected'] and x['firmware']=='2.0.13' for x in observations) else 'POSTPLAY_CONNECTION_UNSTABLE'
else:out['result']='NANO_ASSET_NOT_CONFIRMED'
print('JH2_213_SMOOTH_JACK_RUN_RESULT '+json.dumps(out),flush=True)
