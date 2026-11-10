"""Restore exactly the previously active Turkey Day seven-clip startup show
from saved show arrangement and verified historical Nano delivery records.
Refuse if any asset mapping or signature is ambiguous. No fabricated hashes.
"""
import json,sqlite3,subprocess,urllib.request,time
from pathlib import Path
d=json.loads(subprocess.check_output(["docker","inspect","jason-home-2-web"],text=True))[0]
env=dict(v.split("=",1) for v in d["Config"]["Env"] if "=" in v)
token=env["JH2_UPSTREAM_TOKEN"]
def req(path,body=None):
 h={"Authorization":"Bearer "+token,"Content-Type":"application/json"}
 r=urllib.request.Request("http://127.0.0.1:8081"+path,
    data=json.dumps(body).encode() if body is not None else None,
    headers=h,method="POST" if body is not None else "GET")
 with urllib.request.urlopen(r,timeout=25) as z:return json.load(z)
mount=[x for x in d["Mounts"] if x["Destination"]=="/data" and x["Type"]=="bind"]
assert len(mount)==1
database=Path(mount[0]["Source"])/"jason-home-2.sqlite"
with sqlite3.connect("file:"+str(database)+"?mode=ro",uri=True) as db:
 db.row_factory=sqlite3.Row
 rows=db.execute("SELECT id,name,items_json FROM curtain_internet_shows WHERE name=?",
                 ("Turkey Day",)).fetchall()
 rows=[r for r in rows if len(json.loads(r["items_json"]))==7]
 assert len(rows)==1,"Exact seven-clip Turkey Day saved show not unique"
 record=rows[0];saved=json.loads(record["items_json"])
 assert len({str(v.get("id")) for v in saved})==7 and all(
    isinstance(v.get("seconds"),(int,float)) and 2<=v["seconds"]<=60 for v in saved)
 recent=db.execute("SELECT id,payload FROM curtain_commands WHERE action='asset' AND source='show' AND state='applied' ORDER BY id DESC LIMIT 1000").fetchall()
 lookup={}
 for cmd in recent:
  try:sha=json.loads(cmd["payload"]).get("sha256")
  except Exception:continue
  if not isinstance(sha,str) or len(sha)!=64:continue
  row=db.execute("SELECT metadata,length(bytes) n FROM curtain_assets WHERE sha=?",(sha,)).fetchone()
  if not row or int(row["n"] or 0)<=0:continue
  try:m=json.loads(row["metadata"])
  except Exception:continue
  profile=m.get("playbackProfile") or {}
  id=profile.get("sourceId")
  if (id not in {x["id"] for x in saved} or id in lookup or
     m.get("format")!="jh2-nano-seamless-delta-v1" or m.get("loop") is not True or
     profile.get("mode")!="show-effect" or not 2<=int(m.get("frames") or 0)<=24):
   continue
  lookup[id]=sha
 assert len(lookup)==7,"All seven most-recent successfully delivered clip assets are required"
 items=[{"id":x["id"],"seconds":x["seconds"],"sha256":lookup[x["id"]]} for x in saved]
 print("JH2_SHOW_RESTORE_PREFLIGHT",json.dumps({"name":record["name"],"count":len(items),
   "durationSeconds":sum(x["seconds"] for x in items),"recordVerified":True,"assetsFromAppliedCommands":7}))
live=req("/api/curtain/status")
assert live.get("firmware")=="2.0.15" and live.get("online") is True and live.get("curtain",{}).get("connected") is True
if (live.get("showSequence") or {}).get("running"):
 print("JH2_SHOW_ALREADY_RUNNING_NO_CHANGE")
else:
 ret=req("/api/curtain/startup-show",{"showId":record["id"],"items":items})
 assert ret.get("ok") is True and (ret.get("startupShow") or {}).get("mode")=="sequence"
 print("JH2_SAVED_STARTUP_SHOW_RESTORED",len(items))
 ret=req("/api/curtain/show-sequence",{"operation":"start","name":record["name"],
      "showId":record["id"],"items":items})
 assert ret.get("ok") is True
 for attempt in range(45):
  time.sleep(2)
  live=req("/api/curtain/status")
  if (live.get("showSequence") or {}).get("running") and live.get("curtain",{}).get("connected"):break
 else:raise RuntimeError("Show did not start after restoration")
 print("JH2_SAVED_SEVEN_CLIP_SHOW_PLAYING",live["showSequence"]["name"],live["showSequence"]["phase"])
# Confirm startup is still set and show is running (don't change schedule)
state=req("/api/curtain/startup-show")["startupShow"]
assert state and state.get("mode")=="sequence" and len(state.get("items") or [])==7
assert (live.get("showSequence") or {}).get("running") is True
print("JH2_215_SHOW_RESTORATION_VERIFIED",json.dumps({"name":"Turkey Day",
  "startupSaved":True,"clips":7,"running":True,"firmware":live.get("firmware"),
  "smartdawnConnected":live.get("curtain",{}).get("connected")}))
