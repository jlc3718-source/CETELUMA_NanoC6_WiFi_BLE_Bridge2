import { canonicalEffect } from "./effects.js";
import { astronomy, localParts, localToUtcMs } from "./scheduler.js";
import type { Scene } from "./types.js";

export interface CalendarEvent {
  id:string; name:string; kind:string; rule:string;
  month:number; day:number; weekday:number; nth:number; offsetDays:number; durationDays:number;
  effect:string; speed:number; colors:number[]; enabled:boolean; favorite?:boolean; brightness?:number;
  categoryIndex:number; major:boolean; dateRuleSourceId?:string;
  creativePhases?:Array<{effect:string;speed:number;minutes:number;shift?:number}>;
  aiOneTime?:boolean; expiresAt?:string; aiReplaceEventId?:string;
}
export interface SpecialDate { id:string; year:number; month:number; day:number; }
export interface CustomCalendarItem {
  id:string; name:string; enabled:boolean; annual:boolean; year:number; month:number; day:number;
  effect:string; speed:number; brightness:number; colors:number[];
}
export interface CalendarSettings {
  enabled:boolean; mode:number; lead:number; trail:number; on:number; off:number;
  startAtDusk:boolean; schedule2Enabled:boolean; schedule2EndAtDawn:boolean;
  schedule2End:number; schedule2Brightness:number; overlap:number; categoryMask:number;
  whiteOverride1Enabled:boolean; whiteOverride2Enabled:boolean;
}
export interface CalendarConfig {
  version?:number;
  revision?:number;
  syncedAt?:number;
  settings:CalendarSettings;
  events:CalendarEvent[];
  special:SpecialDate[];
  customSchedules:CustomCalendarItem[];
}
export interface CalendarResolution {
  scene:Scene;
  id:string;
  name:string;
  schedule2:boolean;
}

type Ymd={year:number;month:number;day:number};

function clamp(v:number,a:number,b:number){return Math.max(a,Math.min(b,v));}
function finiteOr(v:any,fallback:number){const n=Number(v);return Number.isFinite(n)?n:fallback;}
function colorValue(v:any){
  if(typeof v==="number"&&Number.isFinite(v))return v&0xffffff;
  if(typeof v==="string"){
    const t=v.trim().replace(/^#/,"");
    if(/^[0-9a-fA-F]{6}$/.test(t))return parseInt(t,16)&0xffffff;
    const n=Number(v);if(Number.isFinite(n))return n&0xffffff;
  }
  return 0xffffff;
}
function ymdMs(d:Ymd){return Date.UTC(d.year,d.month-1,d.day);}
function fromMs(ms:number):Ymd{const d=new Date(ms);return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()};}
function addDays(d:Ymd,n:number):Ymd{return fromMs(ymdMs(d)+n*86400000);}
function cmp(a:Ymd,b:Ymd){return ymdMs(a)-ymdMs(b);}
function sameDay(a:Ymd,b:Ymd){return a.year===b.year&&a.month===b.month&&a.day===b.day;}
function monthDays(y:number,m:number){return new Date(Date.UTC(y,m,0)).getUTCDate();}
function weekday(d:Ymd){return new Date(ymdMs(d)).getUTCDay();}
function localYmd(date:Date,tz:string):Ymd{const p=localParts(date,tz);return {year:p.year,month:p.month,day:p.day};}

