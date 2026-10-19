#!/usr/bin/env python3
"""Scoped Jason Home 2 Oracle-local AI release with exact live-source merge.
No changes to Anderson, Jason Home original, scheduler, Nano, network or SQLite.
By default performs a read-only dry run. --apply backs up, verifies and rolls back.
"""
import argparse, difflib, hashlib, json, os, re, shutil, subprocess, tempfile, time, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/"JasonHome2Server"
CONTAINER="jason-home-2-web"
BASE="http://127.0.0.1:8081"
BACKUPS=Path("/home/ubuntu/jh2-local-ai-release-backups")
def require(v,msg):
 if not v:raise RuntimeError(msg)
def command(*args,stdin=None):
 return subprocess.run(args,input=stdin,text=True,capture_output=True,check=True)
def cp_in(source,destination):
 command("docker","cp",str(source),CONTAINER+":"+destination)
def cp_out(source,destination):
 command("docker","cp",CONTAINER+":"+source,str(destination))
def sha(content):
 return hashlib.sha256(content.encode()).hexdigest()
def merge_exact(old,new,live,label):
 """Carry forward every unrelated live source line; fail on ambiguous conflicts."""
 baseline=old.splitlines(keepends=True);target=new.splitlines(keepends=True)
 ops=difflib.SequenceMatcher(a=baseline,b=target,autojunk=False).get_opcodes()
 count=0
 for tag,a,b,c,d in ops:
  if tag=="equal":continue
  was="".join(baseline[a:b]);will="".join(target[c:d])
  if tag=="insert":
   left="".join(baseline[max(0,a-1):a]);right="".join(baseline[a:min(len(baseline),a+1)])
   anchor=left+right
   require(anchor and live.count(anchor)==1,label+" ambiguous insertion anchor")
   live=live.replace(anchor,left+will+right,1)
  else:
   require(was and live.count(was)==1,label+" live code changed in required AI patch anchor #"+str(count+1))
   live=live.replace(was,will,1)
  count+=1
 require(count>0 and count<45,label+" unsafe patch scope: "+str(count))
 print(label+"_SAFE_SCOPED_MERGE_PARTS="+str(count))
 return live
def script_check(name,source):
 scripts=re.findall(r"<script(?:\s[^>]*)?>(.*?)</script>",source,re.S|re.I) if name.endswith(".html") else [source]
 require(bool(scripts),"No inline JS to check: "+name)
 for part in scripts:
  if part.strip():command("docker","exec","-i",CONTAINER,"node","--input-type=module","--check",stdin=part)
def health():
 try:
  with urllib.request.urlopen(BASE+"/api/health",timeout=8) as resp:return json.load(resp).get("ok") is True
 except Exception:return False
def session():
 info=json.loads(command("docker","inspect","jason-home").stdout)[0]
 env=dict(v.split("=",1) for v in info["Config"]["Env"] if "=" in v)
 token=env.get("JASON_HOME_API_TOKEN","")
 require(bool(token),"Missing existing gateway login key")
 req=urllib.request.Request(BASE+"/api/session",data=json.dumps({"token":token}).encode(),
       method="POST",headers={"content-type":"application/json"})
 with urllib.request.urlopen(req,timeout=15) as resp:
  require(json.load(resp).get("ok") is True,"Could not validate app session")
  ck=resp.headers.get("set-cookie","").split(";",1)[0]
 require(ck.startswith("jh2="),"No authenticated gateway session")
 return ck
