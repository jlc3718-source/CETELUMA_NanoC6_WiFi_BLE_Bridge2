import json,subprocess,urllib.request,base64,time,hashlib,math
out={'cid':85391,'slot':34,'firmwareChanges':0,'erases':0,'uploadAttempts':0,'playAttempts':0,'physicalVisualConfirmation':False}
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
 status=req('/api/curtain/status')
 if status.get('firmware')!='2.0.10' or not status.get('online') or not status.get('curtain',{}).get('connected') or status.get('queued') or status.get('relayStreaming'):
  raise RuntimeError('Refuse playback while Nano disconnected/busy or active looping')
 before=catalog('type3four85391-play-preinventory')
 target=[x for x in before if x.get('cid')==85391]
 if len(before)<90 or len(target)!=1 or target[0]['slot']!=34 or target[0]['id']!=89 or not any(x['cid']==83928 for x in before) or not any(x['cid']==84268 for x in before):
  raise RuntimeError('New Type3 effect missing or controller slot/catalog changed')
 def vi(n):
  a=[]
  while n>127:a.append((n&127)|128);n>>=7
  return bytes(a+[n])
 def field(k,v):return vi(k*8)+vi(v)
 # Encapsulated native 2606: [4 byte link envelope][20 byte DDP command][protobuf CID and slot].
 cmd=bytearray(bytes.fromhex('0a010000f004000a00000b58000000000000000000000000'))
 cmd[10]=2606>>8;cmd[11]=2606&255
 cmd.extend(field(1,85391)+field(2,34))
 mark=cursor()
 out['playAttempts']=1
 out['command']=call('rawWrite',{'uuid':'01020074-1972-1925-3022-077119514e44','data':base64.b64encode(cmd).decode()},'type3four85391-play-cid-slot-once')
 time.sleep(4)
 out['playbackReplies']=[{'opcode':op,'rcode':rc,'fields':fld} for op,rc,fld in messages(mark) if op in (2606,2610,2630,2105)]
 out['statusAfterPlay']=req('/api/curtain/status')
 out['result']='PLAY_SENT_TELEMETRY_RECORDED_VISUAL_UNCONFIRMED'
except Exception as e:
 out['result']='PLAYBACK_TEST_FAILED';out['error']=str(e)
print('JH2_TYPE3_FOUR_PLAYBACK',json.dumps(out,default=str))