function easter(year:number):Ymd{
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
  return {year,month,day};
}
function startDate(e:CalendarEvent,year:number,special:SpecialDate[]):Ymd|null{
  try{
    let d:Ymd|null=null;
    switch(e.rule){
      case "Fixed": d={year,month:e.month,day:e.day}; break;
      case "Month": d={year,month:e.month,day:1}; break;
      case "NthWeekday":{
        const first={year,month:e.month,day:1};
        const delta=(e.weekday-weekday(first)+7)%7;
        d=addDays(first,delta+(Math.max(1,e.nth)-1)*7);
        if(d.month!==e.month)return null;
        break;
      }
      case "LastWeekday":{
        const last={year,month:e.month,day:monthDays(year,e.month)};
        const delta=(weekday(last)-e.weekday+7)%7;
        d=addDays(last,-delta);
        break;
      }
      case "EasterOffset": return addDays(easter(year),e.offsetDays||0);
      case "MonthEnd": d={year,month:e.month,day:monthDays(year,e.month)}; break;
      case "YearTable":
      case "Hanukkah":{
        const sourceId=e.dateRuleSourceId||e.id;
        const hit=special.find(x=>x.id===sourceId&&x.year===year);
        return hit?{year:hit.year,month:hit.month,day:hit.day}:null;
      }
      default:return null;
    }
    return e.offsetDays?addDays(d,e.offsetDays):d;
  }catch{return null;}
}
function included(cfg:CalendarConfig,e:CalendarEvent){
  if(!e.enabled)return false;
  // Explicit one-night AI designs are user-approved overrides for that date,
  // so category/theme filters must not suppress them.
  if(String(e.id||"").startsWith("ai-one:"))return true;
  const mask=Number(cfg.settings.categoryMask??32767);
  if(e.categoryIndex>=0&&e.categoryIndex<31&&((mask&(1<<e.categoryIndex))===0))return false;
  return Number(cfg.settings.mode||0)!==0||!!e.major;
}
function activeOn(cfg:CalendarConfig,e:CalendarEvent,day:Ymd){
  if(e.rule==="Month")return day.month===e.month;
  for(let y=day.year-1;y<=day.year;y++){
    const s=startDate(e,y,cfg.special||[]);if(!s)continue;
    const end=addDays(s,Math.max(1,e.durationDays||1)-1);
    if(cmp(day,s)>=0&&cmp(day,end)<=0)return true;
  }
  return false;
}
function windowActive(cfg:CalendarConfig,e:CalendarEvent,day:Ymd,lead:number,trail:number){
  for(let y=day.year-1;y<=day.year+1;y++){
    const s=startDate(e,y,cfg.special||[]);if(!s)continue;
    const a=addDays(s,-lead),b=addDays(s,Math.max(1,e.durationDays||1)-1+trail);
    if(cmp(day,a)>=0&&cmp(day,b)<=0)return true;
  }
  return false;
}
function inWindow(minute:number,start:number,end:number){
  return start<end?(minute>=start&&minute<end):(minute>=start||minute<end);
}
function span(start:number,end:number){let v=end-start;if(v<=0)v+=1440;return Math.max(1,v);}
function elapsed(minute:number,start:number,total:number){let v=minute-start;if(v<0)v+=1440;if(v>=total)v=total-1;return Math.max(0,v);}
function pick<T>(items:T[],pos:number,total:number):T{
  if(items.length===1)return items[0];
  pos=clamp(pos,0,Math.max(0,total-1));
  return items[Math.min(items.length-1,Math.floor((pos*items.length)/Math.max(1,total)))];
}
type CreativePhase={effect:string;speed:number;minutes:number;shift?:number};

