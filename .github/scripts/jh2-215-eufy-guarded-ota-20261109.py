import os,json,hashlib,base64,subprocess,urllib.request,time,tempfile
from pathlib import Path
out={"expectedOld":"2.0.14","target":"2.0.15","partitionChanged":False,"erases":0,"controllerWrites":0,"firmwareInstallStarted":False,"onlineConfirmed":False,"bleConfirmed":False}
repo=Path(os.environ["GITHUB_WORKSPACE"])
info=json.loads(subprocess.check_output(["docker","inspect","jason-home-2-web"],text=True))[0]
volumes=[x for x in info["Mounts"] if x["Destination"]=="/data" and x["Type"]=="bind"]
assert len(volumes)==1,"Authenticated Oracle data mount unavailable"
root=Path(volumes[0]["Source"])/"signed-ota"
approved=root/"approved";candidate=root/"2.0.15"
assert approved.is_symlink() and approved.resolve()==(root/"2.0.14").resolve(),"Unexpected previously approved recovery version"
assert (root/"2.0.14").is_dir() and candidate.is_dir(),"Signed recovery and candidate must remain intact"
m=json.loads((candidate/"latest.json").read_text())
fields=dict(item.split("=",1) for item in m["payload"].strip().splitlines())
image=(candidate/"jh2-runtime-2.0.15.bin").read_bytes()
assert m["schema"]==1 and fields["product"]=="jason-home-2-nanoc6" and fields["version"]=="2.0.15"
assert hashlib.sha256(image).hexdigest()==fields["sha256"] and int(fields["bytes"])==len(image)
assert len(image)<=0x160000 and image[0]==0xe9 and b"2.0.15" in image and b"JH2TEST" in image
with tempfile.TemporaryDirectory() as temp:
 p=Path(temp);(p/"payload").write_text(m["payload"])
 (p/"signature").write_bytes(base64.b64decode(m["signature"],validate=True))
 subprocess.run(["openssl","dgst","-sha256","-verify",str(repo/"remote-update/anderson_ota_signing_public.pem"),
     "-signature",str(p/"signature"),str(p/"payload")],check=True)
# Since November 2026 the JH2 web control routes require the owner's
# maintenance Bearer credential for non-browser mutations. The legacy
# /api/session cookie authorizes only a read-only status exception.
container=json.loads(subprocess.check_output(["docker","inspect","jason-home-2-web"],text=True))[0]
env=dict(v.split("=",1) for v in container["Config"]["Env"] if "=" in v)
token=env.get("JH2_UPSTREAM_TOKEN")
assert token and len(token)>=32,"JH2 maintenance token unavailable from running web container"
def req(path,body=None,timeout=40):
 headers={"Content-Type":"application/json","Authorization":"Bearer "+token}
 r=urllib.request.Request("http://127.0.0.1:8081"+path,
    data=json.dumps(body).encode() if body is not None else None,
    headers=headers,method="POST" if body is not None else "GET")
 with urllib.request.urlopen(r,timeout=timeout) as z:
  return json.load(z)
def status():return req("/api/curtain/status")
def command(action,key):
 reply=req("/api/curtain/call",{"action":action,"payload":{},"idempotencyKey":key})
 ident=reply.get("commandId")
 assert isinstance(ident,int), "No command identifier"
 for _ in range(90):
  time.sleep(2)
  state=req("/api/curtain/command?id="+str(ident)).get("command",{})
  if state.get("state") in ("applied","failed","superseded","expired"):
   msg=str((state.get("result") or {}).get("message",""))[:180]
   if state.get("state")=="failed" and action=="nanoInstallUpdate" and "Downloading signed firmware" in msg:
    return {"id":ident,"state":"staging","message":"Signed firmware downloading; awaiting Nano OTA ready"}
   if state.get("state")!="applied":raise RuntimeError(action+" "+state.get("state","unknown")+": "+msg)
   return {"id":ident,"state":state.get("state"),"message":msg}
 raise RuntimeError("Nano did not finish command "+action)
