"""JH2 Nano 2.0.16→2.0.17 signed A/B diagnostic OTA.
Before OTA, clear active stream using curtain assetStop (NOT show stop);
the saved seven-item startup show/compiled assets must remain intact.
Separate Eufy secret provisioning persists in Oracle and never reaches logs.
"""
import os,json,time,hashlib,base64,tempfile,subprocess,urllib.request
from pathlib import Path
repo=Path(os.environ["GITHUB_WORKSPACE"])
d=json.loads(subprocess.check_output(["docker","inspect","jason-home-2-web"],text=True))[0]
env=dict(x.split("=",1) for x in d["Config"]["Env"] if "=" in x)
token=env["JH2_UPSTREAM_TOKEN"];assert len(token)>=32
mount=[m for m in d["Mounts"] if m["Destination"]=="/data" and m["Type"]=="bind"]
assert len(mount)==1
root=Path(mount[0]["Source"])/"signed-ota"
old=root/"2.0.16";new=root/"2.0.17";approved=root/"approved"
assert old.is_dir() and new.is_dir() and approved.is_symlink()
assert approved.resolve()==old.resolve(),"Approved release changed unexpectedly"
signed=json.loads((new/"latest.json").read_text())
fields=dict(x.split("=",1) for x in signed["payload"].strip().splitlines())
image=(new/"jh2-runtime-2.0.17.bin").read_bytes()
assert fields["product"]=="jason-home-2-nanoc6" and fields["version"]=="2.0.17"
assert signed["schema"]==1 and len(image)==int(fields["bytes"]) and len(image)<=0x160000
assert hashlib.sha256(image).hexdigest()==fields["sha256"] and image[0]==0xe9
with tempfile.TemporaryDirectory() as temp:
 p=Path(temp);(p/"payload").write_text(signed["payload"])
 (p/"sig").write_bytes(base64.b64decode(signed["signature"],validate=True))
 subprocess.run(["openssl","dgst","-sha256","-verify",
  str(repo/"remote-update/anderson_ota_signing_public.pem"),"-signature",str(p/"sig"),str(p/"payload")],
  check=True,stdout=subprocess.DEVNULL)
def api(path,body=None,timeout=30):
 headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"}
 r=urllib.request.Request("http://127.0.0.1:8081"+path,
  headers=headers,data=json.dumps(body).encode() if body is not None else None,
  method="POST" if body is not None else "GET")
 with urllib.request.urlopen(r,timeout=timeout) as response:return json.load(response)
def status():return api("/api/curtain/status")
def command(action,uid):
 result=api("/api/curtain/call",{"action":action,"payload":{},"idempotencyKey":uid})
 cid=result["commandId"]
 for _ in range(65):
  time.sleep(2)
  row=api("/api/curtain/command?id="+str(cid))["command"]
  state=row["state"]
  if state in ("applied","failed","expired","superseded"):
   message=str((row.get("result") or {}).get("message",""))[:110]
   if state=="failed" and action=="nanoInstallUpdate" and (
       "Downloading signed firmware" in message or "Only newer signed firmware" in message):
    return {"id":cid,"state":"staging-or-reboot","note":message}
   if state!="applied":raise RuntimeError(action+" "+state+": "+message)
   return {"id":cid,"state":state,"note":message}
 raise RuntimeError("Command timed out: "+action)
def approve(version):
 target=root/version
 temp=root/(".approved-jh2-eufy-diagnostic-"+str(os.getpid()))
 assert target.is_dir()
 temp.symlink_to(version,target_is_directory=True)
 os.replace(temp,approved)
 assert approved.resolve()==target.resolve()