function rotatePalette(colors:number[],shift=0){
  const out=colors.length?colors.slice(0,8):[0xffffff];
  if(out.length<2)return out;
  const n=((Math.trunc(shift)%out.length)+out.length)%out.length;
  return n?[...out.slice(n),...out.slice(0,n)]:out;
}
function phase(effect:string,speed:number,minutes:number,shift=0):CreativePhase{
  return {effect:canonicalEffect(effect),speed:clamp(Math.round(speed)||1,1,5),minutes:Math.max(2,Math.round(minutes)||8),shift};
}
function creativeProgram(e:CalendarEvent):CreativePhase[]{
  if(Array.isArray(e.creativePhases)&&e.creativePhases.length){
    return e.creativePhases.slice(0,8).map(p=>phase(p.effect,p.speed,p.minutes,p.shift||0));
  }
  const name=String(e.name||"").toLowerCase(),base=canonicalEffect(e.effect),baseSpeed=clamp(Number(e.speed)||2,1,5);
  const factory=String(e.id||"").includes("::factory:");
  const solemn=/(remembrance|memorial|holocaust|pow\/mia|yom kippur|good friday|ash wednesday|gold star|pearl harbor|transgender day of remembrance)/.test(name);
  const patriotic=/(independence|flag day|veterans|armed forces|patriot day|constitution|freedom day|presidents|memorial day|d-day|korean war|purple heart)/.test(name);
  const rainbow=/(pride|lgbtq|coming out|homophobia|transphobia)/.test(name);
  const winter=/(christmas|hanukkah|kwanzaa|winter solstice)/.test(name);
  const carnival=/(mardi gras|cinco de mayo|diwali|lunar new year|st\. patrick|easter|new year)/.test(name);
  const family=/(valentine|mother.?s day|father.?s day|parents.? day|grandparents)/.test(name);

  // Promoted Factory events become reliable multi-phase 0x0206 shows instead of
  // falling back to the old multi-layer 0x020D recipe.
  if(factory){
    const opposite=base==="Flow2"?"Flow1":"Flow2";
    const accent=base==="Twinkle"?"Breathe":base==="Breathe"?"Twinkle":"Breathe";
    return [phase(base,Math.min(baseSpeed,4),10,0),phase(accent,Math.min(baseSpeed,2),8,1),phase(opposite,Math.min(baseSpeed,3),12,-1)];
  }

  // Hand-authored feature programs. Every phase reuses only the event palette.
  if(/new year.?s eve/.test(name))return [phase("Streamlight",4,7),phase("Twinkle",5,7,1),phase("Cycle",3,8,2),phase("Flow2",3,8,-1)];
  if(/new year.?s day/.test(name))return [phase("Flow1",3,8),phase("Twinkle",3,7,1),phase("Breathe",1,7),phase("Flow2",3,8,-1)];
  if(/halloween/.test(name))return [phase("Streamlight",3,8),phase("Twinkle",3,7,1),phase("Breathe",2,7,2),phase("Flow2",3,8,-1)];
  if(/christmas day/.test(name))return [phase("Flow1",2,8),phase("Breathe",1,7,1),phase("Twinkle",2,7,2),phase("Flow2",2,8,-1)];
  if(/christmas eve/.test(name))return [phase("Breathe",1,9),phase("Flow1",2,8,1),phase("Twinkle",1,6,2),phase("Flow2",2,7,-1)];
  if(/independence day/.test(name))return [phase("Flow1",3,8),phase("Cycle",3,7,1),phase("Twinkle",4,7,2),phase("Flow2",3,8,-1)];
  if(/mardi gras/.test(name))return [phase("Flow1",3,7),phase("Twinkle",3,8,1),phase("Streamlight",3,7,2),phase("Flow2",3,8,-1)];
  if(/diwali/.test(name))return [phase("Breathe",1,7),phase("Twinkle",3,8,1),phase("Streamlight",3,7,2),phase("Flow1",2,8,-1)];
  if(/lunar new year/.test(name))return [phase("Streamlight",3,8),phase("Flow1",3,7,1),phase("Twinkle",2,7),phase("Flow2",3,8,-1)];
  if(/valentine/.test(name))return [phase("Breathe",1,9),phase("Flow1",2,7,1),phase("Twinkle",1,6,2),phase("Flow2",2,8,-1)];

  if(solemn)return [phase("Static",1,15),phase("Breathe",1,15,1)];
  if(patriotic)return [phase("Flow1",2,10),phase("Breathe",1,8,1),phase("Flow2",2,12,-1)];
  if(rainbow)return [phase("Flow1",3,8),phase("Flow2",3,8,1),phase("Breathe",1,7,2),phase("Streamlight",2,7,-1)];
  if(winter)return [phase(base,Math.min(baseSpeed,2),10),phase("Twinkle",1,8,1),phase("Breathe",1,12,-1)];
  if(carnival)return [phase(base,Math.min(baseSpeed,3),9),phase("Twinkle",2,7,1),phase("Flow2",2,7,-1),phase("Breathe",1,7,2)];
  if(family)return [phase("Breathe",1,12),phase("Flow1",2,9,1),phase("Twinkle",1,9,-1)];

  if(e.rule==="Month"){
    if((e.colors||[]).length>=3)return [phase(base,Math.min(baseSpeed,2),12),phase("Breathe",1,8,1),phase("Flow2",2,10,-1)];
    return [phase("Breathe",1,18),phase(base,Math.min(baseSpeed,2),12,1)];
  }
  if(e.kind==="Seasonal")return [phase(base,Math.min(baseSpeed,2),12),phase("Streamlight",2,8,1),phase("Breathe",1,10,-1)];
  if(e.kind==="Holiday"&&(e.colors||[]).length>=2)return [phase(base,Math.min(baseSpeed,3),12),phase("Twinkle",1,7,1),phase("Flow2",2,11,-1)];
  if((e.colors||[]).length>=2)return [phase(base,Math.min(baseSpeed,2),18),phase("Breathe",1,12,1)];
  return [phase(base,Math.min(baseSpeed,2),30)];
}
function sceneFor(e:CalendarEvent,brightness:number,showPosition=0):Scene{
  const colors=Array.isArray(e.colors)&&e.colors.length?e.colors.slice(0,8).map(x=>Number(x)&0xffffff):[0xffffff];
  const program=creativeProgram(e),cycle=program.reduce((n,p)=>n+p.minutes,0),at=((Math.floor(showPosition)%cycle)+cycle)%cycle;
  let cursor=0,chosen=program[0];
  for(const p of program){cursor+=p.minutes;if(at<cursor){chosen=p;break;}}
  const eventBrightness=Number(e.brightness);
  const level=brightness<100?brightness:(Number.isFinite(eventBrightness)&&eventBrightness>0?eventBrightness:brightness);
  return {
    power:true,
    brightness:clamp(level,1,100),
    effect:chosen.effect,
    colors:rotatePalette(colors,chosen.shift||0),
    speed:chosen.speed
  };
}
type CalendarCandidate={id:string;name:string;scene:Scene};