before=status()
out["before"]={"firmware":before.get("firmware"),"online":before.get("online"),
 "connected":(before.get("curtain") or {}).get("connected"),
 "catalogUnique":(before.get("curtain") or {}).get("nativeCatalogUnique"),
 "queue":before.get("queued"),"relayStreaming":before.get("relayStreaming")}
assert before.get("firmware")=="2.0.14" and before.get("online") is True
assert before.get("curtain",{}).get("connected") is True and int(before.get("queued") or 0)==0
active_show=before.get("showSequence") or {}
startup_show=before.get("startupShow") or {}
saved_show=None
if active_show.get("running") is True:
 assert startup_show.get("mode")=="sequence" and startup_show.get("name")==active_show.get("name"),"Do not interrupt unknown active scene"
 saved=req("/api/curtain/internet-art/shows")
 matching=[x for x in saved.get("shows",[]) if x.get("id")==startup_show.get("showId")]
 assert len(matching)==1 and len(matching[0].get("items",[]))>=2,"Cannot restore live show: saved items missing"
 saved_show=matching[0]
else:
 assert before.get("relayStreaming") is False,"Unknown active animation: refuse OTA"
assert int(before.get("curtain",{}).get("mtu") or 0)>=500,"Native high-MTU BLE required"
assert before.get("curtain",{}).get("nanoLocalCacheSupported") is True,"Verified Nano storage required"
assert before.get("signedOta",{}).get("state") in ("idle","failed"),"Concurrent signed OTA activity"
def switch(version):
 import os
 dst=root/"approved"
 temp=root/(".approved-eufy_ble-tmp-"+str(os.getpid()))
 if temp.exists() or temp.is_symlink():temp.unlink()
 temp.symlink_to(version,target_is_directory=True)
 os.replace(temp,dst)
 assert dst.resolve()==(root/version).resolve()
print("JH2_215_OTA_PRECHECK_VERIFIED_SIGNED_RECOVERY_PRESERVED",fields["sha256"],len(image),flush=True)
switch("2.0.15")
out["approvedChanged"]=True
try:
 manifest=req("/api/curtain/firmware-manifest")
 signed=dict(line.split("=",1) for line in manifest["payload"].strip().splitlines())
 assert signed["version"]=="2.0.15" and signed["sha256"]==fields["sha256"],"Oracle served wrong signed version"
 r=urllib.request.Request("http://127.0.0.1:8081/api/curtain/firmware-runtime/2.0.15.bin")
 with urllib.request.urlopen(r,timeout=75) as z:
  served=z.read()
 assert hashlib.sha256(served).hexdigest()==fields["sha256"] and len(served)==len(image),"Oracle served wrong firmware bytes"
 print("JH2_215_ORACLE_MIRROR_SIGNED_VALIDATED",len(served),flush=True)
 current=status()
 if current.get("firmware")!="2.0.15":
  if saved_show:
   out["showPauseRequested"]=True
   reply=req("/api/curtain/show-sequence",{"operation":"stop"})
   assert reply.get("ok") is True,"Cannot stop saved show safely"
   for stop_wait in range(50):
    paused=status()
    if paused.get("relayStreaming") is False and int(paused.get("queued") or 0)==0:break
    time.sleep(2)
   else:raise RuntimeError("Curtain playback did not stop cleanly; OTA cancelled")
   out["showPaused"]=True
  # Release NimBLE's SmartDawn GATT allocation during the separate OTA TLS
  # connection. The curtain retains its last displayed state. A scan command
  # clears hold_disconnect and reconnects, regardless of OTA success.
  out["curtainBleRelease"]=command("disconnect","jh2-215-ota-ble-release-20261109-v3")
  for scan_wait in range(18):
   latest=status()
   if latest.get("curtain",{}).get("connected") is False:break
   time.sleep(2)
  else:raise RuntimeError("SmartDawn BLE release was not confirmed; refusing OTA")
  out["curtainBleTemporarilyReleased"]=True
  out["firmwareCheck"]=command("nanoFirmwareCheck","jh2-215-ota-ble-firmware-check-20261109-v3")
  out["firstInstall"]=command("nanoInstallUpdate","jh2-215-ota-ble-stage-20261109-v3")
  out["firmwareInstallStarted"]=True
 activationIssued=False
 for cycle in range(175):
  current=status()
  fw=current.get("firmware")
  st=current.get("signedOta",{}) or {}
  if cycle%15==0:print("JH2_215_OTA_PROGRESS",json.dumps({"cycle":cycle,"firmware":fw,"online":current.get("online"),
      "state":st.get("state"),"downloaded":st.get("downloadedBytes"),"lastHttp":st.get("lastHttpStatus"),
      "lastEspError":st.get("lastEspError"),"ble":(current.get("curtain") or {}).get("connected")}),flush=True)
  if fw=="2.0.15" and current.get("online") is True:
   out["onlineConfirmed"]=True
   if current.get("curtain",{}).get("connected") is True and int(current.get("queued") or 0)==0:
    out["bleConfirmed"]=True
    break
  if fw=="2.0.14" and st.get("state")=="ready" and not activationIssued:
   out["activation"]=command("nanoInstallUpdate","jh2-215-ota-ble-activate-20261109-v3")
   activationIssued=True
  if st.get("state")=="failed" and fw!="2.0.15":
   raise RuntimeError("Verified signed OTA failed: "+str(st.get("message",""))[:150])
  time.sleep(4)
 out["after"]={"firmware":current.get("firmware"),"online":current.get("online"),
    "connected":current.get("curtain",{}).get("connected"),"queue":current.get("queued"),
    "state":current.get("signedOta",{}).get("state"),"uptime":current.get("uptimeSeconds")}
 assert out["onlineConfirmed"] and out["bleConfirmed"],"New firmware boot/BLE not confirmed"
 assert (current.get("eufyLocalBle") or {}).get("supported") is True, "Eufy BLE feature not reported by new Nano firmware"
 assert (current.get("curtain") or {}).get("mtu",0)>=500,"BLE high MTU not restored"
 out["recoveryVersionPreserved"]="2.0.14"
 out["result"]="NANO_2_0_15_RUNNING_SMARTDAWN_BLE_CONNECTED_EUFY_BLE_AVAILABLE"
