import type { ScheduleRow } from "./types";

function rad(v:number){return v*Math.PI/180;}
function deg(v:number){return v*180/Math.PI;}
function norm(v:number,max:number){v%=max;return v<0?v+max:v;}
function dayOfYear(d:Date){const y=d.getUTCFullYear();return Math.floor((Date.UTC(y,d.getUTCMonth(),d.getUTCDate())-Date.UTC(y,0,0))/86400000);}

export function civilTwilightUtc(date:Date,lat:number,lon:number,dawn:boolean):number|null{
  const n=dayOfYear(date),lngHour=lon/15,t=n+((dawn?6:18)-lngHour)/24;
  const m=0.9856*t-3.289;let l=m+1.916*Math.sin(rad(m))+0.020*Math.sin(rad(2*m))+282.634;l=norm(l,360);
  let ra=deg(Math.atan(0.91764*Math.tan(rad(l))));ra=norm(ra,360);const lq=Math.floor(l/90)*90,raq=Math.floor(ra/90)*90;ra=(ra+(lq-raq))/15;
  const sinDec=0.39782*Math.sin(rad(l)),cosDec=Math.cos(Math.asin(sinDec));
  const cosH=(Math.cos(rad(96))-sinDec*Math.sin(rad(lat)))/(cosDec*Math.cos(rad(lat)));if(cosH>1||cosH<-1)return null;
  let h=dawn?360-deg(Math.acos(cosH)):deg(Math.acos(cosH));h/=15;
  const localMean=h+ra-0.06571*t-6.622;const utc=norm(localMean-lngHour,24);return Math.round(utc*60)%1440;
}

export function localParts(date:Date,tz:string){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23",weekday:"short"}).formatToParts(date);
  const m:any={};for(const p of parts)m[p.type]=p.value;
  return {year:+m.year,month:+m.month,day:+m.day,hour:+m.hour,minute:+m.minute,second:+m.second,weekday:m.weekday};
}
export function tzOffsetMs(date:Date,tz:string){const p=localParts(date,tz);const asUtc=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);return asUtc-date.getTime();}
export function localToUtcMs(year:number,month:number,day:number,hour:number,minute:number,tz:string){
  let guess=Date.UTC(year,month-1,day,hour,minute);for(let i=0;i<3;i++)guess=Date.UTC(year,month-1,day,hour,minute)-tzOffsetMs(new Date(guess),tz);return guess;
}
export function utcMinutesToLocalLabel(date:Date,minutes:number,tz:string){
  const ms=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate())+minutes*60000;
  return new Intl.DateTimeFormat("en-US",{timeZone:tz,hour:"numeric",minute:"2-digit"}).format(new Date(ms));
}
function parseClock(value:string){const m=/^(\d{1,2}):(\d{2})$/.exec(value||"");if(!m)return null;const h=+m[1],min=+m[2];return h>=0&&h<24&&min>=0&&min<60?{h,min}:null;}
function dayAllowed(row:ScheduleRow,weekday:string){if(!row.days||row.days==="*")return true;return row.days.split(",").map(x=>x.trim().slice(0,3).toLowerCase()).includes(weekday.slice(0,3).toLowerCase());}
export interface Astro {dawnLabel:string;duskLabel:string;dawnMs:number|null;duskMs:number|null;}
export function astronomy(now:Date,lat:number,lon:number,tz:string):Astro{
  const lp=localParts(now,tz),noonUtc=localToUtcMs(lp.year,lp.month,lp.day,12,0,tz),basis=new Date(noonUtc);
  const d1=civilTwilightUtc(basis,lat,lon,true),d2=civilTwilightUtc(basis,lat,lon,false);
  function toMs(min:number|null){if(min==null)return null;return Date.UTC(basis.getUTCFullYear(),basis.getUTCMonth(),basis.getUTCDate())+min*60000;}
  return {dawnLabel:d1==null?"—":utcMinutesToLocalLabel(basis,d1,tz),duskLabel:d2==null?"—":utcMinutesToLocalLabel(basis,d2,tz),dawnMs:toMs(d1),duskMs:toMs(d2)};
}
function eventTime(row:ScheduleRow,day:Date,kind:string,value:string,lat:number,lon:number,tz:string):number|null{
  const lp=localParts(day,tz);
  if(kind==="clock"){const c=parseClock(value);return c?localToUtcMs(lp.year,lp.month,lp.day,c.h,c.min,tz):null;}
  const astro=astronomy(new Date(localToUtcMs(lp.year,lp.month,lp.day,12,0,tz)),lat,lon,tz),base=kind==="dawn"?astro.dawnMs:kind==="dusk"?astro.duskMs:null;
  if(base==null)return null;const offset=parseInt(value||"0",10)||0;return base+offset*60000;
}
export function nextScheduleEvent(rows:ScheduleRow[],now:Date,lat:number,lon:number,tz:string):{at:number;row:ScheduleRow;phase:"start"|"end"}|null{
  let best:any=null;
  for(let add=0;add<9;add++){
    const day=new Date(now.getTime()+add*86400000),lp=localParts(day,tz);
    for(const row of rows){if(!row.enabled||!dayAllowed(row,lp.weekday))continue;
      for(const phase of ["start","end"] as const){const at=eventTime(row,day,phase==="start"?row.start_kind:row.end_kind,phase==="start"?row.start_value:row.end_value,lat,lon,tz);if(at!=null&&at>now.getTime()+500&&(!best||at<best.at))best={at,row,phase};}
    }
  }
  return best;
}