def api(path,cookie,body=None,timeout=25):
 req=urllib.request.Request(BASE+path,headers={"cookie":cookie,**({"content-type":"application/json"} if body is not None else {})},
    data=json.dumps(body).encode() if body is not None else None,method="POST" if body is not None else "GET")
 with urllib.request.urlopen(req,timeout=timeout) as response:return json.load(response)
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--baseline-server",required=True)
 parser.add_argument("--baseline-ui",required=True)
 parser.add_argument("--apply",action="store_true")
 args=parser.parse_args()
 require(health(),"Gateway unhealthy: refusing even to stage deployment")
 require((SOURCE/"local_ai.mjs").exists(),"Local model backend missing")
 originals={};targets={}
 with tempfile.TemporaryDirectory(prefix="jh2-ai-preflight-") as d:
  d=Path(d)
  paths={"server.mjs":"/app/server.mjs","anderson_home.html":"/app/web/anderson_home.html",
   "curtain_ai_animation.html":"/app/web/curtain_ai_animation.html"}
  for name,path in paths.items():
   src=d/("live_"+name);cp_out(path,src);originals[name]=src.read_text()
  require("buildSimpleAnimation" in originals["curtain_ai_animation.html"],
          "Live original 5x5 wink renderer not found")
  targets["server.mjs"]=merge_exact(Path(args.baseline_server).read_text(),
      (SOURCE/"server.mjs").read_text(),originals["server.mjs"],"JH2_GATEWAY")
  targets["anderson_home.html"]=merge_exact(Path(args.baseline_ui).read_text(),
      (SOURCE/"web/anderson_home.html").read_text(),originals["anderson_home.html"],"JH2_AI_PARENT")
  targets["curtain_ai_animation.html"]=(SOURCE/"curtain_ai_animation.html").read_text()
  # Curtain was previously verified byte-for-byte identical. Never overwrite a newer edit.
  expected="ce0c560669c4a72fcd01a5393bd86d2c693fb5e6"
  baseline_blob=command("git","hash-object",str(d/"live_curtain_ai_animation.html")).stdout.strip()
  require(baseline_blob==expected,"Curtain AI page has changed since initial audit")
  require('createLocalAI' in targets["server.mjs"] and '/api/local-ai/art' in targets["server.mjs"],
          "Server local AI routes missing")
  require("Oracle Self-Hosted AI" in targets["anderson_home.html"],"New provider not in parent UI")
  require("Quick Create" in targets["curtain_ai_animation.html"] and "AI Chat" in targets["curtain_ai_animation.html"],
          "Both user creation modes required")
  for name,source in targets.items():script_check(name,source)
  command("docker","exec",CONTAINER,"node","-e",
    "fetch('http://127.0.0.1:11434/api/tags').then(r=>r.json()).then(x=>{if(!x.models.some(m=>m.name==='qwen2.5:1.5b-instruct'))process.exit(1)})")
  print("JH2_LOCAL_AI_SCOPED_DRY_RUN_VALIDATED")
  if not args.apply:
   print("NO_LIVE_APPLICATION_FILES_CHANGED")
   return
  BACKUPS.mkdir(parents=True,exist_ok=True,mode=0o700);BACKUPS.chmod(0o700)
  release=BACKUPS/(time.strftime("%Y%m%dT%H%M%SZ",time.gmtime())+"-"+os.environ.get("GITHUB_SHA","manual")[:9])
  release.mkdir(mode=0o700)
  for name,source in originals.items():(release/name).write_text(source)
  module_path="/app/local_ai.mjs"
  old_module=d/"old_local_ai.mjs"
  module_existed=subprocess.run(["docker","exec",CONTAINER,"test","-e",module_path],capture_output=True).returncode==0
  if module_existed:cp_out(module_path,old_module);shutil.copy(old_module,release/"local_ai.mjs")
  changed=False
  try:
   newmodule=SOURCE/"local_ai.mjs"
   cp_in(newmodule,module_path);changed=True
   for name,path in paths.items():
    prepared=d/("new_"+name);prepared.write_text(targets[name]);cp_in(prepared,path)
   command("docker","restart",CONTAINER)
   for attempt in range(30):
    if health():break
    time.sleep(1.5)
   require(health(),"App health check failed after update")
   cookie=session()
   status=api("/api/local-ai/status",cookie)
   require(status.get("ok") is True and status.get("model")=="qwen2.5:1.5b-instruct","Local AI unavailable from gateway")
   state=api("/api/ai",cookie)
   require(state.get("provider")=="Oracle Self-Hosted AI" and state.get("configured") is True,
           "Lighting AI page not configured for Oracle provider")
   art=api("/api/curtain/ai-animation/generate",cookie,
           {"prompt":"Friendly orange jack-o-lantern with two triangular eyes and green stem"},timeout=255)
   require(art.get("ok") is True and art.get("image","").startswith("data:image/png;base64,"),
          "Oracle local artwork endpoint did not generate actual 40x40 PNG")
   require(art.get("sourceKind")=="model","Artwork model failed: only starter template returned")
   for name,path in paths.items():
    installed=command("docker","exec",CONTAINER,"cat",path).stdout
    require(sha(installed)==sha(targets[name]),"Updated asset hash mismatch "+name)
   (release/"verified.json").write_text(json.dumps({
     "ok":True,"source":os.environ.get("GITHUB_SHA","manual"),
     "files":["server.mjs","local_ai.mjs","web/anderson_home.html","web/curtain_ai_animation.html"],
     "provider":"Oracle Self-Hosted AI","model":"qwen2.5:1.5b-instruct",
     "legacyVoiceAndPhotoAIStillExternal":True,
     "controllerChanged":False,"nanoFirmwareChanged":False,"andersonChanged":False,
     "rollbackBackup":str(release),"artSource":art.get("sourceKind")
   },indent=2))
   print("JH2_LOCAL_AI_LIVE_GATEWAY_AND_ARTWORK_VERIFIED")
   print("JH2_LIVE_OLDER_CLOUD_AI_VOICE_AND_PHOTO_REMAIN_PENDING")
  except BaseException:
   if changed:
    for name,path in paths.items():cp_in(release/name,path)
    if module_existed:cp_in(release/"local_ai.mjs",module_path)
    else:command("docker","exec",CONTAINER,"rm","-f",module_path)
    command("docker","restart",CONTAINER)
   print("JH2_AI_RELEASE_ROLLED_BACK")
   raise
if __name__=="__main__":main()
