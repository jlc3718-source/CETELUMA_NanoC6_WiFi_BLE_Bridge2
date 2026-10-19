#!/usr/bin/env python3
"""One-time Jason Home 2 Oracle-persistent AI animation tuning release.

No generic code execution endpoint is opened. Users can update only the two
validated animation prompt guides through the authenticated Jason Home 2 app.
The new code keeps Nano firmware, Native BLE, schedules and other UIs untouched.
"""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.request
import urllib.error

ROOT=Path(__file__).resolve().parents[2]/"JasonHome2Server"
CONTAINER="jason-home-2-web"
BACKUPS=Path("/home/ubuntu/jh2-oracle-ai-tuning-releases")
PATHS=["curtain_ai_animation.mjs","server.mjs","web/curtain_ai_animation.html"]

def cmd(*args,input=None):
    return subprocess.run(args,text=True,input=input,check=True,capture_output=True)

def require(ok,reason):
    if not ok:raise RuntimeError(reason)

def patch_once(source,old,new,label):
    if source.count(old)==0 and new in source:return source
    require(source.count(old)==1,f"{label} has changed; aborting instead of overwriting production")
    return source.replace(old,new,1)

def segment(text,start,end):
    i=text.find(start);j=text.find(end,i+len(start))
    require(i>=0 and j>i,"Release template marker missing")
    return text[i:j]

def patch_server(live):
    desired=(ROOT/"server.mjs").read_text()
    original='import { createCurtainAiAnimation } from "./curtain_ai_animation.mjs";'
    upgraded='import { createCurtainAiAnimation, normalizeCurtainAiGuides, CURTAIN_AI_DEFAULT_GUIDES } from "./curtain_ai_animation.mjs";'
    live=patch_once(live,original,upgraded,"AI module import")
    original='const curtainAnimationAi=createCurtainAiAnimation({run:cloudflareAiRun,chat:cloudflareAiChat,text:cloudflareAiText,configured:cloudflareAiConfigured,model:AI_MODEL});'
    upgraded='const curtainAnimationAi=createCurtainAiAnimation({run:cloudflareAiRun,chat:cloudflareAiChat,text:cloudflareAiText,configured:cloudflareAiConfigured,model:AI_MODEL,guides:()=>meta("curtain_ai_animation_guides",CURTAIN_AI_DEFAULT_GUIDES)});'
    live=patch_once(live,original,upgraded,"AI model config")
    block=segment(desired,"  // Authenticated Oracle-persistent prompt tuning.",'  if(method==="POST"&&path==="/api/curtain/ai-animation/generate")')
    anchor='  if(method==="POST"&&path==="/api/curtain/ai-animation/generate")'
    live=patch_once(live,anchor,block+anchor,"authenticated AI tuning endpoints")
    return live

def patch_ui(live):
    desired=(ROOT/"curtain_ai_animation.html").read_text()
    start='<details class="card" id="animationTuning">'
    block=segment(desired,start,'</details>')+'</details>'
    anchor='</section>\n</main>\n<script src="curtain_loop_animation.js"></script>'
    live=patch_once(live,anchor,'</section>\n'+block+'\n</main>\n<script src="curtain_loop_animation.js"></script>',"AI tuning panel")
    start='async function loadGuides(){'
    end="$('generate').onclick=generate;"
    actions=segment(desired,start,end)
    live=patch_once(live,end,actions+end,"AI tuning controls")
    original="window.addEventListener('load',()=>{refresh();resize();});"
    upgraded="window.addEventListener('load',()=>{refresh();resize();loadGuides().catch(e=>{$('guideStatus').textContent='AI tuning unavailable: '+e.message;});});"
    live=patch_once(live,original,upgraded,"AI tuning load")
    require("buildKeyframes" in live and "seamlessAnimation:true" in live,
            "Existing animation workflow has changed")
    return live

def validate_js(name,content):
    scripts=re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>',content,re.S) if name.endswith(".html") else [content]
    for code in scripts:
        if code.strip():cmd("docker","exec","-i",CONTAINER,"node","--input-type=module","--check",input=code)

def digest(s):
    return hashlib.sha256(s.encode()).hexdigest()

