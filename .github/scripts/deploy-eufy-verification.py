import json,subprocess,pathlib,re,os,sqlite3,time,urllib.request,shutil
root=pathlib.Path.cwd();backup=pathlib.Path('/home/ubuntu')/('jh2-verification-backup-'+os.environ['GITHUB_RUN_ID']);backup.mkdir(mode=0o700)
def run(*a,**kw):return subprocess.run(a,check=True,**kw)
def cpout(container,source,name):
 p=backup/name;run('sudo','docker','cp',container+':'+source,str(p));run('sudo','chown',str(os.getuid())+':'+str(os.getgid()),str(p));return p
info=json.loads(subprocess.check_output(['sudo','docker','inspect','jason-home']))[0];(backup/'inspect.json').write_text(json.dumps(info));(backup/'inspect.json').chmod(0o600)
webinfo=json.loads(subprocess.check_output(['sudo','docker','inspect','jason-home-2-web']))[0];(backup/'web-inspect.json').write_text(json.dumps(webinfo));(backup/'web-inspect.json').chmod(0o600)
env=dict(x.split('=',1) for x in info['Config']['Env'] if '=' in x)
dbpath=env.get('JASON_HOME_DB','/data/jason-home.sqlite');mount=next(m for m in info['Mounts'] if dbpath.startswith(m['Destination'].rstrip('/')+'/'));dbfile=pathlib.Path(mount['Source'])/dbpath[len(mount['Destination']):].lstrip('/')
src=sqlite3.connect('file:'+str(dbfile)+'?mode=ro',uri=True);dst=sqlite3.connect(backup/'state.sqlite');src.backup(dst);src.close();dst.close()
backend=cpout('jason-home','/app/dist/server.js','server-original.js');web=cpout('jason-home-2-web','/app/server.mjs','web-original.mjs');ui=cpout('jason-home-2-web','/app/web/android_eufy_ui.js','ui-original.js')
s=backend.read_text();assert 'createEufyVerification' not in s,'Verification already installed'
s='import { createEufyVerification } from "./eufy/verification.js";\n'+s
initial='''const eufyVerification=createEufyVerification({createClient:()=>new EufyClient(meta("install_id")||DEFAULT_INSTALL),meta,setMeta,commit:async(client)=>{setMeta("eufy_session",JSON.stringify(client.exportSession()));delMeta("eufy_verification_required");const ready=await ensureEufy(true);return {readyNames:ready.readyNames(),reconcile:await reconcile(false,true)};}});\n'''
s,count=re.subn(r'async function ensureEufy\(force\s*=\s*false\)\s*\{',initial+'async function ensureEufy(force=false){\nif(meta("eufy_verification_required"))throw new Error("Eufy verification required. Open Settings → Eufy Devices.");',s,count=1);assert count==1
s,count=re.subn(r'eufyStatus\s*=\s*e\?\.message\s*\|\|\s*String\(e\);',lambda m:m[0]+'\nif(/100032|captcha/i.test(eufyStatus)){setMeta("eufy_verification_required","1");eufyStatus="Eufy verification required. Open Settings → Eufy Devices.";}',s,count=1);assert count==1
route='''if(path==="/api/eufy/verification"&&(method==="GET"||method==="POST"))return json(res,200,method==="POST"?await eufyVerification.handle(await readJson(req)):{ok:true,...eufyVerification.view()});\n'''
s,count=re.subn(r'if\s*\(method\s*===?\s*"GET"\s*&&\s*path\s*===?\s*"/api/status"\)',lambda m:route+m[0],s,count=1);assert count==1
patched=backup/'server-patched.js';patched.write_text(s)
w=web.read_text();w,count=re.subn(r'(const proxyPaths\s*=\s*new Set\(\[)(.*?)(\]\))',lambda m:m[1]+m[2]+',"/api/eufy/verification"'+m[3],w,count=1);assert count==1
webpatched=backup/'web-patched.mjs';webpatched.write_text(w)
# Check syntax in the same Node version as production before replacing anything.
for container,file in [('jason-home',patched),('jason-home-2-web',webpatched)]:
 run('sudo','docker','cp',str(file),container+':/tmp/check-'+file.name)
 run('sudo','docker','exec',container,'node','--check','/tmp/check-'+file.name)
helper=root/'JasonHomeServer/dist/eufy/verification.js';newui=root/'JasonHome2Server/web/android_eufy_ui.js';assert helper.is_file() and newui.is_file()
# Back up private config, retain the existing containers and data volumes.
shutil.copyfile('/home/ubuntu/repo/JasonHomeServer/.env',backup/'runtime.env');(backup/'runtime.env').chmod(0o600)
try:
 run('sudo','docker','cp',str(helper),'jason-home:/app/dist/eufy/verification.js')
 run('sudo','docker','cp',str(patched),'jason-home:/app/dist/server.js')
 run('sudo','docker','cp',str(webpatched),'jason-home-2-web:/app/server.mjs')
 run('sudo','docker','cp',str(newui),'jason-home-2-web:/app/web/android_eufy_ui.js')
 db=sqlite3.connect(dbfile,timeout=10);db.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('eufy_verification_required','1')");db.commit();db.close()
 run('sudo','docker','restart','jason-home','jason-home-2-web')
 token=env['JASON_HOME_API_TOKEN']
 def call(path,body=None):
  request=urllib.request.Request('http://127.0.0.1:8080'+path,None if body is None else json.dumps(body).encode(),{'Authorization':'Bearer '+token,'Content-Type':'application/json'})
  with urllib.request.urlopen(request,timeout=60) as response:return json.load(response)
 for attempt in range(20):
  try:
   health=call('/api/health')
   if health.get('ok'):break
  except Exception:time.sleep(1)
 else:raise RuntimeError('Controller did not restart')
 assert health.get('automationOwner')=='oracle'
 state=call('/api/status');assert state['calendar']['eventCount']==212
 challenge=call('/api/eufy/verification',{'action':'start'})
 assert challenge.get('type')=='captcha' and challenge.get('image','').startswith('data:image/')
 print('Eufy CAPTCHA generated and available in Settings; image and credentials withheld from logs.')
 print('Verified service health, Oracle ownership and 212 preserved events.')
 # Preserve the tested runtime layer as a local recovery image; existing restart policy remains intact.
 run('sudo','docker','commit','jason-home','jasonhomeserver-jason-home:eufy-verification-'+os.environ['GITHUB_RUN_ID'],stdout=subprocess.DEVNULL)
 run('sudo','docker','commit','jason-home-2-web','jason-home-2-web:eufy-verification-'+os.environ['GITHUB_RUN_ID'],stdout=subprocess.DEVNULL)
 print('Verification interface deployed and backed up. No automatic challenge answers attempted.')
except Exception:
 run('sudo','docker','cp',str(backend),'jason-home:/app/dist/server.js')
 run('sudo','docker','cp',str(web),'jason-home-2-web:/app/server.mjs')
 run('sudo','docker','cp',str(ui),'jason-home-2-web:/app/web/android_eufy_ui.js')
 run('sudo','docker','restart','jason-home','jason-home-2-web')
 raise
