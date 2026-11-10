"""Rebuild 7 saved Turkey Day 40x40 motion loops from the actual Oracle GIFs.
The old startup/show record was cleared by stopShowSequence() during OTA.
This only regenerates the seven existing source IDs and their saved durations.
"""
import base64,io,json,math,sqlite3,subprocess,time,urllib.error,urllib.request
from pathlib import Path
from PIL import Image
info=json.loads(subprocess.check_output(["docker","inspect","jason-home-2-web"],text=True))[0]
env=dict(v.split("=",1) for v in info["Config"]["Env"] if "=" in v)
token=env["JH2_UPSTREAM_TOKEN"]
def api(path,payload=None,timeout=135):
 h={"Authorization":"Bearer "+token,"Content-Type":"application/json"}
 req=urllib.request.Request("http://127.0.0.1:8081"+path,
       data=json.dumps(payload).encode() if payload is not None else None,
       headers=h,method="POST" if payload is not None else "GET")
 try:
  with urllib.request.urlopen(req,timeout=timeout) as res:return json.load(res)
 except urllib.error.HTTPError as e:
  raise RuntimeError(path+" returned "+str(e.code)+": "+e.read(420).decode("utf8","replace")) from None
mounts=[m for m in info["Mounts"] if m["Destination"]=="/data" and m["Type"]=="bind"]
assert len(mounts)==1
database=Path(mounts[0]["Source"])/"jason-home-2.sqlite"
with sqlite3.connect("file:"+str(database)+"?mode=ro",uri=True) as db:
 db.row_factory=sqlite3.Row
 rows=db.execute("SELECT id,name,items_json FROM curtain_internet_shows WHERE name=?",
                 ("Turkey Day",)).fetchall()
 selected=[row for row in rows if len(json.loads(row["items_json"]))==7]
 assert len(selected)==1,"Saved seven-clip Turkey Day definition missing or ambiguous"
 row=selected[0]
 saved=json.loads(row["items_json"])
 assert len({x["id"] for x in saved})==7 and all(
  isinstance(x["seconds"],int) and 2<=x["seconds"]<=60 for x in saved)
 sources={}
 for x in saved:
  source=db.execute("SELECT name,kind,gif FROM curtain_internet_art WHERE id=?",(x["id"],)).fetchone()
  assert source and source["kind"]=="gif" and len(source["gif"])>80, "Original GIF source is missing"
  sources[x["id"]]=(source["name"],bytes(source["gif"]))
print("JH2_SHOW_RECOVERY_GIF_SOURCES_VERIFIED",len(sources),flush=True)
live=api("/api/curtain/status")
assert live.get("firmware")=="2.0.15" and live.get("online") is True
assert live.get("curtain",{}).get("connected") is True and live.get("curtain",{}).get("mtu",0)>=500
assert not (live.get("showSequence") or {}).get("running"),"Another show is already running"
def gif_frames(gif,seconds):
 decoder=Image.open(io.BytesIO(gif))
 count=decoder.n_frames
 assert count>=1 and count<10000,"GIF frame count outside safe bounds"
 wanted=min(23,count)
 frames=[];delays=[]
 for i in range(wanted):
  idx=min(count-1,math.floor(i*count/wanted))
  decoder.seek(idx)
  pic=decoder.convert("RGBA")
  pic=pic.resize((40,40),Image.Resampling.NEAREST)
  canvas=Image.new("RGBA",(40,40),(0,0,0,255))
  canvas.alpha_composite(pic)
  frames.append(base64.b64encode(canvas.tobytes()).decode("ascii"))
  next_i=count if i+1==wanted else math.floor((i+1)*count/wanted)
  represented=max(1,next_i-idx)
  ms=int(decoder.info.get("duration") or 100)
  delays.append(max(40,min(60000,ms*represented)))
 total=sum(delays)
 max_cycle=min(4000,seconds*500)
 if total>max_cycle:
  delays=[max(40,round(ms*max_cycle/total)) for ms in delays]
 return frames,delays,count
resolved=[]
for idx,x in enumerate(saved,1):
 name,gif=sources[x["id"]]
 frames,delays,count=gif_frames(gif,x["seconds"])
 payload={"name":name,"sourceId":x["id"],"mode":"show-effect",
          "prepareOnly":True,"speedPercent":160,
          "frames":frames,"delays":delays,"originalSourceFrames":count}
 result=api("/api/curtain/assets/optimize",payload)
 sha=result.get("sha256")
 assert result.get("ok") is True and isinstance(sha,str) and len(sha)==64
 assert result.get("timingMode")=="source" and 2<=result.get("transmittedFrames",0)<=24
 assert result.get("bytes",0)<=102400 and result.get("bytes",0)>0
 resolved.append({"id":x["id"],"seconds":x["seconds"],"sha256":sha})
 print("JH2_SHOW_RECOVERED_CLIP",idx,"frames",result.get("transmittedFrames"),
       "bytes",result.get("bytes"),flush=True)
ret=api("/api/curtain/startup-show",{"showId":row["id"],"items":resolved})
assert ret.get("ok") is True and (ret.get("startupShow") or {}).get("mode")=="sequence"
print("JH2_SHOW_STARTUP_AUTOPLAY_RESTORED",len(resolved),flush=True)
ret=api("/api/curtain/show-sequence",{"operation":"start","name":row["name"],
                                    "showId":row["id"],"items":resolved})
assert ret.get("ok") is True
for i in range(50):
 time.sleep(2)
 live=api("/api/curtain/status")
 seq=live.get("showSequence") or {}
 if seq.get("running") is True and seq.get("phase")=="playing":break
else:raise RuntimeError("Saved show did not reach playing state")
startup=api("/api/curtain/startup-show").get("startupShow") or {}
assert startup.get("mode")=="sequence" and len(startup.get("items") or [])==7
assert live.get("firmware")=="2.0.15" and live.get("curtain",{}).get("connected") is True
print("JH2_215_SAVED_SHOW_PLAYBACK_VERIFIED",json.dumps({"name":seq.get("name"),
  "clips":len(resolved),"running":True,"phase":"playing","startupSaved":True,
  "firmware":live.get("firmware"),"bleMtu":live["curtain"].get("mtu")}),flush=True)
