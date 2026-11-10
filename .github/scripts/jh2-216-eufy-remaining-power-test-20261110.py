"""Verify Eufy E10 Nano BLE ON command to House, Garage, Shed sequentially.
Safely leave unrelated devices and holiday show alone. GATT ACK does not equal
physical confirmation. No MAC/account identifiers or ciphertext in logs.
"""
import json,subprocess,time,urllib.request
d=json.loads(subprocess.check_output(["docker","inspect","jason-home-2-web"],text=True))[0]
env=dict(x.split("=",1) for x in d["Config"]["Env"] if "=" in x)
token=env["JH2_UPSTREAM_TOKEN"]
def req(path,body=None):
 h={"Authorization":"Bearer "+token,"Content-Type":"application/json"}
 r=urllib.request.Request("http://127.0.0.1:8081"+path,
  headers=h,data=json.dumps(body).encode() if body is not None else None,
  method="POST" if body is not None else "GET")
 with urllib.request.urlopen(r,timeout=25) as v:return json.load(v)
def status():return req("/api/eufy/local-ble/status")
def curtain():return req("/api/curtain/status")
first=curtain()
assert first.get("firmware")=="2.0.16" and first.get("online") is True
assert (first.get("curtain") or {}).get("connected") is True
assert (first.get("eufyLocalBle") or {}).get("supported") is True
assert status().get("configured") is True
results={}
for name in ("House","Garage","Shed"):
 print("JH2_216_LOCAL_POWER_TEST_START",name,flush=True)
 d=req("/api/eufy/local-ble/command",{"target":name,"operation":"power","on":True})
 ids=d.get("commandIds")
 assert d.get("queued") and len(ids)==1
 id=ids[0];receipt=None;latest=None
 for i in range(70):
  time.sleep(2)
  latest=status()
  for row in latest.get("commands") or []:
   if row.get("id")==id and row.get("state") in ("applied","failed","expired","superseded"):
    receipt=row;break
  if receipt:break
 assert receipt is not None, "No Eufy result from Nano for "+name
 transport=latest.get("transport") or {}
 result={"state":receipt.get("state"),"gattDelivered":receipt.get("bleTransmitted"),
  "detail":str(receipt.get("detail") or "")[:130],
  "scanStarts":transport.get("scanStarts"),"scanReports":transport.get("scanReports"),
  "scanMatches":transport.get("scanMatches"),"connections":transport.get("gattConnections"),
  "gattMtu":transport.get("gattMtu"),"handshakeAck":transport.get("handshakeWriteAcks"),
  "notifications":transport.get("notificationCount"),"phase":transport.get("phase")}
 results[name]=result
 print("JH2_216_LOCAL_POWER_TEST_RESULT",name,json.dumps(result),flush=True)
 live=curtain()
 assert live.get("online") and (live.get("curtain") or {}).get("connected") is True, "SmartDawn was disrupted"
print("JH2_216_ALL_LOCAL_POWER_GATT_RESULTS",json.dumps(results),flush=True)
assert all(x["state"]=="applied" and x["gattDelivered"] is True for x in results.values()),"At least one light failed E10 GATT"
print("JH2_216_FOUR_EUFY_LOCAL_E10_CONNECTIONS_CONFIRMED_INC_POOL",flush=True)
