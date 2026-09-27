import assert from "node:assert/strict";
import { normalizeCalendarConfig, resolveCalendar, nextCalendarEvent } from "../dist/calendar.js";

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
let r=resolveCalendar(cfg,new Date("2026-12-25T23:00:00Z"),42.0529,-79.0576,"America/New_York");
assert.equal(r?.name,"Christmas Day");
assert.equal(r?.scene.effect,"Candy Cane");
assert.equal(r?.schedule2,false);

r=resolveCalendar(cfg,new Date("2026-12-26T04:30:00Z"),42.0529,-79.0576,"America/New_York");
assert.equal(r?.name,"Christmas Day");
assert.equal(r?.schedule2,true);
assert.equal(r?.scene.brightness,10);

r=resolveCalendar(cfg,new Date("2026-09-27T22:00:00Z"),42.0529,-79.0576,"America/New_York");
assert.equal(r?.name,"Hispanic Heritage Month");

cfg=normalizeCalendarConfig({...base,customSchedules:[{
  id:"custom1",name:"Birthday Test",enabled:true,annual:true,year:2026,month:12,day:25,
  effect:"Breath",speed:3,brightness:88,colors:[0x123456]
}]});
r=resolveCalendar(cfg,new Date("2026-12-25T23:00:00Z"),42.0529,-79.0576,"America/New_York");
assert.equal(r?.name,"Birthday Test");
assert.equal(r?.scene.brightness,88);

const next=nextCalendarEvent(normalizeCalendarConfig(base),new Date("2026-12-01T15:00:00Z"),42.0529,-79.0576,"America/New_York");
assert.equal(next?.name,"Christmas Day");

console.log("Holiday calendar regression: PASS");