function customCandidates(cfg:CalendarConfig,day:Ymd,schedule2:boolean,schedule2Brightness:number):CalendarCandidate[]{
  const out:CalendarCandidate[]=[];
  for(const x of cfg.customSchedules||[]){
    if(x.enabled===false)continue;
    if(Number(x.month)!==day.month||Number(x.day)!==day.day)continue;
    if(!x.annual&&Number(x.year)!==day.year)continue;
    out.push({
      id:x.id||"",
      name:x.name||"Custom Light",
      scene:{
        power:true,
        brightness:schedule2?clamp(schedule2Brightness,1,100):clamp(Number(x.brightness)||100,1,100),
        effect:x.effect||"Solid / Static",
        colors:Array.isArray(x.colors)&&x.colors.length?x.colors.slice(0,8).map(v=>Number(v)&0xffffff):[0xffffff],
        speed:clamp(Number(x.speed)||3,1,10)
      }
    });
  }
  return out;
}
function combineCandidates(items:CalendarCandidate[],brightness:number,schedule2:boolean):CalendarResolution{
  const colors:number[]=[];
  for(const item of items){
    for(const c of item.scene.colors||[]){
      const v=Number(c)&0xffffff;
      if(colors.length<8&&!colors.includes(v))colors.push(v);
    }
    if(colors.length>=8)break;
  }
  const names=items.map(x=>x.name).filter(Boolean);
  return {
    id:"overlap:"+items.map(x=>x.id).join("+"),
    name:names.length<=3?names.join(" + "):`${names.length} overlapping events`,
    schedule2,
    scene:{power:true,brightness:clamp(brightness,1,100),effect:"Cycle",colors:colors.length?colors:[0xffffff],speed:1}
  };
}
function resolveFor(cfg:CalendarConfig,day:Ymd,minute:number,start:number,end:number,schedule2:boolean,brightness:number,programMinute=minute):CalendarResolution|null{
  const total=span(start,end),pos=elapsed(minute,start,total);
  let showPosition=programMinute-start;if(showPosition<0)showPosition+=1440;
  const candidates:CalendarCandidate[]=customCandidates(cfg,day,schedule2,brightness);
  const lead=clamp(Number(cfg.settings.lead)||0,0,14),trail=clamp(Number(cfg.settings.trail)||0,0,14);
  const activeAi=(cfg.events||[]).filter(e=>e.aiOneTime&&included(cfg,e)&&activeOn(cfg,e,day));
  const replaced=new Set(activeAi.map(e=>String(e.aiReplaceEventId||"")).filter(Boolean));
  for(const e of cfg.events||[]){
    if(!included(cfg,e))continue;
    if(!e.aiOneTime&&(replaced.has(e.id)||replaced.has(String(e.dateRuleSourceId||""))))continue;
    const active=activeOn(cfg,e,day)||(e.kind==="Holiday"&&(lead||trail)&&windowActive(cfg,e,day,lead,trail));
    if(active)candidates.push({id:e.id,name:e.name,scene:sceneFor(e,brightness,showPosition)});
  }
  if(!candidates.length)return null;
  const wrap=(x:CalendarCandidate):CalendarResolution=>({id:x.id,name:x.name,schedule2,scene:x.scene});
  // "Apply one time" means replace the normal holiday result for this one
  // lighting night, not participate in rotate/split/combine overlap behavior.
  const aiOneTime=candidates.filter(x=>String(x.id||"").startsWith("ai-one:"));
  if(aiOneTime.length)return wrap(aiOneTime[aiOneTime.length-1]);
  if(candidates.length===1)return wrap(candidates[0]);

  const overlap=clamp(Number(cfg.settings.overlap)||0,0,2);
  if(overlap===2)return combineCandidates(candidates,brightness,schedule2);
  if(overlap===1)return wrap(pick(candidates,pos,total));

  // Rotate nightly across every colliding item, regardless of event type.
  const ordinal=Math.floor(ymdMs(day)/86400000);
  const index=((ordinal%candidates.length)+candidates.length)%candidates.length;
  return wrap(candidates[index]);
}
function astroMinute(now:Date,lat:number,lon:number,tz:string,dawn:boolean){
  const a=astronomy(now,lat,lon,tz),ms=dawn?a.dawnMs:a.duskMs;
  if(ms==null)return dawn?360:1080;
  const p=localParts(new Date(ms),tz);return p.hour*60+p.minute;
}

