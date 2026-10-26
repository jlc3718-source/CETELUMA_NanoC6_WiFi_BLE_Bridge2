import json,subprocess,urllib.request,base64,time,hashlib,math
out={'cid':85397,'sha256':'70d1ecef5d54a6d368f60a6713023844d57e274a4e3c0318e12c06e9efbd570d','firmwareChanges':0,'erases':0,'uploadAttempts':0,'verifiedSaved':False,'visualConfirmed':False}
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
 s=req('/api/curtain/status')
 if s.get('firmware')!='2.0.11' or not s.get('online') or not s.get('curtain',{}).get('connected') or s.get('queued') or s.get('relayStreaming'):
  raise RuntimeError('Nano not ready for native local commit')
 pending=s.get('assetRetention',{}).get('pending') or {}
 if pending.get('cid')!=85397 or pending.get('sha256')!=out['sha256'] or pending.get('bytes')!=8192:
  raise RuntimeError('Original eight-pose registered file no longer pinned on Oracle')
 for attempt in range(3):
  before=catalog('type3eight85397-commit-pre-catalog-'+str(attempt))
  state=req('/api/curtain/status')
  if len(before)>=90 and state.get('curtain',{}).get('nativeTargetSectionComplete'):break
 else:raise RuntimeError('Fresh complete target controller catalog unavailable, commit blocked')
 saved_old=[x for x in before if x['cid'] in (84268,83928,85391)]
 if len(saved_old)!=3 or any(x['cid']==85397 for x in before):
  raise RuntimeError('CID85397 occupied or protected 4K controls missing, no native BLE writes')
 out['beforeCount']=len(before);out['protectedBefore']=saved_old
 out['freshTargetSectionComplete']=True
 q=req('/api/curtain/call',{'action':'nativeSlotCommit','payload':{'sha256':out['sha256'],'cid':85397},
     'idempotencyKey':'original-eight-type3-85397-local-native-commit-one-attempt'})
 ident=q.get('commandId');assert isinstance(ident,int)
 out['commitCommandId']=ident;out['uploadAttempts']=1
 # BLE upload is performed entirely on the Nano. Oracle polling errors do not
 # authorize a second write; only controller catalog readback can prove success.
 for _ in range(155):
  time.sleep(1)
  try:reply=req('/api/curtain/command?id='+str(ident))['command']
  except Exception as e:
   out['pollInterruption']=str(e)[:100];continue
  if reply['state'] in ('applied','failed','expired','superseded'):
   out['commitAck']={'state':reply['state'],'result':reply.get('result')}
   break
 time.sleep(2)
 for n in range(2):
  rows=catalog('type3eight85397-commit-post-catalog-'+str(n))
  target=[x for x in rows if x['cid']==85397]
  protected=[x for x in rows if x['cid'] in (84268,83928,85391)]
  out['read'+str(n+1)]={'count':len(rows),'target':target,'protected':protected}
 t1=out['read1']['target'];t2=out['read2']['target']
 out['verifiedSaved']=len(t1)==len(t2)==1 and t1[0]['slot']==t2[0]['slot'] and len(out['read1']['protected'])==len(out['read2']['protected'])==3
 out['result']='EIGHT_POSE_NATIVE_SAVED_ON_SMARTDAWN' if out['verifiedSaved'] else 'NATIVE_EIGHT_NOT_CONFIRMED'
except Exception as e:
 out['result']='COMMIT_OR_CATALOG_CHECK_FAILED'
 out['error']=str(e)
print('JH2_TYPE3_EIGHT_NANO_LOCAL_COMMIT',json.dumps(out,default=str))
