#!/usr/bin/env python3
"""Isolated, encrypted-reference Agnes job; no private input or output is printed or committed."""
import os, sys, json, time, base64, hashlib, hmac, zlib, subprocess, tempfile, urllib.request, urllib.error, urllib.parse, shutil, zipfile
from pathlib import Path
os.umask(0o077)
ROOT=Path.home()/".agnes-private-jobs"/"roborock-2026-11"
ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
KEY=Path("/home/ubuntu/agnes-sd300/key")
RSA=Path.home()/".sd300-agnes-restore"/"private.pem"
MODEL="agnes-video-2.5-flash"
BASE="https://apihub.agnes-ai.com"
STATE=ROOT/"state.json"
state=json.loads(STATE.read_text()) if STATE.exists() else {}
def save():
 p=STATE.with_suffix(".tmp");p.write_text(json.dumps(state));os.replace(p,STATE)
def cmd(args, data=None, timeout=120):
 return subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=timeout).stdout
def decrypt(payload):
 b=base64.b64decode(payload,validate=True); wrap,iv,tag,ct=b[:384],b[384:400],b[400:432],b[432:]
 k=cmd(["openssl","pkeyutl","-decrypt","-inkey",str(RSA),"-pkeyopt","rsa_padding_mode:oaep","-pkeyopt","rsa_oaep_md:sha256","-pkeyopt","rsa_mgf1_md:sha256"],wrap)
 assert len(k)==64 and hmac.compare_digest(tag,hmac.new(k[32:],iv+ct,hashlib.sha256).digest()),"Input integrity check failed"
 raw=cmd(["openssl","enc","-d","-aes-256-cbc","-K",k[:32].hex(),"-iv",iv.hex()],ct)
 return json.loads(zlib.decompress(raw))
def encrypted_output(data,pem):
 k=os.urandom(64);iv=os.urandom(16)
 ct=cmd(["openssl","enc","-aes-256-cbc","-K",k[:32].hex(),"-iv",iv.hex()],data,240)
 tag=hmac.new(k[32:],iv+ct,hashlib.sha256).digest()
 pub=ROOT/"result-public.pem";pub.write_text(pem)
 wrap=cmd(["openssl","pkeyutl","-encrypt","-pubin","-inkey",str(pub),"-pkeyopt","rsa_padding_mode:oaep","-pkeyopt","rsa_oaep_md:sha256","-pkeyopt","rsa_mgf1_md:sha256"],k)
 return wrap+iv+tag+ct
def call(path,payload=None):
 key=KEY.read_text().strip()
 req=urllib.request.Request(BASE+path,data=None if payload is None else json.dumps(payload).encode(),headers={"Authorization":"Bearer "+key,"Content-Type":"application/json","Accept":"application/json"})
 try:
  with urllib.request.urlopen(req,timeout=120) as r:return r.status,json.load(r),r.headers
 except urllib.error.HTTPError as e:
  try: obj=json.load(e)
  except Exception: obj={}
  return e.code,obj,e.headers
def submit(path,payload,label):
 progress=state.setdefault("submissions",{}).setdefault(label,{})
 while True:
  if (ROOT/"STOP").exists():raise SystemExit("Stopped by user")
  code,obj,head=call(path,payload)
  progress["http"]=code
  if code in (200,201,202):
   progress["status"]="accepted";save();return obj
  if code in (503,429):
   delay=1 if code==503 else max(1,int(float(head.get("Retry-After","15")))) if str(head.get("Retry-After","15")).replace(".","",1).isdigit() else 30
   progress["status"]="queue_full" if code==503 else "rate_limited"
   progress["retries"]=progress.get("retries",0)+1
   progress["retry_delay_seconds"]=delay;save()
   if progress["retries"]==1 or progress["retries"]%30==0:print(label,"HTTP",code,"retry",delay,"count",progress["retries"],flush=True)
   time.sleep(delay);continue
  progress["status"]="rejected";save()
  raise RuntimeError(label+" rejected HTTP "+str(code))
