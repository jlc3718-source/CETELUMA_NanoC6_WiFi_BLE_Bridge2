#!/usr/bin/env python3
"""Rollback-safe hotfix for the AI Animation Cloudflare FLUX input schema.

Touches only /app/curtain_ai_animation.mjs in Jason Home 2 web container.
Preserves all other UI, Nano firmware, database, schedules and credentials.
"""
from pathlib import Path
from datetime import datetime,timezone
import hashlib
import json
import os
import subprocess
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/"JasonHome2Server/curtain_ai_animation.mjs"
CONTAINER="jason-home-2-web"
DEST="/app/curtain_ai_animation.mjs"
BACKUPS=Path("/home/ubuntu/jh2-animation-flux-fixes")

def run(*command,stdin=None):
    return subprocess.run(command,text=True,input=stdin,
                          check=True,capture_output=True)

def healthy():
    try:
        with urllib.request.urlopen("http://127.0.0.1:8081/api/health",timeout=6) as r:
            return json.load(r).get("ok") is True
    except Exception:
        return False

def sha(content):
    return hashlib.sha256(content.encode()).hexdigest()

def main():
    assert healthy(),"Production unhealthy before deployment; nothing changed"
    updated=SOURCE.read_text()
    assert "steps:4" in updated and "seed:" not in updated
    assert "AI-drawn-keyframes" in updated and "poses" in updated
    run("docker","exec","-i",CONTAINER,"node","--input-type=module","--check",stdin=updated)
    BACKUPS.mkdir(parents=True,exist_ok=True,mode=0o700)
    BACKUPS.chmod(0o700)
    label=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup=BACKUPS/(label+"-"+os.environ.get("GITHUB_SHA","manual")[:10]+".mjs")
    run("docker","cp",f"{CONTAINER}:{DEST}",str(backup))
    original=backup.read_text()
    assert "createCurtainAiAnimation" in original and "poses" in original, "Unexpected production module, abort"
    changed=False
    try:
        run("docker","cp",str(SOURCE),f"{CONTAINER}:{DEST}")
        changed=True
        run("docker","restart",CONTAINER)
        for _ in range(30):
            if healthy():break
            time.sleep(2)
        else:
            raise RuntimeError("Production did not recover")
        deployed=run("docker","exec",CONTAINER,"cat",DEST).stdout
        assert sha(deployed)==sha(updated),"Deployed module checksum mismatch"
        assert "seed:" not in deployed
        assert "AI-drawn-keyframes" in deployed
        print("ANIMATION_CLOUDFLARE_FLUX_SEED_FIX_PUBLISHED_HEALTHY")
    except BaseException:
        if changed:
            run("docker","cp",str(backup),f"{CONTAINER}:{DEST}")
            run("docker","restart",CONTAINER)
        print("ANIMATION_CLOUDFLARE_FLUX_SEED_FIX_ROLLED_BACK")
        raise
if __name__=="__main__":
    main()
