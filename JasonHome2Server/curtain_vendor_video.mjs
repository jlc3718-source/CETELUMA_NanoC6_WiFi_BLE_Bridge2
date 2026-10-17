/* SuperPix 4.4.1 vendor video conversion relay, limited to 40x40 curtain tests.
   Manufacturer protocol: POST octet-stream /webs/upload/video,
   POST form /webs/encode/video with sid, poll POST /webs/effect/list,
   GET binary /webs/effect/get/:cid.
   Never writes the controller; returned .eff is subsequently installed by the
   separately guarded CID83928 native BLE module in the browser. */
import {randomUUID} from "node:crypto";
const HOST="https://hk.daniaokeji.com/webs",JOBS=new Map();
const MAX_VIDEO=800000,MAX_EFFECT=2400000,TTL=8*60*1000;
const safeId=v=>typeof v==="string"&&/^[a-zA-Z0-9:._-]{4,96}$/.test(v)?v:"";
function fail(message,status=502){const e=new Error(message);e.status=status;return e;}
function serial(bridge){
 const status=bridge.status?.()||{},c=status.curtain||{};
 // SuperPix calls this value deviceInfo.sn (the Bluetooth device ID).
 const candidates=[process.env.JH2_SMARTDAWN_SN,process.env.JH2_SUPERPIX_SID,c.sn,c.deviceId,c.devId,c.mac,c.address,status.smartdawnSn,status.curtainSn];
 const sn=candidates.map(safeId).find(Boolean);
 if(!sn)throw fail("SmartDawn manufacturer device ID is not available from the Nano status. The vendor requires a sid; no upload was attempted.",409);
 return sn;
}
async function request(path,{method="POST",sid,bytes,params,timeout=35000}={}){
 const headers={"accept":"application/json"};
 if(sid)headers.sid=sid;
 let body;
 if(bytes){headers["content-type"]="application/octet-stream";body=bytes;}
 if(params){headers["content-type"]="application/x-www-form-urlencoded; charset=UTF-8";body=new URLSearchParams(params).toString();}
 let resp;
 try{resp=await fetch(HOST+path,{method,headers,body,signal:AbortSignal.timeout(timeout),redirect:"error"});}
 catch(e){throw fail("SuperPix cloud connection failed: "+(e.name==="TimeoutError"?"request timed out":"connection unavailable"));}
 if(!resp.ok)throw fail("SuperPix cloud "+path+" returned HTTP "+resp.status);
 const length=Number(resp.headers.get("content-length")||0);
 if(path.startsWith("/effect/get/")){
  if(length>MAX_EFFECT)throw fail("SuperPix effect is too large for this 40x40 test");
  const data=Buffer.from(await resp.arrayBuffer());
  if(data.length<4096||data.length>MAX_EFFECT)throw fail("Downloaded native effect size is not supported");
  const magic=data.toString("ascii",0,4);
  if(!["DNMX","DNCX"].includes(magic))throw fail("SuperPix server returned a non-native effect: "+magic.replace(/[^a-zA-Z0-9]/g,"?"));
  if(data.readUInt16LE(6)!==40||data.readUInt16LE(8)!==40)throw fail("Converted effect dimensions do not match 40x40 curtain");
  return data;
 }
 const raw=await resp.text();
 if(raw.length>200000)throw fail("SuperPix cloud response exceeded safe limit");
 try{return JSON.parse(raw);}catch{throw fail("SuperPix cloud returned an unreadable response");}
}
async function list(sid){
 const data=await request("/effect/list",{sid,params:{}});
 if(!Array.isArray(data))throw fail("SuperPix effect list was not accepted for this device");
 return data.filter(v=>Number.isSafeInteger(Number(v?.cid))&&Number(v.cid)>0);
}
function sweep(){const now=Date.now();for(const [id,job]of JOBS)if(now-job.when>TTL)JOBS.delete(id);}
function createVendorVideo(bridge){
 async function start({avi}){
  sweep();
  if(typeof avi!=="string"||avi.length>MAX_VIDEO*4/3+8||!/^[A-Za-z0-9+/]+={0,2}$/.test(avi))throw fail("A valid small AVI animation is required",400);
  const data=Buffer.from(avi,"base64");
  if(data.length<256||data.length>MAX_VIDEO||data.toString("ascii",0,4)!=="RIFF"||data.toString("ascii",8,12)!=="AVI ")throw fail("Only a small valid AVI file can be sent",400);
  if(data.readUInt32LE(4)+8!==data.length)throw fail("AVI byte count is invalid",400);
  const sid=serial(bridge);
  const baseline=await list(sid);
  const known=new Set(baseline.map(x=>Number(x.cid)));
  const upload=await request("/upload/video",{bytes:data,timeout:45000});
  if(upload?.result!=="success"||typeof upload.message!=="string"||upload.message.length>300)throw fail("SuperPix video upload rejected the sample AVI"+(upload?.code?": "+String(upload.code):""));
  const name="JH2_Native_Test_"+randomUUID().replace(/-/g,"").slice(0,12);
  const converted=await request("/encode/video",{sid,params:{video:upload.message,width:"40",height:"40",name},timeout:45000});
  if(converted?.result!=="success")throw fail("SuperPix encoding refused the AVI"+(converted?.code?": "+String(converted.code):""));
  const id=randomUUID();JOBS.set(id,{sid,name,known,when:Date.now(),busy:false,complete:null});
  return {ok:true,jobId:id,state:"converting"};
 }
 async function status(jobId){
  sweep();const job=JOBS.get(jobId);if(!job)throw fail("Conversion expired or was not started",404);
  if(job.complete)return {...job.complete};
  if(job.busy)return {ok:true,state:"converting"};
  job.busy=true;
  try{
   const items=await list(job.sid);
   const candidate=items.find(x=>!job.known.has(Number(x.cid))&&x.name===job.name&&Number(x.status)===1);
   if(!candidate)return {ok:true,state:"converting"};
   const cid=Number(candidate.cid);
   const effect=await request("/effect/get/"+cid,{method:"GET",timeout:45000});
   const effectCid=effect.readUInt32LE(14);
   if(effectCid!==cid)throw fail("Converted effect's embedded CID differs from the vendor catalog; nothing will be uploaded");
   job.complete={ok:true,state:"ready",cid,format:effect.toString("ascii",0,4),bytes:effect.length,eff:effect.toString("base64")};
   return {...job.complete};
  }finally{job.busy=false;}
 }
 return {start,status};
}
export {createVendorVideo};
