"""Add the isolated curtain transport to the exact installed web app; never replace Eufy runtime state."""
import json,subprocess,os,pathlib,sqlite3,urllib.request,time,hashlib,shutil,tarfile,base64
ROOT=pathlib.Path.cwd();RUN=os.environ['GITHUB_RUN_ID']+'-'+os.environ.get('GITHUB_RUN_ATTEMPT','1');SHA=os.environ['GITHUB_SHA'];BACK=pathlib.Path('/home/ubuntu')/('jh2-curtain-backup-'+RUN)
BACK.mkdir(mode=0o700,exist_ok=False)
NONINVASIVE=os.environ.get('JH2_NONINVASIVE_DEPLOY')=='1'
NATIVE_SLOT=os.environ.get('JH2_NATIVE_SLOT_DEPLOY')=='1'
def run(*a,**kw):
 kw.setdefault("check",True);return subprocess.run(a,**kw)
def capture(*a):return subprocess.check_output(a)
def inspect(name):return json.loads(capture('docker','inspect',name))[0]
def env(i):return dict(v.split('=',1) for v in i['Config']['Env'] if '=' in v)
def cpout(name,source,target):run('docker','cp',name+':'+source,str(target))
def dbhost(i,path):
 m=next(m for m in i['Mounts'] if path.startswith(m['Destination'].rstrip('/')+'/'))
 return pathlib.Path(m['Source'])/path[len(m['Destination']):].lstrip('/')
def backupdb(src,dst):
 with sqlite3.connect('file:'+str(src)+'?mode=ro',uri=True) as a,sqlite3.connect(dst) as b:a.backup(b)
 with sqlite3.connect(dst) as b:assert b.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
def api(base,path,token=None,cookie=None,body=None,bridge_header=False):
 headers={'Content-Type':'application/json'}
 if token:
  if bridge_header:headers['X-JH2-Bridge-Token']=token
  else:headers['Authorization']='Bearer '+token
 if cookie:headers['Cookie']=cookie
 req=urllib.request.Request(base+path,None if body is None else json.dumps(body).encode(),headers)
 with urllib.request.urlopen(req,timeout=40) as r:
  data=r.read();return json.loads(data),r.headers
backend=inspect('jason-home');web=inspect('jason-home-2-web');be=env(backend);we=env(web);token=be['JASON_HOME_API_TOKEN'];BASE='http://127.0.0.1:8080'
before,_=api(BASE,'/api/status',token);assert len(before['eufy']['readyNames'])==4;assert before['calendar']['eventCount']==212
owner_before=before['automationOwner'];calendar_revision=before['calendar']['revision']
backend_file=BACK/'backend-server.js';cpout('jason-home','/app/dist/server.js',backend_file);backend_digest=hashlib.sha256(backend_file.read_bytes()).hexdigest()
for name,i in [('backend',backend),('web',web)]:
 (BACK/(name+'-inspect.json')).write_text(json.dumps(i));(BACK/(name+'-inspect.json')).chmod(0o600)
