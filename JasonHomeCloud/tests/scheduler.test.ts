import { nextScheduleEvent, resolveScheduleState, scheduleOccurrences } from "../src/scheduler";
import type { ScheduleRow } from "../src/types";

function row(overrides:Partial<ScheduleRow>):ScheduleRow{
  return {
    id:"base",name:"Base",enabled:1,days:"*",start_kind:"clock",start_value:"18:00",end_kind:"clock",end_value:"23:00",
    target:"All",effect:"Solid / Static",colors:"[16777215]",brightness:75,speed:3,priority:0,...overrides
  };
}
function assert(ok:any,msg:string){if(!ok)throw new Error(msg);}
const tz="America/New_York",lat=42.0529,lon=-79.0576,devices=["Pool","House","Garage","Shed"];

const evening=new Date("2026-09-28T00:00:00Z"); // 8:00 PM EDT
const rows=[
  row({id:"all",name:"All Evening"}),
  row({id:"pool",name:"Pool Breath",target:"Pool",start_value:"19:00",end_value:"21:00",effect:"Breath",priority:5})
];
const resolved=resolveScheduleState(rows,evening,lat,lon,tz,devices);
assert(resolved.Pool?.row.id==="pool","higher-priority Pool schedule must win");
assert(resolved.House?.row.id==="all","All schedule must continue on House");

const overnight=row({id:"overnight",name:"Overnight",start_value:"22:00",end_value:"06:00",effect:"Twinkle / Sparkle"});
const oneAm=new Date("2026-09-28T05:00:00Z"); // 1:00 AM EDT
const overnightState=resolveScheduleState([overnight],oneAm,lat,lon,tz,devices);
assert(overnightState.Pool?.row.id==="overnight","cross-midnight schedule must remain active after midnight");
const occ=scheduleOccurrences([overnight],oneAm,lat,lon,tz,2,1).find(x=>x.start<=oneAm.getTime()&&oneAm.getTime()<x.end);
assert(!!occ&&occ.end>occ.start,"cross-midnight occurrence must have end after start");

const next=nextScheduleEvent(rows,new Date("2026-09-28T00:30:00Z"),lat,lon,tz); // 8:30 PM EDT
assert(next?.row.id==="pool"&&next.phase==="end","next event should be Pool priority schedule ending at 9 PM");

console.log("Jason Home scheduler regression: PASS");