export function normalizeCalendarConfig(input:any):CalendarConfig{
  const s=input?.settings||{};
  const cfg:CalendarConfig={
    version:1,
    revision:Math.max(0,Math.floor(finiteOr(input?.revision,0))),
    syncedAt:Date.now(),
    settings:{
      enabled:!!s.enabled,
      mode:clamp(finiteOr(s.mode,0),0,2),
      lead:clamp(finiteOr(s.lead,0),0,14),
      trail:clamp(finiteOr(s.trail,0),0,14),
      on:clamp(finiteOr(s.on,1020),0,1439),
      off:clamp(finiteOr(s.off,1380),0,1439),
      startAtDusk:!!s.startAtDusk,
      schedule2Enabled:s.schedule2Enabled!==false,
      schedule2EndAtDawn:s.schedule2EndAtDawn!==false,
      schedule2End:clamp(finiteOr(s.schedule2End,360),0,1439),
      schedule2Brightness:clamp(finiteOr(s.schedule2Brightness,10),1,100),
      overlap:clamp(finiteOr(s.overlap,0),0,2),
      categoryMask:clamp(finiteOr(s.categoryMask,32767),0,32767),
      whiteOverride1Enabled:s.whiteOverride1Enabled!==false,
      whiteOverride2Enabled:s.whiteOverride2Enabled!==false
    },
    events:[],
    special:[],
    customSchedules:[]
  };
  for(const raw of Array.isArray(input?.events)?input.events:[]){
    if(!raw||typeof raw.id!=="string"||!raw.id)continue;
    cfg.events.push({
      id:String(raw.id),name:String(raw.name||raw.id),kind:String(raw.kind||"Observance"),rule:String(raw.rule||"Fixed"),
      month:Number(raw.month)||0,day:Number(raw.day)||0,weekday:Number(raw.weekday)||0,nth:Number(raw.nth)||0,
      offsetDays:Number(raw.offsetDays)||0,durationDays:Math.max(1,Number(raw.durationDays)||1),
      effect:canonicalEffect(raw.effect),speed:clamp(Number(raw.speed)||3,1,10),
      colors:Array.isArray(raw.colors)?raw.colors.slice(0,8).map(colorValue):[0xffffff],
      enabled:raw.enabled!==false,favorite:!!raw.favorite,brightness:raw.brightness==null?undefined:clamp(Number(raw.brightness)||100,1,100),categoryIndex:clamp(finiteOr(raw.categoryIndex,0),0,14),major:!!raw.major,
      dateRuleSourceId:typeof raw.dateRuleSourceId==="string"&&raw.dateRuleSourceId?raw.dateRuleSourceId:undefined,
      creativePhases:Array.isArray(raw.creativePhases)?raw.creativePhases.slice(0,8).map((p:any)=>({
        effect:canonicalEffect(p?.effect),speed:clamp(Number(p?.speed)||2,1,5),minutes:clamp(Number(p?.minutes)||6,2,30),shift:Math.trunc(Number(p?.shift)||0)
      })) : undefined,
      aiOneTime:raw.aiOneTime===true,
      expiresAt:typeof raw.expiresAt==="string"&&raw.expiresAt?raw.expiresAt:undefined,
      aiReplaceEventId:typeof raw.aiReplaceEventId==="string"&&raw.aiReplaceEventId?raw.aiReplaceEventId:undefined
    });
  }
  for(const raw of Array.isArray(input?.special)?input.special:[]){
    if(raw&&typeof raw.id==="string")cfg.special.push({id:String(raw.id),year:Number(raw.year),month:Number(raw.month),day:Number(raw.day)});
  }
  for(const raw of Array.isArray(input?.customSchedules)?input.customSchedules:[]){
    if(!raw||typeof raw.id!=="string")continue;
    cfg.customSchedules.push({
      id:String(raw.id),name:String(raw.name||"Custom Light"),enabled:raw.enabled!==false,annual:raw.annual!==false,
      year:Number(raw.year)||0,month:Number(raw.month)||0,day:Number(raw.day)||0,effect:canonicalEffect(raw.effect),
      speed:clamp(Number(raw.speed)||3,1,10),brightness:clamp(Number(raw.brightness)||100,1,100),
      colors:Array.isArray(raw.colors)?raw.colors.slice(0,8).map(colorValue):[0xffffff]
    });
  }
  return cfg;
}

