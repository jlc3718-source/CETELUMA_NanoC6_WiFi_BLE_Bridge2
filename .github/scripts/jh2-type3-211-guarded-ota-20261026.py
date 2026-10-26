import os,json,hashlib,base64,subprocess,urllib.request,time,tempfile
from pathlib import Path
out={"expectedOld":"2.0.10","target":"2.0.11","partitionChanged":False,"erases":0,"controllerWrites":0,"firmwareInstallStarted":False,"onlineConfirmed":False,"bleConfirmed":False}
repo=Path(os.environ["GITHUB_WORKSPACE"])
info=json.loads(subprocess.check_output(["docker","inspect","jason-home-2-web"],text=True))[0]
volumes=[x for x in info["Mounts"] if x["Destination"]=="/data" and x["Type"]=="bind"]
assert len(volumes)==1,"Authenticated Oracle data mount unavailable"
root=Path(volumes[0]["Source"])/"signed-ota"
approved=root/"approved";candidate=root/"2.0.11"
assert approved.is_symlink() and approved.resolve()==(root/"2.0.10").resolve(),"Unexpected previously approved recovery version"
assert (root/"2.0.10").is_dir() and candidate.is_dir(),"Signed recovery and candidate must remain intact"
m=json.loads((candidate/"latest.json").read_text())
fields=dict(item.split("=",1) for item in m["payload"].strip().splitlines())
image=(candidate/"jh2-runtime-2.0.11.bin").read_bytes()
assert m["schema"]==1 and fields["product"]=="jason-home-2-nanoc6" and fields["version"]=="2.0.11"
assert hashlib.sha256(image).hexdigest()==fields["sha256"] and int(fields["bytes"])==len(image)
assert len(image)<=0x160000 and image[0]==0xe9 and b"2.0.11-native-upload-flow" in image
with tempfile.TemporaryDirectory() as temp:
 p=Path(temp);(p/"payload").write_text(m["payload"])
 (p/"signature").write_bytes(base64.b64decode(m["signature"],validate=True))
 subprocess.run(["openssl","dgst","-sha256","-verify",str(repo/"remote-update/anderson_ota_signing_public.pem"),
     "-signature",str(p/"signature"),str(p/"payload")],check=True)
env=dict(v.split("=",1) for v in json.loads(subprocess.check_output(["docker","inspect","jason-home"],text=True))[0]["Config"]["Env"] if "=" in v)
token=env.get("JASON_HOME_API_TOKEN")
assert token and len(token)>=32,"Oracle session secret unavailable"
cookie=""
def req(path,body=None,timeout=40):
 global cookie
 headers={"Content-Type":"application/json",**({"Cookie":cookie} if cookie else {})}
 r=urllib.request.Request("http://127.0.0.1:8081"+path,
    data=json.dumps(body).encode() if body is not None else None,
    headers=headers,method="POST" if body is not None else "GET")
 with urllib.request.urlopen(r,timeout=timeout) as z:
  if path=="/api/session":cookie=z.headers["Set-Cookie"].split(";")[0]
  return json.load(z)
req("/api/session",{"token":token})
def status():return req("/api/curtain/status")
def command(action,key):
 reply=req("/api/curtain/call",{"action":action,"payload":{},"idempotencyKey":key})
 ident=reply.get("commandId")
 assert isinstance(ident,int), "No command identifier"
 for _ in range(90):
  time.sleep(2)
  state=req("/api/curtain/command?id="+str(ident)).get("command",{})
  if state.get("state") in ("applied","failed","superseded","expired"):
   return {"id":ident,"state":state.get("state"),"message":str((state.get("result") or {}).get("message",""))[:180]}
 raise RuntimeError("Nano did not finish command "+action)
before=status()
out["before"]={"firmware":before.get("firmware"),"online":before.get("online"),
 "connected":(before.get("curtain") or {}).get("connected"),
 "catalogUnique":(before.get("curtain") or {}).get("nativeCatalogUnique"),
 "queue":before.get("queued"),"relayStreaming":before.get("relayStreaming")}
