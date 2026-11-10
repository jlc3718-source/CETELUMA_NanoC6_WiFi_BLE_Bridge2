"""Test E120/E22 native encrypted E10 brightness=100, without color changes."""
import json,subprocess,time,urllib.request
d=json.loads(subprocess.check_output(["docker","inspect","jason-home-2-web"],text=True))[0]
env=dict(x.split("=",1) for x in d["Config"]["Env"] if "=" in x);token=env["JH2_UPSTREAM_TOKEN"]
def api(path,body=None):
 h={"Authorization":"Bearer "+token,"Content-Type":"application/json"}
 req=urllib.request.Request("http://127.0.0.1:8081"+path,
   data=json.dumps(body).encode() if body is not None else None,
   headers=h,method="POST" if body is not None else "GET")
 with urllib.request.urlopen(req,timeout=25) as z:return json.load(z)
s=api("/api/curtain/status")
assert s.get("online") and s.get("firmware")=="2.0.16" and s.get("curtain",{}).get("connected")
for name in ("Pool","Garage"):
 result=api("/api/eufy/local-ble/command",{"target":name,"operation":"brightness","value":100})
 cid=result["commandIds"][0];state=None
 for _ in range(75):
  time.sleep(2)
  st=api("/api/eufy/local-ble/status")
  matches=[x for x in st.get("commands",[]) if x["id"]==cid]
  if matches and matches[0]["state"] in ("applied","failed","expired","superseded"):
   state=matches[0];break
 assert state is not None,"No brightness command receipt"
 transport=st.get("transport") or {}
 print("JH2_216_EUFY_BRIGHTNESS_RESULT",json.dumps({"target":name,"command":"brightness100",
  "state":state.get("state"),"gattDelivered":state.get("bleTransmitted"),
  "phase":transport.get("phase"),"handshakeWriteAcks":transport.get("handshakeWriteAcks"),
  "notifications":transport.get("notificationCount"),"result":state.get("detail")}),flush=True)
 assert state.get("state")=="applied" and state.get("bleTransmitted") is True,"Eufy brightness GATT failed"
assert api("/api/curtain/status").get("curtain",{}).get("connected") is True
print("JH2_216_EUFY_E120_AND_E22_BRIGHTNESS_GATT_DELIVERY_PASS")