before=status()
assert before.get("firmware")=="2.0.16" and before.get("online") is True
assert (before.get("curtain") or {}).get("connected") is True
assert int((before.get("curtain") or {}).get("mtu") or 0)>=500
assert int(before.get("queued") or 0)==0
startup=api("/api/curtain/startup-show").get("startupShow") or {}
assert startup.get("mode")=="sequence" and 2<=len(startup.get("items") or [])<=20
assert startup.get("showId") and startup.get("name"),"Cannot restore a saved unnamed show"
print("JH2_217_PRECHECK_SIGNED_STARTUP_SHOW_AND_SMARTDAWN_VERIFIED",flush=True)
show_running=bool((before.get("showSequence") or {}).get("running"))
released=False
completed=False
approved_new=False
try:
 if show_running or before.get("relayStreaming"):
  command("assetStop","jh2-217-ota-pause-animation-one-shot-20261110")
  for i in range(35):
   t=status()
   if not t.get("relayStreaming") and not (t.get("showSequence") or {}).get("running") and not t.get("queued"):break
   time.sleep(2)
  else:raise RuntimeError("Active show could not stop safely")
  print("JH2_217_ACTIVE_SHOW_PAUSED_STARTUP_PRESERVED",flush=True)
 verify_start=api("/api/curtain/startup-show").get("startupShow") or {}
 assert verify_start.get("items")==startup["items"],"Saved show unexpectedly changed after assetStop"
 command("disconnect","jh2-217-ota-release-smartdawn-20261110")
 for i in range(20):
  t=status()
  if (t.get("curtain") or {}).get("connected") is False:break
  time.sleep(2)
 else:raise RuntimeError("SmartDawn BLE disconnect not confirmed")
 released=True
 approve("2.0.17");approved_new=True
 m=api("/api/curtain/firmware-manifest")
 sf=dict(x.split("=",1) for x in m["payload"].strip().splitlines())
 assert sf["sha256"]==fields["sha256"] and sf["version"]=="2.0.17"
 cmd=command("nanoFirmwareCheck","jh2-217-ota-firmware-check-20261110")
 print("JH2_217_FIRMWARE_CHECK",cmd["state"],flush=True)
 stage=command("nanoInstallUpdate","jh2-217-ota-start-download-20261110")
 print("JH2_217_STAGE",stage["state"],flush=True)
 activated=False
 for i in range(160):
  st=status()
  fw=st.get("firmware")
  ota=st.get("signedOta") or {}
  if i%10==0:
   print("JH2_217_OTA_PROGRESS",json.dumps({"version":fw,"state":ota.get("state"),
    "source":ota.get("downloadSource"),"bytes":ota.get("downloadedBytes"),
    "httpStatus":ota.get("lastHttpStatus"),"lastEspError":ota.get("lastEspError")}),flush=True)
  if fw=="2.0.17" and st.get("online") is True:
   completed=True;break
  if ota.get("state")=="ready" and not activated:
   activation=command("nanoInstallUpdate","jh2-217-ota-activate-20261110")
   print("JH2_217_OTA_ACTIVATE",activation["state"],flush=True)
   activated=True
  if ota.get("state")=="failed":
   raise RuntimeError("Signed download failed: "+str(ota.get("message",""))[:140])
  time.sleep(3)
 assert completed,"Nano 2.0.17 did not report healthy boot"
 for i in range(45):
  st=status()
  if (st.get("curtain") or {}).get("connected") is True and (st.get("curtain") or {}).get("mtu",0)>=500:break
  if i==10:command("scan","jh2-217-ota-rescan-smartdawn-20261110")
  time.sleep(2)
 else:raise RuntimeError("New firmware did not reconnect SmartDawn")
 assert (st.get("eufyLocalBle") or {}).get("supported") is True
 assert len((st.get("eufyLocalBle") or {}).get("devices") or [])==4,"Four Eufy BLE statuses missing"
 assert {x.get("name") for x in (st.get("eufyLocalBle") or {}).get("devices") or []}=={"Pool","House","Garage","Shed"}
 print("JH2_217_FOUR_BLE_PER_DEVICE_STATUS_FIELDS_VERIFIED",flush=True)
 print("JH2_217_BOOT_SMARTDAWN_AND_EUFY_CAPABILITY_PASS",flush=True)
finally:
 st=status()
 if not completed and approved_new and st.get("firmware")=="2.0.16":
  approve("2.0.16")
  print("JH2_217_FAILURE_RESTORED_APPROVED_2_0_15",flush=True)
 if released and st.get("online") and (st.get("curtain") or {}).get("connected") is not True:
  try:
   command("scan","jh2-217-ota-restore-smartdawn-20261110")
   for i in range(45):
    st=status()
    if (st.get("curtain") or {}).get("connected") is True:break
    time.sleep(2)
  except Exception as e:print("JH2_217_RECONNECT_WARNING",str(e)[:130],flush=True)
 restored=api("/api/curtain/startup-show").get("startupShow") or {}
 assert restored.get("items")==startup["items"],"Startup show was not retained"
 st=status()
 if st.get("online") and (st.get("curtain") or {}).get("connected") and not (st.get("showSequence") or {}).get("running"):
  try:
   response=api("/api/curtain/show-sequence",{"operation":"start","showId":startup["showId"],
     "items":startup["items"],"name":startup["name"]})
   assert response.get("ok") is True
   print("JH2_217_SAVED_TURKEY_SHOW_RESTARTED",flush=True)
  except Exception as e:print("JH2_217_SHOW_RESTORE_WARNING",str(e)[:150],flush=True)
 print("JH2_217_OTA_FINAL",json.dumps({"firmware":st.get("firmware"),
  "online":st.get("online"),"smartdawnConnected":(st.get("curtain") or {}).get("connected"),
  "eufyBLE":(st.get("eufyLocalBle") or {}).get("supported"),
  "savedShowPresent":True,"eufyDevices":len((st.get("eufyLocalBle") or {}).get("devices") or []),"running":(st.get("showSequence") or {}).get("running")}),flush=True)
