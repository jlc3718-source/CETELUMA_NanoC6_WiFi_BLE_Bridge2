#!/usr/bin/env python3
"""One-time rollback-safe Jason Home 2 AI animation rollout.
Patches only current production code, preserves other deployed functionality,
and never changes firmware or sends a Bluetooth display command.
"""
from pathlib import Path
import hashlib, os, re, subprocess, tempfile, json, urllib.request, time, shutil

ROOT=Path(__file__).resolve().parents[2]/"JasonHome2Server"
CONTAINER="jason-home-2-web"
NEW={
 "curtain_ai_animation.mjs":"curtain_ai_animation.mjs",
 "curtain_ai_animation.html":"web/curtain_ai_animation.html",
 "curtain_loop_animation.js":"web/curtain_loop_animation.js",
}
PATCHED=("server.mjs","curtain_asset.mjs","curtain_bridge.mjs",
         "web/curtain.js","web/curtain_converter.html")
REMOVED="web/curtain_local_test.html"
RELEASES=Path("/home/ubuntu/jh2-ai-animation-releases")

def run(*args):
 return subprocess.run(args,text=True,capture_output=True,check=True)
def must_replace(s,old,new,label):
 if new in s and old not in s:return s
 if s.count(old)!=1:
  raise RuntimeError(f"Unexpected existing {label}: expected one anchor, saw {s.count(old)}")
 return s.replace(old,new,1)
def js_check(text,name):
 cmd=["docker","exec","-i",CONTAINER,"node","--input-type=module","--check"]
 scripts=[text] if name.endswith((".js",".mjs")) else re.findall(r"<script(?:\s[^>]*)?>(.*?)</script>",text,re.S)
 for script in scripts:
  if not script.strip():continue
  subprocess.run(cmd,input=script,text=True,capture_output=True,check=True)
def health():
 try:
  with urllib.request.urlopen("http://127.0.0.1:8081/api/health",timeout=5) as x:return json.load(x).get("ok") is True
 except Exception:return False
def from_live(name,backup):
 dest=backup/name.replace("/","--")
 run("docker","cp",f"{CONTAINER}:/app/{name}",str(dest))
 return dest
def diff_encoder(live):
 source=(ROOT/"curtain_asset.mjs").read_text()
 start=source.index("// 40×40 AI animation package for self-timed Nano playback")
 end=source.index("export const MAX_ASSET_BYTES",start)
 addition=source[start:end]
 marker="export const MAX_ASSET_BYTES=4*1024*1024;"
 live=must_replace(live,marker,addition+marker,"AI animation compiler")
 marker="export function compileAsset(input){\n"
 line=" if(input?.seamlessAnimation===true)return compileSeamlessAnimation(input);\n"
 return must_replace(live,marker,marker+line,"AI compiler dispatch")
def diff_bridge(live):
 marker=" if(action==='nanoAutoUpdate'"
 speed=" if(action==='assetSpeed'){if(!Number.isInteger(p.percent)||p.percent<25||p.percent>300)throw fail(400,'Nano animation speed must be 25–300 percent');return {percent:p.percent};}\n"
 live=must_replace(live,marker,speed+marker,"speed validator")
 marker="'nanoAutoUpdate'].includes(action)"
 live=must_replace(live,marker,"'nanoAutoUpdate','assetSpeed'].includes(action)","transient speed command")
 marker="originalBytes:a.bytes.length,nanoCached:false"
 if marker in live:
  live=live.replace(marker,marker+",...(a.format==='jh2-nano-seamless-delta-v1'?{seamless:true,changedPixels:a.changedPixels,packetCount:a.packetCount}:{})",1)
 return live
def diff_server(live):
 marker='import { createNanoC6BrightnessSync } from "./nanoc6_sync.mjs";'
 live=must_replace(live,marker,marker+'\nimport { createCurtainAiAnimation } from "./curtain_ai_animation.mjs";',"AI module import")
 marker="const curtainRelay=createCurtainBridge({db});"
 live=must_replace(live,marker,marker+"\nconst curtainAnimationAi=createCurtainAiAnimation({run:cloudflareAiRun,chat:cloudflareAiChat,text:cloudflareAiText,configured:cloudflareAiConfigured,model:AI_MODEL});","AI initializer")
 marker='if(method==="POST"&&path==="/api/curtain/ai-revamp")'
 extra='if(method==="POST"&&path==="/api/curtain/ai-animation/generate")return send(res,200,await curtainAnimationAi.generate(await input(req)));\n  if(method==="POST"&&path==="/api/curtain/ai-animation/motion")return send(res,200,await curtainAnimationAi.motion(await input(req)));\n  '
 live=must_replace(live,marker,extra+marker,"AI generate and motion routes")
 if live.count('"curtain_local_test.html"')<2:
  raise RuntimeError("Unexpected live Local Test allowlist/CSP")
 live=live.replace('"curtain_local_test.html"','"curtain_ai_animation.html","curtain_loop_animation.js"',1)
 live=must_replace(live,'name==="curtain_local_test.html"','name==="curtain_ai_animation.html"',"AI iframe CSP")
 return live
