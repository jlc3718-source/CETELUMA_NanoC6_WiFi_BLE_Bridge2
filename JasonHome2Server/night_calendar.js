(()=>{
  "use strict";
  const zone="America/New_York",weekdays=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const today=()=>{const parts=new Intl.DateTimeFormat("en-US",{timeZone:zone,year:"numeric",month:"numeric",day:"numeric"}).formatToParts(new Date());
    const n=type=>Number(parts.find(p=>p.type===type).value);return {year:n("year"),month:n("month"),day:n("day")};};
  let shown=today(),lastRefresh=0,request=0;
  function start(){
    const card=document.querySelector(".v3ScheduleCard"),next=document.querySelector(".v3Next");
    if(!card||!next)return;
    const wrap=document.createElement("section");wrap.className="jh2Calendar";wrap.setAttribute("aria-label","Scheduled lighting by night");
    wrap.innerHTML='<div class="jh2CalendarHead"><button type="button" aria-label="Previous month">‹</button><strong></strong><button type="button" aria-label="Next month">›</button></div><div class="jh2CalendarGrid"></div>';
    card.append(wrap,next);
    const buttons=wrap.querySelectorAll("button");
    buttons.forEach((button,index)=>button.addEventListener("click",()=>{
      const date=new Date(Date.UTC(shown.year,shown.month-1+(index?1:-1),1));
      shown={year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:1};refresh(true);
    }));
    const style=document.createElement("style");style.textContent=`
      .v3ScheduleCard{grid-template-columns:minmax(0,1fr)!important;row-gap:10px!important;min-width:0}
      .v3ScheduleCard>.v3CardKicker,.v3ScheduleCard>#scheduleWindow,.v3ScheduleCard>#resumeSchedule,.v3ScheduleCard>.jh2Calendar,.v3ScheduleCard>.v3Next{grid-column:1/-1!important;grid-row:auto!important;min-width:0;box-sizing:border-box}
      #scheduledEventName{display:none!important}
      .v3ScheduleCard>#scheduleWindow{font-size:12px;line-height:1.55;overflow-wrap:normal}
      .v3ScheduleCard>#resumeSchedule{width:100%;max-width:none!important;min-height:44px;font-size:12px}
      .jh2Calendar{width:100%;margin:8px 0 0;padding:12px;border:1px solid #8daaff32;border-radius:17px;background:#09162c;color:#dfebff}
      .jh2CalendarHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
      .jh2CalendarHead strong{font-size:13px;font-weight:700}
      .jh2CalendarHead button{width:32px;height:32px;border:1px solid #7899d34d;border-radius:9px;background:#1a2e51;color:#dbe9ff;font-size:23px;line-height:1}
      .jh2CalendarGrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px;text-align:center;width:100%}
      .jh2Weekday{font-size:10px;color:#9ab2da;padding:3px 0}
      .jh2Date{min-height:37px;padding:3px 1px;border-radius:9px;font-size:11px;line-height:16px;min-width:0}
      .jh2Date.today{background:#375d9c;box-shadow:inset 0 0 0 1px #a6c5ff;color:white;font-weight:bold}
      .jh2Dots{display:flex;flex-wrap:wrap;justify-content:center;gap:2px;max-width:36px;margin:1px auto 0}
      .jh2Dot{width:5px;height:5px;border-radius:50%;background:#79a9ff;flex:none}
      .v3ScheduleCard>.v3Next{margin-top:4px;padding:16px 0 3px!important;border-left:0!important;border-top:1px solid #a8c4ff30!important;align-content:start}
      .v3ScheduleCard>.v3Next .v3TonightEventRow{min-width:0}
      .v3TonightEventRow{align-items:flex-start!important}
      #tonightEvent{white-space:pre-line}
    `;document.head.append(style);
    window.addEventListener("anderson-scheduled-event",()=>refresh(false));
    document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh(false)});
    setInterval(()=>refresh(false),60000);
    refresh(true);
  }
  async function refresh(force){
    const actual=today();
    if(window.jh2CurrentMonthYear!==undefined&&
       (window.jh2CurrentMonthYear!==actual.year||window.jh2CurrentMonthNumber!==actual.month)){
      shown=actual;force=true;
    }else if(shown.year===actual.year&&shown.month===actual.month&&window.jh2CurrentDay!==actual.day){force=true;}
    if(!force&&Date.now()-lastRefresh<30000)return;
    lastRefresh=Date.now();const sequence=++request;
    const grid=document.querySelector(".jh2CalendarGrid");if(!grid)return;
    try{
      const response=await fetch(`/jason-home-2/api/night-calendar?year=${shown.year}&month=${shown.month}`,{credentials:"same-origin",cache:"no-store"});
      if(!response.ok)throw new Error("Calendar unavailable");
      const data=await response.json();if(sequence!==request)return;
      window.jh2CurrentMonthYear=actual.year;window.jh2CurrentMonthNumber=actual.month;window.jh2CurrentDay=actual.day;
      document.querySelector(".jh2CalendarHead strong").textContent=new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(data.year,data.month-1,1)));
      grid.replaceChildren();
      weekdays.forEach(name=>{const label=document.createElement("span");label.className="jh2Weekday";label.textContent=name;grid.append(label)});
      const offset=new Date(Date.UTC(data.year,data.month-1,1)).getUTCDay();
      for(let i=0;i<offset;i++)grid.append(document.createElement("span"));
      data.days.forEach(entry=>{
        const cell=document.createElement("div");cell.className="jh2Date";
        if(data.year===actual.year&&data.month===actual.month&&entry.day===actual.day)cell.classList.add("today");
        cell.textContent=String(entry.day);cell.title=entry.events.length?entry.events.map(e=>e.name).join(" • "):"No scheduled event";
        const dots=document.createElement("span");dots.className="jh2Dots";
        entry.events.forEach(event=>{const dot=document.createElement("span");dot.className="jh2Dot";dot.style.background=event.colors?.[0]||"#79a9ff";dots.append(dot)});
        cell.append(dots);grid.append(cell);
      });
    }catch{if(sequence===request)grid.textContent="Calendar unavailable. Pull to refresh."}
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
})();
