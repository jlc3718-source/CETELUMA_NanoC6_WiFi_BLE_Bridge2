import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EufyClient, type EufySession } from "./eufy/client.js";
import { canBuildFactoryFields, dedupeFactoryPresetsByName } from "./eufy/factory-presets.js";
import { astronomy, nextScheduleEvent, resolveScheduleState } from "./scheduler.js";
import { currentCalendarInfo, nextCalendarEvent, normalizeCalendarConfig, resolveCalendar, type CalendarConfig } from "./calendar.js";
import type { Scene, ScheduleRow } from "./types.js";

const PORT=Math.max(1,Number(process.env.PORT||"8080"));
const EMAIL=process.env.EUFY_EMAIL||"";
const PASSWORD=process.env.EUFY_PASSWORD||"";
const TOKEN=process.env.JASON_HOME_API_TOKEN||"";
const DB_PATH=process.env.JASON_HOME_DB||"/data/jason-home.sqlite";
const LAT=Number(process.env.HOME_LAT||"42.1507");
const LON=Number(process.env.HOME_LON||"-78.9452");
const TZ=process.env.HOME_TZ||"America/New_York";
const DEFAULT_INSTALL=(process.env.EUFY_INSTALL_ID||createHash("sha256").update("jason-home-server:"+EMAIL).digest("hex").slice(0,32)).toLowerCase();

if(!EMAIL||!PASSWORD)throw new Error("EUFY_EMAIL and EUFY_PASSWORD are required");
if(!TOKEN)throw new Error("JASON_HOME_API_TOKEN is required");
if(!/^[0-9a-f]{32}$/.test(DEFAULT_INSTALL))throw new Error("EUFY_INSTALL_ID must be 32 hex characters when supplied");

const DEVICE_NAMES=["Pool","House","Garage","Shed"] as const;
const DEVICE_MODELS:Record<string,string>={Pool:"E120",House:"E120",Garage:"E22",Shed:"E22"};
const DEFAULT_SCENE:Scene={power:true,brightness:75,effect:"Solid / Static",colors:[0xffffff],speed:3};