def diff_parent(live):
 source=(ROOT/"curtain.js").read_text()
 def region(s,start,end,label):
  a=s.find(start)
  b=s.find(end,a+len(start))
  if a<0 or b<0:raise RuntimeError("Missing "+label)
  return a,b
 # Patch only Curtain navigation and iframe messaging, not Eufy or settings.
 start="  // Nano-local animation cache test"
 end="  function deliverNativeTest()"
 a,z=region(live,start,end,"obsolete Local Test")
 q,w=region(source,"  // New AI Animation tab",end,"new AI Animation")
 live=live[:a]+source[q:w]+live[z:]
 start="  function selectCurtainSubtab(which){"
 end="  // The two iframes share only"
 a,z=region(live,start,end,"tab switcher")
 q,w=region(source,start,end,"new tab switcher")
 fragment=source[q:w].replace("curtain_native_test.html?v=ram-upload-1.1.49",
                              "curtain_native_test.html?v=pumpkin-delta-20261019")
 live=live[:a]+fragment+live[z:]
 start="  window.addEventListener('message',async event=>{"
 end="  selectCurtainSubtab('controls');"
 a,z=region(live,start,end,"postMessage bridge")
 q,w=region(source,start,end,"new postMessage bridge")
 live=live[:a]+source[q:w]+live[z:]
 assert "jh2CurtainAnimationTab" in live and "pendingLocalTest" not in live
 return live
def diff_studio(live):
 button='<button id="sendLocalTest" type="button">Local Test → Nano</button>'
 if live.count(button)!=1:raise RuntimeError("Studio Local Test export source drift")
 live=live.replace(button,"",1)
 anchor="$('sendLocalTest').onclick=()=>{"
 end="$('stopSend').onclick="
 a=live.find(anchor);z=live.find(end,a)
 if a<0 or z<0:raise RuntimeError("Studio Local Test callback source drift")
 return live[:a]+live[z:]
def make_stage(original):
 patches={
  "curtain_asset.mjs":diff_encoder,
  "curtain_bridge.mjs":diff_bridge,
  "server.mjs":diff_server,
  "web/curtain.js":diff_parent,
  "web/curtain_converter.html":diff_studio,
 }
 result={}
 for name,fn in patches.items():result[name]=fn(original[name].read_text())
 for filename,dest in NEW.items():result[dest]=(ROOT/filename).read_text()
 for name,content in result.items():js_check(content,name)
 return result
def main():
 assert health(),"Jason Home 2 web server is currently unhealthy: abort without changes"
 RELEASES.mkdir(mode=0o700,parents=True,exist_ok=True);RELEASES.chmod(0o700)
 rev=os.environ.get("GITHUB_SHA","manual")[:12]
 rel=RELEASES/(time.strftime("%Y%m%dT%H%M%SZ",time.gmtime())+"-"+rev)
 rel.mkdir(mode=0o700)
 originals={}
 present={}
 for name in (*PATCHED,*NEW.values(),REMOVED):
  try:
   originals[name]=from_live(name,rel);present[name]=True
  except subprocess.CalledProcessError:
   if name in PATCHED or name==REMOVED:raise
   present[name]=False
 before=run("docker","exec",CONTAINER,"sha256sum","/app/web/curtain_native_test.html").stdout
 staged=make_stage(originals)
 try:
  with tempfile.TemporaryDirectory(prefix="jh2-ai-staging-") as tmp:
   for name,content in staged.items():
    path=Path(tmp)/name.replace("/","--");path.write_text(content)
    run("docker","cp",str(path),f"{CONTAINER}:/app/{name}")
  run("docker","restart",CONTAINER)
  for _ in range(30):
   if health():break
   time.sleep(2)
  else:raise RuntimeError("web health did not recover")
  for name,content in staged.items():
   actual=run("docker","exec",CONTAINER,"cat","/app/"+name).stdout
   if hashlib.sha256(actual.encode()).hexdigest()!=hashlib.sha256(content.encode()).hexdigest():
    raise RuntimeError("Deployed source digest mismatch "+name)
  if run("docker","exec",CONTAINER,"sha256sum","/app/web/curtain_native_test.html").stdout!=before:
   raise RuntimeError("Working Native Test was unexpectedly modified")
  # The obsolete local page is removed only after a fully verified new release.
  run("docker","exec",CONTAINER,"rm","-f","/app/"+REMOVED)
  run("docker","restart",CONTAINER)
  for _ in range(30):
   if health():break
   time.sleep(2)
  else:raise RuntimeError("web health failed after Local Test removal")
  # The main app and its authenticated static routes remain served unchanged.
  assert "jh2CurtainAnimationTab" in run("docker","exec",CONTAINER,"cat","/app/web/curtain.js").stdout
  assert "assetSpeed" in run("docker","exec",CONTAINER,"cat","/app/curtain_bridge.mjs").stdout
  (rel/"verified.json").write_text(json.dumps({"commit":rev,"healthy":True,"nanoFlashed":False,
   "changed":sorted(staged),"removedLocalTest":True,"workingNativeTestPreserved":True},indent=2))
  print("JH2_AI_ANIMATION_PRODUCTION_UI_PUBLISHED_HEALTHY_NATIVE_TEST_PRESERVED")
 except BaseException:
  for name,file in originals.items():
   run("docker","cp",str(file),f"{CONTAINER}:/app/{name}")
  for name,exists in present.items():
   if not exists:run("docker","exec",CONTAINER,"rm","-f","/app/"+name)
  run("docker","restart",CONTAINER)
  print("JH2_AI_ANIMATION_ROLLED_BACK")
  raise
if __name__=="__main__":main()
