import assert from "node:assert/strict";
import { normalizeCalendarConfig, resolveCalendar, nextCalendarEvent, nextCalendarBoundary, nextCalendarTransition } from "../dist/calendar.js";
import { astronomy, localParts } from "../dist/scheduler.js";

const base={
  settings:{
    enabled:true,mode:2,lead:0,trail:0,on:17*60,off:23*60,startAtDusk:false,
    schedule2Enabled:true,schedule2EndAtDawn:false,schedule2End:6*60,
    schedule2Brightness:10,overlap:0,categoryMask:32767
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
assert.equal(r?.scene.effect,"Candy Cane");
assert.equal(r?.schedule2,false);

r=resolveCalendar(cfg,new Date("2026-12-26T04:30:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"Christmas Day");
assert.equal(r?.schedule2,true);
assert.equal(r?.scene.brightness,10);

r=resolveCalendar(cfg,new Date("2026-09-27T22:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"Hispanic Heritage Month");

cfg=normalizeCalendarConfig({...base,customSchedules:[{
  id:"custom1",name:"Birthday Test",enabled:true,annual:true,year:2026,month:12,day:25,
  effect:"Breath",speed:3,brightness:88,colors:[0x123456]
}]});
r=resolveCalendar(cfg,new Date("2026-12-25T23:00:00Z"),42.1507,-78.9452,"America/New_York");
assert.equal(r?.name,"Birthday Test");
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
  schedule2Brightness:10,overlap:0,categoryMask:0
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
  settings:{...base.settings,on:17*60,off:23*60,startAtDusk:false,schedule2Enabled:false},
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

console.log("Holiday calendar regression: PASS");
