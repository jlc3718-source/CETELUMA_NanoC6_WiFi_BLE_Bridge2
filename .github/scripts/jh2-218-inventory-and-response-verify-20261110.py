"""Validate real nearby BLE inventory and four read-only encrypted response tests.
No light power, brightness, colour, or animation commands are sent.
"""
import json,subprocess,time,urllib.request
d=json.loads(subprocess.check_output(["docker","inspect","jason-home-2-web"],text=True))[0]
env=dict(v.split("=",1) for v in d["Config"]["Env"] if "=" in v)
token=env["JH2_UPSTREAM_TOKEN"]
def api(path,data=None):
 h={"Authorization":"Bearer "+token,"Content-Type":"application/json"}
 r=urllib.request.Request("http://127.0.0.1:8081"+path,
   data=json.dumps(data).encode() if data is not None else None,
   method="POST" if data is not None else "GET",headers=h)
 with urllib.request.urlopen(r,timeout=30) as response:return json.load(response)
def status():return api("/api/eufy/local-ble/status")
s=status()
assert s.get("nanoFirmware")=="2.0.18" and s.get("nanoOnline") is True
assert (s.get("smartDawn") or {}).get("connected") is True
assert (s.get("smartDawn") or {}).get("mtu",0)>=500
assert s.get("configured") is True
assert len(s.get("devices") or [])==4
assert isinstance(s.get("nearbyDevices"),list)
print("JH2_218_FULL_SCAN_AND_FIVE_CONTROLLER_STATUS_PRESENT",flush=True)
scan=api("/api/eufy/local-ble/scan",{})
assert scan.get("queued") is True
id=scan["commandId"]
for n in range(28):
 time.sleep(2)
 cmd=api("/api/curtain/command?id="+str(id)).get("command") or {}
 if cmd.get("state") in ("applied","failed","expired","superseded"):break
else:raise RuntimeError("Manual BLE scan not acknowledged")
assert cmd["state"]=="applied","Passive nearby Bluetooth scan failed"
st=status()
items=st.get("nearbyDevices") or []
recent=[x for x in items if isinstance(x.get("ageSeconds"),(int,float)) and 0<=x["ageSeconds"]<=25]
assert len(recent)>=1,"Nano BLE scan produced no detectable advertisements"
assert all("address" in x and "rssiDbm" in x for x in recent)
print("JH2_218_ALL_BLUETOOTH_SCAN_PASS",json.dumps({"devicesSeen":len(recent),
  "named":sum(bool(x.get("name")) for x in recent),
  "knownEufy":sorted(set(x.get("savedName") for x in recent if x.get("savedName"))) }),flush=True)
print("JH2_218_STARTING_READ_ONLY_EUFY_RESPONSE_CHECKS",flush=True)
result=api("/api/eufy/local-ble/command",{"target":"All","operation":"probe"})
ids=result.get("commandIds") or []
assert result.get("queued") is True and len(ids)==4
settled={}
for i in range(160):
 time.sleep(2)
 st=status()
 for row in st.get("commands") or []:
  if row.get("id") in ids and row.get("state") in ("applied","failed","expired","superseded"):
   settled[row["id"]]={"name":row.get("name"),"state":row["state"],
       "detail":str(row.get("detail") or "")[:100]}
 if len(settled)==4:break
assert len(settled)==4,"One or more response checks lack a final receipt"
devices=st.get("devices") or []
values=[{"name":x["name"],"seenAge":x.get("lastAdvertisementAgeSeconds"),
         "probeAge":x.get("lastProbeAgeSeconds"),
         "contactAge":x.get("lastContactAgeSeconds"),
         "lastFailureStage":x.get("lastFailureStage")} for x in devices]
print("JH2_218_READONLY_RESPONSE_RESULTS",json.dumps({"receipts":list(settled.values()),
    "devices":values}),flush=True)
assert all(x["state"]=="applied" for x in settled.values()),"One or more lights did not respond to encrypted E10 test"
assert all(isinstance(x.get("lastProbeAgeSeconds"),(int,float)) and
           0<=x["lastProbeAgeSeconds"]<240 for x in devices), "Recent GATT probe missing"
now=api("/api/curtain/status")
assert now.get("firmware")=="2.0.18" and now.get("online") is True
assert (now.get("curtain") or {}).get("connected") is True
print("JH2_218_ALL_FOUR_LIGHTS_RESPONDING_AND_SMARTDAWN_CONNECTED_PASS",flush=True)
