(()=>{
  "use strict";
  const zone="America/New_York",weekdays=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const today=()=>{const parts=new Intl.DateTimeFormat("en-US",{timeZone:zone,year:"numeric",month:"numeric",day:"numeric"}).formatToParts(new Date());
    const n=type=>Number(parts.find(p=>p.type===type).value);return {year:n("year"),month:n("month"),day:n("day")};};
  let shown=today(),lastRefresh=0,request=0,showNight=()=>{};
  function start(){
    const card=document.querySelector(".v3ScheduleCard"),next=document.querySelector(".v3Next");
    if(!card||!next)return;
    const wrap=document.createElement("section");wrap.className="andersonCalendar";wrap.setAttribute("aria-label","Scheduled lighting by night");
    wrap.innerHTML='<div class="andersonCalendarHead"><button type="button" aria-label="Previous month">‹</button><strong></strong><button type="button" aria-label="Next month">›</button></div><div class="andersonCalendarGrid"></div>';
    card.append(wrap,next);
    const schedules=document.querySelector('.page[data-page="events"]');
    const detail=document.createElement("section");detail.className="panel andersonNightDetail";detail.hidden=true;
    (schedules.querySelector(".v3PageTitle")||schedules.firstElementChild)?.after(detail);
    showNight=(year,month,entry)=>{
      const date=new Date(Date.UTC(year,month-1,entry.day));
      const label=new Intl.DateTimeFormat("en-US",{timeZone:"UTC",weekday:"long",month:"long",day:"numeric",year:"numeric"}).format(date);
      detail.replaceChildren();
      const head=document.createElement("div");head.className="andersonNightHead";
      const heading=document.createElement("div"),kicker=document.createElement("span"),title=document.createElement("h2");
      kicker.className="andersonNightKicker";kicker.textContent="SCHEDULED FOR THIS NIGHT";title.textContent=label;
      heading.append(kicker,title);
      const all=document.createElement("button");all.type="button";all.className="btn";all.textContent="Show all schedules";
      all.addEventListener("click",()=>{document.body.classList.remove("andersonDateView");detail.hidden=true;document.querySelector(".page.active")?.scrollIntoView({block:"start"})});
      head.append(heading,all);detail.append(head);
      if(!entry.events.length){const empty=document.createElement("p");empty.className="sub";empty.textContent="No scheduled events for this night.";detail.append(empty)}
      else{
        const list=document.createElement("div");list.className="andersonNightList";
        entry.events.forEach(event=>{
          const item=document.createElement("article");item.className="andersonNightItem";
          const colors=document.createElement("div");colors.className="andersonNightColors";
          (event.colors||[]).forEach(color=>{const swatch=document.createElement("span");swatch.style.background=color;colors.append(swatch)});
          const name=document.createElement("strong"),meta=document.createElement("div");name.textContent=event.name;
          meta.className="sub";meta.textContent=`${event.type||"Scheduled event"} · ${event.effect||"Solid / Static"}`;
          item.append(colors,name,meta);list.append(item);
        });detail.append(list);
      }
      detail.hidden=false;document.body.classList.add("andersonDateView");
      document.querySelector('.tab[data-tab="events"]')?.click();
      window.scrollTo({top:0,behavior:"instant"});
    };
    const buttons=wrap.querySelectorAll("button");
    buttons.forEach((button,index)=>button.addEventListener("click",()=>{
      const date=new Date(Date.UTC(shown.year,shown.month-1+(index?1:-1),1));
      shown={year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:1};refresh(true);
    }));
    const style=document.createElement("style");style.textContent=`
      .v3ScheduleCard{grid-template-columns:minmax(0,1fr)!important;row-gap:10px!important;min-width:0}
      .v3ScheduleCard>.v3CardKicker,.v3ScheduleCard>#scheduleWindow,.v3ScheduleCard>#resumeSchedule,.v3ScheduleCard>.andersonCalendar,.v3ScheduleCard>.v3Next{grid-column:1/-1!important;grid-row:auto!important;min-width:0;box-sizing:border-box}
      #scheduledEventName{display:none!important}
      .v3ScheduleCard>#scheduleWindow{font-size:12px;line-height:1.55;overflow-wrap:normal}
      .v3ScheduleCard>#resumeSchedule{width:100%;max-width:none!important;min-height:44px;font-size:12px}
      .andersonCalendar{width:100%;margin:8px 0 0;padding:12px;border:1px solid #8daaff32;border-radius:17px;background:#09162c;color:#dfebff}
      .andersonCalendarHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
      .andersonCalendarHead strong{font-size:13px;font-weight:700}
      .andersonCalendarHead button{width:32px;height:32px;border:1px solid #7899d34d;border-radius:9px;background:#1a2e51;color:#dbe9ff;font-size:23px;line-height:1}
      .andersonCalendarGrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px;text-align:center;width:100%}
      .andersonCalendarError{grid-column:1/-1;text-align:center;padding:12px 8px;color:#cbdcf5;font-size:12px;line-height:1.4}
      .andersonCalendarError button{display:block;margin:10px auto 0;min-height:38px;padding:7px 16px;border:1px solid #7899d34d;border-radius:9px;background:#1a2e51;color:#dbe9ff}
      .andersonWeekday{font-size:10px;color:#9ab2da;padding:3px 0}
      .andersonDate{min-height:37px;padding:3px 1px;border-radius:9px;font-size:11px;line-height:16px;min-width:0}
      button.andersonDate{border:0;background:transparent;color:#dce8ff;cursor:pointer;width:100%;font-size:11px;line-height:16px}
      button.andersonDate:focus-visible{outline:2px solid #a6c5ff;outline-offset:1px}
      button.andersonDate:hover{background:#263f70}
      .andersonDate.today{background:#375d9c;box-shadow:inset 0 0 0 1px #a6c5ff;color:white;font-weight:bold}
      .andersonDots{display:flex;flex-wrap:wrap;justify-content:center;gap:2px;max-width:36px;margin:1px auto 0}
      .andersonDot{width:5px;height:5px;border-radius:50%;background:#79a9ff;flex:none}
      .v3ScheduleCard>.v3Next{margin-top:4px;padding:16px 0 3px!important;border-left:0!important;border-top:1px solid #a8c4ff30!important;align-content:start}
      .v3ScheduleCard>.v3Next .v3TonightEventRow{min-width:0}
      .v3TonightEventRow{align-items:flex-start!important}
      #tonightEvent{white-space:pre-line}
      body.andersonDateView .page[data-page="events"]>.panel:not(.andersonNightDetail){display:none!important}
      .andersonNightDetail{width:100%;box-sizing:border-box}
      .andersonNightHead{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
      .andersonNightHead h2{font-size:20px;line-height:1.2;margin:5px 0 12px}
      .andersonNightKicker{color:#9cb8e7;font-size:10px;font-weight:700;letter-spacing:.12em}
      .andersonNightHead .btn{min-height:42px}
      .andersonNightList{display:grid;gap:10px;margin-top:12px}
      .andersonNightItem{padding:14px 15px;border:1px solid #9ab6ed30;border-radius:13px;background:#101f3a;min-width:0}
      .andersonNightItem strong{display:block;overflow-wrap:anywhere;font-size:15px;margin:7px 0 3px}
      .andersonNightColors{display:flex;gap:5px;flex-wrap:wrap}
      .andersonNightColors span{width:12px;height:12px;border-radius:50%;border:1px solid #fff5}
    `;document.head.append(style);
    window.addEventListener("anderson-scheduled-event",()=>refresh(false));
    document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh(false)});
    setInterval(()=>refresh(false),60000);
    refresh(true);
  }
  async function refresh(force){
    const actual=today();
    if(window.andersonCurrentMonthYear!==undefined&&
       (window.andersonCurrentMonthYear!==actual.year||window.andersonCurrentMonthNumber!==actual.month)){
      shown=actual;force=true;
    }else if(shown.year===actual.year&&shown.month===actual.month&&window.andersonCurrentDay!==actual.day){force=true;}
    if(!force&&Date.now()-lastRefresh<30000)return;
    lastRefresh=Date.now();const sequence=++request;
    const grid=document.querySelector(".andersonCalendarGrid");if(!grid)return;
    document.querySelector(".andersonCalendarHead strong").textContent=new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(shown.year,shown.month-1,1)));
    try{
      const data=await api(`/api/night-calendar?year=${shown.year}&month=${shown.month}`,{},45000);
      if(sequence!==request)return;
      window.andersonCurrentMonthYear=actual.year;window.andersonCurrentMonthNumber=actual.month;window.andersonCurrentDay=actual.day;
      document.querySelector(".andersonCalendarHead strong").textContent=new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(data.year,data.month-1,1)));
      grid.replaceChildren();
      weekdays.forEach(name=>{const label=document.createElement("span");label.className="andersonWeekday";label.textContent=name;grid.append(label)});
      const offset=new Date(Date.UTC(data.year,data.month-1,1)).getUTCDay();
      for(let i=0;i<offset;i++)grid.append(document.createElement("span"));
      data.days.forEach(entry=>{
        const cell=document.createElement("button");cell.type="button";cell.className="andersonDate";
        if(data.year===actual.year&&data.month===actual.month&&entry.day===actual.day)cell.classList.add("today");
        cell.textContent=String(entry.day);cell.title=entry.events.length?entry.events.map(e=>e.name).join(" • "):"No scheduled event";
        cell.setAttribute("aria-label",`${data.month}/${entry.day}/${data.year}: ${entry.events.length} scheduled ${entry.events.length===1?"event":"events"}`);
        cell.addEventListener("click",()=>showNight(data.year,data.month,entry));
        const dots=document.createElement("span");dots.className="andersonDots";
        entry.events.forEach(event=>{const dot=document.createElement("span");dot.className="andersonDot";dot.style.background=event.colors?.[0]||"#79a9ff";dots.append(dot)});
        cell.append(dots);grid.append(cell);
      });
    }catch(error){if(sequence===request){
      grid.replaceChildren();const message=document.createElement("div");message.className="andersonCalendarError";
      const text=document.createElement("span");text.textContent="Calendar unavailable"+(error?.message?": "+error.message:".");
      const retry=document.createElement("button");retry.type="button";retry.textContent="Try again";
      retry.addEventListener("click",()=>refresh(true));message.append(text,retry);grid.append(message);
    }}
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
})();
