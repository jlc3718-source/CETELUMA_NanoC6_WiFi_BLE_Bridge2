#!/usr/bin/env python3
"""Install signed 1.1.68 on idle Nano 1.1.67, one attempt, with preserved manual factory rollback.

The previous signed 1.1.67 runtime must already be retained in Oracle /data
and publicly downloadable. Does NOT erase NVS, factory, storage or credentials.
No automatic retry, no arbitrary BLE commands, and no downgrade claim.
"""
import hashlib,json,subprocess,time,urllib.request
from pathlib import Path

ORACLE="http://127.0.0.1:8081"
NEW="1.1.68"
OLD="1.1.67"
COMMIT="98b13b72b09eca8566816562fe7b3ffcaba34959"
info=json.loads(subprocess.check_output(["docker","inspect","jason-home"],text=True))[0]
env=dict(x.split("=",1) for x in info["Config"]["Env"] if "=" in x)
def api(path,body=None,cookie=""):
    headers={"Content-Type":"application/json"}
    if cookie:headers["Cookie"]=cookie
    data=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(ORACLE+path,data=data,headers=headers,
                             method="POST" if body is not None else "GET")
    with urllib.request.urlopen(r,timeout=25) as resp:
        return json.load(resp),resp.headers

manifest,_=api("/api/curtain/firmware-manifest")
assert manifest.get("schema")==1 and manifest.get("signature")
fields=dict(x.split("=",1) for x in manifest["payload"].strip().splitlines())
assert fields["product"]=="jason-home-2-nanoc6"
assert fields["version"]==NEW and fields["commit"]==COMMIT
assert fields["url"].endswith("jason-home-2-nanoc6-v"+NEW+"/jh2-runtime-"+NEW+".bin")
for version in [OLD,NEW]:
    url=ORACLE+"/api/curtain/firmware-runtime/"+version+".bin"
    with urllib.request.urlopen(url,timeout=90) as stream:
        digest=hashlib.sha256();total=0
        while True:
            data=stream.read(65536)
            if not data:break
            digest.update(data);total+=len(data)
    if version==NEW:
        assert digest.hexdigest()==fields["sha256"] and total==int(fields["bytes"])
    assert 0x120000<total<=0x290000
    print("STAGED_BINARY_READABLE",version,total,digest.hexdigest(),flush=True)

_,headers=api("/api/session",{"token":env["JASON_HOME_API_TOKEN"]})
cookie=headers.get("Set-Cookie","").split(";")[0]
assert cookie.startswith("jh2=")

def status():
    result,_=api("/api/curtain/status",cookie=cookie)
    return result
def healthy(st,ver):
    return st.get("firmware")==ver and st.get("online") is True and (st.get("curtain") or {}).get("connected") is True
s=status()
print("BEFORE",{"fw":s.get("firmware"),"online":s.get("online"),"queue":s.get("queued"),
                "ble":(s.get("curtain") or {}).get("connected"),"streaming":s.get("relayStreaming")},flush=True)
if healthy(s,NEW):
    print("ALREADY_RUNNING_168_NO_DUPLICATE_INSTALL",flush=True)
    raise SystemExit(0)
assert healthy(s,OLD), "Nano not running expected baseline; do not flash"
assert s.get("relayStreaming") is not True, "Streaming currently active; no flash"
assert int(s.get("queued") or 0)==0, "Command queue not idle; no flash"

def command(action,identifier):
    request,_=api("/api/curtain/call",{"action":action,"payload":{},"idempotencyKey":identifier},cookie)
    cid=int(request["commandId"])
    for i in range(150):
        item,_=api("/api/curtain/command?id="+str(cid),cookie=cookie)
        cmd=item["command"]
        state=cmd.get("state")
        if state in ("applied","failed","expired","superseded"):
            print("ACK",action,cid,state,json.dumps(cmd.get("result"),sort_keys=True),flush=True)
            if state=="applied":return
            current=status()
            if healthy(current,NEW):
                print("DEVICE_ALREADY_UPDATED_DURING_ACK",flush=True)
                return
            raise RuntimeError(action+" was not acknowledged. Do not retry: "+state)
        time.sleep(.6)
    current=status()
    if healthy(current,NEW):return
    raise RuntimeError(action+" has no terminal ACK. No automatic retry.")

command("nanoFirmwareCheck","jh2-168-signed-preflight-20261024")
s=status()
if s.get("firmware")==OLD:
    assert healthy(s,OLD) and s.get("relayStreaming") is not True
    assert int(s.get("queued") or 0)==0
    command("nanoInstallUpdate","jh2-168-oracle-launch-install-once-20261024")
for n in range(120):
    time.sleep(3)
    s=status()
    if healthy(s,NEW):
        print("NANO_168_PHYSICAL_HEARTBEAT",{"firmware":s["firmware"],
            "uptime":s.get("uptimeSeconds"),"bridgeOnline":s.get("online"),
            "bleConnected":(s.get("curtain") or {}).get("connected"),
            "queue":s.get("queued")},flush=True)
        print("RECOVERY_OPTION_UNTOUCHED_FACTORY_UPDATER_AND_167_STAGED",flush=True)
        print("LOCAL_NANO_BROWSER_REDIRECT_REQUIRES_HOUSE_LAN_TEST",flush=True)
        raise SystemExit(0)
    if n%10==0:print("WAIT_FOR_NANO",{"fw":s.get("firmware"),
                                  "online":s.get("online"),
                                  "uptime":s.get("uptimeSeconds")},flush=True)
raise RuntimeError("Update not confirmed. Recovery BIN 1.1.67 is available; DO NOT repeat OTA.")
