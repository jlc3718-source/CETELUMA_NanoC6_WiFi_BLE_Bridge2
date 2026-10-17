"""Add the isolated curtain transport to the exact installed web app; never replace Eufy runtime state."""
import json,subprocess,os,pathlib,sqlite3,urllib.request,time,hashlib,shutil,tarfile,base64
ROOT=pathlib.Path.cwd();RUN=os.environ['GITHUB_RUN_ID']+'-'+os.environ.get('GITHUB_RUN_ATTEMPT','1');SHA=os.environ['GITHUB_SHA'];BACK=pathlib.Path('/home/ubuntu')/('jh2-curtain-backup-'+RUN)
BACK.mkdir(mode=0o700,exist_ok=False)
NONINVASIVE=os.environ.get('JH2_NONINVASIVE_DEPLOY')=='1'
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
 # Update the already-isolated route blocks without touching other application code.
 for start,end in [('  if(path.startsWith("/api/curtain-bridge/"))','  if(!isSession(req)){'),('  if(path==="/api/curtain/status"','  if(method==="GET"&&path==="/api/nanoc6/sync")')]:
  a=src.index(start);b=src.index(end,a);x=live.index(start);y=live.index(end,x);live=live[:x]+src[a:b]+live[y:]
# Preserve the active full web app while installing the isolated AI Curtain route.
# Prior deployments copied curtain pages but omitted this API route entirely.
route_start='  if(method==="POST"&&path==="/api/curtain/generate-art")'
route_after='  if(method==="POST"&&path==="/api/curtain/ai-revamp")'
assert src.count(route_start)==1 and src.count(route_after)==1
if route_start not in live:
 assert live.count(route_after)==1, 'The installed AI revamp route moved; refuse unsafe deployment'
 ai_block=src[src.index(route_start):src.index(route_after)]
 live=live.replace(route_after,ai_block+route_after,1)
assert live.count(route_start)==1, 'AI generator must be registered exactly once'
assert 'function cloudflareAiConfigured()' in live and 'async function cloudflareAiRun(' in live, 'Cloudflare helpers must exist in installed gateway'
old_sync='const nanoC6BrightnessSync=createNanoC6BrightnessSync({meta,put,upstream});'
bridge_init='const curtainRelay=createCurtainBridge({db});'
new_sync='const nanoC6BrightnessSync=createNanoC6BrightnessSync({meta,put,upstream,bridge:curtainRelay});'
if old_sync in live:
 assert live.count(old_sync)==1 and live.count(bridge_init)==1
 live=live.replace(old_sync+'\n'+bridge_init,bridge_init+'\n'+new_sync)
assert live.count(new_sync)==1 and live.index(bridge_init)<live.index(new_sync),'Brightness follower must initialize after Oracle bridge'
(stage/'server.mjs').write_text(live)
assert '/api/eufy/verification' in live,'Preserve the working Eufy verification route'
for name in ['curtain_bridge.mjs','curtain_asset.mjs','nanoc6_sync.mjs']:shutil.copyfile(ROOT/'JasonHome2Server'/name,stage/name)
for name in ['curtain.js','curtain_converter.html','curtain_remote.js','nano_sync.js']:shutil.copyfile(ROOT/'JasonHome2Server'/name,stage/'web'/name)
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
  raise RuntimeError('New gateway failed health check')
 ready()
stagename='jh2-curtain-stage-'+RUN
try:
 start(stagename,18081,stagedata)
 base='http://127.0.0.1:18081';_,headers=api(base,'/api/session',body={'token':token});cookie=headers['Set-Cookie'].split(';')[0]
 # A deliberately invalid prompt confirms the generator route exists without spending AI credits.
 try:
  api(base,'/api/curtain/generate-art',cookie=cookie,body={'prompt':'x'})
  raise AssertionError('Short prompt unexpectedly accepted')
 except urllib.error.HTTPError as err:
  assert err.code==400, 'AI generator API not registered on staged gateway'
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
 manifest={'build':SHA,'run':RUN,'image':image,'backup':str(BACK),'rollbackContainer':previous,'oracleOwner':'oracle','schedulerReenabled':scheduler_reenabled,'schedulerReconciled':True,'eufyReady':4,'events':212,'bridgeAuthRecovered':bridge_online,'liveCommandAckVerified':live_ble,'liveBleConnected':live_ble,'credentialRotationQueued':not NONINVASIVE,'physicalBridgeVerified':False,'restartVerified':True,'snapshotRestoreVerified':True}
 (BACK/'deployment.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest))
 public={k:v for k,v in manifest.items() if k not in ['backup','rollbackContainer']}
 (ROOT/'deployment-verification.json').write_text(json.dumps(public,indent=2)+'\n')
 print('Oracle curtain relay deployed. Scheduler authority/reconcile, Eufy backend, UI verification, calendar revision and all four strings preserved. Bridge auth recovered now: '+str(bridge_online)+'.')
except Exception:
 run('docker','rm','-f','jason-home-2-web',check=False,stdout=subprocess.DEVNULL)
 run('docker','update','--restart=unless-stopped',previous,stdout=subprocess.DEVNULL);run('docker','rename',previous,'jason-home-2-web');run('docker','start','jason-home-2-web',stdout=subprocess.DEVNULL)
 shutil.copyfile(BACK/'nginx.conf',nginx);run('nginx','-t');run('systemctl','reload','nginx')
 raise
