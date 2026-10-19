#!/usr/bin/env python3
"""Publish true frame-by-frame AI Curtain animation, removing obsolete Native UI.
No firmware, Oracle command queue, schedules, database or other device changes.
All production edits are backed up on Oracle and rolled back on any failed check.
"""
from pathlib import Path
import hashlib, json, os, re, subprocess, tempfile, time, urllib.request

ROOT=Path(__file__).resolve().parents[2]/"JasonHome2Server"
CONTAINER="jason-home-2-web"
RELEASES=Path("/home/ubuntu/jh2-animation-keyposes-releases")
TARGETS={
 "curtain_ai_animation.mjs":"curtain_ai_animation.mjs",
 "curtain_ai_animation.html":"web/curtain_ai_animation.html",
 "curtain_loop_animation.js":"web/curtain_loop_animation.js",
}
NAV="web/curtain.js"
OBSOLETE="web/curtain_native_test.html"

def run(*args,input=None):
 return subprocess.run(args,input=input,text=True,check=True,capture_output=True)
def require(v,why):
 if not v:raise RuntimeError(why)
def patch_navigation(live):
 if "jh2CurtainNativeTestTab" not in live:
  require("jh2CurtainAnimationTab" in live,"No AI animation tab found")
  return live
 start=live.find("  // Native Animation Test is an isolated research workspace.")
 if start<0:start=live.find("  const testButton=create(")
 end=live.find("  // New AI Animation tab",start)
 require(start>=0 and end>start,"Native Test block unexpectedly changed")
 live=live[:start]+live[end:]
 exact=[
  ("subnav.append(oldButton,studioButton,testButton,aiButton)",
   "subnav.append(oldButton,studioButton,aiButton)"),
  ("page.append(subnav,controls,studio,testPanel,aiPanel)",
   "page.append(subnav,controls,studio,aiPanel)"),
  ("testPanel.hidden=which!=='test';",""),
  ("    testPanel.style.display=which==='test'?'':'none';\n",""),
  ("[testButton,which==='test'],",""),
  ("    if(which==='test'&&!testFrame.getAttribute('src'))testFrame.src='curtain_native_test.html?v=pumpkin-delta-20261019';\n",""),
  ("  testButton.addEventListener('click',()=>selectCurtainSubtab('test'));\n",""),
  ("event.source===testFrame.contentWindow?testFrame:",""),
  ("[studioFrame,testFrame,aiFrame]","[studioFrame,aiFrame]"),
 ]
 for original,new in exact:
  if original not in live and original.startswith("    if(which==='test'"):
   match=re.search(r"^\s*if\(which==='test'[^\n]*\n",live,re.M)
   require(match is not None,"Missing Native Test loader")
   live=live[:match.start()]+live[match.end():]
   continue
  require(live.count(original)==1,"Unexpected Native Test dependency: "+original[:70])
  live=live.replace(original,new,1)
 a=live.find("  let pendingNativeTest=null;")
 z=live.find("  function selectCurtainSubtab(which){",a)
 require(a>=0 and z>a,"Native Test delivery function changed")
 live=live[:a]+live[z:]
 a=live.find("    if(sender===studioFrame&&data.kind==='jh2-native-test-open'){")
 z=live.find("    if(data.kind!=='jh2-curtain-request')return;",a)
 require(a>=0 and z>a,"Native Test postMessage bridge changed")
 live=live[:a]+live[z:]
 live=live.replace("curtain_ai_animation.html?v=nano-loop-155","curtain_ai_animation.html?v=real-poses-20261019")
 require(not any(x in live for x in ("testButton","testFrame","testPanel","pendingNativeTest","deliverNativeTest","jh2CurtainNativeTestTab")),
  "An obsolete Native Test reference remains")
 require("jh2CurtainAnimationTab" in live,"AI Animation tab disappeared")
 return live
def js_check(name,source):
 if name.endswith(".html"):
  snippets=re.findall(r"<script(?:\s[^>]*)?>(.*?)</script>",source,re.S)
 else:snippets=[source]
 require(bool(snippets),"No JavaScript in "+name)
 for snippet in snippets:
  if snippet.strip():run("docker","exec","-i",CONTAINER,"node","--input-type=module","--check",input=snippet)
def health():
 try:
  with urllib.request.urlopen("http://127.0.0.1:8081/api/health",timeout=6) as x:
   return json.load(x).get("ok") is True
 except Exception:return False
def sha(x):return hashlib.sha256(x.encode()).hexdigest()
def main():
 require(health(),"Production Jason Home 2 is unhealthy; no changes attempted")
 RELEASES.mkdir(exist_ok=True,parents=True,mode=0o700)
 release=RELEASES/(time.strftime("%Y%m%dT%H%M%SZ",time.gmtime())+"-"+os.environ.get("GITHUB_SHA","manual")[:12])
 release.mkdir(mode=0o700)
 original={}
 all_targets=[*TARGETS.values(),NAV,OBSOLETE]
 for target in all_targets:
  dest=release/target.replace("/","--")
  run("docker","cp",f"{CONTAINER}:/app/{target}",str(dest))
  original[target]=dest
 changes={dest:(ROOT/src).read_text() for src,dest in TARGETS.items()}
 changes[NAV]=patch_navigation(original[NAV].read_text())
 for target,value in changes.items():js_check(target,value)
 require("buildKeyframes" in changes["web/curtain_ai_animation.html"],"New UI doesn't reference animation key poses")
 require("four" in changes["web/curtain_ai_animation.html"].lower() or "poses" in changes["web/curtain_ai_animation.html"],
  "AI pose generation missing")
 require("output.push(new Uint8ClampedArray(first))" in changes["web/curtain_loop_animation.js"],"Loop closure missing")
 changed=False
 try:
  with tempfile.TemporaryDirectory(prefix="jh2-gif-poses-") as tmp:
   for dest,content in changes.items():
    file=Path(tmp)/dest.replace("/","--")
    file.write_text(content)
    run("docker","cp",str(file),f"{CONTAINER}:/app/{dest}")
  changed=True
  run("docker","restart",CONTAINER)
  for _ in range(35):
   if health():break
   time.sleep(2)
  else:raise RuntimeError("Web server did not recover")
  for dest,content in changes.items():
   actual=run("docker","exec",CONTAINER,"cat","/app/"+dest).stdout
   require(sha(actual)==sha(content),"Live source checksum mismatch: "+dest)
  require("jh2CurtainNativeTestTab" not in run("docker","exec",CONTAINER,"cat","/app/"+NAV).stdout,
    "Obsolete Native UI still linked")
  # Preserve Native BLE firmware & protocol; remove only the obsolete web page.
  run("docker","exec","--user","root",CONTAINER,"rm","-f","/app/"+OBSOLETE)
  require(health(),"Web health failed after deleting Native Test webpage")
  (release/"verified.json").write_text(json.dumps({
   "success":True,"sourceCommit":os.environ.get("GITHUB_SHA","manual"),
   "changed":sorted(changes),"nativeUITabRemoved":True,
   "nativeBLEProtocolRetained":True,"nanoFirmwareUnchanged":True
  },indent=2))
  print("REAL_GIF_KEYPOSES_PRODUCTION_PUBLISHED_NATIVE_TAB_REMOVED")
 except BaseException:
  if changed:
   for dest,old in original.items():
    run("docker","cp",str(old),f"{CONTAINER}:/app/{dest}")
   run("docker","restart",CONTAINER)
  print("REAL_GIF_KEYPOSES_PRODUCTION_ROLLED_BACK")
  raise
if __name__=="__main__":main()
