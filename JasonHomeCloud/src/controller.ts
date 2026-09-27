import type { Env, ScheduleRow, Scene } from "./types";
import { EufyClient, type EufySession } from "./eufy/client";
import { astronomy, nextScheduleEvent, resolveScheduleState } from "./scheduler";

const DEFAULT_SCENE:Scene={power:true,brightness:75,effect:"Solid / Static",colors:[0xffffff],speed:3};
const DEVICE_MODELS:Record<string,string>={Pool:"E120",House:"E120",Garage:"E22",Shed:"E22"};
const DEVICE_NAMES=["Pool","House","Garage","Shed"];
function json(v:unknown,status=200){return new Response(JSON.stringify(v),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
function clamp(v:number,a:number,b:number){return Math.max(a,Math.min(b,v));}
function parseColor(v:any):number|null{if(typeof v==="number"&&Number.isFinite(v))return v&0xffffff;if(typeof v==="string"&&/^#?[0-9a-fA-F]{6}$/.test(v))return parseInt(v.replace("#",""),16);return null;}
function safeScene(input:any,base:Scene=DEFAULT_SCENE):Scene{
  const colors=Array.isArray(input?.colors)?input.colors.map(parseColor).filter((x:any)=>x!=null).slice(0,8) as number[]:base.colors;
  return {power:input?.power==null?base.power:!!input.power,brightness:clamp(Number(input?.brightness??base.brightness)||base.brightness,1,100),effect:String(input?.effect||base.effect).slice(0,64),colors:colors.length?colors:base.colors,speed:clamp(Number(input?.speed??base.speed)||base.speed,1,5)};
}
function sceneKey(scene:Scene){return JSON.stringify({power:!!scene.power,brightness:scene.brightness,effect:scene.effect,colors:scene.colors,speed:scene.speed});}
function offScene():Scene{return {power:false,brightness:DEFAULT_SCENE.brightness,effect:DEFAULT_SCENE.effect,colors:[...DEFAULT_SCENE.colors],speed:DEFAULT_SCENE.speed};}

export class JasonHomeController {
  private sql:any;private eufy:EufyClient|null=null;private eufyReady=false;private eufyStatus="Not connected";
  constructor(private state:any,private env:Env){this.sql=state.storage.sql;state.blockConcurrencyWhile(async()=>this.init());}
  private async init(){
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS devices (name TEXT PRIMARY KEY, model TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, last_ok INTEGER, last_error TEXT);
      CREATE TABLE IF NOT EXISTS desired_state (name TEXT PRIMARY KEY, scene TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, days TEXT NOT NULL DEFAULT '*', start_kind TEXT NOT NULL DEFAULT 'clock', start_value TEXT NOT NULL DEFAULT '18:00', end_kind TEXT NOT NULL DEFAULT 'clock', end_value TEXT NOT NULL DEFAULT '23:00', target TEXT NOT NULL DEFAULT 'All', effect TEXT NOT NULL DEFAULT 'Solid / Static', colors TEXT NOT NULL DEFAULT '[16777215]', brightness INTEGER NOT NULL DEFAULT 75, speed INTEGER NOT NULL DEFAULT 3, priority INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS command_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, target TEXT NOT NULL, action TEXT NOT NULL, ok INTEGER NOT NULL, detail TEXT);`);
    for(const [name,model] of Object.entries(DEVICE_MODELS))this.sql.exec("INSERT OR IGNORE INTO devices(name,model,enabled) VALUES(?,?,1)",name,model);
    if(!this.meta("install_id"))this.setMeta("install_id",crypto.randomUUID().replaceAll("-",""));
    const rows=this.scheduleRows(),last=Date.parse(this.meta("last_reconcile")||"");
    if(rows.length&&(!Number.isFinite(last)||Date.now()-last>300000)){
      await this.state.storage.setAlarm(Date.now()+1000);
      this.setMeta("next_alarm",String(Date.now()+1000));
    }else await this.scheduleNextAlarm();
  }
  private meta(key:string):string|null{const rows=Array.from(this.sql.exec("SELECT value FROM meta WHERE key=?",key)) as any[];return rows[0]?.value??null;}
  private setMeta(key:string,value:string){this.sql.exec("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",key,value);}
  private delMeta(key:string){this.sql.exec("DELETE FROM meta WHERE key=?",key);}
  private scheduleRows():ScheduleRow[]{return Array.from(this.sql.exec("SELECT * FROM schedules WHERE enabled=1 ORDER BY priority DESC,name ASC")) as ScheduleRow[];}
  private geo(){const lat=Number(this.env.HOME_LAT??"42.0529"),lon=Number(this.env.HOME_LON??"-79.0576"),tz=this.env.HOME_TZ||"America/New_York";return {lat,lon,tz};}

  async fetch(request:Request):Promise<Response>{
    const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
    try{
      if(method==="GET"&&path==="/api/status")return json(await this.status(url.searchParams.get("refresh")==="1"));
      if(method==="GET"&&path==="/api/devices")return json({ok:true,devices:this.deviceStatus()});
      if(method==="GET"&&path==="/api/schedules")return json({ok:true,schedules:Array.from(this.sql.exec("SELECT * FROM schedules ORDER BY name ASC"))});
      if(method==="POST"&&path==="/api/schedules")return json(await this.saveSchedule(await request.json()));
      if(method==="DELETE"&&path==="/api/schedules")return json(await this.deleteSchedule(url.searchParams.get("id")||""));
      if(method==="GET"&&path==="/api/events")return json({ok:true,events:Array.from(this.sql.exec("SELECT * FROM schedules WHERE enabled=1 ORDER BY priority DESC,name ASC"))});
      if(method==="POST"&&path==="/api/control")return json(await this.control(await request.json()));
      if(method==="POST"&&(path==="/api/resume-schedule"||path==="/api/resume")){this.delMeta("override");await this.reconcile(true,true);return json({ok:true,resumed:true});}
      if(method==="POST"&&path==="/api/reconcile"){await this.reconcile(false,true);return json({ok:true});}
      if(method==="POST"&&path==="/api/reconnect"){this.eufy=null;this.eufyReady=false;await this.ensureEufy(true);return json({ok:true,eufy:this.eufyStatus});}
      if(method==="POST"&&path==="/api/provision-device"){
        const input:any=await request.json().catch(()=>({})),installId=String(input?.installId||"").trim().toLowerCase();
        if(!/^[0-9a-f]{32}$/.test(installId))throw new Error("Android install identity must be 32 hexadecimal characters");
        const changed=this.meta("install_id")!==installId;
        if(changed){
          this.setMeta("install_id",installId);this.delMeta("eufy_session");
          this.eufy=null;this.eufyReady=false;this.eufyStatus="Android identity synchronized";
        }
        await this.ensureEufy(changed);
        return json({ok:true,changed,eufy:this.eufyStatus,readyNames:this.eufy?.readyNames()||[]});
      }
      if(method==="POST"&&path==="/api/mqtt-probe"){
        const input:any=await request.json().catch(()=>({})),target=String(input?.target||"Pool");
        if(!DEVICE_NAMES.includes(target))throw new Error("Probe target must be Pool, House, Garage, or Shed");
        const eufy=await this.ensureEufy(false),result=await eufy.status(target);
        return json({ok:true,target,published:result.published,report:result.report||null});
      }
      return json({ok:false,error:"Not found",path},404);
    }catch(e:any){this.eufyStatus=e?.message||String(e);return json({ok:false,error:this.eufyStatus},500);}
  }
  async alarm(){await this.reconcile(false,false);}
  private async status(refresh:boolean){
    if(refresh){try{await this.ensureEufy(false);}catch(e:any){this.eufyStatus=e?.message||String(e);}}
    const {lat,lon,tz}=this.geo(),astro=astronomy(new Date(),lat,lon,tz),next=nextScheduleEvent(this.scheduleRows(),new Date(),lat,lon,tz);
    const overrideRaw=this.meta("override");let override:any=null;try{override=overrideRaw?JSON.parse(overrideRaw):null;}catch{}
    return {ok:true,controller:"Online",architecture:"Cloudflare Worker + Durable Object",eufy:{ready:this.eufyReady,status:this.eufyStatus,readyNames:this.eufy?.readyNames()||[]},devices:this.deviceStatus(),override,astronomy:{dawn:astro.dawnLabel,dusk:astro.duskLabel,timeZone:tz},nextEvent:next?{at:new Date(next.at).toISOString(),name:next.row.name,phase:next.phase,target:next.row.target}:null,lastCommand:this.meta("last_command"),desired:Array.from(this.sql.exec("SELECT * FROM desired_state ORDER BY name"))};
  }
  private deviceStatus(){return (Array.from(this.sql.exec("SELECT name,model,enabled,last_ok,last_error FROM devices ORDER BY CASE name WHEN 'Pool' THEN 1 WHEN 'House' THEN 2 WHEN 'Garage' THEN 3 ELSE 4 END")) as any[]).map(d=>({...d,ready:this.eufyReady&&!!this.eufy?.readyNames().includes(d.name)}));}
  private async ensureEufy(force:boolean){
    if(this.eufyReady&&!force&&this.eufy)return this.eufy;
    const install=this.meta("install_id")!;let session:EufySession|undefined;const raw=this.meta("eufy_session");if(raw){try{session=JSON.parse(raw);}catch{}}
    let client=new EufyClient(install,session);
    try{
      if(!client.authed){if(!this.env.EUFY_EMAIL||!this.env.EUFY_PASSWORD)throw new Error("Cloudflare Eufy secrets are not configured");await client.login(this.env.EUFY_EMAIL,this.env.EUFY_PASSWORD);}
      await client.prepare();
    }catch(first:any){
      if(session&&this.env.EUFY_EMAIL&&this.env.EUFY_PASSWORD){this.delMeta("eufy_session");client=new EufyClient(install);await client.login(this.env.EUFY_EMAIL,this.env.EUFY_PASSWORD);await client.prepare();}else throw first;
    }
    this.eufy=client;this.eufyReady=true;this.eufyStatus=`Ready ${client.readyNames().length}/4`;this.setMeta("eufy_session",JSON.stringify(client.exportSession()));return client;
  }
  private targetNames(target:string){if(!target||target.toLowerCase()==="all")return ["Pool","House","Garage","Shed"];if(!(target in DEVICE_MODELS))throw new Error(`Unknown target ${target}`);return [target];}
  private async control(input:any){
    const target=String(input?.target||"All"),names=this.targetNames(target),scene=safeScene(input),eufy=await this.ensureEufy(false);
    const results=await Promise.allSettled(names.map(async name=>{
      const r=input?.power===false?await eufy.power(name,false):await eufy.scene(name,scene.effect,scene.colors,scene.speed,scene.brightness);
      this.sql.exec("UPDATE devices SET last_ok=?,last_error=NULL WHERE name=?",Date.now(),name);
      this.sql.exec("INSERT INTO desired_state(name,scene,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET scene=excluded.scene,updated_at=excluded.updated_at",name,JSON.stringify(scene),Date.now());
      return {name,...r};
    }));
    let ok=0;const detail:any[]=[];results.forEach((r,i)=>{if(r.status==="fulfilled"){ok++;detail.push({name:names[i],ok:true,report:r.value.report||null});}else{const msg=(r.reason as any)?.message||String(r.reason);detail.push({name:names[i],ok:false,error:msg});this.sql.exec("UPDATE devices SET last_error=? WHERE name=?",msg,names[i]);}});
    const next=nextScheduleEvent(this.scheduleRows(),new Date(),this.geo().lat,this.geo().lon,this.geo().tz),override={active:true,target,scene,createdAt:Date.now(),expiresAt:next?.at||null};this.setMeta("override",JSON.stringify(override));
    const summary={at:new Date().toISOString(),target,ok,total:names.length,scene,detail};this.setMeta("last_command",JSON.stringify(summary));this.sql.exec("INSERT INTO command_log(at,target,action,ok,detail) VALUES(?,?,?,?,?)",Date.now(),target,"manual",ok===names.length?1:0,JSON.stringify(detail));await this.scheduleNextAlarm();
    if(ok===0)throw new Error(detail.map(x=>x.error).filter(Boolean).join("; ")||"No light command completed");return {ok:true,updated:ok,total:names.length,detail,override};
  }
  private async saveSchedule(input:any){
    const id=String(input?.id||crypto.randomUUID()),name=String(input?.name||"Schedule").slice(0,80),enabled=input?.enabled===false?0:1,days=String(input?.days||"*").slice(0,64),startKind=["clock","dawn","dusk"].includes(input?.startKind)?input.startKind:"clock",endKind=["clock","dawn","dusk"].includes(input?.endKind)?input.endKind:"clock",startValue=String(input?.startValue||"18:00"),endValue=String(input?.endValue||"23:00"),target=String(input?.target||"All"),scene=safeScene(input),priority=clamp(Number(input?.priority||0),-100,100);
    this.targetNames(target);
    this.sql.exec(`INSERT INTO schedules(id,name,enabled,days,start_kind,start_value,end_kind,end_value,target,effect,colors,brightness,speed,priority) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,days=excluded.days,start_kind=excluded.start_kind,start_value=excluded.start_value,end_kind=excluded.end_kind,end_value=excluded.end_value,target=excluded.target,effect=excluded.effect,colors=excluded.colors,brightness=excluded.brightness,speed=excluded.speed,priority=excluded.priority`,id,name,enabled,days,startKind,startValue,endKind,endValue,target,scene.effect,JSON.stringify(scene.colors),scene.brightness,scene.speed,priority);
    await this.scheduleNextAlarm();
    if(typeof this.state.waitUntil==="function")this.state.waitUntil(this.reconcile(false,true).catch((e:any)=>{this.eufyStatus=e?.message||String(e);}));
    return {ok:true,id};
  }
  private async deleteSchedule(id:string){
    if(!id)throw new Error("Schedule id required");this.sql.exec("DELETE FROM schedules WHERE id=?",id);await this.scheduleNextAlarm();
    if(typeof this.state.waitUntil==="function")this.state.waitUntil(this.reconcile(false,true).catch((e:any)=>{this.eufyStatus=e?.message||String(e);}));
    return {ok:true};
  }
  private async scheduleNextAlarm(){
    const {lat,lon,tz}=this.geo(),next=nextScheduleEvent(this.scheduleRows(),new Date(),lat,lon,tz);const raw=this.meta("override");let exp:number|null=null;
    try{const o=raw?JSON.parse(raw):null;if(o?.active&&o.expiresAt)exp=Number(o.expiresAt)||null;}catch{}
    let at=next?.at||null;if(exp&&exp>Date.now()&&(!at||exp<at))at=exp;
    if(at){await this.state.storage.setAlarm(at);this.setMeta("next_alarm",String(at));}
    else{await this.state.storage.deleteAlarm();this.setMeta("next_alarm","");}
  }
  private storedScene(name:string):Scene|null{
    const rows=Array.from(this.sql.exec("SELECT scene FROM desired_state WHERE name=?",name)) as any[];
    try{return rows[0]?.scene?JSON.parse(rows[0].scene):null;}catch{return null;}
  }
  private async applyScheduled(name:string,scene:Scene,eufy:EufyClient,reason:string){
    if(scene.power)await eufy.scene(name,scene.effect,scene.colors,scene.speed,scene.brightness);else await eufy.power(name,false);
    const now=Date.now();this.sql.exec("UPDATE devices SET last_ok=?,last_error=NULL WHERE name=?",now,name);
    this.sql.exec("INSERT INTO desired_state(name,scene,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET scene=excluded.scene,updated_at=excluded.updated_at",name,sceneKey(scene),now);
    this.sql.exec("INSERT INTO command_log(at,target,action,ok,detail) VALUES(?,?,?,?,?)",now,name,"schedule",1,reason);
  }
  private async reconcile(ignoreOverride:boolean,forceSend:boolean){
    const now=Date.now(),rows=this.scheduleRows(),{lat,lon,tz}=this.geo();
    let override:any=null;const raw=this.meta("override");
    if(raw){try{override=JSON.parse(raw);}catch{this.delMeta("override");}}
    if(override?.active&&override.expiresAt&&Number(override.expiresAt)<=now){this.delMeta("override");override=null;}
    const skipped=new Set<string>();
    if(!ignoreOverride&&override?.active){
      for(const name of this.targetNames(String(override.target||"All")))skipped.add(name);
    }
    if(rows.length){
      const resolved=resolveScheduleState(rows,new Date(now),lat,lon,tz,DEVICE_NAMES),changes:{name:string;scene:Scene;reason:string}[]=[];
      for(const name of DEVICE_NAMES){
        if(skipped.has(name))continue;
        const active=resolved[name],scene=active?active.scene:offScene(),stored=this.storedScene(name);
        if(forceSend||!stored||sceneKey(stored)!==sceneKey(scene)){
          changes.push({name,scene,reason:active?`${active.row.name} • active ${new Date(active.start).toISOString()}–${new Date(active.end).toISOString()}`:"No active schedule"});
        }
      }
      if(changes.length){
        const eufy=await this.ensureEufy(false);
        const results=await Promise.allSettled(changes.map(c=>this.applyScheduled(c.name,c.scene,eufy,c.reason)));
        const errors:string[]=[];results.forEach((r,i)=>{if(r.status==="rejected"){const msg=(r.reason as any)?.message||String(r.reason);errors.push(`${changes[i].name}: ${msg}`);this.sql.exec("UPDATE devices SET last_error=? WHERE name=?",msg,changes[i].name);}});
        this.setMeta("last_command",JSON.stringify({at:new Date().toISOString(),action:"reconcile",sent:changes.length,errors}));
        if(errors.length===changes.length)throw new Error(errors.join("; "));
      }
    }
    this.setMeta("last_reconcile",new Date().toISOString());await this.scheduleNextAlarm();
  }
}
