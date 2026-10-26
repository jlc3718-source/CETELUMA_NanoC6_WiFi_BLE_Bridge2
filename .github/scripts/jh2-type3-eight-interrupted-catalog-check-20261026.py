import json,subprocess,urllib.request,base64,time,hashlib,math
out={'cid':85397,'firmwareChanges':0,'erases':0,'uploadAttempts':0}
env=dict(x.split('=',1) for x in json.loads(subprocess.check_output(['docker','inspect','jason-home'],text=True))[0]['Config']['Env'] if '=' in x)
cookie=''
def req(path,body=None):
 global cookie
 r=urllib.request.Request('http://127.0.0.1:8081'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**({'Cookie':cookie} if cookie else {})})
 with urllib.request.urlopen(r,timeout=30) as z:
  if path=='/api/session':cookie=z.headers['Set-Cookie'].split(';')[0]
  return json.load(z)
req('/api/session',{'token':env['JASON_HOME_API_TOKEN']})
def call(action,payload,key):
 c=req('/api/curtain/call',{'action':action,'payload':payload,'idempotencyKey':key})['commandId']
 for i in range(100):
  time.sleep(.5);d=req('/api/curtain/command?id='+str(c))['command']
  if d['state'] in ('applied','failed','expired','superseded'):
   if d['state']!='applied':raise RuntimeError(str(d.get('result')))
   return c
 raise RuntimeError('command timeout')
def vint(b,p):
 v=0
 for k in range(10):
  c=b[p];p+=1;v|=(c&127)<<(7*k)
  if c<128:return v,p
 raise ValueError('varint')
def fields(b):
 d={};p=0
 while p<len(b):
  t,p=vint(b,p);k,w=t>>3,t&7
  if w==0:v,p=vint(b,p)
  elif w==2:
   n,p=vint(b,p);v=b[p:p+n];p+=n
  else:raise ValueError('wire')
  d.setdefault(k,[]).append(v)
 return d
def messages(since):
 notes=req('/api/curtain/notifications?since='+str(since))['notifications'];groups={};result=[]
 for n in notes:
  try:b=base64.b64decode(n.get('data',''))
  except:continue
  if len(b)<5 or b[3]!=0 or not 0<b[1]<100 or b[2]>=b[1]:continue
  groups.setdefault((b[0],b[1]),{})[b[1]-b[2]-1]=b[4:]
 for (ident,total),g in groups.items():
  if len(g)!=total:continue
  b=b''.join(g[i] for i in range(total))
  if len(b)<20:continue
  try:result.append((int.from_bytes(b[6:8],'big'),b[14],fields(b[20:])))
  except:pass
 return result
def cursor():return max([n['id'] for n in req('/api/curtain/notifications?since=0')['notifications']]+[0])
def catalog(key):
 mark=cursor()
 raw=bytes.fromhex('0a010000f004000a00000b58000000000000000000000000')
 call('rawWrite',{'uuid':'01020074-1972-1925-3022-077119514e44','data':base64.b64encode(raw).decode()},key)
 time.sleep(5);entries=[]
 for op,rcode,f in messages(mark):
  if op!=2904:continue
  for item in f.get(1,[]):
   if not isinstance(item,bytes):continue
   d=fields(item);entries.append({k:d.get(i,[0])[0] for i,k in [(1,'id'),(2,'type'),(3,'slot'),(4,'cid')]})
 return entries
try:
 snap=req('/api/curtain/status')
 out['status']={'firmware':snap.get('firmware'),'online':snap.get('online'),'ble':snap.get('curtain',{}).get('connected'),'queue':snap.get('queued')}
 if snap.get('firmware')!='2.0.11' or not snap.get('online') or not snap.get('curtain',{}).get('connected'):
  raise RuntimeError('Nano not healthy: read only no effect write')
 rows=catalog('type3eight85397-reconcile-interrupted-once')
 out['catalogCount']=len(rows)
 out['protected']=[x for x in rows if x['cid'] in (83928,84268,85391)]
 out['target']=[x for x in rows if x['cid']==85397]
 out['result']='SAVED' if len(out['target'])==1 else ('ABSENT' if not out['target'] else 'AMBIGUOUS')
except Exception as e:out['result']='READ_FAILED';out['error']=str(e)
print('JH2_TYPE3_EIGHT_INTERRUPTED_RECONCILE',json.dumps(out))