mkdirSync(dirname(DB_PATH),{recursive:true});
const db=new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  name TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_ok INTEGER,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS desired_state (
  name TEXT PRIMARY KEY,
  scene TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  days TEXT NOT NULL DEFAULT '*',
  start_kind TEXT NOT NULL DEFAULT 'clock',
  start_value TEXT NOT NULL DEFAULT '18:00',
  end_kind TEXT NOT NULL DEFAULT 'clock',
  end_value TEXT NOT NULL DEFAULT '23:00',
  target TEXT NOT NULL DEFAULT 'All',
  effect TEXT NOT NULL DEFAULT 'Solid / Static',
  colors TEXT NOT NULL DEFAULT '[16777215]',
  brightness INTEGER NOT NULL DEFAULT 75,
  speed INTEGER NOT NULL DEFAULT 3,
  priority INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS command_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  target TEXT NOT NULL,
  action TEXT NOT NULL,
  ok INTEGER NOT NULL,
  detail TEXT
);
`);
for(const [name,model] of Object.entries(DEVICE_MODELS)){
  db.prepare("INSERT OR IGNORE INTO devices(name,model,enabled) VALUES(?,?,1)").run(name,model);
}

function meta(key:string):string|null{
  const row=db.prepare("SELECT value FROM meta WHERE key=?").get(key) as any;
  return row?.value??null;
}
function setMeta(key:string,value:string){
  db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key,value);
}
function delMeta(key:string){db.prepare("DELETE FROM meta WHERE key=?").run(key);}
function calendarConfig():CalendarConfig|null{
  const raw=meta("calendar_config");
  if(!raw)return null;
  try{return JSON.parse(raw) as CalendarConfig;}catch{return null;}
}
function nextAutomationEvent(now=new Date()){
  const generic=nextScheduleEvent(scheduleRows(),now,LAT,LON,TZ);
  const calendar=nextCalendarEvent(calendarConfig(),now,LAT,LON,TZ);
  if(generic&&calendar)return generic.at<=calendar.at?{at:generic.at,name:generic.row.name,target:generic.row.target,phase:generic.phase,source:"schedule"}:{...calendar,phase:"start" as const,source:"calendar"};
  if(generic)return {at:generic.at,name:generic.row.name,target:generic.row.target,phase:generic.phase,source:"schedule"};
  if(calendar)return {...calendar,phase:"start" as const,source:"calendar"};
  return null;
}
if(!meta("install_id"))setMeta("install_id",DEFAULT_INSTALL);

function clamp(v:number,a:number,b:number){return Math.max(a,Math.min(b,v));}
function parseColor(v:any):number|null{
  if(typeof v==="number"&&Number.isFinite(v))return v&0xffffff;
  if(typeof v==="string"&&/^#?[0-9a-fA-F]{6}$/.test(v))return parseInt(v.replace("#",""),16);
  return null;
}
function safeScene(input:any,base:Scene=DEFAULT_SCENE):Scene{
  const colors=Array.isArray(input?.colors)?input.colors.map(parseColor).filter((x:any)=>x!=null).slice(0,8) as number[]:base.colors;
  return {
    power:input?.power==null?base.power:!!input.power,
    brightness:clamp(Number(input?.brightness??base.brightness)||base.brightness,1,100),
    effect:String(input?.effect||base.effect).slice(0,64),
    colors:colors.length?colors:[...base.colors],
    speed:clamp(Number(input?.speed??base.speed)||base.speed,1,5)
  };
}
function sceneKey(scene:Scene){return JSON.stringify({power:!!scene.power,brightness:scene.brightness,effect:scene.effect,colors:scene.colors,speed:scene.speed});}
function offScene():Scene{return {power:false,brightness:DEFAULT_SCENE.brightness,effect:DEFAULT_SCENE.effect,colors:[...DEFAULT_SCENE.colors],speed:DEFAULT_SCENE.speed};}
function scheduleRows():ScheduleRow[]{
  return db.prepare("SELECT * FROM schedules WHERE enabled=1 ORDER BY priority DESC,name ASC").all() as unknown as ScheduleRow[];
}
function allSchedules(){return db.prepare("SELECT * FROM schedules ORDER BY name ASC").all() as any[];}
function targetNames(target:string):string[]{
  if(!target||target.toLowerCase()==="all")return [...DEVICE_NAMES];
  if(!(target in DEVICE_MODELS))throw new Error("Unknown target "+target);
  return [target];
}
function storedScene(name:string):Scene|null{
  const row=db.prepare("SELECT scene FROM desired_state WHERE name=?").get(name) as any;
  try{return row?.scene?JSON.parse(row.scene):null;}catch{return null;}
}
function json(res:http.ServerResponse,status:number,value:unknown){
  const body=JSON.stringify(value);
  res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","content-length":Buffer.byteLength(body)});
  res.end(body);
}
async function readJson(req:http.IncomingMessage){
  const chunks:Buffer[]=[];let total=0;
  for await(const chunk of req){
    const b=Buffer.from(chunk);total+=b.length;
    if(total>1048576)throw new Error("Request body too large");
    chunks.push(b);
  }
  if(!chunks.length)return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function secureEqual(a:string,b:string){
  const aa=Buffer.from(a),bb=Buffer.from(b);
  return aa.length===bb.length&&timingSafeEqual(aa,bb);
}
function authorized(req:http.IncomingMessage){
  const h=req.headers.authorization||"";
  return h.startsWith("Bearer ")&&secureEqual(h.slice(7),TOKEN);
}

let eufy:EufyClient|null=null;
let eufyReady=false;
let eufyStatus="Not connected";
let readyNames:string[]=[];
let preparing:Promise<EufyClient>|null=null;

// Serialize commands per physical string, not globally. This preserves command
// order for each device while allowing Pool/House/Garage/Shed to run in parallel.
const deviceQueues=new Map<string,Promise<void>>();
async function serializedForDevice<T>(name:string,fn:()=>Promise<T>):Promise<T>{
  const prior=deviceQueues.get(name)||Promise.resolve();
  let release!:()=>void;
  const current=new Promise<void>(resolve=>{release=resolve;});
  deviceQueues.set(name,current);
  await prior.catch(()=>{});
  try{return await fn();}
  finally{
    release();
    if(deviceQueues.get(name)===current)deviceQueues.delete(name);
  }
}

async function ensureEufy(force=false){
  if(force){eufy=null;eufyReady=false;readyNames=[];preparing=null;}
  if(eufy&&eufyReady&&readyNames.length===4)return eufy;
  if(preparing)return preparing;
  preparing=(async()=>{
    const install=meta("install_id")||DEFAULT_INSTALL;
    let session:EufySession|undefined;
    const raw=meta("eufy_session");
    if(raw){try{session=JSON.parse(raw);}catch{}}
    let client=new EufyClient(install,session);
    try{
      if(!client.authed)await client.login(EMAIL,PASSWORD);
      await client.prepare();
    }catch(first){
      if(session){
        delMeta("eufy_session");
        client=new EufyClient(install);
        await client.login(EMAIL,PASSWORD);
        await client.prepare();
      }else throw first;
    }
    const names=client.readyNames();
    for(const n of DEVICE_NAMES)if(!names.includes(n))throw new Error("Missing expected Eufy light: "+n);
    eufy=client;eufyReady=true;readyNames=names;eufyStatus=`Ready ${names.length}/4`;
    setMeta("eufy_session",JSON.stringify(client.exportSession()));
    return client;
  })().catch((e:any)=>{
    eufyReady=false;readyNames=[];eufyStatus=e?.message||String(e);throw e;
  }).finally(()=>{preparing=null;});
  return preparing;
}

async function sendScene(name:string,scene:Scene){
  return serializedForDevice(name,async()=>{
    const c=await ensureEufy(false);
    return scene.power
      ? c.scene(name,scene.effect,scene.colors,scene.speed,scene.brightness)
      : c.power(name,false);
  });
}

let manualSequence=0;
const latestManualSequence=new Map<string,number>();

async function sendSceneLatest(name:string,scene:Scene,sequence:number){
  return serializedForDevice(name,async()=>{
    if(latestManualSequence.get(name)!==sequence)return {skipped:true,published:0};
    const c=await ensureEufy(false);
    if(latestManualSequence.get(name)!==sequence)return {skipped:true,published:0};
    const result=scene.power
      ? await c.scene(name,scene.effect,scene.colors,scene.speed,scene.brightness)
      : await c.power(name,false);
    return {...result,skipped:false};
  });
}

let factoryRefreshState:any={state:"idle",startedAt:null,finishedAt:null,error:null};
function queueFactoryRefresh(){
  if(factoryRefreshState?.state==="running")return factoryRefreshState;
  factoryRefreshState={state:"running",startedAt:new Date().toISOString(),finishedAt:null,error:null};
  void factoryCatalog(true).then((catalog:any)=>{
    factoryRefreshState={state:"complete",startedAt:factoryRefreshState.startedAt,finishedAt:new Date().toISOString(),error:null,count:Number(catalog?.count)||0};
  }).catch((e:any)=>{
    factoryRefreshState={state:"failed",startedAt:factoryRefreshState.startedAt,finishedAt:new Date().toISOString(),error:e?.message||String(e)};
  });
  return factoryRefreshState;
}
async function factoryCatalog(refresh=false){
  if(!refresh){
    const raw=meta("factory_catalog");
    if(raw){try{return JSON.parse(raw);}catch{delMeta("factory_catalog");}}
  }
  const c=await ensureEufy(false);
  const fetched=await c.factoryPresets();
  const value={ok:true,fetchedAt:new Date().toISOString(),count:fetched.presets.length,scanned:fetched.scanned,presets:fetched.presets,rawDiscover:fetched.rawDiscover};
  setMeta("factory_catalog",JSON.stringify(value));
  setMeta("factory_catalog_at",String(Date.now()));
  console.log(`Eufy factory catalog: scanned ${fetched.scanned} ids; ${fetched.presets.length} valid records returned`);
  return value;
}
function factoryEdits():Record<string,any>{
  const raw=meta("factory_edits");
  if(!raw)return {};
  try{
    const parsed=JSON.parse(raw);
    return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:{};
  }catch{return {};}
}
function applyFactoryEdit(base:any){
  const edit=factoryEdits()[String(base?.lightId)];
  if(!edit)return base;
  return {...base,...edit,lightId:base.lightId,raw:base.raw,customized:true};
}
function sanitizeFactoryEdit(base:any,input:any){
  if(!base)throw new Error("Factory preset was not found");
  const out:any={};
  if(input?.name!=null)out.name=String(input.name).trim().slice(0,100)||base.name;
  if(input?.brightness!=null){
    const n=Math.round(Number(input.brightness));
    if(!Number.isFinite(n)||n<1||n>100)throw new Error("Brightness must be 1–100");
    out.brightness=n;
  }
  for(const key of ["speed","layerExecutionMode"]){
    if(input?.[key]!=null){
      const n=Math.round(Number(input[key]));
      if(!Number.isFinite(n)||n<0||n>255)throw new Error(key+" must be 0–255");
      out[key]=n;
    }
  }
  if(input?.layers!=null){
    if(!Array.isArray(input.layers)||input.layers.length<1||input.layers.length>32)throw new Error("Factory preset must contain 1–32 layers");
    out.layers=input.layers.map((layer:any,index:number)=>{
      if(!layer||typeof layer!=="object"||Array.isArray(layer))throw new Error("Layer "+(index+1)+" is invalid");
      return JSON.parse(JSON.stringify(layer));
    });
  }
  const merged={...base,...out,lightId:base.lightId,raw:base.raw};
  const e22=canBuildFactoryFields("T8L02",merged);
  const e120=canBuildFactoryFields("T8L00",merged);
  if(!e22&&!e120)throw new Error("Edited factory recipe cannot be serialized for E22 or E120");
  return {edit:out,merged:{...merged,customized:true,buildableE22:e22,buildableE120Experimental:e120}};
}
function saveFactoryEdit(catalog:any,input:any){
  const lightId=Number(input?.lightId);
  if(!Number.isInteger(lightId)||lightId<1||lightId>1000000)throw new Error("Invalid factory preset id");
  const base=(Array.isArray(catalog?.presets)?catalog.presets:[]).find((p:any)=>Number(p?.lightId)===lightId);
  const {edit,merged}=sanitizeFactoryEdit(base,input?.preset||input);
  const edits=factoryEdits();edits[String(lightId)]=edit;setMeta("factory_edits",JSON.stringify(edits));
  return merged;
}
function resetFactoryEdit(lightId:number){
  const edits=factoryEdits(),key=String(lightId),had=Object.prototype.hasOwnProperty.call(edits,key);
  delete edits[key];setMeta("factory_edits",JSON.stringify(edits));
  return had;
}

function factorySummary(catalog:any,includeRaw=false,id?:number){
  const src=Array.isArray(catalog?.presets)?catalog.presets:[];
  const edited=src.map(applyFactoryEdit);
  const canonical=id==null?dedupeFactoryPresetsByName(edited):edited.filter((p:any)=>Number(p?.lightId)===id);
  const list=canonical.map((p:any)=>{
    if(includeRaw)return p;
    const {raw,...summary}=p||{};
    return summary;
  });
  return {ok:true,fetchedAt:catalog?.fetchedAt||null,count:list.length,totalCount:canonical.length,rawTotalCount:src.length,duplicatesCollapsed:Math.max(0,src.length-canonical.length),scanned:Number(catalog?.scanned)||0,presets:list};
}
const factoryJobs=new Map<string,any>();
function pruneFactoryJobs(){
  const cutoff=Date.now()-60*60*1000;
  for(const [id,j] of factoryJobs)if(Number(j?.createdAt||0)<cutoff)factoryJobs.delete(id);
}
function queueFactoryTest(lightId:number,target="All"){
  pruneFactoryJobs();
  const jobId=crypto.randomUUID();
  factoryJobs.set(jobId,{jobId,state:"running",lightId,target,createdAt:Date.now()});
  void factoryTestAll(lightId,target).then(result=>factoryJobs.set(jobId,{jobId,state:"complete",lightId,target,createdAt:Date.now(),result}))
    .catch((e:any)=>factoryJobs.set(jobId,{jobId,state:"failed",lightId,target,createdAt:Date.now(),error:e?.message||String(e)}));
  return {ok:true,queued:true,jobId,lightId,target};
}
async function factoryTestAll(lightId:number,target="All"){
  if(!Number.isInteger(lightId)||lightId<1||lightId>1000000)throw new Error("Invalid factory preset id");
  const c=await ensureEufy(false);
  let preset:any=null;
  const raw=meta("factory_catalog");
  if(raw){try{preset=(JSON.parse(raw)?.presets||[]).find((p:any)=>Number(p?.lightId)===lightId)||null;}catch{}}
  if(!preset)preset=await c.factoryPreset(lightId);
  preset=applyFactoryEdit(preset);
  const names=targetNames(target);
  const results:any[]=[];let sent=0;
  for(const name of names){
    try{
      const r=await serializedForDevice(name,()=>c.factoryScene(name,preset));
      sent++;
      results.push({name,ok:true,model:DEVICE_MODELS[name],strategy:(r as any).strategy,published:(r as any).published,instance:(r as any).instance||null,report:(r as any).report||null});
      db.prepare("UPDATE devices SET last_ok=?,last_error=NULL WHERE name=?").run(Date.now(),name);
    }catch(e:any){
      const msg=e?.message||String(e);
      results.push({name,ok:false,model:DEVICE_MODELS[name],strategy:DEVICE_MODELS[name]==="E22"?"verified-t8l02-020d":"experimental-t8l00-020d",error:msg});
      db.prepare("UPDATE devices SET last_error=? WHERE name=?").run(msg,name);
    }
  }
  const next=nextAutomationEvent(new Date());
  setMeta("override",JSON.stringify({active:true,target,factory:true,lightId,createdAt:Date.now(),expiresAt:next?.at||null}));
  setMeta("factory_last_test",JSON.stringify({at:new Date().toISOString(),lightId,name:preset?.name||null,target,sent,total:names.length,results}));
  return {ok:sent===names.length,lightId,name:preset?.name||null,target,customized:!!preset?.customized,attempted:names.length,sent,results,note:"Factory command sent through the Eufy factory scene path. T8L02/E22 uses the verified 0x020D layout; T8L00/E120 uses the isolated experimental family adaptation and must be verified visually."};
}

async function statusPayload(refresh=false){
  if(refresh){
    try{await ensureEufy(false);}catch{}
  }
  const now=new Date();
  const astro=astronomy(now,LAT,LON,TZ);
  const next=nextAutomationEvent(now);
  const calendar=calendarConfig();
  const currentCalendar=currentCalendarInfo(calendar,now,LAT,LON,TZ);
  let override:any=null;const raw=meta("override");
  try{override=raw?JSON.parse(raw):null;}catch{}
  const devices=(db.prepare("SELECT name,model,enabled,last_ok,last_error FROM devices ORDER BY CASE name WHEN 'Pool' THEN 1 WHEN 'House' THEN 2 WHEN 'Garage' THEN 3 ELSE 4 END").all() as any[])
    .map(d=>({...d,ready:eufyReady&&readyNames.includes(d.name)}));
  return {
    ok:true,
    controller:"Online",
    architecture:"Oracle Linux + Node.js + SQLite",
    eufy:{ready:eufyReady,status:eufyStatus,readyNames:[...readyNames],transport:"linux-mqtt"},
    devices,
    override,
    astronomy:{dawn:astro.dawnLabel,dusk:astro.duskLabel,timeZone:TZ},
    nextEvent:next?{at:new Date(next.at).toISOString(),id:(next as any).id||null,name:next.name,phase:next.phase,target:next.target,source:next.source}:null,
    location:{zip:"14772",lat:LAT,lon:LON,timeZone:TZ},
    calendar:{synced:!!calendar,enabled:!!calendar?.settings?.enabled,eventCount:calendar?.events?.length||0,customCount:calendar?.customSchedules?.length||0,current:currentCalendar,syncedAt:calendar?.syncedAt||null},
    lastCommand:meta("last_command"),
    desired:db.prepare("SELECT * FROM desired_state ORDER BY name").all()
  };
}

async function manualControl(input:any,sequence?:number){
  const target=String(input?.target||"All"),names=targetNames(target),scene=safeScene(input);

  const next=nextAutomationEvent(new Date());
  const override={active:true,target,scene,createdAt:Date.now(),expiresAt:next?.at||null};
  setMeta("override",JSON.stringify(override));

  const detail=await Promise.all(names.map(async name=>{
    try{
      const r:any=sequence==null?await sendScene(name,scene):await sendSceneLatest(name,scene,sequence);
      if(r?.skipped)return {name,ok:true,skipped:true};
      db.prepare("UPDATE devices SET last_ok=?,last_error=NULL WHERE name=?").run(Date.now(),name);
      db.prepare("INSERT INTO desired_state(name,scene,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET scene=excluded.scene,updated_at=excluded.updated_at").run(name,sceneKey(scene),Date.now());
      return {name,ok:true,report:r?.report||null,instance:r?.instance||null};
    }catch(e:any){
      const msg=e?.message||String(e);
      db.prepare("UPDATE devices SET last_error=? WHERE name=?").run(msg,name);
      return {name,ok:false,error:msg};
    }
  }));
  const completed=detail.filter((x:any)=>x.ok&&!x.skipped).length;
  const skipped=detail.filter((x:any)=>x.skipped).length;
  const failed=detail.filter((x:any)=>!x.ok).length;
  const summary={at:new Date().toISOString(),target,ok:completed,skipped,failed,total:names.length,scene,detail,transport:"linux-mqtt"};
  setMeta("last_command",JSON.stringify(summary));
  db.prepare("INSERT INTO command_log(at,target,action,ok,detail) VALUES(?,?,?,?,?)").run(Date.now(),target,"manual",failed===0?1:0,JSON.stringify(detail));
  if(failed===names.length)throw new Error(detail.map((x:any)=>x.error).filter(Boolean).join("; ")||"No light command completed");
  return {ok:true,updated:completed,skipped,total:names.length,detail,override};
}

function queueManualControl(input:any){
  const target=String(input?.target||"All"),names=targetNames(target),scene=safeScene(input);
  const sequence=++manualSequence;
  for(const name of names)latestManualSequence.set(name,sequence);

  const next=nextAutomationEvent(new Date());
  const override={active:true,target,scene,createdAt:Date.now(),expiresAt:next?.at||null};
  setMeta("override",JSON.stringify(override));
  setMeta("last_command",JSON.stringify({at:new Date().toISOString(),target,queued:true,sequence,scene,transport:"linux-mqtt"}));

  void manualControl(input,sequence).catch((e:any)=>{
    const msg=e?.message||String(e);
    console.error("[manual queued]",target,msg);
    setMeta("last_command",JSON.stringify({at:new Date().toISOString(),target,queued:false,sequence,error:msg,scene,transport:"linux-mqtt"}));
  });
  return {ok:true,queued:true,sequence,target,total:names.length,override};
}

async function applyScheduled(name:string,scene:Scene,reason:string){
  const r=await sendScene(name,scene);
  const now=Date.now();
  db.prepare("UPDATE devices SET last_ok=?,last_error=NULL WHERE name=?").run(now,name);
  db.prepare("INSERT INTO desired_state(name,scene,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET scene=excluded.scene,updated_at=excluded.updated_at").run(name,sceneKey(scene),now);
  db.prepare("INSERT INTO command_log(at,target,action,ok,detail) VALUES(?,?,?,?,?)").run(now,name,"schedule",1,JSON.stringify({reason,report:r.report||null}));
}

let reconciling=false;
async function reconcile(ignoreOverride=false,forceSend=false){
  if(reconciling)return {ok:true,busy:true};
  reconciling=true;
  try{
    const now=Date.now(),rows=scheduleRows(),calendar=calendarConfig();
    let override:any=null;const raw=meta("override");
    if(raw){try{override=JSON.parse(raw);}catch{delMeta("override");}}
    if(override?.active&&override.expiresAt&&Number(override.expiresAt)<=now){delMeta("override");override=null;}
    const skipped=new Set<string>();
    if(!ignoreOverride&&override?.active){
      for(const name of targetNames(String(override.target||"All")))skipped.add(name);
    }
    const changes:{name:string;scene:Scene;reason:string}[]=[];
    const automationEnabled=rows.length>0||!!calendar?.settings?.enabled;
    if(automationEnabled){
      const resolved=rows.length?resolveScheduleState(rows,new Date(now),LAT,LON,TZ,[...DEVICE_NAMES]):{} as Record<string,any>;
      const cal=resolveCalendar(calendar,new Date(now),LAT,LON,TZ);
      for(const name of DEVICE_NAMES){
        if(skipped.has(name))continue;
        const active=resolved[name];
        const scene:Scene=active?active.scene:(cal?cal.scene:offScene());
        const reason=active
          ?`${active.row.name} • active ${new Date(active.start).toISOString()}–${new Date(active.end).toISOString()}`
          :(cal?`${cal.name} • ${cal.schedule2?"Schedule 2":"Schedule 1"}`:"No active holiday/custom schedule");
        const stored=storedScene(name);
        if(forceSend||!stored||sceneKey(stored)!==sceneKey(scene))changes.push({name,scene,reason});
      }
    }
    const results=await Promise.all(changes.map(async c=>{
      try{await applyScheduled(c.name,c.scene,c.reason);return null;}
      catch(e:any){
        const msg=e?.message||String(e);
        db.prepare("UPDATE devices SET last_error=? WHERE name=?").run(msg,c.name);
        return `${c.name}: ${msg}`;
      }
    }));
    const errors=results.filter((x):x is string=>!!x);
    setMeta("last_reconcile",new Date().toISOString());
    setMeta("last_command",JSON.stringify({at:new Date().toISOString(),action:"reconcile",sent:changes.length,errors,transport:"linux-mqtt"}));
    if(changes.length&&errors.length===changes.length)throw new Error(errors.join("; "));
    return {ok:true,sent:changes.length,errors};
  }finally{reconciling=false;}
}

function saveSchedule(input:any){
  const id=String(input?.id||crypto.randomUUID());
  const name=String(input?.name||"Schedule").slice(0,80);
  const enabled=input?.enabled===false?0:1;
  const days=String(input?.days||"*").slice(0,64);
  const startKind=["clock","dawn","dusk"].includes(input?.startKind)?input.startKind:"clock";
  const endKind=["clock","dawn","dusk"].includes(input?.endKind)?input.endKind:"clock";
  const startValue=String(input?.startValue||"18:00");
  const endValue=String(input?.endValue||"23:00");
  const target=String(input?.target||"All");targetNames(target);
  const scene=safeScene(input);
  const priority=clamp(Number(input?.priority||0),-100,100);
  db.prepare(`INSERT INTO schedules(id,name,enabled,days,start_kind,start_value,end_kind,end_value,target,effect,colors,brightness,speed,priority)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,days=excluded.days,start_kind=excluded.start_kind,start_value=excluded.start_value,end_kind=excluded.end_kind,end_value=excluded.end_value,target=excluded.target,effect=excluded.effect,colors=excluded.colors,brightness=excluded.brightness,speed=excluded.speed,priority=excluded.priority`)
    .run(id,name,enabled,days,startKind,startValue,endKind,endValue,target,scene.effect,JSON.stringify(scene.colors),scene.brightness,scene.speed,priority);
  void reconcile(false,true).catch(e=>console.error("[schedule reconcile]",e?.message||e));
  return {ok:true,id};
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||"/","http://localhost"),method=(req.method||"GET").toUpperCase(),path=url.pathname;
    if(method==="GET"&&path==="/api/health"){
      return json(res,200,{ok:true,service:"jason-home",runtime:"oracle-linux",architecture:"Node.js + SQLite + Eufy MQTT",time:new Date().toISOString()});
    }
    if(!authorized(req))return json(res,401,{ok:false,error:"Unauthorized"});

    if(method==="GET"&&path==="/api/status")return json(res,200,await statusPayload(url.searchParams.get("refresh")==="1"));
    if(method==="GET"&&path==="/api/devices")return json(res,200,{ok:true,devices:(await statusPayload(false)).devices});
    if(method==="GET"&&path==="/api/schedules")return json(res,200,{ok:true,schedules:allSchedules()});
    if(method==="POST"&&path==="/api/schedules")return json(res,200,saveSchedule(await readJson(req)));
    if(method==="DELETE"&&path==="/api/schedules"){
      const id=url.searchParams.get("id")||"";
      if(!id)throw new Error("Schedule id required");
      db.prepare("DELETE FROM schedules WHERE id=?").run(id);
      void reconcile(false,true).catch(e=>console.error("[schedule delete reconcile]",e?.message||e));
      return json(res,200,{ok:true});
    }
    if(method==="GET"&&path==="/api/calendar"){
      const cfg=calendarConfig();
      return json(res,200,{ok:true,synced:!!cfg,calendar:cfg});
    }
    if(method==="POST"&&path==="/api/calendar/sync"){
      const cfg=normalizeCalendarConfig(await readJson(req));
      if(cfg.events.length<1)throw new Error("Holiday calendar is empty");
      setMeta("calendar_config",JSON.stringify(cfg));
      setMeta("calendar_sync",new Date().toISOString());
      void reconcile(false,true).catch(e=>console.error("[calendar reconcile]",e?.message||e));
      return json(res,200,{ok:true,eventCount:cfg.events.length,customCount:cfg.customSchedules.length,enabled:cfg.settings.enabled,syncedAt:cfg.syncedAt});
    }
    if(method==="GET"&&path==="/api/events"){
      const cfg=calendarConfig();
      return json(res,200,{ok:true,events:cfg?.events||[],synced:!!cfg});
    }
    if(method==="GET"&&path==="/api/eufy/factory-presets"){
      const includeRaw=url.searchParams.get("raw")==="1";
      const idRaw=url.searchParams.get("id"),id=idRaw==null?undefined:Number(idRaw);
      if(url.searchParams.get("refresh")==="1")queueFactoryRefresh();
      const raw=meta("factory_catalog");
      if(!raw){
        const refresh=queueFactoryRefresh();
        return json(res,202,{ok:true,loading:true,refresh});
      }
      let catalog:any;
      try{catalog=JSON.parse(raw);}catch{delMeta("factory_catalog");return json(res,202,{ok:true,loading:true,refresh:queueFactoryRefresh()});}
      return json(res,200,{...factorySummary(catalog,includeRaw,id),refresh:factoryRefreshState});
    }
    if(method==="POST"&&path==="/api/eufy/factory-presets/save"){
      const raw=meta("factory_catalog");
      if(!raw)throw new Error("Factory catalog is not loaded yet");
      const catalog=JSON.parse(raw),input:any=await readJson(req);
      const preset=saveFactoryEdit(catalog,input);
      return json(res,200,{ok:true,preset});
    }
    if(method==="POST"&&path==="/api/eufy/factory-presets/reset"){
      const input:any=await readJson(req),lightId=Number(input?.lightId);
      if(!Number.isInteger(lightId)||lightId<1||lightId>1000000)throw new Error("Invalid factory preset id");
      return json(res,200,{ok:true,lightId,reset:resetFactoryEdit(lightId)});
    }
    if(method==="POST"&&path==="/api/eufy/factory-presets/refresh"){
      return json(res,202,{ok:true,queued:true,refresh:queueFactoryRefresh()});
    }
    if(method==="POST"&&path==="/api/eufy/factory-test"){
      const input:any=await readJson(req),lightId=Number(input?.lightId),target=String(input?.target||"All");
      if(!Number.isInteger(lightId)||lightId<1||lightId>1000000)throw new Error("Invalid factory preset id");
      targetNames(target);
      return json(res,202,queueFactoryTest(lightId,target));
    }
    if(method==="GET"&&path==="/api/eufy/factory-test"){
      const jobId=url.searchParams.get("job")||"";
      const job=factoryJobs.get(jobId);
      return job?json(res,200,{ok:true,...job}):json(res,404,{ok:false,error:"Factory test job not found"});
    }
    if(method==="POST"&&path==="/api/control"){
      const input=await readJson(req);
      if(url.searchParams.get("wait")==="1")return json(res,200,await manualControl(input));
      return json(res,202,queueManualControl(input));
    }
    if(method==="POST"&&(path==="/api/resume"||path==="/api/resume-schedule")){
      delMeta("override");return json(res,200,{ok:true,resumed:true,reconcile:await reconcile(true,true)});
    }
    if(method==="POST"&&path==="/api/reconcile")return json(res,200,await reconcile(false,true));
    if(method==="POST"&&path==="/api/reconnect"){
      const c=await ensureEufy(true);return json(res,200,{ok:true,eufy:eufyStatus,readyNames:c.readyNames()});
    }
    if(method==="POST"&&path==="/api/provision-device"){
      const input:any=await readJson(req),installId=String(input?.installId||"").trim().toLowerCase();
      if(!/^[0-9a-f]{32}$/.test(installId))throw new Error("Android install identity must be 32 hexadecimal characters");
      const changed=meta("install_id")!==installId;
      if(changed){setMeta("install_id",installId);delMeta("eufy_session");eufy=null;eufyReady=false;readyNames=[];}
      const c=await ensureEufy(changed);
      return json(res,200,{ok:true,changed,eufy:eufyStatus,readyNames:c.readyNames(),transport:"linux-mqtt"});
    }
    if(method==="POST"&&path==="/api/mqtt-probe"){
      const input:any=await readJson(req),target=String(input?.target||"Pool");
      if(!DEVICE_NAMES.includes(target as any))throw new Error("Probe target must be Pool, House, Garage, or Shed");
      const result=await serializedForDevice(target,async()=>{const c=await ensureEufy(false);return c.status(target);});
      return json(res,200,{ok:true,target,published:result.published,report:result.report||null,instance:(result as any).instance||null});
    }
    return json(res,404,{ok:false,error:"Not found",path});
  }catch(e:any){
    const msg=e?.message||String(e);
    console.error("[api]",req.method,req.url,msg);
    if(/session|auth|login|certificate/i.test(msg)){eufy=null;eufyReady=false;readyNames=[];}
    return json(res,500,{ok:false,error:msg});
  }
});

server.keepAliveTimeout=65000;
server.listen(PORT,"0.0.0.0",()=>{
  console.log(`Jason Home Oracle server listening on 0.0.0.0:${PORT}`);
  console.log(`Scheduler timezone: ${TZ}; coordinates: ${LAT}, ${LON}`);
  setTimeout(()=>void reconcile(false,false).catch(e=>console.error("[startup reconcile]",e?.message||e)),5000);
  setInterval(()=>void reconcile(false,false).catch(e=>console.error("[scheduler]",e?.message||e)),30000);
});
