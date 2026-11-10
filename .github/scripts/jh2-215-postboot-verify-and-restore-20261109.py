"""Validate running 2.0.15, retain 2.0.14, restore user's seven-clip show.
Only local authenticated Oracle endpoints; no Eufy cloud sign-ins or secret output.
"""
import os,json,time,hashlib,base64,subprocess,urllib.request,tempfile
from pathlib import Path
repo=Path(os.environ["GITHUB_WORKSPACE"])
info=json.loads(subprocess.check_output(["docker","inspect","jason-home-2-web"],text=True))[0]
env=dict(v.split("=",1) for v in info["Config"]["Env"] if "=" in v)
token=env.get("JH2_UPSTREAM_TOKEN")
assert token and len(token)>=32
def request(path,body=None):
 headers={"Authorization":"Bearer "+token, "Content-Type":"application/json"}
 r=urllib.request.Request("http://127.0.0.1:8081"+path,
    data=json.dumps(body).encode() if body is not None else None,
    headers=headers,method="POST" if body is not None else "GET")
 with urllib.request.urlopen(r,timeout=25) as z:
  return json.load(z)
def status():return request("/api/curtain/status")
s=status()
assert s.get("firmware")=="2.0.15" and s.get("online") is True, "New Nano firmware is not online"
assert s.get("curtain",{}).get("connected") is True and s.get("curtain",{}).get("mtu",0)>=500, "SmartDawn BLE not recovered"
assert s.get("eufyLocalBle",{}).get("supported") is True, "Nano 2.0.15 Eufy BLE capability is absent"
print("JH2_215_PHYSICAL_NANO_BOOT_AND_SMARTDAWN_MTU_VERIFIED")
# Public-key verification before approving newly installed image
mounts=[x for x in info["Mounts"] if x["Destination"]=="/data" and x["Type"]=="bind"]
assert len(mounts)==1
root=Path(mounts[0]["Source"])/"signed-ota"
new=root/"2.0.15";old=root/"2.0.14";approved=root/"approved"
assert old.is_dir() and new.is_dir() and approved.is_symlink(), "Recovery generation missing"
latest=json.loads((new/"latest.json").read_text())
fields=dict(v.split("=",1) for v in latest["payload"].splitlines() if "=" in v)
image=(new/"jh2-runtime-2.0.15.bin").read_bytes()
assert latest.get("schema")==1 and fields["product"]=="jason-home-2-nanoc6" and fields["version"]=="2.0.15"
assert len(image)==int(fields["bytes"]) and hashlib.sha256(image).hexdigest()==fields["sha256"]
assert len(image)<=0x160000 and image[0]==0xe9
with tempfile.TemporaryDirectory() as tmp:
 p=Path(tmp);(p/"payload").write_text(latest["payload"])
 (p/"signature").write_bytes(base64.b64decode(latest["signature"],validate=True))
 subprocess.run(["openssl","dgst","-sha256","-verify",
  str(repo/"remote-update/anderson_ota_signing_public.pem"),
  "-signature",str(p/"signature"),str(p/"payload")],check=True)
if approved.resolve()!=new.resolve():
 assert approved.resolve()==old.resolve(),"Unexpected release already approved"
 temp=root/(".approved-jh2-215-postboot-"+str(os.getpid()))
 assert not temp.exists()
 temp.symlink_to("2.0.15",target_is_directory=True)
 os.replace(temp,approved)
assert approved.resolve()==new.resolve() and old.is_dir()
print("JH2_215_SIGNED_APPROVED_2_0_14_RECOVERY_RETAINED",fields["sha256"],len(image))
# Restore already-saved startup show, don't invent show items or modify its master definition.
live=status()
if (live.get("showSequence") or {}).get("running"):
 print("JH2_215_SAVED_SHOW_ALREADY_RUNNING", (live["showSequence"] or {}).get("name"))
else:
 state=request("/api/curtain/startup-show")
 show=state.get("startupShow") or {}
 assert show.get("mode")=="sequence" and len(show.get("items") or [])>=2, "No complete saved startup show"
 assert len(show["items"])<=20 and show.get("showId"), "Startup show is malformed"
 response=request("/api/curtain/show-sequence",{"operation":"start",
    "showId":show["showId"],"name":show["name"],"items":show["items"]})
 assert response.get("ok") is True,"Saved show start was not accepted"
 for _ in range(25):
  time.sleep(2)
  live=status()
  if (live.get("showSequence") or {}).get("running") is True:break
 else:raise RuntimeError("Saved show did not resume")
 print("JH2_215_SAVED_SHOW_RESTORED",len(show["items"]),show["name"])
print("JH2_215_STATUS",json.dumps({"firmware":live.get("firmware"),
 "nanoOnline":live.get("online"),"smartDawnConnected":live.get("curtain",{}).get("connected"),
 "bleMTU":live.get("curtain",{}).get("mtu"),"eufyBLE":live.get("eufyLocalBle",{}).get("supported"),
 "showRunning":(live.get("showSequence") or {}).get("running"),
 "eufyCredentialConfigured":live.get("eufyLocalConfigured"),
 "approved":"2.0.15","fallback":"2.0.14"},sort_keys=True))
