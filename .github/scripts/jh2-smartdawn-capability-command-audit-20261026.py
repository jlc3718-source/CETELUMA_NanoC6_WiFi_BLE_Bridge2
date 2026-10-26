import json,subprocess,urllib.request,base64,time
out={'deviceInfoReads':1,'capabilityWrites':0,'firmwareChanges':0,'erases':0,'bleDisconnects':0}
env=dict(x.split('=',1) for x in json.loads(subprocess.check_output(['docker','inspect','jason-home'],text=True))[0]['Config']['Env'] if '=' in x)
cookie=''
def req(path,body=None):
 global cookie
 r=urllib.request.Request('http://127.0.0.1:8081'+path,
  data=json.dumps(body).encode() if body is not None else None,
  headers={'Content-Type':'application/json',**({'Cookie':cookie} if cookie else {})})
 with urllib.request.urlopen(r,timeout=30) as z:
  if path=='/api/session':cookie=z.headers['Set-Cookie'].split(';')[0]
  return json.load(z)
req('/api/session',{'token':env['JASON_HOME_API_TOKEN']})
def vint(b,p):
 v=0
 for k in range(10):
  c=b[p];p+=1;v|=(c&127)<<(7*k)
  if c<128:return v,p
 raise ValueError('Bad varint')
def fields(b):
 d={};p=0
 while p<len(b):
  t,p=vint(b,p);k,w=t>>3,t&7
  if w==0:v,p=vint(b,p)
  elif w==2:
   n,p=vint(b,p);v=b[p:p+n];p+=n
  else:raise ValueError('Unsupported field wire')
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
try:
 s=req('/api/curtain/status')
 if s.get('firmware')!='2.0.11' or not s.get('online') or not s.get('curtain',{}).get('connected') or s.get('queued') or s.get('relayStreaming'):
  raise RuntimeError('Connected idle 2.0.11 baseline required')
 mark=max([n['id'] for n in req('/api/curtain/notifications?since=0')['notifications']]+[0])
 # The original app explicitly sends opcode 2103 to request DeviceInfoNotify.
 # This is a read-only information request, NOT a capability setter.
 p=bytearray(bytes.fromhex('0a010000f004000a00000b58000000000000000000000000'))
 p[10]=2103>>8;p[11]=2103&255
 q=req('/api/curtain/call',{'action':'rawWrite','payload':{'uuid':'01020074-1972-1925-3022-077119514e44','data':base64.b64encode(p).decode()},
      'idempotencyKey':'smartdawn-2103-device-info-readonly-20261026'})
 id=q.get('commandId');out['commandId']=id
 for step in range(35):
  time.sleep(.65)
  response=req('/api/curtain/command?id='+str(id)).get('command') or {}
  if response.get('state') in ('applied','failed','expired','superseded'):
   out['commandState']=response.get('state')
   break
 time.sleep(2)
 items=[{'rcode':rc,'fields':v} for op,rc,v in messages(mark) if op==2103]
 out['deviceInfoReplies']=len(items)
 out['reported']=[]
 for sample in items:
  d=sample['fields']
  def value(k):
   v=d.get(k,[None])[0]
   return v if isinstance(v,int) else None
  cap=value(22)
  out['reported'].append({'rcode':sample['rcode'],'firmware':value(6),
    'capabilityHex':'0x%08x'%(cap&0xffffffff) if cap is not None else None,
    'field33_tfcard':value(33),'field34_vidUpload':value(34),
    'capabilityBit0200':bool(cap&0x200) if cap is not None else None})
 out['result']='READ_ONLY_DEVICE_INFO_RECEIVED' if out['reported'] else 'DEVICE_INFO_REPLY_NOT_OBSERVED'
except Exception as e:
 out['result']='READ_ONLY_AUDIT_FAILED';out['error']=str(e)
print('JH2_SMARTDAWN_VIDEO_CAPABILITY_COMMAND_AUDIT',json.dumps(out))