assert before.get("firmware")=="2.0.10" and before.get("online") is True
assert before.get("curtain",{}).get("connected") is True and int(before.get("queued") or 0)==0
assert before.get("relayStreaming") is False
assert int(before.get("curtain",{}).get("nativeCatalogUnique") or 0)>=90,"Stored four-pose control must exist"
assert before.get("signedOta",{}).get("state") in ("idle","failed"),"Concurrent signed OTA activity"
def switch(version):
 import os
 dst=root/"approved"
 temp=root/(".approved-type3-tmp-"+str(os.getpid()))
 if temp.exists() or temp.is_symlink():temp.unlink()
 temp.symlink_to(version,target_is_directory=True)
 os.replace(temp,dst)
 assert dst.resolve()==(root/version).resolve()
print("JH2_211_OTA_PRECHECK_VERIFIED_SIGNED_RECOVERY_PRESERVED",fields["sha256"],len(image),flush=True)
switch("2.0.11")
out["approvedChanged"]=True
try:
 manifest=req("/api/curtain/firmware-manifest")
 signed=dict(line.split("=",1) for line in manifest["payload"].strip().splitlines())
 assert signed["version"]=="2.0.11" and signed["sha256"]==fields["sha256"],"Oracle served wrong signed version"
 r=urllib.request.Request("http://127.0.0.1:8081/api/curtain/firmware-runtime/2.0.11.bin")
 with urllib.request.urlopen(r,timeout=75) as z:
  served=z.read()
 assert hashlib.sha256(served).hexdigest()==fields["sha256"] and len(served)==len(image),"Oracle served wrong firmware bytes"
 print("JH2_211_ORACLE_MIRROR_SIGNED_VALIDATED",len(served),flush=True)
 current=status()
 if current.get("firmware")!="2.0.11":
  out["firmwareCheck"]=command("nanoFirmwareCheck","jh2-211-type3-fwcheck-once-20261026")
  out["firstInstall"]=command("nanoInstallUpdate","jh2-211-type3-stage-once-20261026")
  out["firmwareInstallStarted"]=True
 activationIssued=False
 for cycle in range(175):
  current=status()
  fw=current.get("firmware")
  st=current.get("signedOta",{}) or {}
  if cycle%15==0:print("JH2_211_OTA_PROGRESS",json.dumps({"cycle":cycle,"firmware":fw,"online":current.get("online"),
      "state":st.get("state"),"downloaded":st.get("downloadedBytes"),"lastHttp":st.get("lastHttpStatus"),
      "lastEspError":st.get("lastEspError"),"ble":(current.get("curtain") or {}).get("connected")}),flush=True)
  if fw=="2.0.11" and current.get("online") is True:
   out["onlineConfirmed"]=True
   if current.get("curtain",{}).get("connected") is True and int(current.get("queued") or 0)==0:
    out["bleConfirmed"]=True
    break
  if fw=="2.0.10" and st.get("state")=="ready" and not activationIssued:
   out["activation"]=command("nanoInstallUpdate","jh2-211-type3-activate-once-20261026")
   activationIssued=True
  if st.get("state")=="failed" and fw!="2.0.11":
   raise RuntimeError("Verified signed OTA failed: "+str(st.get("message",""))[:150])
  time.sleep(4)
 out["after"]={"firmware":current.get("firmware"),"online":current.get("online"),
    "connected":current.get("curtain",{}).get("connected"),"queue":current.get("queued"),
    "state":current.get("signedOta",{}).get("state"),"uptime":current.get("uptimeSeconds")}
 assert out["onlineConfirmed"] and out["bleConfirmed"],"New firmware boot/BLE not confirmed"
 out["result"]="NANO_2_0_11_RUNNING_BLE_CONNECTED_SIGNED_OTA"
except BaseException as e:
 out["result"]="OTA_NOT_CONFIRMED"
 out["error"]=str(e)
 # Prevent ongoing automatic attempts to reapply a failed candidate when old
 # production firmware remains in charge. Existing immutable signed release is untouched.
 if not out["onlineConfirmed"]:
  switch("2.0.10")
  out["approvedRestored"]="2.0.10"
 print("JH2_211_OTA_RESULT",json.dumps(out),flush=True)
 raise
print("JH2_211_OTA_RESULT",json.dumps(out),flush=True)
