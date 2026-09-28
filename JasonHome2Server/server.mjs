import http from "node:http";
import { createHmac, randomBytes, timingSafeEqual, randomUUID } from "node:crypto";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root=resolve(process.env.JH2_WEB_ROOT||new URL("./web/",import.meta.url).pathname);
const dataDir=resolve(process.env.JH2_DATA_DIR||"./data");
const catalog=JSON.parse(readFileSync(new URL("./catalog.json",import.meta.url),"utf8"));
const port=Number(process.env.JH2_PORT||8081);
const upstreamUrl=process.env.JH2_UPSTREAM_URL||"http://127.0.0.1:8080";
const upstreamToken=process.env.JH2_UPSTREAM_TOKEN||"";
if(!upstreamToken)throw new Error("JH2_UPSTREAM_TOKEN must be configured");
mkdirSync(dataDir,{recursive:true});
const db=new DatabaseSync(join(dataDir,"jason-home-2.sqlite"));
db.exec("CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
const meta=(key,fallback=null)=>{const row=db.prepare("SELECT value FROM meta WHERE key=?").get(key);return row?JSON.parse(row.value):fallback;};
const put=(key,value)=>db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key,JSON.stringify(value));
let secret=meta("session_secret");
if(!secret){secret=randomBytes(32).toString("hex");put("session_secret",secret);}
const send=(res,status,value,headers={})=>{const body=JSON.stringify(value);res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","content-length":Buffer.byteLength(body),...headers});res.end(body);};
const fail=(status,message)=>Object.assign(new Error(message),{status});
const secureEqual=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);};
const isSession=req=>{
  const raw=(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("jh2="))?.slice(4)||"";
  const [expires,sig]=raw.split(".");
  if(!/^\d{10,14}$/.test(expires||"")||!sig||Date.now()>Number(expires))return false;
  const expected=createHmac("sha256",secret).update(expires).digest("hex");
  return secureEqual(sig,expected);
};
const cookie=()=>{const expires=String(Date.now()+90*86400000),sig=createHmac("sha256",secret).update(expires).digest("hex");return `jh2=${expires}.${sig}; Path=/jason-home-2; Max-Age=7776000; HttpOnly; Secure; SameSite=Strict`;};
async function input(req){
  let text="";
  for await(const chunk of req){text+=chunk;if(text.length>2_000_000)throw fail(413,"Request is too large");}
  if(!text)return {};
  try{return JSON.parse(text);}catch{throw fail(400,"Invalid JSON");}
}
async function upstream(path,method="GET",value){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
  try{
    const response=await fetch(new URL(path,upstreamUrl),{
      method,headers:{"authorization":"Bearer "+upstreamToken,"accept":"application/json",...(value===undefined?{}:{"content-type":"application/json"})},
      body:value===undefined?undefined:JSON.stringify(value),signal:controller.signal
    });
    const payload=await response.json().catch(()=>({ok:false,error:"Invalid Oracle response"}));
    if(!response.ok)throw fail(response.status,payload.error||"Oracle request failed");
    return payload;
  }finally{clearTimeout(timer);}
}
const hex=x=>"#"+((typeof x==="string"&&/^#?[0-9a-f]{6}$/i.test(x))?x.replace("#","").toUpperCase():(Number(x)||0).toString(16).padStart(6,"0").slice(-6).toUpperCase());
const rgb=values=>(Array.isArray(values)?values:[]).slice(0,8).map(hex);
const colorInts=values=>rgb(values).map(x=>parseInt(x.slice(1),16));
const clamp=(v,low,high)=>Math.min(high,Math.max(low,Number(v)||low));
const minutes=s=>{const m=/^(\d{1,2}):(\d{2})$/.exec(String(s||""));return m?Math.min(1439,Math.max(0,Number(m[1])*60+Number(m[2]))):null;};
const clock=n=>`${String(Math.floor(Number(n||0)/60)).padStart(2,"0")}:${String(Number(n||0)%60).padStart(2,"0")}`;
const targetNames=["All","Pool","House","Garage","Shed"];
const eventById=new Map(catalog.events.map(e=>[e.id,e]));
const categoryByIndex=new Map(catalog.categories.map(c=>[c.index,c]));
const theme=mode=>mode===0?"1":mode===1?"3.0.28":"3.0.29";
const themeName=t=>t==="1"?"Major U.S. Holidays — Basic Colors":t==="3.0.28"?"Expanded Holidays — Basic Colors":"Expanded Holidays — Expanded Colors";
async function config(){
  const r=await upstream("/api/calendar");if(!r.calendar)throw fail(503,"Oracle calendar is not initialized");
  if(meta("initialized")!==true){
    const schedules=(r.calendar.customSchedules||[]).map(x=>({...x,colors:rgb(x.colors)}));
    const presets=[...new Map(schedules.filter(x=>x.presetId).map(x=>[x.presetId,
      {id:x.presetId,name:x.name,effect:x.effect,speed:x.speed,brightness:x.brightness,colors:x.colors,enabled:x.enabled!==false,favorite:false}])).values()];
    put("custom_schedules",schedules);put("presets",presets);
    const mode=Number(r.calendar.settings.mode||0),overrides={};
    for(const e of r.calendar.events){
      const original=eventById.get(e.id);if(!original)continue;
      const p=original.profiles,o={};
      if(e.effect!==(mode===2?p.expandedEffect:original.effect))o.effect=e.effect;
      if(e.speed!==(mode===2?p.expandedSpeed:original.speed))o.speed=e.speed;
      if(JSON.stringify(e.colors)!==JSON.stringify(mode===0?p.major:mode===1?p.basic:p.expanded))o.colors=e.colors;
      if(e.enabled===false)o.enabled=false;
      if(e.favorite)o.favorite=true;
      if(Object.keys(o).length)overrides[e.id]=o;
    }
    put("event_overrides",overrides);put("initialized",true);
  }
  return r.calendar;
}
async function mutateCalendar(change){
  // Always start from the newest Oracle revision; stale edits must fail instead of overwriting an intervening update.
  const cfg=await config();
  change(cfg);
  const result=await upstream("/api/calendar/sync","POST",{...cfg,revision:Number(cfg.revision||0)+1});
  if(!result.ok)throw fail(409,"Calendar update was rejected");
  return cfg;
}
function eventDate(e,year,special){
  const utc=(y,m,d)=>new Date(Date.UTC(y,m-1,d));
  let d=null;
  if(e.rule==="Month")return utc(year,e.month,1);
  if(e.rule==="Fixed")d=utc(year,e.month,e.day);
  if(e.rule==="NthWeekday"){
    d=utc(year,e.month,1);
    d.setUTCDate(1+((e.weekday-d.getUTCDay()+7)%7)+(Math.max(1,e.nth)-1)*7);
    if(d.getUTCMonth()+1!==e.month)return null;
  }
  if(e.rule==="LastWeekday"){
    d=utc(year,e.month+1,0);
    d.setUTCDate(d.getUTCDate()-((d.getUTCDay()-e.weekday+7)%7));
  }
  if(e.rule==="MonthEnd")d=utc(year,e.month+1,0);
  if(e.rule==="EasterOffset"){
    const a=year%19,b=Math.floor(year/100),c=year%100,h=(19*a+b-Math.floor(b/4)-Math.floor((b-Math.floor((b+8)/25)+1)/3)+15)%30;
    const l=(32+2*(b%4)+2*Math.floor(c/4)-h-(c%4))%7,m=Math.floor((a+11*h+22*l)/451),n=h+l-7*m+114;
    d=utc(year,Math.floor(n/31),n%31+1);
  }
  if(e.rule==="YearTable"||e.rule==="Hanukkah"){
    const hit=special.find(s=>s.id===(e.dateRuleSourceId||e.id)&&s.year===year);
    if(hit)d=utc(hit.year,hit.month,hit.day);
  }
  if(d&&e.offsetDays&&e.rule!=="EasterOffset")d.setUTCDate(d.getUTCDate()+e.offsetDays);
  if(d&&e.rule==="EasterOffset")d.setUTCDate(d.getUTCDate()+e.offsetDays);
  return d;
}
function when(e,year,special){
  if(e.rule==="Month")return new Intl.DateTimeFormat("en-US",{month:"long",timeZone:"UTC"}).format(eventDate(e,year,special))+" — all month";
  const d=eventDate(e,year,special);
  if(!d)return "No scheduled date in "+year;
  const format=x=>new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",timeZone:"UTC"}).format(x);
  if(Number(e.durationDays||1)>1){const end=new Date(d);end.setUTCDate(end.getUTCDate()+Number(e.durationDays)-1);return format(d)+" – "+format(end);}
  return format(d);
}
function displayEvents(cfg,url){
  const year=Number(url.searchParams.get("year"))||new Date().getFullYear(),month=Number(url.searchParams.get("month"))||0;
  const search=(url.searchParams.get("q")||"").toLowerCase().trim(),mode=Number(cfg.settings.mode||0),mask=Number(cfg.settings.categoryMask??32767);
  let rows=[];
  for(const e of cfg.events){
    if(mode===0&&!e.major)continue;
    if((mask&(1<<e.categoryIndex))===0)continue;
    const d=eventDate(e,year,cfg.special||[]);
    if(month&&(!d||d.getUTCMonth()+1!==month))continue;
    const category=categoryByIndex.get(e.categoryIndex)||catalog.categories[0],label=when(e,year,cfg.special||[]);
    if(search&&!(e.name+" "+label+" "+e.kind+" "+category.name).toLowerCase().includes(search))continue;
    const original=eventById.get(e.id),defaults=original?.profiles;
    rows.push({id:e.id,name:e.name,kind:e.kind,categoryId:category.id,categoryName:category.name,categoryColor:category.color,
      when:label,effect:e.effect,speed:e.speed,colors:rgb(e.colors),enabled:e.enabled!==false,favorite:!!e.favorite,
      customized:!!defaults&&(e.effect!==(mode===2?defaults.expandedEffect:original.effect)||e.speed!==(mode===2?defaults.expandedSpeed:original.speed)
       ||JSON.stringify(e.colors)!==JSON.stringify(mode===0?defaults.major:mode===1?defaults.basic:defaults.expanded))});
    if(!month&&rows.length>=96)break;
  }
  return {events:rows,truncated:!month&&rows.length>=96,overlap:"Craumer priority and overlap rules are active."};
}
async function state(){
  const [s,cfg]=await Promise.all([upstream("/api/status"),config()]);
  const a=cfg.settings,first=s.override?.scene||s.calendar?.current?.scene||(()=>{try{return JSON.parse(s.desired?.[0]?.scene||"null");}catch{return null;}})();
  const selected=meta("target",0),names=["Pool","House","Garage","Shed"],ready=new Set(s.eufy?.readyNames||[]);
  const scene=first||{power:false,brightness:75,effect:"Solid / Static",colors:[0xffffff],speed:3};
  const scheduled=s.calendar?.current||{},id=scheduled.id||"";
  const scheduledEvent={name:scheduled.name||(a.enabled?"Schedule active • waiting for next event":"Schedule disabled"),id,
    enabled:a.enabled!==false,toggleable:!!id,upcoming:false,type:id.includes("::factory:")?"factoryPromotion":id.startsWith("schedule-")?"customSchedule":id?"builtin":"none",
    custom:id.startsWith("schedule-"),factoryLightId:id.includes("::factory:")?Number(id.split("::factory:")[1]):undefined};
  return {firmwareVersion:"Jason Home 2 • Oracle Web",power:!!scene.power,brightness:scene.brightness,speed:scene.speed,
    running:{name:scheduled.name||meta("running_name","Jason Home 2"),effect:scene.effect,colors:rgb(scene.colors)},
    settings:{on:clock(a.on),off:clock(a.off),lead:a.lead,trail:a.trail,overlap:["rotate","first","last"][a.overlap]||"rotate",
      tz:"America/New_York",scheduler:a.enabled,scheduler2:a.schedule2Enabled,schedule1StartAtDusk:a.startAtDusk,
      schedule2End:clock(a.schedule2End),schedule2EndAtDawn:a.schedule2EndAtDawn,schedule2Brightness:a.schedule2Brightness,
      dawn:s.astronomy?.dawn||"",dusk:s.astronomy?.dusk||""},
    scheduleWindow:`Schedule 1 ${a.startAtDusk?"dusk ("+(s.astronomy?.dusk||"")+")":clock(a.on)} - ${clock(a.off)} • Schedule 2 ${clock(a.off)} - ${a.schedule2EndAtDawn?"dawn ("+(s.astronomy?.dawn||"")+")":clock(a.schedule2End)} at ${a.schedule2Brightness}%`,
    nextEvent:s.nextEvent?.name||"No upcoming event",scheduledEvent,manualOverride:!!s.override?.active,stateAuthority:"oracle",
    ble:{ready:!!s.eufy?.ready,busy:false,connected:!!s.eufy?.ready,connectedCount:ready.size,knownCount:4,seenCount:ready.size,
      name:"Saved Eufy lights",address:"",protocol:"Oracle + Eufy MQTT",connectionMode:"Oracle / Internet",target:selected,
      controllers:names.map((name,slot)=>({slot,name,model:slot<2?"E120":"E22",protocol:"Oracle",seen:ready.has(name),connected:ready.has(name),saved:true})),
      status:s.eufy?.status||"Oracle unavailable",transportStatus:"Oracle Linux → Eufy MQTT"}};
}
function authenticatedRead(req,res,path){
  const name=path==="/"?"anderson_home.html":path.slice(1);
  const allowed=new Set(["anderson_home.html","v3_mockup.css","v3_mockup.js","event_categories.css","event_categories.js","android_eufy_ui.css","android_eufy_ui.js"]);
  if(!allowed.has(name))return send(res,404,{ok:false,error:"Not found"});
  const file=join(root,name);
  if(!existsSync(file))return send(res,404,{ok:false,error:"Missing web asset"});
  const type=extname(file)===".js"?"text/javascript":extname(file)===".css"?"text/css":"text/html";
  const data=readFileSync(file);res.writeHead(200,{"content-type":type+"; charset=utf-8","content-length":data.length,
    "cache-control":"no-store","content-security-policy":"default-src 'self' 'unsafe-inline' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    "x-content-type-options":"nosniff"});res.end(data);
}
const loginPage=`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jason Home 2</title>
<style>body{background:#06111d;color:#eef6ff;font:16px system-ui;margin:0;display:grid;min-height:100vh;place-items:center}main{width:min(90vw,420px);padding:28px;background:#172436;border:1px solid #38506a;border-radius:20px}input,button{box-sizing:border-box;width:100%;padding:14px;margin-top:14px;border-radius:10px;font:inherit}input{background:#fff;border:0}button{color:#051221;background:#50b7ff;border:0;font-weight:700}small{color:#aec7da}#error{color:#ffc5c5}</style>
<main><h1>Jason Home 2</h1><p>Connect this app to your Oracle lighting controller once.</p><form id="login"><label for="token">Oracle API key</label><input id="token" type="password" autocomplete="off" required><button>Connect</button></form><p id="error"></p><small>Your key is checked by Oracle and is never stored in this page or APK.</small></main>
<script>document.getElementById("login").addEventListener("submit",async e=>{e.preventDefault();const token=document.getElementById("token").value;const r=await fetch("/jason-home-2/api/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token})});if(r.ok){document.getElementById("token").value="";location.replace("/jason-home-2/");}else document.getElementById("error").textContent="Could not connect. Check the Oracle API key.";});</script></html>`;
async function route(req,res){
  const url=new URL(req.url||"/","http://127.0.0.1"),path=url.pathname,method=req.method||"GET";
  if(path==="/api/health")return send(res,200,{ok:true,service:"jason-home-2-web",upstream:upstreamUrl,build:process.env.JH2_BUILD_SHA||"local"});
  if(path==="/api/session"&&method==="POST"){
    const value=await input(req),candidate=String(value.token||"");
    if(!candidate||!secureEqual(candidate,upstreamToken))throw fail(401,"Invalid Oracle API key");
    await upstream("/api/status");
    return send(res,200,{ok:true},{"set-cookie":cookie()});
  }
  if(!isSession(req)){
    if(method==="GET"&&!path.startsWith("/api/")){const body=Buffer.from(loginPage);res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-length":body.length});return res.end(body);}
    throw fail(401,"Connect Jason Home 2 to Oracle");
  }
  if(method!=="GET"){
    const origin=req.headers.origin;
    if(origin&&new URL(origin).host!==req.headers.host)throw fail(403,"Invalid request origin");
    if(req.headers["sec-fetch-site"]==="cross-site")throw fail(403,"Cross-site request blocked");
  }
  if(!path.startsWith("/api/"))return authenticatedRead(req,res,path);
  if(method==="GET"&&path==="/api/state")return send(res,200,await state());
  if(method==="GET"&&path==="/api/cloud/config")return send(res,200,{ok:true,endpoint:"https://150.136.245.51",mode:"cloud",configured:true,automationOwner:"oracle",directReady:false,directStatus:"Jason Home 2 web controller"});
  if(method==="POST"&&path==="/api/cloud/config")return send(res,200,{ok:true,endpoint:"https://150.136.245.51",mode:"cloud",configured:true,automationOwner:"oracle"});
  if(method==="GET"&&path==="/api/cloud/test")return send(res,200,await upstream("/api/status?refresh=1"));
  if(method==="GET"&&path==="/api/cloud/health")return send(res,200,await upstream("/api/health"));
  if(method==="POST"&&path==="/api/control"){
    const body=await input(req),target=targetNames[meta("target",0)]||"All";
    if(body.colors)body.colors=colorInts(body.colors);
    if(body.name)put("running_name",String(body.name).slice(0,100));
    await upstream("/api/control","POST",{...body,target});
    return send(res,200,await state());
  }
  if(method==="POST"&&path==="/api/resume"){await upstream("/api/resume","POST",{});return send(res,200,await state());}
  if(method==="POST"&&path==="/api/settings"){
    const body=await input(req);
    await mutateCalendar(cfg=>{
      const s=cfg.settings;
      for(const [field,key] of [["scheduler","enabled"],["scheduler2","schedule2Enabled"],["schedule1Dusk","startAtDusk"],["schedule2Dawn","schedule2EndAtDawn"],["lead","lead"],["trail","trail"],["schedule2Brightness","schedule2Brightness"]])
        if(Object.hasOwn(body,field))s[key]=body[field];
      for(const [field,key] of [["on","on"],["off","off"],["schedule2End","schedule2End"]])if(Object.hasOwn(body,field)){const n=minutes(body[field]);if(n===null)throw fail(400,"Invalid schedule time");s[key]=n;}
      if(Object.hasOwn(body,"overlap"))s.overlap={rotate:0,first:1,last:2}[body.overlap]??0;
    });
    return send(res,200,await state());
  }
  if(method==="GET"&&(path==="/api/events"||path==="/api/events/search"))return send(res,200,displayEvents(await config(),url));
  if(method==="POST"&&path==="/api/event"){
    const body=await input(req);
    await mutateCalendar(cfg=>{
      const e=cfg.events.find(x=>x.id===body.id),original=eventById.get(body.id);
      if(!e||!original)throw fail(404,"Unknown event");
      if(body.reset){const mode=Number(cfg.settings.mode||0),p=original.profiles;
        e.effect=mode===2?p.expandedEffect:original.effect;e.speed=mode===2?p.expandedSpeed:original.speed;
        e.colors=mode===0?p.major:mode===1?p.basic:p.expanded;
        const overrides=meta("event_overrides",{});delete overrides[e.id];put("event_overrides",overrides);
      }else{
        const o=meta("event_overrides",{});o[e.id]??={};
        for(const key of ["enabled","favorite","effect","speed"])if(Object.hasOwn(body,key)){e[key]=body[key];o[e.id][key]=body[key];}
        if(Array.isArray(body.colors)){e.colors=colorInts(body.colors);o[e.id].colors=e.colors;}
        put("event_overrides",o);
      }
    });
    return send(res,200,{ok:true});
  }
  if(path==="/api/event-categories"){
    if(method==="POST"){
      const body=await input(req),index=Number(body.index);
      if(!Number.isInteger(index)||index<0||index>=15)throw fail(400,"Unknown category");
      const cfg=await mutateCalendar(c=>{const bit=1<<index;c.settings.categoryMask=body.enabled?(Number(c.settings.categoryMask??32767)|bit):(Number(c.settings.categoryMask??32767)&~bit);});
      const category=catalog.categories[index];
      return send(res,200,{ok:true,...category,enabled:!!(cfg.settings.categoryMask&(1<<index)),mask:cfg.settings.categoryMask});
    }
    const cfg=await config(),mask=Number(cfg.settings.categoryMask??32767);
    return send(res,200,{mask,expanded:Number(cfg.settings.mode||0)!==0,categories:catalog.categories.map(x=>({...x,enabled:!!(mask&(1<<x.index))}))});
  }
  if(path==="/api/event-color-theme"){
    if(method==="POST"){
      const body=await input(req),t=["1","3.0.28","3.0.29"].includes(body.theme)?body.theme:"3.0.29",mode=t==="1"?0:t==="3.0.28"?1:2;
      await mutateCalendar(cfg=>{
        const previous=Number(cfg.settings.mode||0),overrides=meta("event_overrides",{});
        for(const e of cfg.events){
          const original=eventById.get(e.id);if(!original)continue;
          const p=original.profiles,o=overrides[e.id]||{};
          if(previous===mode)continue;
          e.effect=o.effect??(mode===2?p.expandedEffect:original.effect);
          e.speed=o.speed??(mode===2?p.expandedSpeed:original.speed);
          e.colors=o.colors??(mode===0?p.major:mode===1?p.basic:p.expanded);
          if(o.enabled!==undefined)e.enabled=o.enabled;
          if(o.favorite!==undefined)e.favorite=o.favorite;
        }
        cfg.settings.mode=mode;
      });
      return send(res,200,{theme:t,name:themeName(t)});
    }
    const t=theme(Number((await config()).settings.mode||0));return send(res,200,{theme:t,name:themeName(t)});
  }
  if(method==="GET"&&path==="/api/favorites"){
    const c=await config(),presets=meta("presets",[]);
    return send(res,200,{events:[
      ...c.events.filter(x=>x.favorite).map(x=>({id:x.id,name:x.name,effect:x.effect,speed:x.speed,colors:rgb(x.colors),favorite:true,custom:false})),
      ...presets.filter(x=>x.favorite).map(x=>({...x,custom:true}))
    ]});
  }
  if(method==="GET"&&path==="/api/presets")return send(res,200,{presets:meta("presets",[])});
  if(method==="POST"&&path==="/api/preset"){
    const body=await input(req),all=meta("presets",[]),schedules=meta("custom_schedules",[]);
    if(body.deleteId){put("presets",all.filter(x=>x.id!==body.deleteId));return send(res,200,{ok:true});}
    let item=all.find(x=>x.id===body.id),id=body.id||"custom-"+randomUUID().slice(0,8);
    if(item&&(Object.hasOwn(body,"favorite")||Object.hasOwn(body,"enabled"))){
      if(Object.hasOwn(body,"favorite"))item.favorite=!!body.favorite;
      if(Object.hasOwn(body,"enabled")){item.enabled=!!body.enabled;
        for(const s of schedules)if(s.presetId===id)s.enabled=!!body.enabled;
        put("custom_schedules",schedules);await mutateCalendar(c=>{c.customSchedules=schedules;});
      }
    }else{
      if(!String(body.name||"").trim())throw fail(400,"Give this custom light a name");
      if(!item){item={id};all.push(item);}
      Object.assign(item,{name:String(body.name).trim(),effect:String(body.effect||"Jump"),brightness:clamp(body.brightness??100,1,100),
        speed:clamp(body.speed??3,1,5),enabled:body.enabled!==false,favorite:!!body.favorite,colors:rgb(body.colors||["#E08700"])});
    }
    put("presets",all);return send(res,200,{ok:true,id,fileBytes:JSON.stringify(all).length});
  }
  if(method==="GET"&&path==="/api/custom-schedules"){
    const y=Number(url.searchParams.get("year"))||new Date().getFullYear(),m=Number(url.searchParams.get("month"))||new Date().getMonth()+1;
    return send(res,200,{items:meta("custom_schedules",[]).filter(x=>x.month===m&&(x.annual||x.year===y))});
  }
  if(method==="POST"&&path==="/api/custom-schedules/group"){
    const body=await input(req),items=meta("custom_schedules",[]),wanted=!!body.enabled,changed=items.filter(x=>x.enabled!==wanted).length;
    items.forEach(x=>x.enabled=wanted);put("custom_schedules",items);
    await mutateCalendar(c=>{c.customSchedules=items.map(x=>({...x,colors:colorInts(x.colors)}));});
    return send(res,200,{ok:true,enabled:wanted,changed,total:items.length});
  }
  if(method==="POST"&&path==="/api/custom-schedules"){
    const body=await input(req),items=meta("custom_schedules",[]);
    if(body.id&&body.remove){put("custom_schedules",items.filter(x=>x.id!==body.id));}
    else if(body.id&&Object.hasOwn(body,"enabled")){const x=items.find(x=>x.id===body.id);if(!x)throw fail(404,"Unknown custom schedule");x.enabled=!!body.enabled;put("custom_schedules",items);}
    else{
      const preset=meta("presets",[]).find(x=>x.id===body.presetId);if(!preset)throw fail(404,"Custom light not found");
      const id="schedule-"+randomUUID().slice(0,8);
      items.push({...preset,id,presetId:preset.id,year:Number(body.year)||new Date().getFullYear(),month:Number(body.month)||1,
        day:Number(body.day)||1,annual:body.annual!==false,enabled:true});put("custom_schedules",items);
    }
    await mutateCalendar(c=>{c.customSchedules=meta("custom_schedules",[]).map(x=>({...x,colors:colorInts(x.colors)}));});
    return send(res,200,{ok:true});
  }
  if(path==="/api/colors"){
    const all=meta("palette",{});
    if(method==="POST"){
      const body=await input(req),index=Number(body.index);
      if(!Number.isInteger(index)||index<0||index>=catalog.palette.length)throw fail(400,"Select a valid color preset");
      if(body.reset)delete all[index];else if(/^#?[0-9A-F]{6}$/i.test(String(body.color)))all[index]=hex(body.color);
      else throw fail(400,"Enter a valid six-digit color");
      put("palette",all);
    }
    return send(res,200,{presets:catalog.palette.map(x=>({...x,color:all[x.index]||x.default,customized:!!all[x.index]}))});
  }
  if(method==="GET"&&path==="/api/ble/scan"){
    const status=await upstream("/api/status"),ready=new Set(status.eufy?.readyNames||[]);
    return send(res,200,{scanning:false,transport:"oracle",devices:targetNames.slice(1).map((name,i)=>({name,address:"",rssi:0,model:i<2?"E120":"E22",connected:ready.has(name)}))});
  }
  if(method==="POST"&&path==="/api/ble/target"){
    const value=Number((await input(req)).target);
    put("target",Number.isInteger(value)&&value>=0&&value<=4?value:0);
    return send(res,200,await state());
  }
  if(method==="GET"&&path==="/api/backup/status")return send(res,200,{hasBackup:!!meta("backup"),lastBackup:meta("backup_time",0),lastOk:!!meta("backup"),mode:"complete"});
  if(method==="POST"&&path==="/api/backup/manual"){
    const oracle=(await upstream("/api/backup/export")).backup;
    const backup={schema:2,createdAt:Math.floor(Date.now()/1000),app:{},schedule:{},oracle,web2:{presets:meta("presets",[]),
      customSchedules:meta("custom_schedules",[]),palette:meta("palette",{}),eventOverrides:meta("event_overrides",{}),target:meta("target",0)}};
    put("backup",backup);put("backup_time",backup.createdAt);
    return send(res,200,{ok:true,lastBackup:backup.createdAt,mode:"complete-web2",oracleIncluded:true});
  }
  if(method==="GET"&&path==="/api/backup/export-portable"){
    const backup=meta("backup");if(!backup)throw fail(404,"Create a backup first");
    return send(res,200,{ok:true,backup,portable:true,containsCredentials:false});
  }
  if(method==="POST"&&(path==="/api/backup/import-portable"||path==="/api/backup/restore")){
    const backup=path.endsWith("import-portable")?(await input(req)).backup:meta("backup");
    if(!backup||backup.schema!==2||!backup.oracle)throw fail(400,"Invalid full backup");
    // A restore may change the active lights; this is performed only from an explicit user action.
    await upstream("/api/backup/restore","POST",{backup:backup.oracle});
    if(backup.web2){
      put("presets",backup.web2.presets||[]);put("custom_schedules",backup.web2.customSchedules||[]);
      put("palette",backup.web2.palette||{});put("event_overrides",backup.web2.eventOverrides||{});put("target",backup.web2.target||0);
    }else if(backup.app&&typeof backup.app==="object"){
      // Portable backups from Jason Home 1 store typed Android preferences.
      const pref=k=>backup.app[k]?.v;
      const parseList=k=>{try{const v=pref(k);return Array.isArray(v)?v:JSON.parse(v||"[]");}catch{return [];}};
      const presets=parseList("presets"),schedules=parseList("custom_schedules"),palette={},overrides={};
      for(let i=0;i<catalog.palette.length;i++)if(typeof pref("color_"+i)==="string")palette[i]=hex(pref("color_"+i));
      for(const e of catalog.events){const prefix="event_"+e.id+"_",o={};
        for(const key of ["effect","speed","enabled","favorite"])if(pref(prefix+key)!==undefined)o[key]=pref(prefix+key);
        if(pref(prefix+"colors")!==undefined){try{o.colors=colorInts(JSON.parse(pref(prefix+"colors")));}catch{}}
        if(Object.keys(o).length)overrides[e.id]=o;
      }
      put("presets",presets);put("custom_schedules",schedules);put("palette",palette);put("event_overrides",overrides);
      if(Number.isInteger(Number(pref("target"))))put("target",clamp(pref("target"),0,4));
    }
    put("backup",backup);put("backup_time",Math.floor(Date.now()/1000));
    return send(res,200,{ok:true,restoredAt:Math.floor(Date.now()/1000),oracleRestored:true});
  }
  const proxyPaths=new Set(["/api/status","/api/devices","/api/schedules","/api/reconcile","/api/reconnect"]);
  if(proxyPaths.has(path)||path.startsWith("/api/eufy/factory-")){
    const value=method==="GET"?undefined:await input(req);
    return send(res,200,await upstream(path+url.search,method,value));
  }
  throw fail(404,"Unknown API route: "+path);
}
http.createServer((req,res)=>route(req,res).catch(e=>{
  const status=Number(e.status)||(e.name==="AbortError"?504:502);
  if(status>=500)console.error("[Jason Home 2]",req.method,req.url,e.message);
  send(res,status,{ok:false,error:e.message||"Request failed"});
})).listen(port,"0.0.0.0",()=>console.log("Jason Home 2 web on port "+port));