export function resolveCalendar(cfg:CalendarConfig|null,now:Date,lat:number,lon:number,tz:string):CalendarResolution|null{
  if(!cfg)return null;
  const lp=localParts(now,tz),day={year:lp.year,month:lp.month,day:lp.day},minute=lp.hour*60+lp.minute;
  const whiteScene:Scene={power:true,brightness:100,effect:"Static",colors:[0xffffff],speed:3};

  if(cfg.settings.whiteOverride1Enabled!==false&&minute>=21*60&&minute<22*60){
    return {id:"white-override-1",name:"White Override 1",schedule2:false,scene:whiteScene};
  }

  if(cfg.settings.whiteOverride2Enabled!==false){
    const dawn=astroMinute(now,lat,lon,tz,true),morningEnd=Math.min(dawn,7*60+30);
    if(dawn>6*60&&minute>=6*60&&minute<morningEnd){
      return {id:"white-override-2",name:"White Override 2",schedule2:false,scene:whiteScene};
    }
  }

  if(!cfg.settings.enabled||(!(cfg.events?.length)&&!(cfg.customSchedules?.length)))return null;
  const start=cfg.settings.startAtDusk?astroMinute(now,lat,lon,tz,false):cfg.settings.on;
  const end=cfg.settings.off;
  if(inWindow(minute,start,end)){
    // If Schedule 1 crosses midnight, the post-midnight portion belongs to the
    // prior evening's calendar theme. Otherwise a Dec 25 11 PM–1 AM window,
    // for example, can switch to Dec 26's event at midnight.
    let themeDay=day,themeStart=start;
    if(start>end&&minute<end){
      themeDay=addDays(day,-1);
      if(cfg.settings.startAtDusk){
        const themeNoon=new Date(localToUtcMs(themeDay.year,themeDay.month,themeDay.day,12,0,tz));
        themeStart=astroMinute(themeNoon,lat,lon,tz,false);
      }
    }
    return resolveFor(cfg,themeDay,minute,themeStart,end,false,100);
  }
  if(cfg.settings.schedule2Enabled){
    const s2end=cfg.settings.schedule2EndAtDawn?astroMinute(now,lat,lon,tz,true):cfg.settings.schedule2End;
    if(inWindow(minute,end,s2end)){
      let themeDay=day,themeStart=start;
      if(minute<start){
        themeDay=addDays(day,-1);
        const themeNoon=new Date(localToUtcMs(themeDay.year,themeDay.month,themeDay.day,12,0,tz));
        themeStart=cfg.settings.startAtDusk?astroMinute(themeNoon,lat,lon,tz,false):cfg.settings.on;
      }
      const last=(end+1439)%1440;
      return resolveFor(cfg,themeDay,last,themeStart,end,true,cfg.settings.schedule2Brightness,minute);
    }
  }
  return null;
}

