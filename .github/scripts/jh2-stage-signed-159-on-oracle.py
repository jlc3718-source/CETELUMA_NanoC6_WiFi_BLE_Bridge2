#!/usr/bin/env python3
"""Atomically stage verified signed OTA 1.1.59 through Jason Home 2 ONLY.
No other services, Eufy, schedules, code roots, credentials, or firmware affected.
"""
import base64, hashlib, json, os, pathlib, shutil, subprocess, tempfile, time, urllib.request

def run(cmd,**kw):
    return subprocess.run(cmd,check=True,text=True,**kw)
def get_json(url,cookie=""):
    headers={"Cookie":cookie} if cookie else {}
    request=urllib.request.Request(url,headers=headers)
    with urllib.request.urlopen(request,timeout=18) as reply:return json.load(reply)
version="1.1.59"
package=pathlib.Path(os.environ["GITHUB_WORKSPACE"],"signed-package")
binary=package/f"jh2-runtime-{version}.bin"
manifest_file=package/"latest.json"
manifest=json.loads(manifest_file.read_text())
assert manifest["schema"]==1 and manifest["signature"] and manifest["payload"]
fields=dict(line.split("=",1) for line in manifest["payload"].strip().splitlines())
assert fields["product"]=="jason-home-2-nanoc6"
assert fields["version"]==version
assert fields["commit"]=="6abadb829b7d1da9b94bd706de5f25705e66ee02"
assert fields["url"]==f"https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/releases/download/jason-home-2-nanoc6-v{version}/jh2-runtime-{version}.bin"
fw=binary.read_bytes()
assert len(fw)==int(fields["bytes"]) and len(fw)>0x120000 and fw[:1]==b"\xe9"
assert hashlib.sha256(fw).hexdigest()==fields["sha256"]
with tempfile.TemporaryDirectory(prefix="jh2-signed-stage-") as temporary:
    tmp=pathlib.Path(temporary)
    (tmp/"payload").write_text(manifest["payload"])
    (tmp/"signature").write_bytes(base64.b64decode(manifest["signature"],validate=True))
    run(["openssl","dgst","-sha256","-verify",
         str(pathlib.Path(os.environ["GITHUB_WORKSPACE"],"remote-update/anderson_ota_signing_public.pem")),
         "-signature",str(tmp/"signature"),str(tmp/"payload")])
    # Confirm production resources and empty queue before any server staging.
    bridge=json.loads(subprocess.check_output(["docker","inspect","jason-home"],text=True))[0]
    environment=dict(x.split("=",1) for x in bridge["Config"]["Env"] if "=" in x)
    credentials=json.dumps({"token":environment["JASON_HOME_API_TOKEN"]}).encode()
    request=urllib.request.Request("http://127.0.0.1:8081/api/session",data=credentials,
      headers={"content-type":"application/json"},method="POST")
    with urllib.request.urlopen(request,timeout=18) as response:
        response.read()
        cookie=response.headers["Set-Cookie"].split(";")[0]
    assert cookie.startswith("jh2=")
    state=get_json("http://127.0.0.1:8081/api/curtain/status",cookie)
    assert state.get("firmware") in ("1.1.55","1.1.56","1.1.57","1.1.59")
    assert state.get("online") is True and int(state.get("queued",0) or 0)==0
    if state["firmware"]=="1.1.59":
        print("ALREADY_INSTALLED; do not redeploy",flush=True);raise SystemExit(0)
    before=get_json("http://127.0.0.1:8081/api/curtain/firmware-manifest")
    assert "version=1.1.57\n" in before["payload"],"Existing production signed channel changed; abort"
    info=json.loads(subprocess.check_output(["docker","inspect","jason-home-2-web"],text=True))[0]
    mount=next((x for x in info["Mounts"] if x["Destination"]=="/data" and x["Type"]=="bind"),None)
    assert mount,"Expected dedicated web-only persistent /data volume"
    root=pathlib.Path(mount["Source"])
    dest=root/"signed-ota"/version
    assert not dest.exists(),"Signed staging already exists; inspect before retrying"
    stage=root/"signed-ota"/(version+".staging")
    stage.mkdir(parents=True,exist_ok=False)
    try:
        shutil.copy2(binary,stage/binary.name)
        shutil.copy2(manifest_file,stage/"latest.json")
        assert hashlib.sha256((stage/binary.name).read_bytes()).hexdigest()==fields["sha256"]
        stage.rename(dest)
    except BaseException:
        if stage.exists():shutil.rmtree(stage)
        raise
    source=tmp/"server.original.mjs"
    run(["docker","cp","jason-home-2-web:/app/server.mjs",str(source)])
    original=source.read_text()
    anchor='// JH2_SIGNED_LOCAL_157_BEGIN'
    assert original.count(anchor)==1,"Cannot isolate exact server firmware endpoint"
    marker="// JH2_SIGNED_LOCAL_159_BEGIN"
    assert marker not in original,"Local OTA handler already installed"
    insertion=r'''// JH2_SIGNED_LOCAL_159_BEGIN — only pinned, independently ECDSA-verified OTA 1.1.59.
if(method==="GET"&&path==="/api/curtain/firmware-manifest"&&existsSync("/data/signed-ota/1.1.59/latest.json")){
  const manifest=JSON.parse(readFileSync("/data/signed-ota/1.1.59/latest.json","utf8"));
  if(manifest?.schema!==1||!manifest.payload?.includes("version=1.1.59\n")||!manifest.signature)throw fail(503,"Local signed firmware not validated");
  return send(res,200,manifest,{"cache-control":"no-store"});
}
if(method==="GET"&&path==="/api/curtain/firmware-runtime/1.1.59.bin"&&existsSync("/data/signed-ota/1.1.59/jh2-runtime-1.1.59.bin")){
  const manifest=JSON.parse(readFileSync("/data/signed-ota/1.1.59/latest.json","utf8"));
  const fields=Object.fromEntries(manifest.payload.trim().split("\n").map(x=>x.split("=",2)));
  const image=readFileSync("/data/signed-ota/1.1.59/jh2-runtime-1.1.59.bin");
  if(fields.version!=="1.1.59"||image.length!==Number(fields.bytes)||
      createHash("sha256").update(image).digest("hex")!==fields.sha256)throw fail(503,"Local firmware digest invalid");
  res.writeHead(200,{"content-type":"application/octet-stream","content-length":image.length,
    "cache-control":"no-store","x-firmware-sha256":fields.sha256,"x-content-type-options":"nosniff"});
  return res.end(image);
}
// JH2_SIGNED_LOCAL_159_END
'''
    updated=original.replace(anchor,insertion+anchor,1)
    assert updated.replace(insertion,"",1)==original
    patch=tmp/"server.patched.mjs";patch.write_text(updated)
    # Ensure Node syntax and route scope are correct before changing live source.
    run(["docker","cp",str(patch),"jason-home-2-web:/tmp/jh2-159-server-patched.mjs"])
    run(["docker","exec","jason-home-2-web","node","--check","/tmp/jh2-159-server-patched.mjs"])
    backup=dest/"server.before-159.mjs";shutil.copy2(source,backup)
    changed=False
    try:
        run(["docker","cp",str(patch),"jason-home-2-web:/app/server.mjs"])
        changed=True
        run(["docker","restart","jason-home-2-web"],stdout=subprocess.DEVNULL)
        ok=False
        for i in range(40):
            time.sleep(1.5)
            try:
                health=get_json("http://127.0.0.1:8081/api/health")
                got=get_json("http://127.0.0.1:8081/api/curtain/firmware-manifest")
                if health.get("ok") and got==manifest:ok=True;break
            except Exception:continue
        assert ok,"Production health or manifest failed after staged web restart"
        # Verify HTTP binary mirror BY DIGEST without disclosing bytes into logs.
        with urllib.request.urlopen("http://127.0.0.1:8081/api/curtain/firmware-runtime/1.1.59.bin",timeout=55) as response:
            d=hashlib.sha256();total=0
            while True:
                chunk=response.read(65536)
                if not chunk:break
                d.update(chunk);total+=len(chunk)
        assert total==len(fw) and d.hexdigest()==fields["sha256"],"OTA mirror corruption detected"
        print("SIGNED_LOCAL_157_ORACLE_CHANNEL_READY",len(fw),fields["sha256"],flush=True)
    except BaseException:
        if changed:
            run(["docker","cp",str(backup),"jason-home-2-web:/app/server.mjs"])
            run(["docker","restart","jason-home-2-web"],stdout=subprocess.DEVNULL)
        print("ORACLE_159_DEPLOY_ROLLED_BACK",flush=True)
        raise
