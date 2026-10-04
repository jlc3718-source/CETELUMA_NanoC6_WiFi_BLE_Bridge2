import assert from "node:assert/strict";
import { normalizeCalendarConfig, resolveCalendar, nextCalendarEvent, nextCalendarBoundary, nextCalendarTransition } from "../dist/calendar.js";
import { astronomy, localParts } from "../dist/scheduler.js";

const base={
  settings:{
    enabled:true,mode:2,lead:0,trail:0,on:17*60,off:23*60,startAtDusk:false,
    schedule2Enabled:true,schedule2EndAtDawn:false,schedule2End:6*60,
    schedule2Brightness:10,overlap:0,categoryMask:32767,
    whiteOverride1Enabled:false,whiteOverride2Enabled:false
  },
  special:[],
  customSchedules:[],
  events:[
    {id:"xmas",name:"Christmas Day",kind:"Holiday",rule:"Fixed",month:12,day:25,weekday:0,nth:0,offsetDays:0,durationDays:1,effect:"Candy Cane",speed:2,colors:[0xff0000,0x00ff00],enabled:true,categoryIndex:0,major:true},
    {id:"heritage",name:"Hispanic Heritage Month",kind:"Awareness",rule:"Month",month:9,day:1,weekday:0,nth:0,offsetDays:0,durationDays:30,effect:"Gradient Sweep",speed:2,colors:[0xff0000,0xffffff,0x00ff00],enabled:true,categoryIndex:1,major:false}
  ]
};

