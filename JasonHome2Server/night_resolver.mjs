import { resolveCalendar } from "./shared/calendar.js";
import { astronomy, localParts, localToUtcMs } from "./shared/scheduler.js";

function addDays(day,delta){
  const d=new Date(Date.UTC(day.year,day.month-1,day.day+delta));
  return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()};
}
function localDay(now,tz){
  const p=localParts(now,tz);
  return {year:p.year,month:p.month,day:p.day};
}
function astroMinute(day,lat,lon,tz,dawn){
  const noon=new Date(localToUtcMs(day.year,day.month,day.day,12,0,tz));
  const a=astronomy(noon,lat,lon,tz),ms=dawn?a.dawnMs:a.duskMs;
  if(ms==null)return dawn?360:1080;
  const p=localParts(new Date(ms),tz);
  return p.hour*60+p.minute;
}
function atMinute(day,minute,tz){
  return localToUtcMs(day.year,day.month,day.day,Math.floor(minute/60),minute%60,tz);
}
function nightBounds(cfg,day,lat,lon,tz){
  const startMinute=cfg?.settings?.startAtDusk?astroMinute(day,lat,lon,tz,false):Number(cfg?.settings?.on??1020);
  const start=atMinute(day,startMinute,tz);
  let endDay=day,end=atMinute(endDay,Number(cfg?.settings?.off??1380),tz);
  if(end<=start){endDay=addDays(day,1);end=atMinute(endDay,Number(cfg?.settings?.off??1380),tz);}
  let schedule2End=null;
  if(cfg?.settings?.schedule2Enabled){
    if(cfg.settings.schedule2EndAtDawn){
      for(let shift=0;shift<=2;shift++){
        const d=addDays(day,shift);
        const noon=new Date(localToUtcMs(d.year,d.month,d.day,12,0,tz));
        const candidate=astronomy(noon,lat,lon,tz).dawnMs;
        if(candidate!=null&&candidate>end){schedule2End=candidate;break;}
      }
    }else{
      const minute=Number(cfg.settings.schedule2End??360);
      let d=day;
      schedule2End=atMinute(d,minute,tz);
      while(schedule2End<=end){d=addDays(d,1);schedule2End=atMinute(d,minute,tz);}
    }
  }
  return {start,end,schedule2End};
}
function sourceFor(cfg,id){
  return (cfg?.events||[]).find(x=>x.id===id)||(cfg?.customSchedules||[]).find(x=>x.id===id)||null;
}
function eventFromId(cfg,id,fallback=null){
  const source=sourceFor(cfg,id);
  if(source)return {id:String(id),name:String(source.name||id),colors:Array.isArray(source.colors)?source.colors.slice(0,8):[]};
  if(fallback)return {id:String(id||fallback.id||""),name:String(fallback.name||id||"Scheduled event"),colors:Array.isArray(fallback.scene?.colors)?fallback.scene.colors.slice(0,8):[]};
  return {id:String(id),name:String(id),colors:[]};
}
function combinedIds(result){
  const id=String(result?.id||"");
  if(!id.startsWith("overlap:"))return [];
  return id.slice("overlap:".length).split("+").filter(Boolean);
}

export function resolveNightEvents(cfg,day,lat,lon,tz){
  if(!cfg?.settings?.enabled)return [];
  const bounds=nightBounds(cfg,day,lat,lon,tz);
  if(bounds.end<=bounds.start)return [];
  const noWhite={...cfg,settings:{...cfg.settings,whiteOverride1Enabled:false,whiteOverride2Enabled:false}};
  const overlap=Math.max(0,Math.min(2,Number(cfg.settings.overlap)||0));
  const instant=new Date(Math.min(bounds.end-1,bounds.start+1000));

  if(overlap===1||overlap===2){
    const combinedCfg={...noWhite,settings:{...noWhite.settings,overlap:2}};
    const combined=resolveCalendar(combinedCfg,instant,lat,lon,tz);
    const ids=combinedIds(combined);
    if(ids.length)return ids.map(id=>eventFromId(cfg,id));
    if(combined)return [eventFromId(cfg,combined.id,combined)];
    return [];
  }

  const winner=resolveCalendar(noWhite,instant,lat,lon,tz);
  return winner?[eventFromId(cfg,winner.id,winner)]:[];
}

export function lightingNightDate(cfg,now,lat,lon,tz){
  const today=localDay(now,tz),yesterday=addDays(today,-1);
  if(cfg?.settings?.enabled){
    const prior=nightBounds(cfg,yesterday,lat,lon,tz);
    const last=prior.schedule2End??prior.end;
    if(now.getTime()>=prior.start&&now.getTime()<last)return yesterday;
  }
  return today;
}
