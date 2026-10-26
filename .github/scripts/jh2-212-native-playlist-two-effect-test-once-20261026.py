"""Guarded on-device playlist experiment. Never erases existing custom effects."""
import os,json,base64,time,urllib.request,subprocess
out={'expectedFirmware':'2.0.12','existingEffectsPreserved':True,'nativeUploads':0,'controllerEffectErases':0,'firmwareChanges':0,'newPlaylistName':'JH2TEST','commands':[],'physicalVisualConfirmed':False}
env=dict(v.split('=',1) for v in json.loads(subprocess.check_output(['docker','inspect','jason-home'],text=True))[0]['Config']['Env'] if '=' in v)
cookie=''
def req(path,body=None):
 global cookie
 request=urllib.request.Request('http://127.0.0.1:8081'+path,
  data=json.dumps(body).encode() if body is not None else None,
  headers={'Content-Type':'application/json',**({'Cookie':cookie} if cookie else {})})
 with urllib.request.urlopen(request,timeout=35) as z:
  if path=='/api/session':cookie=z.headers['Set-Cookie'].split(';')[0]
  return json.load(z)
req('/api/session',{'token':env['JASON_HOME_API_TOKEN']})
def varint(v):
 z=[]
 while True:
  b=v&127;v>>=7;z.append(b|(128 if v else 0))
  if not v:return bytes(z)
def fields(b):
 d={};p=0
 while p<len(b):
  v=0
  for i in range(5):
   x=b[p];p+=1;v|=(x&127)<<(7*i)
   if x<128:break
  k,w=v>>3,v&7
  if w==0:
   v=0
   for i in range(10):
    x=b[p];p+=1;v|=(x&127)<<(7*i)
    if x<128:break
  elif w==2:
   n=0
   for i in range(4):
    x=b[p];p+=1;n|=(x&127)<<(7*i)
    if x<128:break
   v=b[p:p+n];p+=n
  else:raise ValueError('Unrecognized protobuf wire '+str(w))
  d.setdefault(k,[]).append(v)
 return d
def fld(id,val):return varint(id<<3)+varint(val)
def binary(id,data):return varint((id<<3)|2)+varint(len(data))+data
counter=0
def cursor():return max([n['id'] for n in req('/api/curtain/notifications?since=0').get('notifications',[])]+[0])
def response(opcode,mark):
 notes=req('/api/curtain/notifications?since='+str(mark)).get('notifications',[])
 packets={};answers=[]
 for n in notes:
  try:b=base64.b64decode(n.get('data',''))
  except:continue
  if len(b)<5 or b[3]!=0 or b[1]<1 or b[2]>=b[1]:continue
  packets.setdefault((b[0],b[1]),{})[b[1]-b[2]-1]=b[4:]
 for (seq,total),part in packets.items():
  if len(part)!=total:continue
  b=b''.join(part[i] for i in range(total))
  if len(b)<20 or int.from_bytes(b[6:8],'big')!=opcode:continue
  try:answers.append((b[14],fields(b[20:])))
  except:pass
 return answers
def cmd(opcode,data=b'',purpose=''):
 global counter
 counter+=1
 b=bytearray(20);b[:2]=bytes([240,4]);b[2:4]=(11300+counter).to_bytes(2,'big')
 b[6:8]=opcode.to_bytes(2,'big')
 packet=bytes([(91+counter)&255,1,0,0])+b+data
 key='jh2-212-'+purpose.replace(' ','-')+'-'+str(counter)+'-20261026'
 x=req('/api/curtain/call',{'action':'rawWrite','payload':{'uuid':'01020074-1972-1925-3022-077119514e44','data':base64.b64encode(packet).decode()},'idempotencyKey':key})
 ident=x['commandId']
 for i in range(50):
  time.sleep(.6)
  state=req('/api/curtain/command?id='+str(ident))['command']
  if state['state'] in ('applied','failed','expired','superseded'):
   out['commands'].append({'opcode':opcode,'id':ident,'state':state['state'],
     'message':str((state.get('result') or {}).get('message',''))[:140]})
   if state['state']!='applied':raise RuntimeError('Manufacturer '+str(opcode)+' rejected: '+str(state.get('result'))[:180])
   return ident
 raise RuntimeError('No Nano confirmation for '+str(opcode))
def read_playlist():
 mark=cursor();cmd(2627,purpose='read-playlists')
 time.sleep(2)
 r=response(2627,mark)
 if not r:raise RuntimeError('No fresh manufacturer playlist list response')
 _,f=r[-1];li=[]
 for raw in f.get(3,[]):
  d=fields(raw);li.append({'id':d.get(1,[None])[0],'idx':d.get(2,[None])[0],
     'name':(d.get(3,[b''])[0]).decode(errors='replace')})
 return {'enableId':f.get(1,[-1])[0],'amount':f.get(2,[-1])[0],'lists':li}