let cfg=normalizeCalendarConfig(base);
let r=resolveCalendar(cfg,new Date("2026-12-25T23:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"Christmas Day");
assert.equal(r?.scene.effect,"Flow1");
assert.ok(r?.scene.pattern?.blocks?.length===2,"Existing saved layers should automatically gain segmented patterns");
assert.equal(r?.schedule2,false);
assert.ok(r?.scene.pattern?.blocks?.length===2,"Two-color holiday should receive a segmented lamp pattern");
assert.ok(r.scene.pattern.blocks.some(n=>n>1),"Segmented pattern must use multi-lamp color blocks");

r=resolveCalendar(cfg,new Date("2026-12-26T04:30:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"Christmas Day");
assert.equal(r?.schedule2,true);
assert.equal(r?.scene.brightness,10);

r=resolveCalendar(cfg,new Date("2026-09-27T22:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"Hispanic Heritage Month");

cfg=normalizeCalendarConfig({...base,settings:{...base.settings,overlap:1},customSchedules:[{
  id:"custom1",name:"Birthday Test",enabled:true,annual:true,year:2026,month:12,day:25,
  effect:"Breath",speed:3,brightness:88,colors:[0x123456]
}]});
r=resolveCalendar(cfg,new Date("2026-12-25T23:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"Birthday Test","Custom schedules participate in universal split overlap");
assert.equal(r?.scene.brightness,88);

const next=nextCalendarEvent(normalizeCalendarConfig(base),new Date("2026-12-01T15:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(next?.name,"Christmas Day");

const christmasMorning=new Date("2026-12-25T15:00:00Z");
const christmasTransition=nextCalendarTransition(normalizeCalendarConfig(base),christmasMorning,42.1507,-78.9452,"America/New_York");
assert.equal(christmasTransition?.name,"Christmas Day","Christmas morning transition should be tonight, not next year");
assert.equal(new Date(christmasTransition.at).toISOString(),"2026-12-25T22:00:00.000Z");
const christmasBoundary=nextCalendarBoundary(normalizeCalendarConfig(base),christmasMorning,42.1507,-78.9452,"America/New_York");
assert.equal(new Date(christmasBoundary.at).toISOString(),"2026-12-25T22:00:00.000Z");

const monthlyOnly=normalizeCalendarConfig({...base,events:[base.events[1]]});
const monthlyTransition=nextCalendarTransition(monthlyOnly,new Date("2026-09-27T15:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(monthlyTransition?.name,"Hispanic Heritage Month");

const customOnly=normalizeCalendarConfig({...base,events:[],customSchedules:[{
  id:"today-custom",name:"Today Custom",enabled:true,annual:true,year:2026,month:9,day:27,
  effect:"Breath",speed:3,brightness:80,colors:[0x123456]
}]});
const customTransition=nextCalendarTransition(customOnly,new Date("2026-09-27T15:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(customTransition?.name,"Today Custom");

const zeros=normalizeCalendarConfig({settings:{
  enabled:true,mode:2,lead:0,trail:0,on:0,off:0,startAtDusk:false,
  schedule2Enabled:true,schedule2EndAtDawn:false,schedule2End:0,
  schedule2Brightness:10,overlap:0,categoryMask:0,
  whiteOverride1Enabled:false,whiteOverride2Enabled:false
},events:[],special:[],customSchedules:[]});
assert.equal(zeros.settings.on,0);
assert.equal(zeros.settings.off,0);
assert.equal(zeros.settings.schedule2End,0);
assert.equal(zeros.settings.categoryMask,0);

const crossing=normalizeCalendarConfig({
  settings:base.settings,
  special:[],
  customSchedules:[],
  events:[{id:"cross",name:"Year Crossing",kind:"Holiday",rule:"Fixed",month:12,day:30,weekday:0,nth:0,offsetDays:0,durationDays:5,effect:"Solid / Static",speed:3,colors:[0xffffff],enabled:true,categoryIndex:0,major:true}]
});
r=resolveCalendar(crossing,new Date("2027-01-02T00:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"Year Crossing");

const hanukkah=normalizeCalendarConfig({
  settings:base.settings,
  special:[{id:"evt202",year:2026,month:12,day:4}],
  customSchedules:[],
  events:[{id:"evt202::factory:100",dateRuleSourceId:"evt202",name:"Hanukkah Factory",kind:"Holiday",rule:"YearTable",month:0,day:0,weekday:0,nth:0,offsetDays:0,durationDays:8,effect:"Breath",speed:3,colors:[0xffffff],enabled:true,categoryIndex:0,major:true}]
});
r=resolveCalendar(hanukkah,new Date("2026-12-05T00:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"Hanukkah Factory");

const overnightSchedule1=normalizeCalendarConfig({
  settings:{...base.settings,on:23*60,off:60,startAtDusk:false,schedule2Enabled:false},
  special:[],
  customSchedules:[],
  events:[
    base.events[0],
    {id:"boxing",name:"Boxing Day Test",kind:"Holiday",rule:"Fixed",month:12,day:26,weekday:0,nth:0,offsetDays:0,durationDays:1,effect:"Breath",speed:1,colors:[0x0000ff],enabled:true,categoryIndex:0,major:true}
  ]
});
r=resolveCalendar(overnightSchedule1,new Date("2026-12-26T05:30:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"Christmas Day","Schedule 1 after midnight must retain the prior evening's theme");
r=resolveCalendar(overnightSchedule1,new Date("2026-12-26T06:30:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r,null,"Cross-midnight Schedule 1 must end at its configured end time");

const splitNight=normalizeCalendarConfig({
  settings:{...base.settings,on:17*60,off:23*60,startAtDusk:false,schedule2Enabled:false,overlap:1},
  special:[],
  customSchedules:[],
  events:[
    base.events[0],
    {id:"xmas-alt",name:"Christmas Alternate",kind:"Holiday",rule:"Fixed",month:12,day:25,weekday:0,nth:0,offsetDays:0,durationDays:1,effect:"Breath",speed:1,colors:[0xffffff],enabled:true,categoryIndex:0,major:true}
  ]
});
const midSceneTransition=nextCalendarTransition(splitNight,new Date("2026-12-25T23:30:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(midSceneTransition?.name,"Christmas Alternate","Next transition must detect a real scene change inside Schedule 1");
assert.equal(new Date(midSceneTransition.at).toISOString(),"2026-12-26T01:00:00.000Z");

const summer=astronomy(new Date("2026-06-21T16:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.ok(summer.duskMs!=null);
const duskLocal=localParts(new Date(summer.duskMs),"America/New_York");
assert.deepEqual([duskLocal.year,duskLocal.month,duskLocal.day],[2026,6,21]);

const universalSplit=normalizeCalendarConfig({
  settings:{...base.settings,overlap:1},
  special:[],customSchedules:[],
  events:[
    {...base.events[0],id:"same-a",name:"Same Night A"},
    {...base.events[0],id:"same-b",name:"Same Night B",effect:"Breath",colors:[0x0000ff]}
  ]
});
r=resolveCalendar(universalSplit,new Date("2026-12-25T23:30:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"Same Night A");
r=resolveCalendar(universalSplit,new Date("2026-12-26T01:30:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"Same Night B");

const universalCombine=normalizeCalendarConfig({
  settings:{...base.settings,overlap:2},
  special:[],customSchedules:[],
  events:[
    {...base.events[0],id:"combine-a",name:"Combine A",colors:[0xff0000]},
    {...base.events[0],id:"combine-b",name:"Combine B",colors:[0x0000ff]}
  ]
});
r=resolveCalendar(universalCombine,new Date("2026-12-25T23:30:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.scene.effect,"Cycle");
assert.deepEqual(r?.scene.colors,[0xff0000,0x0000ff]);

const aiOneTime=normalizeCalendarConfig({
  settings:{...base.settings,overlap:2},
  special:[{id:"ai-once-test",year:2026,month:12,day:25}],
  customSchedules:[],
  events:[
    base.events[0],
    {id:"ai-once-test",name:"AI Christmas Reverse",kind:"AI One-Time",rule:"YearTable",month:12,day:25,weekday:0,nth:0,offsetDays:0,durationDays:1,
      effect:"Flow1",speed:2,brightness:62,colors:[0xff0000,0x00ff00],enabled:true,categoryIndex:0,major:true,dateRuleSourceId:"ai-once-test",
      creativePhases:[{effect:"Flow1",speed:2,minutes:5,shift:0},{effect:"Flow2",speed:3,minutes:5,shift:1}],
      aiOneTime:true,aiReplaceEventId:"xmas",expiresAt:"2026-12-26T14:00:00.000Z"}
  ]
});
r=resolveCalendar(aiOneTime,new Date("2026-12-25T22:02:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"AI Christmas Reverse","Approved AI one-time event must replace the normal holiday for that night");
assert.equal(r?.scene.brightness,62,"AI one-time event brightness must be honored during Schedule 1");
assert.equal(r?.scene.effect,"Flow1");
r=resolveCalendar(aiOneTime,new Date("2026-12-25T22:06:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.scene.effect,"Flow2","AI multi-layer recipe must advance through its saved phases");


// Per-event scheduling overrides: built-in date, specific date, date range,
// entire month, annual/one-year recurrence, and event-specific times.
const halloweenBase={id:"halloween",name:"Halloween",kind:"Holiday",rule:"Fixed",month:10,day:31,weekday:0,nth:0,offsetDays:0,durationDays:1,effect:"Flow1",speed:2,colors:[0xff6600,0x8000ff],enabled:true,categoryIndex:0,major:true};

const halloweenMonth=normalizeCalendarConfig({...base,events:[{
  ...halloweenBase,
  scheduleOverride:{mode:"month",annual:true,year:0,startMonth:10,startDay:1,endMonth:10,endDay:31,customTime:false,start:0,end:0}
}]});
r=resolveCalendar(halloweenMonth,new Date("2026-10-10T23:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"Halloween","Entire-month override should run Halloween on every October lighting night");
r=resolveCalendar(halloweenMonth,new Date("2026-11-10T23:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.notEqual(r?.name,"Halloween");

const halloweenRange=normalizeCalendarConfig({...base,events:[{
  ...halloweenBase,
  scheduleOverride:{mode:"range",annual:true,year:0,startMonth:10,startDay:20,endMonth:11,endDay:2,customTime:false,start:0,end:0}
}]});
r=resolveCalendar(halloweenRange,new Date("2026-10-25T23:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"Halloween");
r=resolveCalendar(halloweenRange,new Date("2026-11-01T23:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"Halloween","Annual date ranges may cross a month boundary");

const halloweenOneYear=normalizeCalendarConfig({...base,events:[{
  ...halloweenBase,
  scheduleOverride:{mode:"date",annual:false,year:2026,startMonth:10,startDay:30,endMonth:10,endDay:30,customTime:false,start:0,end:0}
}]});
r=resolveCalendar(halloweenOneYear,new Date("2026-10-30T23:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"Halloween");
r=resolveCalendar(halloweenOneYear,new Date("2027-10-30T23:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.notEqual(r?.name,"Halloween","One-year date override must not recur");

const timedHalloween=normalizeCalendarConfig({...base,settings:{...base.settings,on:17*60,off:23*60,schedule2Enabled:false},events:[{
  ...halloweenBase,
  scheduleOverride:{mode:"date",annual:true,year:0,startMonth:10,startDay:31,endMonth:10,endDay:31,customTime:true,start:20*60+30,end:22*60}
}]});
r=resolveCalendar(timedHalloween,new Date("2026-10-31T23:30:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r,null,"Event-specific start time should suppress the event before 8:30 PM local");
r=resolveCalendar(timedHalloween,new Date("2026-11-01T01:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"Halloween","Event-specific time window should run inside its custom clock range");
r=resolveCalendar(timedHalloween,new Date("2026-11-01T02:30:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r,null,"Event-specific end time should stop the event before global Schedule 1 ends");

const normalizedSchedule=timedHalloween.events[0].scheduleOverride;
assert.deepEqual(normalizedSchedule,{mode:"date",annual:true,year:0,startMonth:10,startDay:31,endMonth:10,endDay:31,customTime:true,start:1230,end:1320});
const timedNext=nextCalendarEvent(timedHalloween,new Date("2026-10-31T14:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(new Date(timedNext.at).toISOString(),"2026-11-01T00:30:00.000Z","Next-event time should use the event-specific start time");

const whiteOverrides=normalizeCalendarConfig({
  settings:{...base.settings,enabled:false,whiteOverride1Enabled:true,whiteOverride2Enabled:true},
  special:[],customSchedules:[],events:[]
});
r=resolveCalendar(whiteOverrides,new Date("2026-09-28T01:15:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"White Override 1");
assert.equal(r?.scene.brightness,100);
assert.deepEqual(r?.scene.colors,[0xffffff]);
r=resolveCalendar(whiteOverrides,new Date("2026-09-28T10:05:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"White Override 2");
assert.equal(r?.scene.brightness,100);
r=resolveCalendar(whiteOverrides,new Date("2026-09-28T11:30:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r,null,"Morning white override must be off by 7:30 AM");
r=resolveCalendar(whiteOverrides,new Date("2026-06-21T10:05:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r,null,"Morning white override must not start when civil dawn was before 6:00 AM");
r=resolveCalendar(whiteOverrides,new Date("2026-10-03T01:15:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r,null,"White Override 1 must be skipped on Friday night");
r=resolveCalendar(whiteOverrides,new Date("2026-10-04T01:15:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r,null,"White Override 1 must be skipped on Saturday night");
r=resolveCalendar(whiteOverrides,new Date("2026-10-02T10:05:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r,null,"White Override 2 must be skipped on Friday morning");
r=resolveCalendar(whiteOverrides,new Date("2026-10-03T10:05:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r,null,"White Override 2 must be skipped on Saturday morning");

const whiteBoundary=nextCalendarBoundary(whiteOverrides,new Date("2026-09-28T00:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(new Date(whiteBoundary.at).toISOString(),"2026-09-28T01:00:00.000Z");

console.log("Holiday calendar regression: PASS");