def get_health():
    try:
        with urllib.request.urlopen("http://127.0.0.1:8081/api/health",timeout=6) as response:
            return json.load(response).get("ok") is True
    except Exception:return False

def check_settings():
    info=json.loads(cmd("docker","inspect","jason-home").stdout)[0]
    environment=dict(s.split("=",1) for s in info["Config"]["Env"] if "=" in s)
    token=environment["JASON_HOME_API_TOKEN"]
    endpoint="http://127.0.0.1:8081"
    def post(path,data,cookie=""):
        req=urllib.request.Request(endpoint+path,data=json.dumps(data).encode(),
           method="POST",headers={"content-type":"application/json","cookie":cookie})
        with urllib.request.urlopen(req,timeout=25) as response:
            return json.load(response),response.headers
    (login,headers)=post("/api/session",{"token":token})
    require(login.get("ok") is True,"Session validation failed")
    cookie=headers.get("Set-Cookie","").split(";",1)[0]
    require(cookie.startswith("jh2="),"Missing authenticated session")
    def get():
        req=urllib.request.Request(endpoint+"/api/curtain/ai-animation/settings",
          headers={"cookie":cookie})
        with urllib.request.urlopen(req,timeout=12) as response:
            return json.load(response)
    current=get()
    require(current.get("ok") and current.get("storage")=="oracle","Settings read failed")
    guides=current["guides"]
    require(isinstance(guides.get("styleGuide"),str) and isinstance(guides.get("motionGuide"),str),
            "Malformed stored animation tuning")
    saved,_=post("/api/curtain/ai-animation/settings",guides,cookie)
    require(saved.get("ok") and saved["guides"]==guides,"Settings save failed")
    require(get()["guides"]==guides,"Settings did not persist")
    print("ORACLE_AI_TUNING_GET_SAVE_AND_PERSISTENCE_VERIFIED")

def main():
    require(get_health(),"Production server unhealthy; nothing changed")
    BACKUPS.mkdir(parents=True,exist_ok=True,mode=0o700)
    BACKUPS.chmod(0o700)
    stamp=time.strftime("%Y%m%dT%H%M%SZ",time.gmtime())
    backup=BACKUPS/(stamp+"-"+os.environ.get("GITHUB_SHA","manual")[:10])
    backup.mkdir(mode=0o700)
    old={}
    for path in PATHS:
        target=backup/path.replace("/","--")
        cmd("docker","cp",f"{CONTAINER}:/app/{path}",str(target))
        old[path]=target
    versions={
       "curtain_ai_animation.mjs":(ROOT/"curtain_ai_animation.mjs").read_text(),
       "server.mjs":patch_server(old["server.mjs"].read_text()),
       "web/curtain_ai_animation.html":patch_ui(old["web/curtain_ai_animation.html"].read_text()),
    }
    for name,source in versions.items():validate_js(name,source)
    changed=False
    try:
        with tempfile.TemporaryDirectory(prefix="jh2-ai-tuning-") as tmp:
            for path,source in versions.items():
                file=Path(tmp)/path.replace("/","--")
                file.write_text(source)
                changed=True
                cmd("docker","cp",str(file),f"{CONTAINER}:/app/{path}")
        cmd("docker","restart",CONTAINER)
        for _ in range(30):
            if get_health():break
            time.sleep(2)
        else:raise RuntimeError("Server failed after applying patch")
        for path,source in versions.items():
            actual=cmd("docker","exec",CONTAINER,"cat","/app/"+path).stdout
            require(digest(actual)==digest(source),"Deployed file mismatch: "+path)
        check_settings()
        (backup/"verified.json").write_text(json.dumps({
            "ok":True,"source":os.environ.get("GITHUB_SHA","manual"),
            "files":sorted(versions),"storage":"oracle-sqlite",
            "noGenericCodeUpload":True,"nanoFirmwareChanged":False},indent=2))
        print("ORACLE_TUNING_PUBLISHED_NO_GITHUB_NEEDED_FOR_PROMPT_ADJUSTMENTS")
    except BaseException:
        if changed:
            for path,file in old.items():
                cmd("docker","cp",str(file),f"{CONTAINER}:/app/{path}")
            cmd("docker","restart",CONTAINER)
        print("ORACLE_AI_TUNING_ROLLED_BACK")
        raise

if __name__=="__main__":main()