function calendarResolutionKey(r:CalendarResolution|null){
  return r?JSON.stringify({id:r.id,schedule2:r.schedule2,scene:r.scene}):"off";
}
function calendarTransitionKey(r:CalendarResolution|null){
  // Internal creative-show phase changes are reconciled every 30 seconds, but
  // they are not schedule/event boundaries and should not replace the next-event UI.
  return r?JSON.stringify({id:r.id,schedule2:r.schedule2}):"off";
}
function calendarDayBounds(cfg:CalendarConfig,day:Ymd,lat:number,lon:number,tz:string){
  const noon=(d:Ymd)=>new Date(localToUtcMs(d.year,d.month,d.day,12,0,tz));
  const startMinute=cfg.settings.startAtDusk?astroMinute(noon(day),lat,lon,tz,false):cfg.settings.on;
  let start=localToUtcMs(day.year,day.month,day.day,Math.floor(startMinute/60),startMinute%60,tz);
  let end=localToUtcMs(day.year,day.month,day.day,Math.floor(cfg.settings.off/60),cfg.settings.off%60,tz);
  if(end<=start){
    const d=addDays(day,1);end=localToUtcMs(d.year,d.month,d.day,Math.floor(cfg.settings.off/60),cfg.settings.off%60,tz);
  }
  let schedule2End:number|null=null;
  if(cfg.settings.schedule2Enabled){
    if(cfg.settings.schedule2EndAtDawn){
      for(let shift=0;shift<=2;shift++){
        const d=addDays(day,shift),a=astronomy(noon(d),lat,lon,tz).dawnMs;
        if(a!=null&&a>end){schedule2End=a;break;}
      }
    }else{
      let d=day;
      schedule2End=localToUtcMs(d.year,d.month,d.day,Math.floor(cfg.settings.schedule2End/60),cfg.settings.schedule2End%60,tz);
      while(schedule2End<=end){
        d=addDays(d,1);
        schedule2End=localToUtcMs(d.year,d.month,d.day,Math.floor(cfg.settings.schedule2End/60),cfg.settings.schedule2End%60,tz);
      }
    }
  }
  const white1Start=localToUtcMs(day.year,day.month,day.day,21,0,tz);
  const white1End=localToUtcMs(day.year,day.month,day.day,22,0,tz);
  const dawnMinute=astroMinute(noon(day),lat,lon,tz,true);
  const white2Start=dawnMinute>360?localToUtcMs(day.year,day.month,day.day,6,0,tz):null;
  const white2End=dawnMinute>360
    ?localToUtcMs(day.year,day.month,day.day,Math.floor(Math.min(dawnMinute,450)/60),Math.min(dawnMinute,450)%60,tz)
    :null;
  return {start,end,schedule2End,white1Start,white1End,white2Start,white2End};
}
export function nextCalendarBoundary(cfg:CalendarConfig|null,now:Date,lat:number,lon:number,tz:string){
  if(!cfg||(!cfg.settings.enabled&&cfg.settings.whiteOverride1Enabled===false&&cfg.settings.whiteOverride2Enabled===false))return null;
  const today=localYmd(now,tz),nowMs=now.getTime(),items:Array<{at:number;phase:string}>=[];
  for(let shift=-1;shift<=3;shift++){
    const b=calendarDayBounds(cfg,addDays(today,shift),lat,lon,tz);
    if(cfg.settings.enabled){
      items.push({at:b.start,phase:"schedule1-start"},{at:b.end,phase:"schedule1-end"});
      if(b.schedule2End!=null)items.push({at:b.schedule2End,phase:"schedule2-end"});
    }
    if(cfg.settings.whiteOverride1Enabled!==false)items.push({at:b.white1Start,phase:"white-override-1-start"},{at:b.white1End,phase:"white-override-1-end"});
    if(cfg.settings.whiteOverride2Enabled!==false&&b.white2Start!=null&&b.white2End!=null){
      items.push({at:b.white2Start,phase:"white-override-2-start"},{at:b.white2End,phase:"white-override-2-end"});
    }
  }
  return items.filter(x=>x.at>nowMs+500).sort((a,b)=>a.at-b.at)[0]||null;
}
export function nextCalendarTransition(cfg:CalendarConfig|null,now:Date,lat:number,lon:number,tz:string){
  if(!cfg||(!cfg.settings.enabled&&cfg.settings.whiteOverride1Enabled===false&&cfg.settings.whiteOverride2Enabled===false))return null;
  const nowMs=now.getTime(),today=localYmd(now,tz);
  const boundaries:Array<{at:number;phase:string}>=[];
  for(let shift=-1;shift<=14;shift++){
    const b=calendarDayBounds(cfg,addDays(today,shift),lat,lon,tz);
    if(cfg.settings.enabled){
      boundaries.push({at:b.start,phase:"schedule1-start"},{at:b.end,phase:"schedule1-end"});
      if(b.schedule2End!=null)boundaries.push({at:b.schedule2End,phase:"schedule2-end"});
    }
    if(cfg.settings.whiteOverride1Enabled!==false)boundaries.push({at:b.white1Start,phase:"white-override-1-start"},{at:b.white1End,phase:"white-override-1-end"});
    if(cfg.settings.whiteOverride2Enabled!==false&&b.white2Start!=null&&b.white2End!=null){
      boundaries.push({at:b.white2Start,phase:"white-override-2-start"},{at:b.white2End,phase:"white-override-2-end"});
    }
  }
  boundaries.sort((a,b)=>a.at-b.at);
  const first=boundaries.find(x=>x.at>nowMs+500);
  if(first){
    let prior=resolveCalendar(cfg,now,lat,lon,tz),priorKey=calendarTransitionKey(prior);
    for(let t=Math.ceil((nowMs+1)/60000)*60000;t<first.at;t+=60000){
      const r=resolveCalendar(cfg,new Date(t),lat,lon,tz),key=calendarTransitionKey(r);
      if(key!==priorKey)return {at:t,id:r?.id||null,name:r?.name||(r?"Scheduled scene":"Lights off"),target:"All",phase:"scene"};
      prior=r;priorKey=key;
    }
  }
  for(const b of boundaries){
    if(b.at<=nowMs+500)continue;
    const before=resolveCalendar(cfg,new Date(b.at-1000),lat,lon,tz);
    const after=resolveCalendar(cfg,new Date(b.at+1000),lat,lon,tz);
    if(calendarTransitionKey(before)!==calendarTransitionKey(after)){
      return {at:b.at,id:after?.id||null,name:after?.name||(after?"Scheduled scene":"Lights off"),target:"All",phase:b.phase};
    }
  }
  return null;
}

