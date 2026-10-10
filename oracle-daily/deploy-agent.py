#!/usr/bin/env python3
"""Install persistent runtime mounts with a recoverable original container."""
import datetime
import http.client
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request

class Docker(http.client.HTTPConnection):
    def __init__(self):
        super().__init__("localhost")
    def connect(self):
        self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        self.sock.connect("/var/run/docker.sock")

def api(method,url,body=None):
    connection=Docker()
    data=json.dumps(body).encode() if body is not None else None
    connection.request(method,url,body=data,headers={"Content-Type":"application/json"})
    response=connection.getresponse()
    raw=response.read()
    if response.status>=400:
        raise RuntimeError("Docker API failed: "+method+" "+url+" HTTP "+str(response.status))
    return json.loads(raw) if raw else {}

def command(*args):
    subprocess.run(args,check=True,stdout=sys.stderr)

def health():
    with urllib.request.urlopen("http://127.0.0.1:8932/health",timeout=3) as response:
        return json.load(response)

def selfcheck():
    request=urllib.request.Request("http://127.0.0.1:8932/run",data=json.dumps({"id":"daily-deploy-check","task":"agent_selfcheck"}).encode(),headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(request,timeout=5) as response:
        data=json.load(response)
    if data.get("result",{}).get("version")!="2026.10.10.1":
        raise RuntimeError("New runtime dispatch not active")
    return data["result"]

def main():
    cid=sys.argv[1]
    source=pathlib.Path(sys.argv[2]).resolve()
    inspect=api("GET","/containers/"+cid+"/json")
    data_mount=next(m for m in inspect["Mounts"] if m["Destination"]=="/data" and m["Type"]=="bind")
    root=pathlib.Path(data_mount["Source"])/"daily-runtime-v2"
    backup=root.parent/("daily-runtime-backup-"+datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    backup.mkdir(mode=0o700)
    if root.exists():shutil.copytree(root,backup/"runtime",dirs_exist_ok=True)
    root.mkdir(mode=0o700,exist_ok=True)
    (backup/"container.json").write_text(json.dumps(inspect))
    (backup/"container.json").chmod(0o600)
    try:
        command("docker","cp",cid+":/app/src/server.js",str(root/"server.js"))
        command("docker","cp",cid+":/app/src/fast-daily.js",str(root/"fast-daily.js"))
        command("python3",str(source/"patch-agent.py"),str(root/"server.js"),str(source/"legacy-patches.json"))
        runtime=root/"module"
        shutil.copytree(source,runtime,dirs_exist_ok=True)
        for name in ("server.js","fast-daily.js"):(root/name).chmod(0o600)
        command("docker","exec",cid,"node","--check","/data/daily-runtime-v2/server.js")
        command("docker","exec",cid,"node","--check","/data/daily-runtime-v2/module/runtime.js")
    except Exception:
        if (backup/"runtime").exists():
            shutil.rmtree(root)
            shutil.copytree(backup/"runtime",root)
        raise
    # The configuration never leaves the Oracle host. Its environment and vault
    # mounts are preserved without placing credentials in CLI arguments or Git.
    config={k:v for k,v in inspect["Config"].items() if k not in ("Hostname","Domainname")}
    config["Image"]=inspect["Image"]
    host=inspect["HostConfig"]
    replacements={str(root/"server.js")+":/app/src/server.js:ro",str(root/"fast-daily.js")+":/app/src/fast-daily.js:ro",str(runtime)+":/app/src/daily-runtime-v2:ro"}
    host["Binds"]=[b for b in host.get("Binds",[]) if b.split(":")[1] not in ("/app/src/server.js","/app/src/fast-daily.js","/app/src/daily-runtime-v2")]+sorted(replacements)
    if host.get("RestartPolicy",{}).get("Name") not in ("always","unless-stopped"):
        host["RestartPolicy"]={"Name":"unless-stopped","MaximumRetryCount":0}
    config["HostConfig"]=host
    labels=config.setdefault("Labels",{})
    labels["oracle.daily.runtime"]="2026.10.10.1"
    name=inspect["Name"].lstrip("/")
    old_name=name+"-before-daily-v2-"+datetime.datetime.now(datetime.timezone.utc).strftime("%H%M%S")
    (root/"container-create.json").write_text(json.dumps(config))
    (root/"container-create.json").chmod(0o600)
    created=None
    try:
        api("POST","/containers/"+cid+"/stop?t=12")
        api("POST","/containers/"+cid+"/rename?name="+urllib.parse.quote(old_name))
        created=api("POST","/containers/create?name="+urllib.parse.quote(name),config)["Id"]
        api("POST","/containers/"+created+"/start")
        checked=None
        for _ in range(25):
            try:
                health()
                checked=selfcheck()
                break
            except Exception:
                time.sleep(1)
        if not checked:raise RuntimeError("New runtime failed its health/dispatch checks")
        mounted=api("GET","/containers/"+created+"/json")["Mounts"]
        if not any(m["Destination"]=="/app/src/daily-runtime-v2" for m in mounted):
            raise RuntimeError("Runtime persistence mount missing")
        print(json.dumps({"deployed":True,"version":checked["version"],"persistent_bind_mounts":True,"backup_container":old_name,"rollback_directory":str(backup),"health":health()}))
    except Exception:
        if created:
            try:api("POST","/containers/"+created+"/stop?t=5")
            except Exception:pass
            try:api("DELETE","/containers/"+created+"?v=false")
            except Exception:pass
        if (backup/"runtime").exists():
            shutil.rmtree(root)
            shutil.copytree(backup/"runtime",root)
        api("POST","/containers/"+cid+"/rename?name="+urllib.parse.quote(name))
        api("POST","/containers/"+cid+"/start")
        raise

if __name__=="__main__":main()
