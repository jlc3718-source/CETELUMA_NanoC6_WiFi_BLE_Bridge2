import subprocess,json,time,urllib.request,urllib.error
d=json.loads(subprocess.check_output(["docker","inspect","jason-home-2-web"],text=True))[0]
env=dict(x.split("=",1) for x in d["Config"]["Env"] if "=" in x)
token=env["JH2_UPSTREAM_TOKEN"]
def api(path,body=None):
 h={"Authorization":"Bearer "+token,"Content-Type":"application/json"}
 req=urllib.request.Request("http://127.0.0.1:8081"+path,
  data=json.dumps(body).encode() if body is not None else None,
  headers=h,method="POST" if body is not None else "GET")
 with urllib.request.urlopen(req,timeout=20) as r:return json.load(r)
s=api("/api/eufy/local-ble/status")
assert s.get("nanoFirmware")=="2.0.16" and s.get("nanoOnline") is True
assert s.get("configured") is True and (s.get("transport") or {}).get("supported") is True
def short(d):
 keys=["supported","busy","connected","state","phase","scanReports","scanMatches",
 "scanDeferred","scanStarts","gattConnections","notificationCount","handshakeWriteAcks",
 "gattMtu","lastFailureCode","lastResult"]
 return {k:d.get(k) for k in keys if k in d}
print("JH2_216_EUFY_DIAGNOSTICS_BEFORE",json.dumps(short(s["transport"])),flush=True)
# A single ON is idempotent for already-on Pool; no other physical lights are touched.
result=api("/api/eufy/local-ble/command",{"target":"Pool","operation":"power","on":True})
ids=result.get("commandIds")
assert result.get("queued") is True and isinstance(ids,list) and len(ids)==1
cid=ids[0]
print("JH2_216_POOL_COMMAND_QUEUED",cid,flush=True)
finished=None
for iteration in range(75):
 time.sleep(2)
 s=api("/api/eufy/local-ble/status")
 if iteration in (3,7,12,20,28):
  print("JH2_216_DIAGNOSTIC_STAGE",json.dumps(short(s.get("transport") or {})),flush=True)
 commands=s.get("commands") or []
 rows=[r for r in commands if r.get("id")==cid]
 if rows and rows[0].get("state") in ("applied","failed","expired","superseded"):
  finished=rows[0]
  break
assert finished is not None,"No command receipt"
final=short((s.get("transport") or {}))
print("JH2_216_FINAL_LOCAL_BLE",json.dumps({"target":"Pool","commandState":finished.get("state"),
 "gattDelivered":finished.get("bleTransmitted"),"commandResult":str(finished.get("detail"))[:135],
 "diagnostics":final}),flush=True)
if finished.get("state")=="applied" and finished.get("bleTransmitted") is True:
 print("JH2_216_POOL_ENCRYPTED_GATT_DELIVERED_PHYSICAL_LIGHT_NOT_YET_CONFIRMED",flush=True)
else:
 print("JH2_216_POOL_LOCAL_BLE_NOT_YET_OPERATIONAL",flush=True)
 raise SystemExit(2)