def body(obj):
 d=obj.get("data")
 return d if isinstance(d,dict) else obj
def make_ref(job):
 if state.get("ref_url"):return state["ref_url"]
 obj=submit("/v1/images/generations",{"model":"agnes-image-2.5-flash","prompt":job["image_prompt"],"size":"1K","n":1,"extra_body":{"image":job["reference_images"],"ratio":"9:16","response_format":"url"}},"REFERENCE_IMAGE")
 data=obj.get("data")
 if not isinstance(data,list) or not data or not str(data[0].get("url","")).startswith("https://"):raise RuntimeError("Reference image did not return URL")
 state["ref_url"]=data[0]["url"];save();print("REFERENCE_IMAGE_READY",flush=True);return state["ref_url"]
def find_video_url(obj):
 d=body(obj)
 for v in (d,obj):
  if not isinstance(v,dict):continue
  for field in ("url","video_url","download_url"):
   u=v.get(field)
   if isinstance(u,str) and u.startswith("https://"):return u
  for field in ("metadata","output","result","videos"):
   item=v.get(field)
   for entry in (item if isinstance(item,list) else [item]):
    if isinstance(entry,str) and entry.startswith("https://"):return entry
    if isinstance(entry,dict):
     for key in ("url","video_url","download_url"):
      u=entry.get(key)
      if isinstance(u,str) and u.startswith("https://"):return u
 return None
