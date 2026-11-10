"""Verify live BLE status for five controllers without changing any lighting."""
import json,subprocess,time,urllib.request
d=json.loads(subprocess.check_output(["docker","inspect","jason-home-2-web"],text=True))[0]
token=dict(x.split("=",1) for x in d["Config"]["Env"] if "=" in x)["JH2_UPSTREAM_TOKEN"]
def api(path,data=None):
 headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"}
 r=urllib.request.Request("http://127.0.0.1:8081"+path,
   headers=headers,data=json.dumps(data).encode() if data is not None else None,
   method="POST" if data is not None else "GET")
 with urllib.request.urlopen(r,timeout=25) as f:return json.load(f)
def status():return api("/api/eufy/local-ble/status")
s=status()
assert s.get("nanoOnline") is True and s.get("nanoFirmware")=="2.0.17"
assert s.get("smartDawn",{}).get("connected") is True
assert s.get("smartDawn",{}).get("mtu",0)>=500
assert s.get("configured") is True
devices=s.get("devices") or []
assert len(devices)==4 and {d.get("name") for d in devices}=={"Pool","House","Garage","Shed"}
for d in devices:
 assert d.get("availability") in ("connected","seen-nearby","not-seen-recently","not-checked")
 assert isinstance(d.get("connected"),bool)
 assert "lastAdvertisementAgeSeconds" in d and "lastGattAckAgeSeconds" in d
print("JH2_217_LIVE_FIVE_CONTROLLER_STATUS_PRESENT",flush=True)
result=api("/api/eufy/local-ble/scan",{})
assert result.get("queued") is True
cid=result["commandId"]
print("JH2_217_PASSIVE_SCAN_QUEUED",cid,flush=True)
done=None
for _ in range(30):
 time.sleep(2)
 record=api("/api/curtain/command?id="+str(cid)).get("command") or {}
 if record.get("state") in ("applied","failed","expired","superseded"):
  done=record;break
assert done is not None,"BLE scan never acknowledged"
s=status();t=s.get("transport") or {}
summary={"commandState":done.get("state"),"surveyCount":t.get("surveyCount"),
 "surveyAgeSeconds":t.get("lastSurveyAgeSeconds"),
 "devices":[{"name":x["name"],"connected":x["connected"],"availability":x["availability"],
   "seenAgeSeconds":x["lastAdvertisementAgeSeconds"],
   "rssiDbm":x["rssiDbm"],"lastGattAckAgeSeconds":x["lastGattAckAgeSeconds"],
   "lastFailureStage":x["lastFailureStage"]} for x in s.get("devices") or []],
 "smartDawnConnected":s["smartDawn"]["connected"],
 "smartDawnMtu":s["smartDawn"]["mtu"]}
print("JH2_217_LIVE_STATUS_SURVEY_RESULT",json.dumps(summary),flush=True)
assert done.get("state")=="applied","Status-only BLE survey failed"
assert t.get("lastSurveyAgeSeconds",999)<=20
assert len(summary["devices"])==4
assert s["smartDawn"]["connected"] is True
print("JH2_217_PASSIVE_FOUR_EUFY_PRESENCE_SCAN_AND_SMARTDAWN_COEXISTENCE_PASS",flush=True)
