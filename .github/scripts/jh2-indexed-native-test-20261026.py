import json,subprocess,urllib.request,base64,time,hashlib,math
out={'cid':85391,'firmwareChanges':0,'erases':0,'uploadAttempts':0}
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
 b=subprocess.check_output(['docker','exec','jason-home-2-web','cat','/tmp/jh2-jack-indexed-native.eff'])
 if len(b)!=16384 or hashlib.sha256(b).hexdigest()!='373830d3057c2e08d1c25dd80f9b35431d1a9d8c1fb0b4a647f5725d59ac538b':raise RuntimeError('candidate hash changed')
 status=req('/api/curtain/status')
 if status.get('firmware')!='2.0.10' or not status.get('online') or not status.get('curtain',{}).get('connected') or status.get('queued'):raise RuntimeError('preflight')
 call('assetStop',{},'indexed85391-stop-loop-once')
 before=catalog('indexed85391-pre-catalog-once');out['beforeCount']=len(before)
 if len(before)<89 or any(x['cid']==85391 for x in before):raise RuntimeError('catalog incomplete or CID occupied')
 def vi(n):
  a=[]
  while n>127:a.append((n&127)|128);n>>=7
  return bytes(a+[n])
 def f(k,v):return vi(k*8)+vi(v)
 def crc(b):
  c=0
  for x in b:
   c^=x
   for _ in range(8):c=((c<<1)^0x97 if c&128 else c<<1)&255
  return c
 parts=33;ident=234
 def envelope(left):return bytes([ident,parts>>8,parts&255,17,255,left>>8,left&255,0])
 filename=b'85391.eff'
 header=bytearray(envelope(parts)+f(1,ident)+f(2,0)+f(3,len(b))+f(4,0)+f(5,parts)+f(6,500)+f(7,0)+vi(66)+vi(len(filename))+filename+f(9,85391))
 header[7]=crc(header);mark=cursor()
 call('rawWrite',{'uuid':'27923001-2072-1925-3022-077119514e44','data':base64.b64encode(header).decode()},'indexed85391-header-once')
 time.sleep(1)
 replies=messages(mark);start=[x for x in replies if x[0]==2931]
 out['start']=[{'rcode':x[1],'fields':x[2]} for x in start]
 if not start or start[-1][2].get(1,[0])[0]!=0 or start[-1][2].get(2,[0])[0]!=ident:raise RuntimeError('start not confirmed')
 out['uploadAttempts']=1
 packets=[]
 for i in range(parts):
  payload=b[i*500:(i+1)*500];p=bytearray(envelope(parts-i-1)+payload);p[7]=crc(payload);packets.append(base64.b64encode(p).decode())
 for i in range(0,parts,8):call('nativeSlotWrite',{'packets':packets[i:i+8]},'indexed85391-data-'+str(i))
 time.sleep(3)
 out['replies']=[{'opcode':op,'rcode':rc,'fields':d} for op,rc,d in messages(mark) if op in (2931,2933,2934)]
 after=catalog('indexed85391-post-catalog-once')
 out['afterCount']=len(after);out['saved']=[x for x in after if x['cid']==85391]
 out['result']='CONTROLLER_CATALOG_CONFIRMS_NATIVE_FILE' if out['saved'] else 'NOT_SAVED'
except Exception as e:out['error']=str(e);out['result']='FAILED'
print('JH2_INDEXED_NATIVE_TEST',json.dumps(out))