def video(scene,ref):
 sid=scene["id"];x=state.setdefault("scenes",{}).setdefault(sid,{})
 raw=ROOT/(sid+"-raw.mp4")
 if raw.exists() and raw.stat().st_size>50000:return raw
 if not x.get("video_id"):
  o=submit("/v1/videos",{"model":MODEL,"mode":"reference","seconds":"12","size":"720P","aspect_ratio":"9:16","n":1,"images":[ref],"prompt":scene["prompt"]},sid)
  d=body(o);v=d.get("video_id") or o.get("video_id")
  if not v:raise RuntimeError("Missing video_id")
  x["video_id"]=v;save();print("AGNES_ACCEPTED",sid,flush=True)
 else: print("REUSING_ACCEPTED_JOB",sid,flush=True)
 last=""
 while True:
  if (ROOT/"STOP").exists():raise SystemExit("Stopped by user")
  q=urllib.parse.urlencode({"video_id":x["video_id"],"model_name":MODEL})
  code,o,h=call("/agnesapi?"+q);d=body(o)
  status=str(d.get("status",o.get("status","pending"))).lower()
  x["poll_http"]=code;x["status"]=status;save()
  if status!=last:print(sid,"STATUS",status,flush=True);last=status
  if code==200 and status in ("completed","succeeded","success"):
   url=find_video_url(o)
   if not url:
    print("COMPLETED_RESULT_URL_MISSING",sid,flush=True)
    raise RuntimeError("Missing completed URL")
   with urllib.request.urlopen(url,timeout=120) as resp:
    data=resp.read(100000001)
   if len(data)<50000 or len(data)>100000000 or b"ftyp" not in data[:64]:raise RuntimeError("Invalid output")
   tmp=raw.with_suffix(".part");tmp.write_bytes(data);os.replace(tmp,raw)
   cmd(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",str(raw)])
   return raw
  if status in ("failed","error","cancelled","canceled"):raise RuntimeError(sid+" generation failed")
  if code in (400,401,403,422):raise RuntimeError(sid+" poll rejected HTTP "+str(code))
  time.sleep(15 if code==200 else 30)

def finish(scene,raw):
 sid=scene["id"];out=ROOT/(sid+".mp4")
 if out.exists() and out.stat().st_size>50000:return out
 voice=ROOT/(sid+".wav")
 es=shutil.which("espeak-ng") or shutil.which("espeak")
 local_bin=ROOT/"tts-local"/"usr"/"bin"/"espeak"
 local_lib=ROOT/"tts-local"/"usr"/"lib"/"aarch64-linux-gnu"
 local_data=ROOT/"tts-local"/"usr"/"lib"/"aarch64-linux-gnu"/"espeak-data"
 if not local_data.exists():local_data=ROOT/"tts-local"/"usr"/"share"/"espeak-data"
 duration=float(cmd(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",str(raw)]).decode())
 def voice_duration():
  return float(cmd(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",str(voice)]).decode())
 def synth(rate):
  if es:
   cmd([es,"-v","en-us+m3","-s",str(rate),"-w",str(voice),scene["narration"]])
  elif local_bin.is_file() and local_data.is_dir():
   env=dict(os.environ,LD_LIBRARY_PATH=str(local_lib)+":"+os.environ.get("LD_LIBRARY_PATH",""))
   subprocess.run([str(local_bin),"--path="+str(local_data.parent),"-v","en-us+m3","-s",str(rate),"-w",str(voice),scene["narration"]],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=120)
  else:
   script=ROOT/(sid+"-narration.txt")
   script.write_text(scene["narration"])
   # flite reads only the private local narration file; no text is printed.
   if not all(x.isalnum() or x in "/._-" for x in str(script)):raise RuntimeError("Unsafe narration file path")
   cmd(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y","-f","lavfi","-i","flite=textfile="+str(script)+":voice=kal","-af","atempo="+str(max(0.5,min(2.0,rate/157))),str(voice)])
 synth(157)
 vd=voice_duration()
 if vd>duration+0.1:
  rate=min(275,max(158,int(157*vd/max(1,duration-0.2))+2))
  synth(rate)
  vd=voice_duration()
 if vd>duration+0.1:
  print("NARRATION_DURATION_EXCEEDS_CLIP",sid,flush=True)
  raise RuntimeError("Narration exceeds clip")
 tmp=out.with_name(sid+".tmp.mp4")
 cmd(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y","-i",str(raw),"-i",str(voice),"-map","0:v:0","-map","1:a:0","-vf","drawtext=text='AI-generated reenactment':fontsize=25:fontcolor=white:box=1:boxcolor=black@0.8:boxborderw=8:x=(w-tw)/2:y=36","-af","apad","-t",str(duration),"-c:v","libx264","-preset","veryfast","-crf","19","-c:a","aac","-b:a","128k","-pix_fmt","yuv420p","-movflags","+faststart",str(tmp)],timeout=240)
 cmd(["ffmpeg","-v","error","-nostdin","-i",str(tmp),"-f","null","-"],timeout=240)
 os.replace(tmp,out);print("VIDEO_VERIFIED",sid,flush=True);return out
def main():
 payload=os.environ.pop("ENCRYPTED_JOB","").strip()
 if not payload:payload=(ROOT/"encrypted-job.txt").read_text().strip()
 job=decrypt(payload)
 digest=hashlib.sha256(payload.encode()).hexdigest()
 if state.get("input_sha256") not in (None,digest):raise RuntimeError("Different input; refusing to overwrite existing private job")
 state["input_sha256"]=digest;save()
 print("PRIVATE_INPUT_DECRYPTED_AND_VERIFIED",flush=True)
 assert len(job["reference_images"])==2 and len(job["scenes"])==2
 ref=make_ref(job)
 outputs=[]
 for scene in job["scenes"]:outputs.append(finish(scene,video(scene,ref)))
 z=ROOT/"result.zip"
 with zipfile.ZipFile(z,"w",compression=zipfile.ZIP_STORED) as f:
  for p in outputs:f.write(p,p.name)
 dest=ROOT/"agnes-private-result.enc"
 dest.write_bytes(encrypted_output(z.read_bytes(),job["result_public_key"]))
 print("ENCRYPTED_RESULT_READY",dest.stat().st_size,flush=True)
if __name__=="__main__":
 try:main()
 except Exception as e:
  # Error messages from remote APIs and subprocesses can contain private URLs or input bytes.
  print("FAILED",type(e).__name__,flush=True)
  raise SystemExit(1)