def read_effects():
 mark=cursor();cmd(2904,purpose='read-effect-catalog')
 time.sleep(7)
 replies=response(2904,mark);outmap={}
 for code,f in replies:
  for data in f.get(1,[]):
   d=fields(data);cid=d.get(4,[None])[0]
   if cid is not None:outmap[cid]={'id':d.get(1,[0])[0],'slot':d.get(3,[0])[0]}
 return outmap
def read_items():
 mark=cursor();cmd(2622,fld(1,3),purpose='read-reserved-items')
 time.sleep(3)
 r=response(2631,mark)
 if not r:raise RuntimeError('No manufacturer playlist items received')
 f=r[-1][1];items=[]
 for raw in f.get(4,[]):
  d=fields(raw);items.append({'cid':d.get(2,[None])[0],'slot':d.get(3,[None])[0]})
 return {'listId':f.get(1,[None])[0],'amount':f.get(2,[None])[0],'items':items}
created=False
try:
 s=req('/api/curtain/status');p=s.get('controllerPlayback') or {}
 if s.get('firmware')!='2.0.12' or not s.get('online') or not (s.get('curtain') or {}).get('connected') or s.get('queued') or s.get('relayStreaming'):
  raise RuntimeError('Nano 2.0.12 healthy idle connection required')
 out['before']=read_playlist()
 if out['before']['amount']!=3 or out['before']['enableId'] not in (-1,18446744073709551615) or len(out['before']['lists'])!=3:
  raise RuntimeError('Unexpected existing playlist; do not mutate')
 effects=read_effects()
 out['savedBefore']={str(c):effects.get(c) for c in (83928,84268,85391,85397)}
 for cid,slot in ((83928,33),(85397,35)):
  if effects.get(cid,{}).get('slot')!=slot:raise RuntimeError('CID '+str(cid)+' missing expected native slot; no changes')
 cmd(2660,fld(1,0)+binary(3,b'JH2TEST'),purpose='create-jh2test')
 created=True
 out['afterCreate']=read_playlist()
 if out['afterCreate']['amount']!=4 or not any(x.get('id')==3 and x.get('name')=='JH2TEST' for x in out['afterCreate']['lists']):
  raise RuntimeError('Playlist creation not verified; no native items saved')
 item1=fld(2,83928)+fld(3,33)
 item2=fld(2,85397)+fld(3,35)
 payload=fld(1,3)+fld(2,2)+binary(4,item1)+binary(4,item2)
 cmd(2626,payload,purpose='save-two-native-effects')
 out['afterSave']=read_items()
 if out['afterSave']['listId']!=3 or out['afterSave']['amount']!=2 or out['afterSave']['items']!=[{'cid':83928,'slot':33},{'cid':85397,'slot':35}]:
  raise RuntimeError('Playlist content did not match exact protected two native CIDs')
 cmd(2623,fld(1,3),purpose='enable-native-playlist')
 out['afterEnable']=read_playlist()
 if out['afterEnable']['enableId']!=3:raise RuntimeError('Controller did not enable native playlist')
 observed=[]
 for step in range(18):
  time.sleep(4)
  st=req('/api/curtain/status')
  pl=st.get('controllerPlayback') or {}
  observed.append({'cid':pl.get('cid'),'slot':pl.get('slot'),'currentFrame':pl.get('currentFrame'),
   'state':pl.get('state'),'streaming':st.get('relayStreaming')})
 out['observed']=observed
 keys={x['cid'] for x in observed if x['state']=='current'}
 alternations=sum(1 for a,b in zip(observed,observed[1:]) if a['cid']!=b['cid'] and a['cid'] in (83928,85397) and b['cid'] in (83928,85397))
 out['nativeControllerAlternations']=alternations
 out['result']='AUTONOMOUS_CONTROLLER_PLAYLIST_SWITCHING_TELEMETRY_VISUAL_UNCONFIRMED' if alternations>=2 and keys=={83928,85397} and not any(x['streaming'] for x in observed) else 'PLAYLIST_DID_NOT_DEMONSTRATE_SWITCHING'
 if not out['result'].startswith('AUTONOMOUS_'):raise RuntimeError(out['result'])
except Exception as e:
 out['error']=str(e)
 if out.get('result') is None:out['result']='TEST_NOT_VERIFIED'
 if created:
  try:
   cmd(2624,fld(1,3),purpose='rollback-disable-test-playlist')
   out['rollbackDisabled']=True
  except Exception as rollback:out['rollbackError']=str(rollback)[:180]
finally:
 print('JH2_212_PLAYLIST_NATIVE_CONTROLLER_RESULT '+json.dumps(out,default=str),flush=True)