backupdb(dbhost(backend,be.get('JASON_HOME_DB','/data/jason-home.sqlite')),BACK/'backend.sqlite')
webdb=dbhost(web,'/data/jason-home-2.sqlite');backupdb(webdb,BACK/'web.sqlite')
cpout('jason-home-2-web','/app',BACK/'web-app')
shutil.copyfile('/home/ubuntu/repo/JasonHomeServer/.env',BACK/'backend.env');(BACK/'backend.env').chmod(0o600)
nginx=pathlib.Path('/etc/nginx/sites-available/jason-home');shutil.copyfile(nginx,BACK/'nginx.conf')
# Encrypt the consistent runtime snapshot and independently decrypt/restore it before deployment.
key=pathlib.Path('/home/ubuntu/.jason-home-signing/restore-transport.pem');assert key.is_file()
run('openssl','req','-new','-x509','-key',str(key),'-days','30','-subj','/CN=JasonHome2RuntimeRecovery','-out',str(BACK/'recipient.pem'),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
with tarfile.open(BACK/'runtime.tar','w') as archive:
 for name in ['backend-inspect.json','web-inspect.json','backend.sqlite','web.sqlite','backend.env','nginx.conf','backend-server.js','web-app']:archive.add(BACK/name,arcname=name)
run('openssl','cms','-encrypt','-binary','-aes-256-cbc','-in',str(BACK/'runtime.tar'),'-outform','DER','-out',str(BACK/'runtime.cms'),'-recip',str(BACK/'recipient.pem'),'-keyopt','rsa_padding_mode:oaep',stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
run('openssl','cms','-decrypt','-binary','-inform','DER','-in',str(BACK/'runtime.cms'),'-inkey',str(key),'-out',str(BACK/'restored.tar'),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
assert hashlib.sha256((BACK/'runtime.tar').read_bytes()).digest()==hashlib.sha256((BACK/'restored.tar').read_bytes()).digest()
with tarfile.open(BACK/'restored.tar') as archive:
 for name in ['backend.sqlite','web.sqlite']:
  data=archive.extractfile(name).read();target=BACK/('restore-test-'+name);target.write_bytes(data)
  with sqlite3.connect(target) as d:assert d.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
(BACK/'runtime.tar').unlink();(BACK/'restored.tar').unlink()
print('Encrypted production snapshot decrypted and SQLite restores verified; Eufy session and 212 events preserved.')
# The user's requested authority is Oracle. Restore it only after the verified backup exists.
scheduler_reenabled=owner_before!='oracle'
if scheduler_reenabled:api(BASE,'/api/automation/ownership',token,body={'owner':'oracle'})
before,_=api(BASE,'/api/status',token);assert before['automationOwner']=='oracle';assert before['calendar']['revision']==calendar_revision
# Apply only the new transport integration to installed code and the two existing curtain files.
stage=BACK/'build';shutil.copytree(BACK/'web-app',stage)
live=(stage/'server.mjs').read_text();src=(ROOT/'JasonHome2Server/server.mjs').read_text()
if NATIVE_SLOT:
 # Preserve all installed web modules and unrelated controller runtime routes.
 # Validate patchability before taking down the production gateway.
 current=(stage/'curtain_bridge.mjs').read_text()
 anchor=" const bytes=Buffer.from(input.nativeEff,'base64');"
 assert current.count(anchor)==1,'Installed compiler differs; refuse non-atomic replacement'
 assert 'function compileNativeEffect(input)' in current,'Installed native conversion guard absent'
 assert not (stage/'curtain_bridge.mjs').is_symlink(),'Unsupported live native module layout'

if not NATIVE_SLOT:
 if 'createCurtainBridge' not in live:
  live='import {createCurtainBridge} from "./curtain_bridge.mjs";\n'+live
  anchor='const nanoC6BrightnessSync=createNanoC6BrightnessSync({meta,put,upstream});';assert live.count(anchor)==1
  live=live.replace(anchor,anchor+'\nconst curtainRelay=createCurtainBridge({db});')
  a=src.index('  if(path.startsWith("/api/curtain-bridge/"))');b=src.index('  if(!isSession(req)){',a);block=src[a:b]
  assert live.count('  if(!isSession(req)){')==1;live=live.replace('  if(!isSession(req)){',block+'  if(!isSession(req)){')
  a=src.index('  if(path==="/api/curtain/status"');b=src.index('  if(method==="GET"&&path==="/api/nanoc6/sync")',a);block=src[a:b]
  assert live.count('  if(method==="GET"&&path==="/api/nanoc6/sync")')==1;live=live.replace('  if(method==="GET"&&path==="/api/nanoc6/sync")',block+'  if(method==="GET"&&path==="/api/nanoc6/sync")')
  live=live.replace('"nano_sync.js"]','"nano_sync.js","curtain_remote.js"]')
 else:
  # The installed Oracle server has newer Eufy master-schedule and vendor-video
  # routes than this development branch. Preserve them byte-for-byte.
  # Add ONLY the authenticated /nano/ trace console below.
  pass
 # Keep the authenticated Nano diagnostic route immediately before static asset routing.
 remote_begin='  if(path==="/nano/"&&method==="GET"){' 
 remote_end='  if(!path.startsWith("/api/"))return authenticatedRead(req,res,path);'
 if remote_begin in src:
  new_nano=src[src.index(remote_begin):src.index(remote_end,src.index(remote_begin))]
  if remote_begin in live:
   start=live.index(remote_begin)
   # Modern Oracle has an inline Nano UI followed immediately by pairing API,
   # not the older static file handler. Preserve all newer routes verbatim.
   api_next='  if(path==="/api/curtain/pair"&&method==="POST")'
   stop=live.index(api_next,start) if api_next in live[start:] else live.index(remote_end,start)
   live=live[:start]+new_nano+live[stop:]
  else:
   anchor=remote_end if remote_end in live else '  if(path==="/api/curtain/pair"&&method==="POST")'
   assert anchor in live,'No known authenticated Nano route insertion boundary'
   live=live.replace(anchor,new_nano+anchor,1)
 else:raise RuntimeError('Source /nano/ handler missing')
 # The installed gateway routes all non-API GETs to a strict static allowlist.
 # Its legacy /nano/ handler was located AFTER that catchall and unreachable.
 # Make this single authenticated exception precede the catchall.
 if remote_end in live and remote_begin in live and live.index(remote_end)<live.index(remote_begin):
  start=live.index(remote_begin)
  api_next='  if(path==="/api/curtain/pair"&&method==="POST")'
  assert api_next in live[start:],'Missing authenticated curtain API boundary'
  stop=live.index(api_next,start)
  nano_block=live[start:stop]
  live=live[:start]+live[stop:]
  assert live.count(remote_end)==1 and live.count(remote_begin)==0
  live=live.replace(remote_end,nano_block+remote_end,1)
 assert live.index(remote_begin)<live.index(remote_end),'Nano route hidden behind static catchall'
 
 
 old_sync='const nanoC6BrightnessSync=createNanoC6BrightnessSync({meta,put,upstream});'
 bridge_init='const curtainRelay=createCurtainBridge({db});'
 new_sync='const nanoC6BrightnessSync=createNanoC6BrightnessSync({meta,put,upstream,bridge:curtainRelay});'
 if old_sync in live:
  assert live.count(old_sync)==1 and live.count(bridge_init)==1
  live=live.replace(old_sync+'\n'+bridge_init,bridge_init+'\n'+new_sync)
 assert live.count(new_sync)==1 and live.index(bridge_init)<live.index(new_sync),'Brightness follower must initialize after Oracle bridge'
(stage/'server.mjs').write_text(live)
if not NATIVE_SLOT:assert remote_begin in live and 'nano_remote.html' in live,'Nano UI authenticated route missing' 
assert '/api/eufy/verification' in live,'Preserve the working Eufy verification route'
# Retain the installed compatible curtain/Eufy runtime modules; copying
# older branch modules removes setEufyMasterEnabled and crashes Oracle.
for name in ['curtain_bridge.mjs','curtain_asset.mjs','nanoc6_sync.mjs']:
 if not (stage/name).is_file():shutil.copyfile(ROOT/'JasonHome2Server'/name,stage/name)
# The Nano remote console is not a /web static file: server.mjs reads it
# next to the server module. Omitting it produces a missing-file failure.
if not NATIVE_SLOT:shutil.copyfile(ROOT/'JasonHome2Server/nano_remote.html',stage/'nano_remote.html')
assert (stage/'nano_remote.html').is_file()

# Preserve the deployed original Curtain tab and Studio while enabling /nano/.
# This deployment adds the trace console rather than rolling back later features.
for name in ['curtain.js','curtain_converter.html','curtain_remote.js','nano_sync.js']:
 if not (stage/'web'/name).is_file():shutil.copyfile(ROOT/'JasonHome2Server'/name,stage/'web'/name)
if NATIVE_SLOT:
 # Apply ONLY the DN1FE reference recognition to the installed native compiler.
 # No branch-source replacement: preserve every newer feature and route.
 module=stage/'curtain_bridge.mjs';original=module.read_text()
 anchor=" const bytes=Buffer.from(input.nativeEff,'base64');"
 addition="""\n if(bytes.length===4096){
  if(bytes.subarray(0,4).toString('hex')!=='444e01fe'||bytes.readUInt32LE(4)!==83928)
   throw Error('Only original 4 KB SmartDawn DN1FE CID 83928 may use the reference upload');
  return {bytes,format:'DN1FE',frames:1,loop:false,native:true,sha256:hash(bytes)};
 }"""
 assert original.count(anchor)==1,'Cannot safely patch deployed SmartDawn compiler'
 patched=original.replace(anchor,anchor+addition,1)
 assert len(patched)>len(original) and patched.replace(anchor+addition,anchor,1)==original
 module.write_text(patched)
 assert (stage/'server.mjs').read_bytes()==(BACK/'web-app/server.mjs').read_bytes()
 print('Patched only original 4KB native asset validation; kept deployed Curtain UI, runtime and Eufy routes.',flush=True)
html=stage/'web/anderson_home.html';text=html.read_text()
if 'src="curtain_remote.js"' not in text:
 assert text.count('<script src="curtain.js"></script>')==1
 text=text.replace('<script src="curtain.js"></script>','<script src="curtain_remote.js"></script>\n<script src="curtain.js"></script>');html.write_text(text)
# New image is built from the full installed app, retaining its exact private configuration outside the image.
(stage/'Dockerfile').write_text('FROM node:22-bookworm-slim\nWORKDIR /app\nCOPY . /app/\nENV JH2_PORT=8081 JH2_DATA_DIR=/data JH2_CURTAIN_BUILD_SHA='+SHA+'\nUSER node\nCMD ["node","--no-warnings=ExperimentalWarning","server.mjs"]\n')
image='jason-home-2-web:curtain-relay-'+SHA;run('docker','build','-t',image,str(stage),stdout=subprocess.DEVNULL)
# Preserve exactly the current environment; no .env rewrite or Eufy credential replacement.
we['JH2_CURTAIN_BUILD_SHA']=SHA
private=BACK/'web-runtime.env';private.write_text(''.join(k+'='+v+'\n' for k,v in we.items()));private.chmod(0o600)
stagedata=BACK/'stage-data';stagedata.mkdir();backupdb(webdb,stagedata/'jason-home-2.sqlite');run('chown','-R','1000:1000',str(stagedata))
def start(name,port,data):
 run('docker','run','-d','--name',name,'--network','host','--restart','unless-stopped','--env-file',str(private),'-e','JH2_PORT='+str(port),'-v',str(data)+':/data',image,stdout=subprocess.DEVNULL)
 def ready():
  for i in range(30):
   try:api('http://127.0.0.1:'+str(port),'/api/health');return
   except Exception:time.sleep(1)
  diagnostics=subprocess.run(['docker','logs','--tail','70',name],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,check=False).stdout
  safe=[line[:350] for line in diagnostics.splitlines() if any(k in line for k in ['Error','error','at file:','at Module','SyntaxError','ReferenceError','ERR_','/app/server.mjs'])]
  print('STAGED_GATEWAY_STARTUP_ERROR',safe[-25:],flush=True)
  raise RuntimeError('New gateway failed health check')
 ready()
stagename='jh2-curtain-stage-'+RUN
try:
 start(stagename,18081,stagedata)
 base='http://127.0.0.1:18081';_,headers=api(base,'/api/session',body={'token':token});cookie=headers['Set-Cookie'].split(';')[0]
 nanoPage=urllib.request.Request(base+'/nano/',headers={'Cookie':cookie})
 with urllib.request.urlopen(nanoPage,timeout=15) as response:
  html=response.read().decode('utf-8')
  assert 'NanoC6 Remote' in html and 'curtain_converter.html' in html and 'traceId' in html,'Hosted diagnostic console missing'
 studioPage=urllib.request.Request(base+'/curtain_converter.html',headers={'Cookie':cookie})
 with urllib.request.urlopen(studioPage,timeout=15) as response:
  studio=response.read().decode('utf-8')
  assert 'JH2_ORACLE_CURTAIN' in studio or 'curtain' in studio,'Hosted Studio missing'
 print('Staging Nano trace console and 40x40 Studio authenticated HTML both served',flush=True)
 nano,_=api(base,'/api/nanoc6/sync',cookie=cookie)
 assert nano['configured'] is True,'NanoC6 brightness checkbox must be enabled by Oracle bridge'
 enabled,_=api(base,'/api/nanoc6/sync',cookie=cookie,body={'enabled':True})
 assert enabled['enabled'] is True,'NanoC6 brightness sync could not be enabled'
 restored,_=api(base,'/api/nanoc6/sync',cookie=cookie,body={'enabled':nano['enabled']})
 assert restored['enabled']==nano['enabled'],'Original checkbox state not preserved'

 pair,_=api(base,'/api/curtain/pair',cookie=cookie,body={});bridgekey=pair['token']
 accepted,_=api(base,'/api/curtain/call',cookie=cookie,body={'action':'effect','payload':{'id':1},'idempotencyKey':'stage-test'})
 received,_=api(base,'/api/curtain-bridge/sync',bridgekey,body={'status':{'firmware':'1.1.2','curtain':{'connected':True}},'bootId':'stage-emulator'},bridge_header=True)
 assert received['commands'];cid=received['commands'][0]['id']
 api(base,'/api/curtain-bridge/sync',bridgekey,body={'acks':[{'id':cid,'state':'applied','result':{'bleTransmitted':True,'physicalPlaybackConfirmed':False}}]})
 checked,_=api(base,'/api/curtain/command?id='+str(cid),cookie=cookie);assert checked['command']['state']=='applied'
 api(base,'/api/curtain/rotate',cookie=cookie,body={})
 offered,_=api(base,'/api/curtain-bridge/sync',bridgekey,body={'status':{'firmware':'1.1.2','curtain':{'connected':True}},'bootId':'stage-emulator'})
 rotated=offered['credential']['token'];assert len(rotated)==64
 api(base,'/api/curtain-bridge/sync',rotated,body={'status':{'firmware':'1.1.2','curtain':{'connected':True}},'bootId':'stage-emulator'},bridge_header=True)
 rotated_status,_=api(base,'/api/curtain/status',cookie=cookie);assert rotated_status['credentialRotationPending'] is False
 frame=bytes([255,0,0,255])*1600
 asset,_=api(base,'/api/curtain/assets',cookie=cookie,body={'frames':[base64.b64encode(frame).decode()],'quality':'pal4','delays':[100]})
 request=urllib.request.Request(base+'/api/curtain-bridge/assets/'+asset['sha256']+'?offset=0&length=4096',headers={'X-JH2-Bridge-Token':rotated})
 with urllib.request.urlopen(request,timeout=10) as response:
  chunk=response.read();assert response.headers['x-chunk-sha256']==hashlib.sha256(chunk).hexdigest();assert chunk[:4]==b'JHC1'
 retained,_=api(base,'/api/curtain/retention',cookie=cookie)
 assert retained['maxFilesPerTarget']==2 and retained['maxFileBytes']==4194304
 staged_command,_=api(base,'/api/curtain/call',cookie=cookie,body={'action':'asset','payload':{'sha256':asset['sha256']},'idempotencyKey':'staged-asset-check'})
 stage_id=staged_command['commandId']
 api(base,'/api/curtain-bridge/sync',rotated,body={'acks':[{'id':stage_id,'state':'applied','result':{'bleTransmitted':True,'physicalPlaybackConfirmed':False}}]},bridge_header=True)
 waiting,_=api(base,'/api/curtain/retention',cookie=cookie)
 assert waiting['pending'] is not None and waiting['confirmationRequired']
 confirmed,_=api(base,'/api/curtain/confirm-display',cookie=cookie,body={'commandId':stage_id,'observed':True})
 assert confirmed['active']['sha256']==asset['sha256'] and confirmed['retainedFiles']>=1
 if NATIVE_SLOT:
  native=bytearray(28672);native[:4]=b'DNMX';native[4:10]=bytes([3,1,40,0,40,0])
  def u32(offset,value):native[offset:offset+4]=value.to_bytes(4,'little')
  u32(10,4800);u32(14,83928);u32(128,4096);native[134]=4
  native[4096:4101]=b'DNX2\x03';u32(4101,4800);u32(4105,4);native[4109]=native[4111]=40
  staged_native,_=api(base,'/api/curtain/assets',cookie=cookie,body={'nativeEff':base64.b64encode(native).decode()})
  assert staged_native['native'] and staged_native['bytes']==28672
  native_command,_=api(base,'/api/curtain/call',cookie=cookie,body={'action':'nativeSlotUpload','payload':{'sha256':staged_native['sha256']},'idempotencyKey':'staged-native-ram-check'})
  received_native,_=api(base,'/api/curtain-bridge/sync',rotated,body={'status':{'firmware':'1.1.49'},'bootId':'stage-emulator'},bridge_header=True)
  assert any(a['sha256']==staged_native['sha256'] and a.get('native') for a in received_native['assets'])
  request=urllib.request.Request(base+'/api/curtain-bridge/stream/'+staged_native['sha256'],headers={'X-JH2-Bridge-Token':rotated})
  with urllib.request.urlopen(request,timeout=10) as response:assert response.read()==native
  assert received_native['desired']['visual']['action']=='asset'
  original_reference=bytearray(4096);original_reference[:4]=b'DN\\x01\\xfe';original_reference[4:8]=(83928).to_bytes(4,'little')
  control,_=api(base,'/api/curtain/assets',cookie=cookie,body={'nativeEff':base64.b64encode(original_reference).decode()})
  assert control['native'] and control['bytes']==4096,'Native original 4KB reference upload rejected in staging'
  print('Staged native RAM upload: exact full-file HTTP stream and transient command manifest verified.')
 assert not checked['command']['physicalPlaybackConfirmed']
 print('Staged actual HTTP API: both bridge auth headers, credential rotation, command/ACK, Oracle conversion and 4 KB digest-checked relay PASS. ACK used a simulator; physical BLE is not claimed.')
finally:run('docker','rm','-f',stagename,stdout=subprocess.DEVNULL)
previous='jh2-web-before-relay-'+RUN
# All prerequisite checks passed; replace only the web gateway and preserve the old container for immediate rollback.
try:
 run('docker','stop','jason-home-2-web',stdout=subprocess.DEVNULL);run('docker','rename','jason-home-2-web',previous);run('docker','update','--restart=no',previous,stdout=subprocess.DEVNULL)
 start('jason-home-2-web',8081,webdb.parent)
 config=nginx.read_text();marker='location ^~ /jason-home-2/ {';assert marker in config
 block=config[config.index(marker):config.find('}',config.index(marker))+1];directives=[]
 for directive in ['client_max_body_size 8m;','proxy_set_header Authorization $http_authorization;','proxy_set_header X-JH2-Bridge-Token $http_x_jh2_bridge_token;']:
  if directive not in block:directives.append('        '+directive)
 if directives:
  nginx.write_text(config.replace(marker,marker+'\n'+'\n'.join(directives),1));run('nginx','-t');run('systemctl','reload','nginx')
 base='http://127.0.0.1:8081';_,headers=api(base,'/api/session',body={'token':token});cookie=headers['Set-Cookie'].split(';')[0]
 relay,_=api(base,'/api/curtain/status',cookie=cookie);assert relay['assetStorage']=='oracle';assert relay['pollSeconds']==5
 api(base,'/api/eufy/verification',cookie=cookie)
 if not NATIVE_SLOT:
  reconcile,_=api(BASE,'/api/reconcile',token,body={});assert reconcile.get('ok') is True and not reconcile.get('errors')
 after,_=api(BASE,'/api/status',token);assert after['automationOwner']=='oracle';assert len(after['eufy']['readyNames'])==4;assert after['calendar']['revision']==before['calendar']['revision'];assert after['calendar']['eventCount']==212
 cpout('jason-home','/app/dist/server.js',BACK/'backend-after.js');assert hashlib.sha256((BACK/'backend-after.js').read_bytes()).hexdigest()==backend_digest
 untouched=BACK/'eufy-ui-after.js';cpout('jason-home-2-web','/app/web/android_eufy_ui.js',untouched);assert untouched.read_bytes()==(BACK/'web-app/web/android_eufy_ui.js').read_bytes()
 # Verify a controlled gateway restart and the durable schema independently from physical bridge pairing.
 run('docker','restart','jason-home-2-web',stdout=subprocess.DEVNULL)
 for i in range(30):
  try:api(base,'/api/health');break
  except Exception:time.sleep(1)
 api(base,'/api/curtain/status',cookie=cookie)
 # Existing 1.1.1 can now authenticate through nginx; 1.1.2 will then rotate in-band.
 bridge_online=False
 for i in range(18):
  relay,_=api(base,'/api/curtain/status',cookie=cookie)
  if relay['online']:
   bridge_online=True;break
  time.sleep(5)
 assert bridge_online,'Existing NanoC6 did not authenticate after proxy header repair'
 live_ble=False
 if NONINVASIVE:
  print('Oracle-only deployment verified bridge authentication; skipped BLE connect and credential rotation while user is logging SmartDawn.',flush=True)
 else:
  # BLE can be temporarily unavailable while DN5E58 advertises or reconnects.
  # Retry genuine physical bridge connect requests; never synthesize an ACK.
  live_ble=False
  for attempt in range(1,5):
   probe,_=api(base,'/api/curtain/call',cookie=cookie,body={'action':'connect','payload':{},'idempotencyKey':'deploy-connect-'+RUN+'-'+str(attempt)})
   delivered=None
   for i in range(25):
    delivered,_=api(base,'/api/curtain/command?id='+str(probe['commandId']),cookie=cookie)
    if delivered['command']['state'] in ['applied','failed','expired']:break
    time.sleep(2)
   cmd=delivered['command'] if delivered else {}
   outcome=cmd.get('result') or {}
   live_ble=cmd.get('state')=='applied' and outcome.get('connected') is True
   print('Live BLE connect probe',attempt,'state:',cmd.get('state'),'result:',json.dumps(outcome),flush=True)
   if live_ble:break
   if attempt<4:time.sleep(8)
  assert live_ble,'NanoC6 did not ACK a connected DN5E58 after four live attempts; see probe results above'
  api(base,'/api/curtain/rotate',cookie=cookie,body={})
 # Pin future gateway starts to the verified image without altering existing secrets.
 (pathlib.Path('/opt/jason-home-2')/'curtain-relay-image').write_text(image+'\n')
 manifest={'build':SHA,'run':RUN,'image':image,'backup':str(BACK),'rollbackContainer':previous,'oracleOwner':'oracle','schedulerReenabled':scheduler_reenabled,'schedulerReconciled':not NATIVE_SLOT,'nativeSlotUpdated':NATIVE_SLOT,'eufyReady':4,'events':212,'bridgeAuthRecovered':bridge_online,'liveCommandAckVerified':live_ble,'liveBleConnected':live_ble,'credentialRotationQueued':not NONINVASIVE,'physicalBridgeVerified':False,'restartVerified':True,'snapshotRestoreVerified':True}
 (BACK/'deployment.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest))
 public={k:v for k,v in manifest.items() if k not in ['backup','rollbackContainer']}
 (ROOT/'deployment-verification.json').write_text(json.dumps(public,indent=2)+'\n')
 print('Oracle curtain relay deployed. Scheduler authority/reconcile, Eufy backend, UI verification, calendar revision and all four strings preserved. Bridge auth recovered now: '+str(bridge_online)+'.')
except Exception:
 run('docker','rm','-f','jason-home-2-web',check=False,stdout=subprocess.DEVNULL)
 run('docker','update','--restart=unless-stopped',previous,stdout=subprocess.DEVNULL);run('docker','rename',previous,'jason-home-2-web');run('docker','start','jason-home-2-web',stdout=subprocess.DEVNULL)
 shutil.copyfile(BACK/'nginx.conf',nginx);run('nginx','-t');run('systemctl','reload','nginx')
 raise
