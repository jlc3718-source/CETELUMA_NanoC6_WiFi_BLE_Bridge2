#!/usr/bin/env python3
"""Publish only the two Jason Home 2 AI animation web assets on Oracle.

Implements the proven three-frame wink pattern: one original 40x40 picture,
a 5x5 eye/mouth edit, and exact restoration. No AI re-rendering, Nano flash,
DB migrations, extra endpoints, background workflows, or Docker restart.
Backs up and validates real authenticated HTTP responses before success.
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

ROOT=Path(__file__).resolve().parents[2]/"JasonHome2Server"
CONTAINER="jason-home-2-web"
NAMES=("curtain_loop_animation.js","curtain_ai_animation.html")
BACKUPS=Path("/home/ubuntu/jh2-small-pixel-animation-releases")
BASE="http://127.0.0.1:8081"

def run(*args,stdin=None):
    return subprocess.run(args,text=True,input=stdin,check=True,capture_output=True)

def require(condition,message):
    if not condition:raise RuntimeError(message)

def digest(content):
    return hashlib.sha256(content.encode()).hexdigest()

def health():
    try:
        with urllib.request.urlopen(BASE+"/api/health",timeout=6) as r:
            return json.load(r).get("ok") is True
    except Exception:return False

def validate_script(name,source):
    scripts=re.findall(r"<script(?:\s[^>]*)?>(.*?)</script>",source,re.S) if name.endswith(".html") else [source]
    require(bool(scripts),"Missing animation JavaScript")
    for code in scripts:
        if code.strip():
            run("docker","exec","-i",CONTAINER,"node","--input-type=module","--check",stdin=code)

def authenticated_http():
    inspection=json.loads(run("docker","inspect","jason-home").stdout)[0]
    env=dict(item.split("=",1) for item in inspection["Config"]["Env"] if "=" in item)
    token=env["JASON_HOME_API_TOKEN"]
    request=urllib.request.Request(BASE+"/api/session",method="POST",
      data=json.dumps({"token":token}).encode(),
      headers={"content-type":"application/json"})
    with urllib.request.urlopen(request,timeout=18) as r:
        require(json.load(r).get("ok") is True,"No authenticated web session")
        cookie=r.headers.get("set-cookie","").split(";",1)[0]
    require(cookie.startswith("jh2="),"Session cookie missing")
    return cookie

def served_asset(name,cookie):
    request=urllib.request.Request(BASE+"/"+name,headers={"cookie":cookie})
    with urllib.request.urlopen(request,timeout=15) as r:
        require(r.status==200,"Web asset not served")
        require(r.headers.get("cache-control")=="no-store","WebView may cache the old animation")
        return r.read().decode("utf8")

def main():
    require(health(),"Jason Home 2 unhealthy before update")
    originals={};targets={name:(ROOT/name).read_text() for name in NAMES}
    require("buildSimpleAnimation" in targets[NAMES[0]] and
            "buildKeyframes" not in targets[NAMES[0]],"Old full-pose engine still present")
    require("L.buildSimpleAnimation(base" in targets[NAMES[1]],"HTML not using 5x5 wink")
    require("async function animate()" in targets[NAMES[1]] and
            "await api(" not in targets[NAMES[1]].split("async function animate(){",1)[1].split("async function publish(){",1)[0],
            "Animate must not call any AI image or storyboard service")
    for name,source in targets.items():validate_script(name,source)
    BACKUPS.mkdir(parents=True,exist_ok=True,mode=0o700)
    BACKUPS.chmod(0o700)
    release=BACKUPS/(time.strftime("%Y%m%dT%H%M%SZ",time.gmtime())+"-"+os.environ.get("GITHUB_SHA","manual")[:10])
    release.mkdir(mode=0o700)
    for name in NAMES:
        copy=release/name
        run("docker","cp",CONTAINER+":/app/web/"+name,str(copy))
        originals[name]=copy.read_text()
        require("40x40" in originals[name].lower() or "40×40" in originals[name] or
                "buildKeyframes" in originals[name],"Unexpected installed animation web asset")
    changed=False
    try:
        with tempfile.TemporaryDirectory(prefix="jh2-simple-wink-") as directory:
            for name,source in targets.items():
                temporary=Path(directory)/name
                temporary.write_text(source)
                changed=True
                run("docker","cp",str(temporary),CONTAINER+":/app/web/"+name)
        for name,source in targets.items():
            copied=run("docker","exec",CONTAINER,"cat","/app/web/"+name).stdout
            require(digest(copied)==digest(source),"Container file hash mismatch: "+name)
        require(health(),"Jason Home 2 became unhealthy after file update")
        cookie=authenticated_http()
        for name,source in targets.items():
            require(digest(served_asset(name,cookie))==digest(source),
                    "Authenticated HTTP returned old animation file "+name)
        (release/"verified.json").write_text(json.dumps({
            "ok":True,"source":os.environ.get("GITHUB_SHA","manual"),
            "installedFiles":list(NAMES),"httpVerified":True,
            "maxChangedPixelsPerFrame":25,"nanoFirmwareChanged":False,
            "serverRestarted":False,"otherAppFilesChanged":False
        },indent=2))
        print("SIMPLE_5X5_WINK_ANIMATION_LIVE_HTTP_VERIFIED_NO_SERVER_RESTART")
    except BaseException:
        if changed:
            with tempfile.TemporaryDirectory(prefix="jh2-wink-rollback-") as directory:
                for name,source in originals.items():
                    path=Path(directory)/name
                    path.write_text(source)
                    run("docker","cp",str(path),CONTAINER+":/app/web/"+name)
        print("SIMPLE_WINK_ROLLED_BACK")
        raise

if __name__=="__main__":main()
