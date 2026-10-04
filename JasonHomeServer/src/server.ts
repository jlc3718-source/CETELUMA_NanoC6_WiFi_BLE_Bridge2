import { canonicalEffect } from "./effects.js";
import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EufyClient, type EufySession } from "./eufy/client.js";
import { canBuildFactoryFields, dedupeFactoryPresetsByName } from "./eufy/factory-presets.js";
import { astronomy, nextScheduleEvent, resolveScheduleState } from "./scheduler.js";
import { currentCalendarInfo, nextCalendarBoundary, nextCalendarEvent, nextCalendarTransition, normalizeCalendarConfig, resolveCalendar, type CalendarConfig } from "./calendar.js";
import type { Scene, ScheduleRow } from "./types.js";
import { mqttConnectionStatus, commandCaptureStatus, stopCommandCapture } from "./eufy/mqtt.js";

let captureRestoreTimer:ReturnType<typeof setTimeout>|null=null;
const PORT=Math.max(1,Number(process.env.PORT||"8080"));
const EMAIL=process.env.EUFY_EMAIL||"";
const PASSWORD=process.env.EUFY_PASSWORD||"";
const TOKEN=process.env.JASON_HOME_API_TOKEN||"";
const DB_PATH=process.env.JASON_HOME_DB||"/data/jason-home.sqlite";
const LAT=Number(process.env.HOME_LAT||"42.1507");
const LON=Number(process.env.HOME_LON||"-78.9452");
const TZ=process.env.HOME_TZ||"America/New_York";
const BUILD_SHA=process.env.JASON_HOME_BUILD_SHA||"unknown";
const STARTED_AT=new Date().toISOString();
const DEFAULT_INSTALL=(process.env.EUFY_INSTALL_ID||createHash("sha256").update("jason-home-server:"+EMAIL).digest("hex").slice(0,32)).toLowerCase();

if(!EMAIL||!PASSWORD)throw new Error("EUFY_EMAIL and EUFY_PASSWORD are required");
if(!TOKEN)throw new Error("JASON_HOME_API_TOKEN is required");
if(!/^[0-9a-f]{32}$/.test(DEFAULT_INSTALL))throw new Error("EUFY_INSTALL_ID must be 32 hex characters when supplied");

const DEVICE_NAMES=["Pool","House","Garage","Shed"] as const;
const DEVICE_MODELS:Record<string,string>={Pool:"E120",House:"E120",Garage:"E22",Shed:"E22"};
const DEFAULT_SCENE:Scene={power:true,brightness:75,effect:"Static",colors:[0xffffff],speed:5};

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

const parsedMetaCache=new Map<string,{raw:string,value:any}>();
function meta(key:string):string|null{
  const row=db.prepare("SELECT value FROM meta WHERE key=?").get(key) as any;
  return row?.value??null;
}
function setMeta(key:string,value:string){
  db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key,value);
  parsedMetaCache.delete(key);
}
function delMeta(key:string){db.prepare("DELETE FROM meta WHERE key=?").run(key);parsedMetaCache.delete(key);}
function parsedMeta<T>(key:string,fallback:T):T{
  const raw=meta(key);
  if(raw==null)return fallback;
  const cached=parsedMetaCache.get(key);
  if(cached&&cached.raw===raw)return cached.value as T;
  try{const value=JSON.parse(raw) as T;parsedMetaCache.set(key,{raw,value});return value;}
  catch{return fallback;}
}
function localCalendarParts(now=new Date()){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:TZ,year:"numeric",month:"numeric",day:"numeric",hour:"numeric",hourCycle:"h23"}).formatToParts(now);
  const get=(type:string)=>Number(parts.find(x=>x.type===type)?.value||0);
  return {year:get("year"),month:get("month"),day:get("day"),hour:get("hour")};
}
function calendarOrdinal(v:{year:number;month:number;day:number}){return Math.floor(Date.UTC(v.year,v.month-1,v.day)/86400000);}
function cleanedCalendarConfig(input:CalendarConfig){
  const cfg=JSON.parse(JSON.stringify(input)) as CalendarConfig;
  const beforeEvents=cfg.events.length,beforeSpecial=cfg.special.length;
  const now=localCalendarParts(),today=calendarOrdinal(now);
  const specials=new Map((cfg.special||[]).map((x:any)=>[String(x.id||""),x]));
  const expired=new Set<string>();
  for(const e of cfg.events||[]){
    const id=String((e as any).id||"");
    if(id==="master"){expired.add(id);continue;}
    if(!id.startsWith("ai-once-"))continue;
    const hit:any=specials.get(id);
    if(!hit){expired.add(id);continue;}
    const age=today-calendarOrdinal({year:Number(hit.year),month:Number(hit.month),day:Number(hit.day)});
    // Keep the one-time show through the following morning so Schedule 2 can
    // finish the prior lighting night; purge it by noon the next day.
    if(age>1||(age===1&&now.hour>=12))expired.add(id);
  }
  if(expired.size){
    cfg.events=(cfg.events||[]).filter((e:any)=>!expired.has(String(e.id||"")));
    cfg.special=(cfg.special||[]).filter((x:any)=>!expired.has(String(x.id||"")));
  }
  return {cfg,changed:cfg.events.length!==beforeEvents||cfg.special.length!==beforeSpecial};
}
function calendarConfig():CalendarConfig|null{
  const stored=parsedMeta<CalendarConfig|null>("calendar_config",null);
  if(!stored)return null;
  const {cfg,changed}=cleanedCalendarConfig(stored);
  if(changed){
    const revision=Math.max(Number(meta("calendar_revision")||0)||0,Number(cfg.revision)||0)+1;
    cfg.revision=revision;cfg.syncedAt=Date.now();
    setMeta("calendar_config",JSON.stringify(cfg));
    setMeta("calendar_revision",String(revision));
    setMeta("calendar_sync",new Date().toISOString());
  }
  return cfg;
}
function pruneExpiredAiEvents(now=Date.now()){
  const cfg=calendarConfig();if(!cfg)return false;
  const expired=new Set((cfg.events||[]).filter((e:any)=>e?.aiOneTime===true&&e?.expiresAt&&Date.parse(String(e.expiresAt))<=now).map((e:any)=>String(e.id)));
  if(!expired.size)return false;
  cfg.events=(cfg.events||[]).filter((e:any)=>!expired.has(String(e.id)));
  cfg.special=(cfg.special||[]).filter((x:any)=>!expired.has(String(x.id)));
  const revision=Math.max(Number(meta("calendar_revision")||0)||0,Number(cfg.revision||0)||0)+1;
  cfg.revision=revision;cfg.syncedAt=Date.now();
  setMeta("calendar_config",JSON.stringify(cfg));setMeta("calendar_revision",String(revision));setMeta("calendar_sync",new Date().toISOString());
  return true;
}
function nextAutomationEvent(now=new Date()){
  const generic=nextScheduleEvent(scheduleRows(),now,LAT,LON,TZ);
  const cfg=effectiveCalendarConfig();
  const transition=nextCalendarTransition(cfg,now,LAT,LON,TZ);
  const named=nextCalendarEvent(cfg,now,LAT,LON,TZ);
  const candidates:any[]=[];
  if(generic)candidates.push({at:generic.at,name:generic.row.name,target:generic.row.target,phase:generic.phase,source:"schedule"});
  if(transition)candidates.push({...transition,source:"calendar"});
  if(!transition&&named)candidates.push({...named,phase:"start",source:"calendar"});
  candidates.sort((a,b)=>a.at-b.at);
  return candidates[0]||null;
}
function nextOverrideExpiry(now=new Date()){
  const generic=nextScheduleEvent(scheduleRows(),now,LAT,LON,TZ);
  const cfg=effectiveCalendarConfig();
  // Prefer the next transition that actually changes the scheduled scene.
  // A nominal dusk/end/dawn boundary can be a no-op, and expiring a manual
  // preview there would resume the schedule earlier than the user expects.
  const transition=nextCalendarTransition(cfg,now,LAT,LON,TZ);
  const boundary=transition?null:nextCalendarBoundary(cfg,now,LAT,LON,TZ);
  const calendarAt=transition?.at??boundary?.at??Number.POSITIVE_INFINITY;
  const at=Math.min(generic?.at??Number.POSITIVE_INFINITY,calendarAt);
  return Number.isFinite(at)?at:null;
}
if(!meta("install_id"))setMeta("install_id",DEFAULT_INSTALL);
if(!meta("automation_owner"))setMeta("automation_owner","oracle");