except BaseException as e:
 out["result"]="OTA_NOT_CONFIRMED"
 out["error"]=str(e)
 # Prevent ongoing automatic attempts to reapply a failed candidate when old
 # production firmware remains in charge. Existing immutable signed release is untouched.
 if not out["onlineConfirmed"]:
  switch("2.0.14")
  out["approvedRestored"]="2.0.14"
 # A failed OTA must never strand the preexisting SmartDawn connection offline.
 if out.get("curtainBleTemporarilyReleased"):
  try:
   current=status()
   if current.get("online") and current.get("curtain",{}).get("connected") is not True:
    out["curtainReconnect"]=command("scan","jh2-215-ota-restore-scan-20261109-v3")
    for scan_wait in range(35):
     current=status()
     if current.get("curtain",{}).get("connected") is True:
      out["curtainReconnectedAfterFailure"]=True
      break
     time.sleep(2)
  except Exception as restore_error:
   out["curtainReconnectError"]=str(restore_error)[:130]
 if out.get("showPauseRequested") and saved_show:
  try:
   now=status()
   if now.get("online") and now.get("curtain",{}).get("connected") is True and not (now.get("showSequence") or {}).get("running"):
    restore=req("/api/curtain/show-sequence",{"operation":"start","showId":saved_show["id"],
     "name":saved_show["name"],"items":saved_show["items"]})
    out["showRestoredAfterFailure"]=restore.get("ok") is True
   else:out["showRestoreDeferred"]="Nano or SmartDawn not ready"
  except Exception as err:
   out["showRestoreError"]=str(err)[:130]
 print("JH2_215_OTA_RESULT",json.dumps(out),flush=True)
 raise
if saved_show and not (current.get("showSequence") or {}).get("running"):
 try:
  restore=req("/api/curtain/show-sequence",{"operation":"start","showId":saved_show["id"],
   "name":saved_show["name"],"items":saved_show["items"]})
  out["showRestoredAfterSuccess"]=restore.get("ok") is True
 except Exception as err:
  out["showRestoreError"]=str(err)[:130]
print("JH2_215_OTA_RESULT",json.dumps(out),flush=True)
