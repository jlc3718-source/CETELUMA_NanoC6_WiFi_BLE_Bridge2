import { astronomy, localParts, localToUtcMs } from "./scheduler.js";
import type { Scene } from "./types.js";

export interface CalendarEvent {
  id:string; name:string; kind:string; rule:string;
  month:number; day:number; weekday:number; nth:number; offsetDays:number; durationDays:number;
  effect:string; speed:number; colors:number[]; enabled:boolean; favorite?:boolean;
  categoryIndex:number; major:boolean;
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
}
export interface CalendarConfig {
  version?:number;
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
        const hit=special.find(x=>x.id===e.id&&x.year===year);
        return hit?{year:hit.year,month:hit.month,day:hit.day}:null;
      }
      default:return null;
    }
    return e.offsetDays?addDays(d,e.offsetDays):d;
  }catch{return null;}
}
function included(cfg:CalendarConfig,e:CalendarEvent){
  if(!e.enabled)return false;
  const mask=Number(cfg.settings.categoryMask??32767);
  if(e.categoryIndex>=0&&e.categoryIndex<31&&((mask&(1<<e.categoryIndex))===0))return false;
  return Number(cfg.settings.mode||0)!==0||!!e.major;
}
function activeOn(cfg:CalendarConfig,e:CalendarEvent,day:Ymd){
  if(e.rule==="Month")return day.month===e.month;
  let s=startDate(e,day.year,cfg.special||[]);
  if(!s&&day.month===1)s=startDate(e,day.year-1,cfg.special||[]);
  if(!s)return false;
  const end=addDays(s,Math.max(1,e.durationDays||1)-1);
  return cmp(day,s)>=0&&cmp(day,end)<=0;
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
function sceneFor(e:CalendarEvent,brightness:number):Scene{
  return {
    power:true,
    brightness:clamp(brightness,1,100),
    effect:e.effect||"Solid / Static",
    colors:Array.isArray(e.colors)&&e.colors.length?e.colors.slice(0,8).map(x=>Number(x)&0xffffff):[0xffffff],
    speed:clamp(Number(e.speed)||3,1,5)
  };
}
function customScene(cfg:CalendarConfig,day:Ymd,schedule2:boolean,schedule2Brightness:number):CalendarResolution|null{
  for(const x of cfg.customSchedules||[]){
    if(x.enabled===false)continue;
    if(Number(x.month)!==day.month||Number(x.day)!==day.day)continue;
    if(!x.annual&&Number(x.year)!==day.year)continue;
    return {
      id:x.id||"",
      name:x.name||"Custom Light",
      schedule2,
      scene:{
        power:true,
        brightness:schedule2?clamp(schedule2Brightness,1,100):clamp(Number(x.brightness)||100,1,100),
        effect:x.effect||"Solid / Static",
        colors:Array.isArray(x.colors)&&x.colors.length?x.colors.slice(0,8).map(v=>Number(v)&0xffffff):[0xffffff],
        speed:clamp(Number(x.speed)||3,1,5)
      }
    };
  }
  return null;
}
function higherPriorityCountOn(cfg:CalendarConfig,day:Ymd){
  let count=0;
  const lead=clamp(Number(cfg.settings.lead)||0,0,14),trail=clamp(Number(cfg.settings.trail)||0,0,14);
  for(const e of cfg.events||[]){
    if(!included(cfg,e)||e.rule==="Month")continue;
    if(activeOn(cfg,e,day)){count++;continue;}
    if(e.kind==="Holiday"&&(lead||trail)&&windowActive(cfg,e,day,lead,trail))count++;
  }
  return count;
}
function monthlyPosition(cfg:CalendarConfig,day:Ymd){
  let total=0,ordinal=0,forcedDay=0,lowest=Number.MAX_SAFE_INTEGER;
  const days=monthDays(day.year,day.month);
  for(let d=1;d<=days;d++){
    const probe={year:day.year,month:day.month,day:d};
    const high=higherPriorityCountOn(cfg,probe);
    if(high===0){if(d<day.day)ordinal++;total++;}
    if(high<lowest){lowest=high;forcedDay=d;}
  }
  return {total,ordinal,forcedDay};
}
function combineMonthly(items:CalendarEvent[],brightness:number,schedule2:boolean):CalendarResolution{
  const colors:number[]=[];
  for(const e of items){
    for(const c of e.colors||[]){const v=Number(c)&0xffffff;if(colors.length<8&&!colors.includes(v))colors.push(v);}
    if(colors.length>=8)break;
  }
  return {id:items[0]?.id||"",name:"Combined monthly events",schedule2,scene:{power:true,brightness:clamp(brightness,1,100),effect:"Jump",colors:colors.length?colors:[0xffffff],speed:1}};
}
function resolveFor(cfg:CalendarConfig,day:Ymd,minute:number,start:number,end:number,schedule2:boolean,brightness:number):CalendarResolution|null{
  const specific:CalendarEvent[]=[],windows:CalendarEvent[]=[],monthly:CalendarEvent[]=[];
  const lead=clamp(Number(cfg.settings.lead)||0,0,14),trail=clamp(Number(cfg.settings.trail)||0,0,14);
  for(const e of cfg.events||[]){
    if(!included(cfg,e))continue;
    if(activeOn(cfg,e,day)){(e.rule==="Month"?monthly:specific).push(e);continue;}
    if(e.kind==="Holiday"&&(lead||trail)&&windowActive(cfg,e,day,lead,trail))windows.push(e);
  }
  const total=span(start,end),pos=elapsed(minute,start,total),mp=monthlyPosition(cfg,day);
  const forced=monthly.length>0&&mp.total===0&&mp.forcedDay===day.day&&(specific.length>0||windows.length>0);

  const wrap=(e:CalendarEvent):CalendarResolution=>({id:e.id,name:e.name,schedule2,scene:sceneFor(e,brightness)});
  if(forced){
    const monthlySpan=Math.max(1,Math.floor(total/3));
    if(pos<monthlySpan){
      if(Number(cfg.settings.overlap)===2)return combineMonthly(monthly,brightness,schedule2);
      return wrap(pick(monthly,pos,monthlySpan));
    }
    const highPos=pos-monthlySpan,highSpan=Math.max(1,total-monthlySpan);
    if(windows.length&&specific.length){
      const ws=Math.max(1,Math.floor(highSpan/3));
      return highPos<ws?wrap(pick(windows,highPos,ws)):wrap(pick(specific,highPos-ws,Math.max(1,highSpan-ws)));
    }
    if(specific.length)return wrap(pick(specific,highPos,highSpan));
    if(windows.length)return wrap(pick(windows,highPos,highSpan));
  }

  if(specific.length)return wrap(pick(specific,pos,total));
  if(windows.length)return wrap(pick(windows,pos,total));
  if(monthly.length){
    const overlap=Number(cfg.settings.overlap)||0;
    if(overlap===2)return combineMonthly(monthly,brightness,schedule2);
    if(overlap===1)return wrap(pick(monthly,pos,total));
    if(mp.total===0)return wrap(monthly[0]);
    if(mp.total>=monthly.length)return wrap(monthly[mp.ordinal%monthly.length]);
    const a=Math.floor((mp.ordinal*monthly.length)/mp.total),b=Math.max(a+1,Math.floor(((mp.ordinal+1)*monthly.length)/mp.total));
    return wrap(pick(monthly.slice(a,Math.min(monthly.length,b)),pos,total));
  }
  return null;
}
function astroMinute(now:Date,lat:number,lon:number,tz:string,dawn:boolean){
  const a=astronomy(now,lat,lon,tz),ms=dawn?a.dawnMs:a.duskMs;
  if(ms==null)return dawn?360:1080;
  const p=localParts(new Date(ms),tz);return p.hour*60+p.minute;
}

export function normalizeCalendarConfig(input:any):CalendarConfig{
  const s=input?.settings||{};
  const cfg:CalendarConfig={
    version:1,syncedAt:Date.now(),
    settings:{
      enabled:!!s.enabled,
      mode:clamp(Number(s.mode)||0,0,2),
      lead:clamp(Number(s.lead)||0,0,14),
      trail:clamp(Number(s.trail)||0,0,14),
      on:clamp(Number(s.on)||1020,0,1439),
      off:clamp(Number(s.off)||1380,0,1439),
      startAtDusk:!!s.startAtDusk,
      schedule2Enabled:s.schedule2Enabled!==false,
      schedule2EndAtDawn:s.schedule2EndAtDawn!==false,
      schedule2End:clamp(Number(s.schedule2End)||360,0,1439),
      schedule2Brightness:clamp(Number(s.schedule2Brightness)||10,1,100),
      overlap:clamp(Number(s.overlap)||0,0,2),
      categoryMask:clamp(Number(s.categoryMask)||32767,0,32767)
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
      effect:String(raw.effect||"Solid / Static"),speed:clamp(Number(raw.speed)||3,1,5),
      colors:Array.isArray(raw.colors)?raw.colors.slice(0,8).map(colorValue):[0xffffff],
      enabled:raw.enabled!==false,favorite:!!raw.favorite,categoryIndex:clamp(Number(raw.categoryIndex)||0,0,14),major:!!raw.major
    });
  }
  for(const raw of Array.isArray(input?.special)?input.special:[]){
    if(raw&&typeof raw.id==="string")cfg.special.push({id:String(raw.id),year:Number(raw.year),month:Number(raw.month),day:Number(raw.day)});
  }
  for(const raw of Array.isArray(input?.customSchedules)?input.customSchedules:[]){
    if(!raw||typeof raw.id!=="string")continue;
    cfg.customSchedules.push({
      id:String(raw.id),name:String(raw.name||"Custom Light"),enabled:raw.enabled!==false,annual:raw.annual!==false,
      year:Number(raw.year)||0,month:Number(raw.month)||0,day:Number(raw.day)||0,effect:String(raw.effect||"Solid / Static"),
      speed:clamp(Number(raw.speed)||3,1,5),brightness:clamp(Number(raw.brightness)||100,1,100),
      colors:Array.isArray(raw.colors)?raw.colors.slice(0,8).map(colorValue):[0xffffff]
    });
  }
  return cfg;
}

export function resolveCalendar(cfg:CalendarConfig|null,now:Date,lat:number,lon:number,tz:string):CalendarResolution|null{
  if(!cfg?.settings?.enabled||!cfg.events?.length)return null;
  const lp=localParts(now,tz),day={year:lp.year,month:lp.month,day:lp.day},minute=lp.hour*60+lp.minute;
  const start=cfg.settings.startAtDusk?astroMinute(now,lat,lon,tz,false):cfg.settings.on;
  const end=cfg.settings.off;
  if(inWindow(minute,start,end)){
    const custom=customScene(cfg,day,false,100);if(custom)return custom;
    return resolveFor(cfg,day,minute,start,end,false,100);
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
      const custom=customScene(cfg,themeDay,true,cfg.settings.schedule2Brightness);if(custom)return custom;
      const last=(end+1439)%1440;
      return resolveFor(cfg,themeDay,last,themeStart,end,true,cfg.settings.schedule2Brightness);
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