export function nextCalendarEvent(cfg:CalendarConfig|null,now:Date,lat:number,lon:number,tz:string){
  if(!cfg?.settings?.enabled)return null;
  const today=localYmd(now,tz);
  let best:Ymd|null=null,bestEvent:CalendarEvent|null=null;
  for(const e of cfg.events||[]){
    if(!included(cfg,e)||e.rule==="Month")continue;
    for(let y=today.year;y<=today.year+3;y++){
      const d=startDate(e,y,cfg.special||[]);
      if(d&&cmp(d,today)>0&&(!best||cmp(d,best)<0)){best=d;bestEvent=e;}
    }
  }
  if(!best||!bestEvent)return null;
  let hour=Math.floor(cfg.settings.on/60),minute=cfg.settings.on%60;
  if(cfg.settings.startAtDusk){
    const noon=new Date(localToUtcMs(best.year,best.month,best.day,12,0,tz));
    const m=astroMinute(noon,lat,lon,tz,false);hour=Math.floor(m/60);minute=m%60;
  }
  return {at:localToUtcMs(best.year,best.month,best.day,hour,minute,tz),id:bestEvent.id,name:bestEvent.name,target:"All"};
}

export function currentCalendarInfo(cfg:CalendarConfig|null,now:Date,lat:number,lon:number,tz:string){
  const r=resolveCalendar(cfg,now,lat,lon,tz);
  return r?{id:r.id,name:r.name,schedule2:r.schedule2,scene:r.scene}:null;
}