function clamp(v:number,a:number,b:number){return Math.max(a,Math.min(b,v));}
function parseColor(v:any):number|null{
  if(typeof v==="number"&&Number.isFinite(v))return v&0xffffff;
  if(typeof v==="string"&&/^#?[0-9a-fA-F]{6}$/.test(v))return parseInt(v.replace("#",""),16);
  return null;
}
function safePattern(value:any,colorCount:number){
  if(colorCount<2||!value||typeof value!=="object")return undefined;
  const rawPositions=Array.isArray(value.positions)?value.positions:[];
  const positions=[...new Set(rawPositions.map((x:any)=>Math.trunc(Number(x))).filter((x:any)=>Number.isInteger(x)&&x>=0&&x<120))].slice(0,120);
  const blocks=Array.isArray(value.blocks)&&value.blocks.length
    ?value.blocks.slice(0,colorCount).map((x:any)=>clamp(Math.round(Number(x)||1),1,12))
    :[];
  while(blocks.length&&blocks.length<colorCount)blocks.push(blocks[blocks.length%Math.max(1,blocks.length)]||1);
  if(!blocks.length&&!positions.length)return undefined;
  const out:any={offset:Math.trunc(Number(value.offset)||0),mirror:!!value.mirror};
  if(blocks.length)out.blocks=blocks;
  if(positions.length)out.positions=positions;
  return out;
}
function safeScene(input:any,base:Scene=DEFAULT_SCENE):Scene{
  const colors=Array.isArray(input?.colors)?input.colors.map(parseColor).filter((x:any)=>x!=null).slice(0,8) as number[]:base.colors;
  const source=input&&typeof input==="object"?input:{};
  const hasFactory=Object.prototype.hasOwnProperty.call(source,"factoryEffectName");
  const requestedFactory=hasFactory?String(source.factoryEffectName||"").trim().slice(0,100):"";
  const recipeChanged=["effect","colors","speed","pattern"].some(key=>Object.prototype.hasOwnProperty.call(source,key));
  const inheritedFactory=!hasFactory&&!recipeChanged?String(base.factoryEffectName||"").trim().slice(0,100):"";
  const factoryEffectName=requestedFactory||inheritedFactory||undefined;
  const hasPattern=Object.prototype.hasOwnProperty.call(source,"pattern");
  const pattern=hasPattern?safePattern(source.pattern,colors.length):(!recipeChanged?safePattern(base.pattern,colors.length):undefined);
  const scene:Scene={
    power:input?.power==null?base.power:!!input.power,
    brightness:clamp(Number(input?.brightness??base.brightness)||base.brightness,1,100),
    effect:canonicalEffect(input?.effect||base.effect),
    colors:colors.length?colors:[...base.colors],
    speed:clamp(Number(input?.speed??base.speed)||base.speed,1,10)
  };
  if(factoryEffectName)scene.factoryEffectName=factoryEffectName;
  if(pattern)scene.pattern=pattern;
  return scene;
}
function sceneKey(scene:Scene){return JSON.stringify({power:!!scene.power,brightness:scene.brightness,effect:scene.effect,colors:scene.colors,speed:scene.speed,factoryEffectName:scene.factoryEffectName||null,pattern:scene.pattern||null});}
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
function logCommand(at:number,target:string,action:string,ok:boolean,detail:any){
  db.prepare("INSERT INTO command_log(at,target,action,ok,detail) VALUES(?,?,?,?,?)").run(at,target,action,ok?1:0,typeof detail==="string"?detail:JSON.stringify(detail));
  db.prepare("DELETE FROM command_log WHERE id NOT IN (SELECT id FROM command_log ORDER BY id DESC LIMIT 1000)").run();
}
db.prepare("DELETE FROM command_log WHERE id NOT IN (SELECT id FROM command_log ORDER BY id DESC LIMIT 1000)").run();

function storedScene(name:string):Scene|null{
  const row=db.prepare("SELECT scene FROM desired_state WHERE name=?").get(name) as any;
  try{return row?.scene?JSON.parse(row.scene):null;}catch{return null;}
}
function activeOverrideScene(name:string):Scene|null{
  try{
    const raw=meta("override");if(!raw)return null;
    const o=JSON.parse(raw);if(!o?.active||!o?.scene)return null;
    if(!targetNames(String(o.target||"All")).includes(name))return null;
    return safeScene(o.scene,DEFAULT_SCENE);
  }catch{return null;}
}
function manualScenes(input:any,names:string[]){
  const out:Record<string,Scene>={};
  for(const name of names)out[name]=safeScene(input,activeOverrideScene(name)||storedScene(name)||DEFAULT_SCENE);
  return out;
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
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}
  catch{const e:any=new Error("Malformed JSON request body");e.statusCode=400;throw e;}
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

function markEufyDegraded(error:any){
  const msg=error?.message||String(error||"Eufy transport failure");
  eufyReady=false;readyNames=[];eufyStatus="Degraded: "+msg;
  if(/auth|login|certificate|session|token|401/i.test(msg))eufy=null;
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

function nativeFactoryLightId(scene:Scene):number|null{
  const m=/^Exact Native Factory #(\d+)$/.exec(String(scene?.effect||""));
  if(!m)return null;
  const id=Number(m[1]);
  return Number.isInteger(id)&&id>0?id:null;
}
function cachedFactoryPreset(lightId:number){
  const raw=meta("factory_catalog");
  if(!raw)return null;
  try{
    const base=(JSON.parse(raw)?.presets||[]).find((p:any)=>Number(p?.lightId)===lightId);
    return base?applyFactoryEdit(base):null;
  }catch{return null;}
}
function cachedFactoryPresetsByName(name:string){
  const raw=meta("factory_catalog"),wanted=String(name||"").trim().toLowerCase();
  if(!raw||!wanted)return [];
  try{return (JSON.parse(raw)?.presets||[]).filter((p:any)=>String(p?.name||"").trim().toLowerCase()===wanted).map((p:any)=>applyFactoryEdit(p));}
  catch{return [];}
}
async function sendScene(name:string,scene:Scene){
  return serializedForDevice(name,async()=>{
    try{
      const c=await ensureEufy(false);
      if(!scene.power)return await c.power(name,false);
      if(scene.factoryEffectName){
        const presets=cachedFactoryPresetsByName(scene.factoryEffectName);
        if(!presets.length)throw new Error("Native factory effect "+scene.factoryEffectName+" is not available in the cached Eufy catalog");
        return await c.namedFactoryScene(name,presets,scene.brightness);
      }
      const factoryLightId=nativeFactoryLightId(scene);
      if(factoryLightId!=null){
        const preset=cachedFactoryPreset(factoryLightId);
        if(!preset)throw new Error("Exact Native Factory preset "+factoryLightId+" is not available in the cached Eufy catalog");
        const compatible={...factoryCompatibleScene(preset),brightness:scene.brightness};
        return await c.scene(name,compatible.effect,compatible.colors,compatible.speed,compatible.brightness,scene.pattern);
      }
      return await c.scene(name,scene.effect,scene.colors,scene.speed,scene.brightness,scene.pattern);
    }catch(e){markEufyDegraded(e);throw e;}
  });
}

let manualSequence=0;
const latestManualSequence=new Map<string,number>();

async function sendSceneLatest(name:string,scene:Scene,sequence:number){
  return serializedForDevice(name,async()=>{
    if(latestManualSequence.get(name)!==sequence)return {skipped:true,published:0};
    try{
      const c=await ensureEufy(false);
      if(latestManualSequence.get(name)!==sequence)return {skipped:true,published:0};
      let result:any;
      if(!scene.power){
        result=await c.power(name,false);
      }else if(scene.factoryEffectName){
        const presets=cachedFactoryPresetsByName(scene.factoryEffectName);
        if(!presets.length)throw new Error("Native factory effect "+scene.factoryEffectName+" is not available in the cached Eufy catalog");
        result=await c.namedFactoryScene(name,presets,scene.brightness);
      }else{
        const factoryLightId=nativeFactoryLightId(scene);
        if(factoryLightId!=null){
          const preset=cachedFactoryPreset(factoryLightId);
          if(!preset)throw new Error("Exact Native Factory preset "+factoryLightId+" is not available in the cached Eufy catalog");
          const compatible={...factoryCompatibleScene(preset),brightness:scene.brightness};
          result=await c.scene(name,compatible.effect,compatible.colors,compatible.speed,compatible.brightness,scene.pattern);
        }else{
          result=await c.scene(name,scene.effect,scene.colors,scene.speed,scene.brightness,scene.pattern);
        }
      }
      return {...result,skipped:false};
    }catch(e){markEufyDegraded(e);throw e;}
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
  const parsed=parsedMeta<any>("factory_edits",{});
  return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:{};
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
  const baseCanonical=dedupeFactoryPresetsByName(src);
  const edited=baseCanonical.map(applyFactoryEdit);
  const allCanonical=id==null?edited:edited.filter((p:any)=>Number(p?.lightId)===id);
  const promoted=id==null?new Set(factoryPromotionRows(calendarConfig()).map((x:any)=>Number(x.lightId))):new Set<number>();
  const canonical=id==null?allCanonical.filter((p:any)=>!promoted.has(Number(p?.lightId))):allCanonical;
  const list=canonical.map((p:any)=>{
    if(includeRaw)return p;
    const {raw,...summary}=p||{};
    return summary;
  });
  return {ok:true,fetchedAt:catalog?.fetchedAt||null,count:list.length,totalCount:canonical.length,rawTotalCount:src.length,duplicatesCollapsed:Math.max(0,src.length-allCanonical.length),promotedCount:promoted.size,scanned:Number(catalog?.scanned)||0,presets:list};
}
function factoryHexColors(preset:any):number[]{
  const out:number[]=[];
  const add=(v:any)=>{
    const s=String(v??"").replace(/^#/,"");
    if(/^[0-9a-fA-F]{6}$/.test(s)){
      const n=parseInt(s,16)&0xffffff;
      if(!out.includes(n))out.push(n);
    }
  };
  for(const layer of Array.isArray(preset?.layers)?preset.layers:[]){
    for(const x of String(layer?.colors||"").split("|"))add(x);
  }
  for(const x of String(preset?.colors||"").split("|"))add(x);
  return out.slice(0,8);
}
function factorySpeed10(preset:any):number{
  const layers=Array.isArray(preset?.layers)?preset.layers:[];
  const raw=Number(preset?.speed??layers[0]?.layer_speed??25);
  if(!Number.isFinite(raw))return 5;
  if(raw<=5)return 1;if(raw<=20)return 3;if(raw<=40)return 5;if(raw<=70)return 8;return 10;
}
function factoryDominantLayer(preset:any){
  const layers=Array.isArray(preset?.layers)?preset.layers:[];
  return layers.map((x:any,i:number)=>({x,i,p:Number(x?.layer_priority)||0})).sort((a:any,b:any)=>b.p-a.p||a.i-b.i)[0]?.x||null;
}
function factoryCompatibleScene(preset:any):Scene{
  const layer=factoryDominantLayer(preset),type=Number(layer?.current_layer_type);
  let effect="Breath";
  if(type===0){
    const gradient=Number(layer?.gradient_value)||0;
    const meteor=Number(layer?.length_range)||0;
    effect=meteor>0?"Meteor / Comet":gradient>0?"Gradient Sweep":"Chase";
  }else if(type===2)effect="Twinkle / Sparkle";
  else if(type===1){
    const transition=Number(layer?.transition_mode)||0;
    effect=transition===0?"Breath":transition===2?"Gradient Sweep":"Jump";
  }
  return {
    power:true,
    brightness:clamp(Math.round(Number(preset?.brightness)||75),1,100),
    effect:canonicalEffect(effect),
    colors:factoryHexColors(preset).length?factoryHexColors(preset):[0xffffff],
    speed:factorySpeed10(preset)
  };
}
function factoryScheduledNativeScene(preset:any):Scene{
  const visual=factoryCompatibleScene(preset);
  const lightId=Number(preset?.lightId);
  if(!Number.isInteger(lightId)||lightId<1)throw new Error("Factory preset has an invalid native light id");
  return {...visual,effect:canonicalEffect(visual.effect)};
}
const FACTORY_EVENT_MATCHES:Record<string,string>={
  "mardi gras":"evt027",
  "valentine s day":"evt025",
  "presidents day":"evt026",
  "flag day":"evt105",
  "labor day":"evt144",
  "halloween":"evt179",
  "halloween 2":"evt179",
  "halloween 3":"evt179",
  "hanukkah":"evt202",
  "new year s day":"evt006",
  "new year s day 2":"evt006",
  "new year s day 3":"evt006",
  "easter":"evt065",
  "mother s day":"evt087",
  "fourth of july":"evt118",
  "christmas day":"evt208",
  "christmas day 2":"evt208",
  "christmas day 3":"evt208",
  "st patrick s day":"evt046",
  "father s day":"evt109",
  "thanksgiving day":"evt197",
  "april fool s day":"evt061"
};
function promotionNameKey(v:any){
  return String(v??"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
}
function factoryPromotionState():Record<string,{enabled?:boolean}>{
  const x=parsedMeta<any>("factory_promotions",{});
  return x&&typeof x==="object"&&!Array.isArray(x)?x:{};
}
function factoryPromotionMap():Record<string,{eventId:string;sourceNameKey:string}>{
  const x=parsedMeta<any>("factory_promotion_map",{});
  return x&&typeof x==="object"&&!Array.isArray(x)?x:{};
}
function persistFactoryPromotionMap(value:Record<string,{eventId:string;sourceNameKey:string}>){
  setMeta("factory_promotion_map",JSON.stringify(value));
}
function factoryPromotionRows(base:CalendarConfig|null=calendarConfig()){
  if(!base)return [] as any[];
  const catalog=parsedMeta<any>("factory_catalog",null);
  if(!catalog)return [] as any[];
  const src=Array.isArray(catalog?.presets)?catalog.presets:[];
  const bases=dedupeFactoryPresetsByName(src);
  const state=factoryPromotionState();
  const map=factoryPromotionMap();
  let mapChanged=false,stateChanged=false;
  const out:any[]=[];
  for(const basePreset of bases){
    const lightId=Number(basePreset.lightId),key=String(lightId),sourceNameKey=promotionNameKey(basePreset?.name);
    let binding=map[key];
    if(!binding){
      const eventId=FACTORY_EVENT_MATCHES[sourceNameKey];
      if(!eventId)continue;
      const prior=Object.entries(map).find(([,v])=>v?.sourceNameKey===sourceNameKey);
      binding={eventId,sourceNameKey};
      map[key]=binding;mapChanged=true;
      if(prior&&state[key]===undefined&&state[prior[0]]!==undefined){
        state[key]={...state[prior[0]]};stateChanged=true;
      }
    }
    const event=(base.events||[]).find(e=>e.id===binding.eventId);
    if(!event)continue;
    const preset=applyFactoryEdit(basePreset);
    const enabled=state[key]?.enabled!==false;
    const scene=factoryScheduledNativeScene(preset);
    out.push({
      lightId,
      name:String(preset.name||("Factory "+lightId)),
      eventId:binding.eventId,eventName:event.name,enabled,
      sourceNameKey:binding.sourceNameKey,
      scheduling:event.rule==="Month"
        ?"Rotates across eligible days with the matching monthly event."
        :"Shares and splits the active event window with the matching scheduled event.",
      preset,
      scene,
      event
    });
  }
  if(mapChanged)persistFactoryPromotionMap(map);
  if(stateChanged)setMeta("factory_promotions",JSON.stringify(state));
  out.sort((a,b)=>a.eventId.localeCompare(b.eventId)||a.name.localeCompare(b.name,undefined,{numeric:true}));
  return out;
}
function saveFactoryPromotion(input:any){
  const lightId=Number(input?.lightId);
  const rows=factoryPromotionRows(calendarConfig());
  const row=rows.find(x=>x.lightId===lightId);
  if(!row)throw new Error("Factory preset is not promoted into the schedule");
  const state=factoryPromotionState();
  state[String(lightId)]={...(state[String(lightId)]||{}),enabled:input?.enabled!==false};
  setMeta("factory_promotions",JSON.stringify(state));
  return {...row,enabled:state[String(lightId)].enabled!==false};
}
function factoryPromotionGroupState(rows=factoryPromotionRows(calendarConfig())){
  const total=rows.length;
  const enabledCount=rows.filter((x:any)=>x.enabled!==false).length;
  return {
    total,
    enabledCount,
    disabledCount:Math.max(0,total-enabledCount),
    allEnabled:total>0&&enabledCount===total,
    allDisabled:total>0&&enabledCount===0,
    mixed:enabledCount>0&&enabledCount<total
  };
}
function saveFactoryPromotionGroup(input:any){
  const enabled=input?.enabled!==false;
  const rows=factoryPromotionRows(calendarConfig());
  const state=factoryPromotionState();
  for(const row of rows)state[String(row.lightId)]={...(state[String(row.lightId)]||{}),enabled};
  setMeta("factory_promotions",JSON.stringify(state));
  const updated=factoryPromotionRows(calendarConfig());
  return {enabled,group:factoryPromotionGroupState(updated),promotions:updated};
}
function effectiveCalendarConfig(base:CalendarConfig|null=calendarConfig()):CalendarConfig|null{
  if(!base)return null;
  const cfg=JSON.parse(JSON.stringify(base)) as CalendarConfig;
  cfg.events=(cfg.events||[]).filter((e:any)=>!String(e.id||"").includes("::factory:")&&String(e.id||"")!=="master");
  for(const row of factoryPromotionRows(base)){
    const e:any=row.event;
    const scene:Scene=row.scene;
    cfg.events.push({
      ...e,
      id:e.id+"::factory:"+row.lightId,
      dateRuleSourceId:e.id,
      name:row.name,
      effect:scene.effect,
      speed:scene.speed,
      colors:[...scene.colors],
      enabled:row.enabled,
      favorite:false
    });
  }
  return cfg;
}

const factoryJobs=new Map<string,any>();
function pruneFactoryJobs(){
  const cutoff=Date.now()-60*60*1000;
  for(const [id,j] of factoryJobs)if(Number(j?.createdAt||0)<cutoff)factoryJobs.delete(id);
}
function queueFactoryTest(lightId:number,target="All",mode="compatible"){
  pruneFactoryJobs();
  const jobId=crypto.randomUUID();
  factoryJobs.set(jobId,{jobId,state:"running",lightId,target,mode,createdAt:Date.now()});
  void factoryTestAll(lightId,target,mode).then(result=>factoryJobs.set(jobId,{jobId,state:"complete",lightId,target,mode,createdAt:Date.now(),result}))
    .catch((e:any)=>factoryJobs.set(jobId,{jobId,state:"failed",lightId,target,mode,createdAt:Date.now(),error:e?.message||String(e)}));
  return {ok:true,queued:true,jobId,lightId,target,mode};
}
async function factoryTestAll(lightId:number,target="All",mode="compatible"){
  if(!Number.isInteger(lightId)||lightId<1||lightId>1000000)throw new Error("Invalid factory preset id");
  let preset:any=null;
  const raw=meta("factory_catalog");
  if(raw){try{preset=(JSON.parse(raw)?.presets||[]).find((p:any)=>Number(p?.lightId)===lightId)||null;}catch{}}
  if(!preset){
    try{preset=await (await ensureEufy(false)).factoryPreset(lightId);}
    catch(e){markEufyDegraded(e);throw e;}
  }
  preset=applyFactoryEdit(preset);
  const names=targetNames(target),sequence=++manualSequence;
  for(const name of names)latestManualSequence.set(name,sequence);
  const compatible=factoryCompatibleScene(preset);
  setMeta("override",JSON.stringify({active:true,target,factory:true,lightId,mode:"compatible",sequence,scene:compatible,createdAt:Date.now(),expiresAt:null}));
  const results=await Promise.all(names.map(async name=>{
    try{
      const r:any=await serializedForDevice(name,async()=>{
        if(latestManualSequence.get(name)!==sequence)return {skipped:true,published:0};
        const client=await ensureEufy(false);
        if(latestManualSequence.get(name)!==sequence)return {skipped:true,published:0};
        const out=await client.scene(name,compatible.effect,compatible.colors,compatible.speed,compatible.brightness);
        return {...out,skipped:false};
      });
      if(r?.skipped)return {name,ok:true,skipped:true,model:DEVICE_MODELS[name]};
      db.prepare("UPDATE devices SET last_ok=?,last_error=NULL WHERE name=?").run(Date.now(),name);
      // A Factory preview is a temporary override, not proof that the prior
      // scheduled scene is still physically present. Invalidating this cache
      // forces the scheduler to reapply its scene after Resume/expiry.
      db.prepare("DELETE FROM desired_state WHERE name=?").run(name);
      return {name,ok:true,model:DEVICE_MODELS[name],strategy:"native-personal-0206",compatible,published:r.published,brokerAccepted:r.brokerAccepted===true,deviceReported:r.deviceReported===true,instance:r.instance||null,report:r.report||null};
    }catch(e:any){
      markEufyDegraded(e);
      const msg=e?.message||String(e);
      db.prepare("UPDATE devices SET last_error=? WHERE name=?").run(msg,name);
      return {name,ok:false,model:DEVICE_MODELS[name],strategy:"native-personal-0206",error:msg};
    }
  }));
  const sent=results.filter((x:any)=>x.ok&&!x.skipped).length,skipped=results.filter((x:any)=>x.skipped).length;
  const expiresAt=nextOverrideExpiry(new Date());
  const currentFactoryOverride=parsedMeta<any>("override",null);
  if(currentFactoryOverride?.active&&Number(currentFactoryOverride?.sequence)===sequence){
    currentFactoryOverride.expiresAt=expiresAt;
    setMeta("override",JSON.stringify(currentFactoryOverride));
  }
  if(sent===0&&skipped===0){
    const current=meta("override");
    try{if(current&&JSON.parse(current)?.sequence===sequence)delMeta("override");}catch{}
  }
  setMeta("factory_last_test",JSON.stringify({at:new Date().toISOString(),lightId,name:preset?.name||null,target,mode,sequence,sent,skipped,total:names.length,results}));
  return {ok:sent===names.length,lightId,name:preset?.name||null,target,mode:"compatible",sequence,customized:!!preset?.customized,compatible,attempted:names.length,sent,skipped,results,note:"Factory recipe translated to the captured native 0x0206 command set for reliable visible output."};
}

async function statusPayload(refresh=false){
  if(refresh){
    try{await ensureEufy(false);}catch{}
  }
  const now=new Date();
  const astro=astronomy(now,LAT,LON,TZ);
  const next=nextAutomationEvent(now);
  const calendar=calendarConfig();
  const effectiveCalendar=effectiveCalendarConfig(calendar);
  const currentCalendar=currentCalendarInfo(effectiveCalendar,now,LAT,LON,TZ);
  let override:any=null;const raw=meta("override");
  try{override=raw?JSON.parse(raw):null;}catch{}
  const devices=(db.prepare("SELECT name,model,enabled,last_ok,last_error FROM devices ORDER BY CASE name WHEN 'Pool' THEN 1 WHEN 'House' THEN 2 WHEN 'Garage' THEN 3 ELSE 4 END").all() as any[])
    .map(d=>({...d,ready:eufyReady&&readyNames.includes(d.name)}));
  return {
    ok:true,
    controller:"Online",
    architecture:"Oracle Linux + Node.js + SQLite",
    build:{sha:BUILD_SHA,startedAt:STARTED_AT},
    automationOwner:meta("automation_owner")||"oracle",
    eufy:{ready:eufyReady,status:eufyStatus,readyNames:[...readyNames],transport:"linux-mqtt",connection:mqttConnectionStatus()},
    devices,
    override,
    astronomy:{dawn:astro.dawnLabel,dusk:astro.duskLabel,timeZone:TZ},
    nextEvent:next?{at:new Date(next.at).toISOString(),id:(next as any).id||null,name:next.name,phase:next.phase,target:next.target,source:next.source}:null,
    location:{zip:"14772",lat:LAT,lon:LON,timeZone:TZ},
    calendar:{synced:!!calendar,enabled:!!calendar?.settings?.enabled,revision:calendar?.revision||Number(meta("calendar_revision")||0)||0,eventCount:calendar?.events?.length||0,promotedFactoryCount:factoryPromotionRows(calendar).length,customCount:calendar?.customSchedules?.length||0,current:currentCalendar,syncedAt:calendar?.syncedAt||null},
    lastCommand:meta("last_command"),
    lastReconcile:meta("last_reconcile"),
    lastSchedulerEvaluation:meta("last_scheduler_eval"),
    commandLogCount:Number((db.prepare("SELECT COUNT(*) AS n FROM command_log").get() as any)?.n||0),
    desired:db.prepare("SELECT * FROM desired_state ORDER BY name").all()
  };
}

async function manualControl(input:any,sequence?:number,preserveTestHalloweenPreview=false){
  stopCalendarRandomFlash();
  if(!preserveTestHalloweenPreview)stopTestHalloweenPreview();
  const target=String(input?.target||"All"),names=targetNames(target),scenes=manualScenes(input,names);
  const firstScene=scenes[names[0]]||DEFAULT_SCENE;
  const overrideSequence=sequence??++manualSequence;
  // Do not let calendar bookkeeping delay the physical command. The scheduler
  // treats an active override with no expiry as active while we send, then the
  // exact next transition is attached after MQTT completion.
  const override:any={active:true,target,scene:firstScene,scenes,sequence:overrideSequence,createdAt:Date.now(),expiresAt:null};
  setMeta("override",JSON.stringify(override));

  const detail=await Promise.all(names.map(async name=>{
    const scene=scenes[name];
    try{
      const r:any=sequence==null?await sendScene(name,scene):await sendSceneLatest(name,scene,sequence);
      if(r?.skipped)return {name,ok:true,skipped:true};
      db.prepare("UPDATE devices SET last_ok=?,last_error=NULL WHERE name=?").run(Date.now(),name);
      db.prepare("INSERT INTO desired_state(name,scene,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET scene=excluded.scene,updated_at=excluded.updated_at").run(name,sceneKey(scene),Date.now());
      return {name,ok:true,scene,brokerAccepted:r?.brokerAccepted===true,deviceReported:r?.deviceReported===true,report:r?.report||null,instance:r?.instance||null,connectionMode:r?.transport||null};
    }catch(e:any){
      const msg=e?.message||String(e);
      db.prepare("UPDATE devices SET last_error=? WHERE name=?").run(msg,name);
      return {name,ok:false,scene,error:msg};
    }
  }));
  const completed=detail.filter((x:any)=>x.ok&&!x.skipped).length;
  const skipped=detail.filter((x:any)=>x.skipped).length;
  const failed=detail.filter((x:any)=>!x.ok).length;
  const expiresAt=nextOverrideExpiry(new Date());
  override.expiresAt=expiresAt;
  const currentOverride=parsedMeta<any>("override",null);
  if(currentOverride?.active&&Number(currentOverride?.sequence)===overrideSequence){
    currentOverride.expiresAt=expiresAt;
    setMeta("override",JSON.stringify(currentOverride));
  }
  const summary={at:new Date().toISOString(),target,ok:completed,skipped,failed,total:names.length,scenes,detail,transport:"linux-mqtt"};
  setMeta("last_command",JSON.stringify(summary));
  logCommand(Date.now(),target,"manual",failed===0,detail);
  if(failed===names.length)throw new Error(detail.map((x:any)=>x.error).filter(Boolean).join("; ")||"No light command completed");
  return {ok:true,updated:completed,skipped,total:names.length,detail,override};
}

function queueManualControl(input:any){
  const target=String(input?.target||"All"),names=targetNames(target),scenes=manualScenes(input,names);
  const sequence=++manualSequence;
  for(const name of names)latestManualSequence.set(name,sequence);

  const override={active:true,target,scene:scenes[names[0]]||DEFAULT_SCENE,scenes,sequence,createdAt:Date.now(),expiresAt:null};
  setMeta("override",JSON.stringify(override));
  setMeta("last_command",JSON.stringify({at:new Date().toISOString(),target,queued:true,sequence,scenes,transport:"linux-mqtt"}));

  void manualControl(input,sequence).catch((e:any)=>{
    const msg=e?.message||String(e);
    console.error("[manual queued]",target,msg);
    setMeta("last_command",JSON.stringify({at:new Date().toISOString(),target,queued:false,sequence,error:msg,scenes,transport:"linux-mqtt"}));
  });
  return {ok:true,queued:true,sequence,target,total:names.length,override};
}

async function transientControl(input:any){
  const target=String(input?.target||"All"),names=targetNames(target),scenes=manualScenes(input,names);
  const detail=await Promise.all(names.map(async name=>{
    const scene=scenes[name];
    try{
      const r:any=await serializedForDevice(name,async()=>{
        const client=await ensureEufy(false);
        if(!scene.power)return {skipped:true};
        return client.sceneTransient(name,scene.effect,scene.colors,scene.speed,scene.brightness,scene.pattern);
      });
      if(r?.skipped)return {name,ok:true,skipped:true};
      db.prepare("UPDATE devices SET last_ok=?,last_error=NULL WHERE name=?").run(Date.now(),name);
      return {name,ok:true,brokerAccepted:r?.brokerAccepted===true,transport:r?.transport||null};
    }catch(e:any){
      const msg=e?.message||String(e);
      db.prepare("UPDATE devices SET last_error=? WHERE name=?").run(msg,name);
      return {name,ok:false,error:msg};
    }
  }));
  const failed=detail.filter((x:any)=>!x.ok);
  if(failed.length===detail.length)throw new Error(failed.map((x:any)=>x.error).filter(Boolean).join("; ")||"No transient light command completed");
  return {ok:failed.length===0,target,total:names.length,detail};
}

const TEST_HALLOWEEN_EVENT_ID="ai-once-test-halloween-2026";
const TEST_HALLOWEEN_PURPLE=0x5b00e6;
const TEST_HALLOWEEN_ORANGE=0xff0d00;
const TEST_HALLOWEEN_FLASH_MS=90;
const TEST_HALLOWEEN_GAP_MIN_MS=40;
const TEST_HALLOWEEN_GAP_MAX_MS=100;
const TEST_HALLOWEEN_LAMPS:Record<string,number>={Pool:60,House:60,Garage:60,Shed:30};
let calendarRandomFlashGeneration=0;
let calendarRandomFlashSignature="";
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function randomFlashPositions(lamps:number,count:number,previous:number[]=[]){
  const prior=new Set(previous);
  for(let attempt=0;attempt<7;attempt++){
    const pool=Array.from({length:lamps},(_,i)=>i);
    for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
    const next=pool.slice(0,Math.max(1,Math.min(lamps,count))).sort((a,b)=>a-b);
    const overlap=next.reduce((n,x)=>n+(prior.has(x)?1:0),0);
    if(!previous.length||overlap<=Math.ceil(next.length*.45)||attempt===6)return next;
  }
  return [];
}
function stopCalendarRandomFlash(){
  calendarRandomFlashGeneration++;
  calendarRandomFlashSignature="";
}
async function sendTestHalloweenFrame(targets:string[],level:number,orange:boolean,previous:Map<string,number[]>){
  const results=await Promise.all(targets.map(async name=>{
    try{
      await serializedForDevice(name,async()=>{
        const client=await ensureEufy(false),lamps=TEST_HALLOWEEN_LAMPS[name]||60;
        if(!orange)return client.sceneTransientFast(name,"Static",[TEST_HALLOWEEN_PURPLE],1,level);
        const count=Math.max(1,Math.round(lamps/3)),positions=randomFlashPositions(lamps,count,previous.get(name)||[]);
        previous.set(name,positions);
        return client.sceneTransientFast(name,"Static",[TEST_HALLOWEEN_PURPLE,TEST_HALLOWEEN_ORANGE],1,level,{positions});
      });
      db.prepare("UPDATE devices SET last_ok=?,last_error=NULL WHERE name=?").run(Date.now(),name);
      return true;
    }catch(e:any){
      const msg=e?.message||String(e);
      db.prepare("UPDATE devices SET last_error=? WHERE name=?").run(msg,name);
      console.error("[Test Halloween transient]",name,msg);
      return false;
    }
  }));
  return results.filter(Boolean).length;
}
async function applyGarageHalloweenNative(level:number){
  try{
    await serializedForDevice("Garage",async()=>{
      const client=await ensureEufy(false);
      // Garage's 60-lamp E22 ignores the high-frequency segmented Static frames
      // used by the other strings. Let its controller animate purple/orange
      // natively so it continues independently of the software burst loop.
      return client.sceneTransientFast("Garage","Twinkle",[TEST_HALLOWEEN_PURPLE,TEST_HALLOWEEN_ORANGE],10,level);
    });
    db.prepare("UPDATE devices SET last_ok=?,last_error=NULL WHERE name='Garage'").run(Date.now());
    return true;
  }catch(e:any){
    const msg=e?.message||String(e);
    db.prepare("UPDATE devices SET last_error=? WHERE name='Garage'").run(msg);
    console.error("[Test Halloween Garage native]",msg);
    return false;
  }
}
function ensureCalendarRandomFlash(names:string[],brightness:number){
  const targets=[...new Set(names)].sort(),level=clamp(Math.round(brightness)||100,1,100);
  if(!targets.length){stopCalendarRandomFlash();return;}
  const signature=targets.join(",")+"|"+level;
  if(calendarRandomFlashSignature===signature)return;
  const token=++calendarRandomFlashGeneration;
  calendarRandomFlashSignature=signature;
  const rapidTargets=targets.filter(name=>name!=="Garage");

  // Garage runs its E22-native animation in its own loop. It is refreshed
  // periodically, and failures here never block the other three controllers.
  if(targets.includes("Garage")){
    void (async()=>{
      while(token===calendarRandomFlashGeneration&&calendarRandomFlashSignature===signature){
        const rawOverride=meta("override");
        if(rawOverride){try{if(JSON.parse(rawOverride)?.active)break;}catch{}}
        await applyGarageHalloweenNative(level);
        await delay(10000);
      }
    })();
  }

  // Every other string gets its own independent burst loop. A slow or dropped
  // PUBACK on one controller cannot stall the others.
  for(const name of rapidTargets){
    void (async()=>{
      const previous=new Map<string,number[]>();
      let failures=0;
      while(token===calendarRandomFlashGeneration&&calendarRandomFlashSignature===signature){
        const rawOverride=meta("override");
        if(rawOverride){try{if(JSON.parse(rawOverride)?.active)break;}catch{}}
        const sent=await sendTestHalloweenFrame([name],level,true,previous);
        if(!sent){
          failures++;
          await delay(failures>=4?250:100);
          continue;
        }
        failures=0;
        await delay(TEST_HALLOWEEN_FLASH_MS);
        if(token!==calendarRandomFlashGeneration||calendarRandomFlashSignature!==signature)break;
        await sendTestHalloweenFrame([name],level,false,previous);
        await delay(TEST_HALLOWEEN_GAP_MIN_MS+Math.floor(Math.random()*(TEST_HALLOWEEN_GAP_MAX_MS-TEST_HALLOWEEN_GAP_MIN_MS+1)));
      }
    })();
  }
}
let testHalloweenPreviewGeneration=0;
function stopTestHalloweenPreview(){testHalloweenPreviewGeneration++;}
function queueTestHalloweenPreview(brightness=100,durationMs=45000){
  const level=clamp(Math.round(brightness)||100,1,100),token=++testHalloweenPreviewGeneration;
  void (async()=>{
    await manualControl({
      name:"Test Halloween",target:"All",power:true,brightness:level,effect:"Static",
      colors:[TEST_HALLOWEEN_PURPLE],speed:1
    },undefined,true);
    if(token!==testHalloweenPreviewGeneration)return;
    const until=Date.now()+Math.max(5000,Math.min(120000,durationMs));

    // Garage uses the E22 controller's native twinkle engine. Keep refreshing it
    // separately so it cannot throttle or terminate the other strings.
    void (async()=>{
      while(token===testHalloweenPreviewGeneration&&Date.now()<until){
        await applyGarageHalloweenNative(level);
        await delay(10000);
      }
    })();

    const rapidTargets=[...DEVICE_NAMES].filter(name=>name!=="Garage");
    for(const name of rapidTargets){
      void (async()=>{
        const previous=new Map<string,number[]>();
        let failures=0;
        while(token===testHalloweenPreviewGeneration&&Date.now()<until){
          const sent=await sendTestHalloweenFrame([name],level,true,previous);
          if(!sent){
            failures++;
            await delay(failures>=4?250:100);
            continue;
          }
          failures=0;
          await delay(TEST_HALLOWEEN_FLASH_MS);
          if(token!==testHalloweenPreviewGeneration)return;
          await sendTestHalloweenFrame([name],level,false,previous);
          await delay(TEST_HALLOWEEN_GAP_MIN_MS+Math.floor(Math.random()*(TEST_HALLOWEEN_GAP_MAX_MS-TEST_HALLOWEEN_GAP_MIN_MS+1)));
        }
      })();
    }
  })().catch(e=>console.error("[Test Halloween preview]",e?.message||e));
  return {ok:true,queued:true,brightness:level,durationMs,flashMs:TEST_HALLOWEEN_FLASH_MS,gapMinMs:TEST_HALLOWEEN_GAP_MIN_MS,gapMaxMs:TEST_HALLOWEEN_GAP_MAX_MS,density:"1/3",garageMode:"E22 native Twinkle"};
}

async function applyScheduled(name:string,scene:Scene,reason:string){
  const r=await sendScene(name,scene);
  const now=Date.now();
  db.prepare("UPDATE devices SET last_ok=?,last_error=NULL WHERE name=?").run(now,name);
  db.prepare("INSERT INTO desired_state(name,scene,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET scene=excluded.scene,updated_at=excluded.updated_at").run(name,sceneKey(scene),now);
  logCommand(now,name,"schedule",true,{reason,brokerAccepted:r.brokerAccepted===true,deviceReported:r.deviceReported===true,report:r.report||null,connectionMode:r.transport||null});
}

let reconciling=false;
async function reconcile(ignoreOverride=false,forceSend=false){
  if(reconciling)return {ok:true,busy:true};
  reconciling=true;
  try{
    const now=Date.now();pruneExpiredAiEvents(now);
    const owner=meta("automation_owner")||"oracle";
    if(owner!=="oracle"&&!ignoreOverride){
      stopCalendarRandomFlash();
      const evalState={at:new Date(now).toISOString(),owner,paused:true,sent:0,errors:[]};
      setMeta("last_reconcile",new Date(now).toISOString());
      setMeta("last_scheduler_eval",JSON.stringify(evalState));
      return {ok:true,paused:true,owner,sent:0,errors:[]};
    }
    const rows=scheduleRows(),calendar=effectiveCalendarConfig();
    let override:any=null;const raw=meta("override");
    if(raw){try{override=JSON.parse(raw);}catch{delMeta("override");}}
    if(override?.active&&override.expiresAt&&Number(override.expiresAt)<=now){delMeta("override");override=null;}
    const skipped=new Set<string>();
    if(!ignoreOverride&&override?.active){
      for(const name of targetNames(String(override.target||"All")))skipped.add(name);
    }
    const changes:{name:string;scene:Scene;reason:string}[]=[];
    const flashTargets:string[]=[];let flashBrightness=100;
    const automationEnabled=rows.length>0||!!calendar?.settings?.enabled;
    if(automationEnabled){
      const resolved=rows.length?resolveScheduleState(rows,new Date(now),LAT,LON,TZ,[...DEVICE_NAMES]):{} as Record<string,any>;
      const cal=resolveCalendar(calendar,new Date(now),LAT,LON,TZ);
      for(const name of DEVICE_NAMES){
        if(skipped.has(name))continue;
        const active=resolved[name],testHalloween=!active&&cal?.id===TEST_HALLOWEEN_EVENT_ID;
        const scene:Scene=testHalloween
          ?{power:true,brightness:clamp(Number(cal?.scene?.brightness)||100,1,100),effect:"Static",colors:[TEST_HALLOWEEN_PURPLE],speed:1}
          :(active?active.scene:(cal?cal.scene:offScene()));
        if(testHalloween){flashTargets.push(name);flashBrightness=scene.brightness;}
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
    if(flashTargets.length)ensureCalendarRandomFlash(flashTargets,flashBrightness);else stopCalendarRandomFlash();
    setMeta("last_reconcile",new Date().toISOString());
    setMeta("last_scheduler_eval",JSON.stringify({at:new Date().toISOString(),owner:meta("automation_owner")||"oracle",action:"reconcile",sent:changes.length,errors,transport:"linux-mqtt"}));
    if(changes.length&&errors.length===changes.length)throw new Error(errors.join("; "));
    return {ok:true,sent:changes.length,errors};
  }finally{reconciling=false;}
}

function plainObject(value:any){
  return value&&typeof value==="object"&&!Array.isArray(value)?value:{};
}
function settingsBackupExport(){
  const calendar=calendarConfig();
  const edits=plainObject(parsedMeta<any>("factory_edits",{}));
  const promotions=plainObject(parsedMeta<any>("factory_promotions",{}));
  const promotionMap=plainObject(parsedMeta<any>("factory_promotion_map",{}));
  const ids=new Set<number>([
    ...Object.keys(edits).map(Number),
    ...Object.keys(promotions).map(Number),
    ...Object.keys(promotionMap).map(Number)
  ].filter(Number.isFinite));
  let referencedFactoryPresets:any[]=[];
  const catalog=parsedMeta<any>("factory_catalog",{});
  referencedFactoryPresets=(Array.isArray(catalog?.presets)?catalog.presets:[]).filter((p:any)=>ids.has(Number(p?.lightId)));
  return {
    schema:1,
    createdAt:new Date().toISOString(),
    calendar,
    calendarRevision:Math.max(0,Number(meta("calendar_revision")||calendar?.revision||0)||0),
    schedules:allSchedules(),
    factoryEdits:edits,
    factoryPromotions:promotions,
    factoryPromotionMap:promotionMap,
    referencedFactoryPresets
  };
}
function validateSettingsBackup(input:any){
  if(!input||typeof input!=="object"||Number(input.schema)!==1)throw new Error("Unsupported Oracle backup schema");
  const calendar=input.calendar?normalizeCalendarConfig(input.calendar):null;
  if(calendar&&calendar.events.length<1)throw new Error("Backup calendar is empty");
  if(!Array.isArray(input.schedules))throw new Error("Backup schedules are missing");
  for(const row of input.schedules){
    if(!row||typeof row!=="object"||!String(row.id||"")||!String(row.name||""))throw new Error("Backup contains an invalid schedule row");
    targetNames(String(row.target||"All"));
  }
  for(const key of ["factoryEdits","factoryPromotions","factoryPromotionMap"]){
    if(input[key]!=null&&(typeof input[key]!=="object"||Array.isArray(input[key])))throw new Error("Backup "+key+" is invalid");
  }
  if(input.referencedFactoryPresets!=null&&!Array.isArray(input.referencedFactoryPresets))throw new Error("Backup Factory recipe list is invalid");
  return {calendar,schedules:input.schedules,factoryEdits:plainObject(input.factoryEdits),factoryPromotions:plainObject(input.factoryPromotions),factoryPromotionMap:plainObject(input.factoryPromotionMap),referencedFactoryPresets:Array.isArray(input.referencedFactoryPresets)?input.referencedFactoryPresets:[]};
}
function mergeReferencedFactoryPresets(presets:any[]){
  if(!presets.length)return;
  let catalog:any={ok:true,fetchedAt:null,count:0,scanned:0,presets:[]};
  try{catalog=JSON.parse(meta("factory_catalog")||JSON.stringify(catalog));}catch{}
  const current=Array.isArray(catalog?.presets)?catalog.presets:[],byId=new Map<number,any>();
  for(const p of current)if(Number.isFinite(Number(p?.lightId)))byId.set(Number(p.lightId),p);
  for(const p of presets)if(Number.isFinite(Number(p?.lightId)))byId.set(Number(p.lightId),p);
  catalog.presets=[...byId.values()];
  catalog.count=catalog.presets.length;
  setMeta("factory_catalog",JSON.stringify(catalog));
}
function restoreSettingsBackup(input:any){
  const value=validateSettingsBackup(input);
  const previous=settingsBackupExport();
  const currentRevision=Math.max(0,Number(meta("calendar_revision")||0)||0);
  db.exec("BEGIN IMMEDIATE");
  try{
    setMeta("settings_backup_previous",JSON.stringify(previous));
    if(value.calendar){
      const revision=Math.max(currentRevision+1,Number(input.calendarRevision||value.calendar.revision||0)+1);
      value.calendar.revision=revision;value.calendar.syncedAt=Date.now();
      setMeta("calendar_config",JSON.stringify(value.calendar));
      setMeta("calendar_revision",String(revision));
      setMeta("calendar_sync",new Date().toISOString());
    }
    db.prepare("DELETE FROM schedules").run();
    for(const row of value.schedules){
      db.prepare(`INSERT INTO schedules(id,name,enabled,days,start_kind,start_value,end_kind,end_value,target,effect,colors,brightness,speed,priority)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          String(row.id),String(row.name).slice(0,80),row.enabled===0?0:1,String(row.days||"*"),
          ["clock","dawn","dusk"].includes(row.start_kind)?row.start_kind:"clock",String(row.start_value||"18:00"),
          ["clock","dawn","dusk"].includes(row.end_kind)?row.end_kind:"clock",String(row.end_value||"23:00"),
          String(row.target||"All"),String(row.effect||"Solid / Static"),typeof row.colors==="string"?row.colors:JSON.stringify(row.colors||[16777215]),
          clamp(Number(row.brightness)||75,1,100),clamp(Number(row.speed)||3,1,10),clamp(Number(row.priority)||0,-100,100)
        );
    }
    setMeta("factory_edits",JSON.stringify(value.factoryEdits));
    setMeta("factory_promotions",JSON.stringify(value.factoryPromotions));
    setMeta("factory_promotion_map",JSON.stringify(value.factoryPromotionMap));
    mergeReferencedFactoryPresets(value.referencedFactoryPresets);
    db.exec("COMMIT");
  }catch(e){try{db.exec("ROLLBACK");}catch{}throw e;}
  void reconcile(false,true).catch(e=>console.error("[backup restore reconcile]",e?.message||e));
  return {ok:true,restoredAt:new Date().toISOString(),revision:Number(meta("calendar_revision")||0),scheduleCount:value.schedules.length,factoryEditCount:Object.keys(value.factoryEdits).length,factoryPromotionCount:Object.keys(value.factoryPromotions).length};
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
      return json(res,200,{ok:true,service:"jason-home",runtime:"oracle-linux",architecture:"Node.js + SQLite + Eufy MQTT",build:{sha:BUILD_SHA,startedAt:STARTED_AT},automationOwner:meta("automation_owner")||"oracle",time:new Date().toISOString()});
    }
    if(!authorized(req))return json(res,401,{ok:false,error:"Unauthorized"});

    if(method==="GET"&&path==="/api/status")return json(res,200,await statusPayload(url.searchParams.get("refresh")==="1"));
    if(method==="GET"&&path==="/api/devices")return json(res,200,{ok:true,devices:(await statusPayload(false)).devices});
    if(method==="POST"&&path==="/api/automation/ownership"){
      const input:any=await readJson(req),owner=String(input?.owner||"").toLowerCase();
      if(owner!=="oracle"&&owner!=="direct")return json(res,400,{ok:false,error:"Automation owner must be oracle or direct"});
      setMeta("automation_owner",owner);
      if(owner==="oracle"){
        delMeta("override");
        return json(res,200,{ok:true,owner,reconcile:await reconcile(true,true)});
      }
      return json(res,200,{ok:true,owner,paused:true});
    }
    if(method==="GET"&&path==="/api/backup/export")return json(res,200,{ok:true,backup:settingsBackupExport()});
    if(method==="POST"&&path==="/api/backup/restore"){
      const input:any=await readJson(req);
      return json(res,200,restoreSettingsBackup(input?.backup||input));
    }
    if(method==="POST"&&path==="/api/backup/rollback"){
      const raw=meta("settings_backup_previous");
      if(!raw)throw new Error("No Oracle rollback snapshot is available");
      return json(res,200,restoreSettingsBackup(JSON.parse(raw)));
    }
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
      pruneExpiredAiEvents();
      const cfg=calendarConfig();
      return json(res,200,{ok:true,synced:!!cfg,calendar:cfg});
    }
    if(method==="POST"&&path==="/api/calendar/sync"){
      const input:any=await readJson(req);
      const incomingExplicit=Number.isFinite(Number(input?.revision))&&Number(input?.revision)>0;
      const currentRevision=Math.max(0,Number(meta("calendar_revision")||0)||0);
      let incomingRevision=incomingExplicit?Math.floor(Number(input.revision)):currentRevision+1;
      if(incomingExplicit&&incomingRevision<currentRevision){
        return json(res,409,{ok:false,error:"Stale calendar revision",incomingRevision,currentRevision});
      }
      if(incomingExplicit&&incomingRevision===currentRevision){
        const current=calendarConfig();
        const cfg=normalizeCalendarConfig(input);
        cfg.revision=incomingRevision;
        if(current&&JSON.stringify({...current,syncedAt:0})===JSON.stringify({...cfg,syncedAt:0}))
          return json(res,200,{ok:true,unchanged:true,revision:currentRevision,eventCount:cfg.events.length,customCount:cfg.customSchedules.length,enabled:cfg.settings.enabled,syncedAt:current.syncedAt});
        return json(res,409,{ok:false,error:"Calendar revision conflict",incomingRevision,currentRevision});
      }
      const cfg=normalizeCalendarConfig(input);
      cfg.revision=incomingRevision;
      setMeta("calendar_config",JSON.stringify(cfg));
      setMeta("calendar_revision",String(incomingRevision));
      setMeta("calendar_sync",new Date().toISOString());
      void reconcile(false,true).catch(e=>console.error("[calendar reconcile]",e?.message||e));
      return json(res,200,{ok:true,revision:incomingRevision,eventCount:cfg.events.length,customCount:cfg.customSchedules.length,enabled:cfg.settings.enabled,syncedAt:cfg.syncedAt});
    }
    if(method==="GET"&&path==="/api/events"){
      const cfg=calendarConfig();
      return json(res,200,{ok:true,events:cfg?.events||[],synced:!!cfg});
    }
    if(method==="GET"&&path==="/api/eufy/factory-promotions"){
      const base=calendarConfig();
      const rows=factoryPromotionRows(base);
      const promotions=rows.map((x:any)=>{
        const {raw,...preset}=x.preset||{};
        return {...x,preset};
      });
      return json(res,200,{ok:true,count:promotions.length,group:factoryPromotionGroupState(rows),promotions});
    }
    if(method==="POST"&&path==="/api/eufy/factory-promotions"){
      const updated=saveFactoryPromotion(await readJson(req));
      void reconcile(false,true).catch(e=>console.error("[factory promotion reconcile]",e?.message||e));
      const {raw,...preset}=updated.preset||{};
      return json(res,200,{ok:true,promotion:{...updated,preset}});
    }
    if(method==="POST"&&path==="/api/eufy/factory-promotions/group"){
      const updated=saveFactoryPromotionGroup(await readJson(req));
      void reconcile(false,true).catch(e=>console.error("[factory promotion group reconcile]",e?.message||e));
      return json(res,200,{ok:true,enabled:updated.enabled,group:updated.group,count:updated.promotions.length});
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
      const input:any=await readJson(req),lightId=Number(input?.lightId),target=String(input?.target||"All"),requestedMode=String(input?.mode||"compatible"),mode="compatible";
      if(!Number.isInteger(lightId)||lightId<1||lightId>1000000)throw new Error("Invalid factory preset id");
      targetNames(target);
      if(requestedMode!=="compatible"&&requestedMode!=="native")throw new Error("Factory apply mode must be compatible");
      return json(res,202,queueFactoryTest(lightId,target,mode));
    }
    if(method==="GET"&&path==="/api/eufy/factory-test"){
      const jobId=url.searchParams.get("job")||"";
      const job=factoryJobs.get(jobId);
      return job?json(res,200,{ok:true,...job}):json(res,404,{ok:false,error:"Factory test job not found"});
    }
    if(method==="POST"&&path==="/api/control/transient"){
      const input=await readJson(req);
      return json(res,200,await transientControl(input));
    }
    if(method==="POST"&&path==="/api/test-halloween/preview"){
      const input=await readJson(req);
      return json(res,202,queueTestHalloweenPreview(
        clamp(Math.round(Number(input?.brightness)||100),1,100),
        clamp(Math.round(Number(input?.durationMs)||45000),5000,120000)
      ));
    }
    if(method==="POST"&&path==="/api/control"){
      const input=await readJson(req);
      if(url.searchParams.get("wait")==="1")return json(res,200,await manualControl(input));
      return json(res,202,queueManualControl(input));
    }
    if(method==="POST"&&(path==="/api/resume"||path==="/api/resume-schedule")){
      stopTestHalloweenPreview();stopCalendarRandomFlash();
      delMeta("override");return json(res,200,{ok:true,resumed:true,reconcile:await reconcile(true,true)});
    }
    if(method==="POST"&&path==="/api/reconcile")return json(res,200,await reconcile(false,true));
    if(method==="POST"&&path==="/api/reconnect"){
      const c=await ensureEufy(true);const reapplied=await reconcile(false,true);return json(res,200,{ok:true,eufy:eufyStatus,readyNames:c.readyNames(),reapplied});
    }
    if(method==="POST"&&path==="/api/provision-device"){
      const input:any=await readJson(req),installId=String(input?.installId||"").trim().toLowerCase();
      if(!/^[0-9a-f]{32}$/.test(installId))throw new Error("Android install identity must be 32 hexadecimal characters");
      const changed=meta("install_id")!==installId;
      if(changed){setMeta("install_id",installId);delMeta("eufy_session");eufy=null;eufyReady=false;readyNames=[];}
      const c=await ensureEufy(changed);
      return json(res,200,{ok:true,changed,eufy:eufyStatus,readyNames:c.readyNames(),transport:"linux-mqtt"});
    }
    if(method==="GET"&&path==="/api/mqtt-capture"){const target=url.searchParams.get("target")||undefined;return json(res,200,commandCaptureStatus(target));}
    if(method==="POST"&&path==="/api/mqtt-capture/start"){
      const input:any=await readJson(req),target=String(input?.target||"Pool");
      if(target!=="All"&&!DEVICE_NAMES.includes(target as any))throw new Error("Capture target must be All, Pool, House, Garage, or Shed");
      const c=await ensureEufy(false);
      setMeta("automation_owner","direct");
      const names=target==="All"?[...DEVICE_NAMES]:[target];
      const started=await Promise.all(names.map(async name=>[name,await c.startCommandCapture(name)] as const));
      if(captureRestoreTimer)clearTimeout(captureRestoreTimer);
      captureRestoreTimer=setTimeout(()=>{stopCommandCapture();setMeta("automation_owner","oracle");void reconcile(false,true).catch(e=>console.error("[capture resume]",e.message));},1800000);
      return json(res,200,{ok:true,target,captures:Object.fromEntries(started)});
    }
    if(method==="POST"&&path==="/api/mqtt-capture/stop"){
      if(captureRestoreTimer)clearTimeout(captureRestoreTimer);
      const capture=stopCommandCapture();setMeta("automation_owner","oracle");
      return json(res,200,{...capture,reconcile:await reconcile(false,true)});
    }
    if(method==="POST"&&path==="/api/brightness-capture"){
      const input:any=await readJson(req),target=String(input?.target||"Pool"),value=clamp(Math.round(Number(input?.brightness)||1),1,100);
      if(!DEVICE_NAMES.includes(target as any))throw new Error("Brightness capture target must be Pool, House, Garage, or Shed");
      let sent:any,report:any;
      try{
        const c=await ensureEufy(false);
        sent=await serializedForDevice(target,()=>c.brightness(target,value));
        await new Promise(r=>setTimeout(r,450));
        report=await serializedForDevice(target,()=>c.status(target));
      }catch(e){markEufyDegraded(e);throw e;}
      return json(res,200,{ok:true,target,requested:value,command:{published:sent.published,brokerAccepted:sent.brokerAccepted===true,deviceReported:sent.deviceReported===true,report:sent.report||null},report:report.report||null});
    }
    if(method==="POST"&&path==="/api/mqtt-probe"){
      const input:any=await readJson(req),target=String(input?.target||"Pool");
      if(!DEVICE_NAMES.includes(target as any))throw new Error("Probe target must be Pool, House, Garage, or Shed");
      let result:any;try{result=await serializedForDevice(target,async()=>{const c=await ensureEufy(false);return c.status(target);});}catch(e){markEufyDegraded(e);throw e;}
      return json(res,200,{ok:true,target,published:result.published,brokerAccepted:result.brokerAccepted===true,deviceReported:result.deviceReported===true,report:result.report||null,instance:result.instance||null});
    }
    return json(res,404,{ok:false,error:"Not found",path});
  }catch(e:any){
    const msg=e?.message||String(e);
    console.error("[api]",req.method,req.url,msg);
    if(/session|auth|login|certificate/i.test(msg)){eufy=null;eufyReady=false;readyNames=[];}
    const status=Number(e?.statusCode)||(/^(Invalid|Unknown|Malformed|Schedule id required|Factory apply mode|Probe target|Android install identity|Automation owner|Backup )/i.test(msg)?400:500);
    return json(res,status,{ok:false,error:msg});
  }
});

server.keepAliveTimeout=65000;
// Preserve each old speed at the corresponding point of the new ten-step scale.
if(!meta("speed_scale_10")){
  const legacySpeed=(v:any)=>[1,3,5,8,10][Math.round(clamp(Number(v)||3,1,5))-1];
  const migrateScenes=(value:any):any=>{
    if(Array.isArray(value)){value.forEach(migrateScenes);return value;}
    if(value&&typeof value==="object")for(const [key,item] of Object.entries(value)){
      if(key==="speed")value[key]=legacySpeed(item);else migrateScenes(item);
    }
    return value;
  };
  db.exec("BEGIN");
  try{
    for(const key of ["calendar_config","override"]){
      const raw=meta(key);if(raw){setMeta("speed_scale_10_backup_"+key,raw);const value=migrateScenes(JSON.parse(raw));
        if(key==="calendar_config"){value.revision=Math.max(Number(value.revision)||0,Number(meta("calendar_revision"))||0)+1;setMeta("calendar_revision",String(value.revision));}
        setMeta(key,JSON.stringify(value));}
    }
    for(const row of allSchedules())db.prepare("UPDATE schedules SET speed=? WHERE id=?").run(legacySpeed(row.speed),row.id);
    for(const row of db.prepare("SELECT name,scene FROM desired_state").all() as any[])db.prepare("UPDATE desired_state SET scene=? WHERE name=?").run(JSON.stringify(migrateScenes(JSON.parse(row.scene))),row.name);
    setMeta("speed_scale_10","true");db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
}
// Migrate effects once, preserving dates, palettes, enablement and schedule settings.
const previousCalendar=calendarConfig();
if(previousCalendar){
  const migrated=normalizeCalendarConfig(previousCalendar);
  const changed=[...previousCalendar.events,...previousCalendar.customSchedules].some(e=>e.effect!==canonicalEffect(e.effect));
  if(changed){
    if(!meta("native_effects_migration_backup"))setMeta("native_effects_migration_backup",JSON.stringify(previousCalendar));
    migrated.revision=Math.max(Number(meta("calendar_revision")||0),Number(previousCalendar.revision)||0)+1;
    migrated.syncedAt=previousCalendar.syncedAt;
    setMeta("calendar_config",JSON.stringify(migrated));
    setMeta("calendar_revision",String(migrated.revision));
  }
}
for(const row of allSchedules()){
  const effect=canonicalEffect(row.effect);
  if(effect!==row.effect)db.prepare("UPDATE schedules SET effect=? WHERE id=?").run(effect,row.id);
}
if(meta("suicide_prevention_restore_original_v1")!=="true"){
  const cfg=calendarConfig();
  const e=cfg?.events?.find(x=>x.id==="evt134");
  if(cfg&&e){
    e.name="Suicide Prevention Awareness Month";
    e.kind="Awareness";e.rule="Month";e.month=9;e.day=0;e.weekday=0;e.nth=0;e.offsetDays=0;e.durationDays=1;
    e.effect="Breathe";e.speed=1;e.colors=[46260,5964006,46260,5964006];
    e.enabled=true;e.favorite=false;e.categoryIndex=9;e.major=true;
    delete e.factoryEffectName;delete e.creativePhases;
    const revision=Math.max(Number(meta("calendar_revision")||0)||0,Number(cfg.revision||0)||0)+1;
    cfg.revision=revision;cfg.syncedAt=Date.now();
    setMeta("calendar_config",JSON.stringify(cfg));setMeta("calendar_revision",String(revision));setMeta("calendar_sync",new Date().toISOString());
  }
  try{
    const active=parsedMeta<any>("override",null);
    if(active?.scene?.factoryEffectName==="Garden Romance")delMeta("override");
  }catch{}
  setMeta("suicide_prevention_restore_original_v1","true");
}
server.listen(PORT,"0.0.0.0",()=>{
  console.log(`Jason Home Oracle server listening on 0.0.0.0:${PORT}`);
  console.log(`Scheduler timezone: ${TZ}; coordinates: ${LAT}, ${LON}`);
  setTimeout(()=>void reconcile(false,true).catch(e=>console.error("[startup reconcile]",e?.message||e)),5000);
  setInterval(()=>void reconcile(false,false).catch(e=>console.error("[scheduler]",e?.message||e)),30000);
});
