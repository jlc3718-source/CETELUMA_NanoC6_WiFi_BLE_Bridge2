import assert from "node:assert/strict";
import { normalizeCalendarConfig } from "../shared/calendar.js";
import { resolveNightEvents, resolveNightCandidates, resolveNightCandidateScene, lightingNightDate } from "../night_resolver.mjs";

const lat=42.1507,lon=-78.9452,tz="America/New_York";
const settings={
  enabled:true,mode:2,lead:0,trail:0,on:17*60,off:21*60,startAtDusk:false,
  schedule2Enabled:true,schedule2EndAtDawn:false,schedule2End:6*60,
  schedule2Brightness:10,overlap:0,categoryMask:32767,
  whiteOverride1Enabled:true,whiteOverride2Enabled:true
};
const monthly={id:"monthly",name:"Monthly Awareness",kind:"Awareness",rule:"Month",month:9,day:1,weekday:0,nth:0,offsetDays:0,durationDays:30,effect:"Candy Cane",speed:2,colors:[0xff0000,0xffffff],enabled:true,categoryIndex:1,major:false};
const factory={id:"event::factory:77",name:"Factory Special",kind:"Holiday",rule:"Fixed",month:9,day:28,weekday:0,nth:0,offsetDays:0,durationDays:1,effect:"Pulse Wave",speed:3,colors:[0x00ff00],enabled:true,categoryIndex:0,major:true};
const custom={id:"schedule-test",name:"Custom Test",enabled:true,annual:true,year:2026,month:9,day:28,effect:"Breath",speed:3,brightness:75,colors:[0x0000ff]};
const make=overlap=>normalizeCalendarConfig({settings:{...settings,overlap},events:[monthly,factory],special:[],customSchedules:[custom]});
const ids=cfg=>resolveNightEvents(cfg,{year:2026,month:9,day:28},lat,lon,tz).map(x=>x.id);

const rotate=ids(make(0));
assert.equal(rotate.length,1,"rotate-nightly overlap must expose only the actual winner");
assert.ok(["monthly","event::factory:77","schedule-test"].includes(rotate[0]));
assert.deepEqual(new Set(resolveNightCandidates(make(0),{year:2026,month:9,day:28},lat,lon,tz).map(x=>x.id)),
  new Set(["monthly","event::factory:77","schedule-test"]),"tonight chooser must expose every legitimate candidate even in rotate-nightly mode");
const chosenScene=resolveNightCandidateScene(make(0),{year:2026,month:9,day:28},"schedule-test",new Date("2026-09-28T22:00:00Z"),lat,lon,tz);
assert.equal(chosenScene?.effect,"Breathe");
assert.equal(chosenScene?.brightness,75);
assert.deepEqual(chosenScene?.colors,[0x0000ff]);

assert.deepEqual(new Set(ids(make(1))),new Set(["monthly","event::factory:77","schedule-test"]),"split-night overlap must expose every participating item");
assert.deepEqual(new Set(ids(make(2))),new Set(["monthly","event::factory:77","schedule-test"]),"combined overlap must expose every participating item");

const whitesOnly=normalizeCalendarConfig({settings,events:[],special:[],customSchedules:[]});
assert.deepEqual(resolveNightEvents(whitesOnly,{year:2026,month:9,day:28},lat,lon,tz),[],"white overrides are transitions, not calendar dots");

assert.deepEqual(lightingNightDate(make(1),new Date("2026-09-29T03:00:00Z"),lat,lon,tz),{year:2026,month:9,day:28},"after midnight still belongs to the prior lighting night");
assert.deepEqual(lightingNightDate(make(1),new Date("2026-09-28T16:00:00Z"),lat,lon,tz),{year:2026,month:9,day:28},"before dusk resolves the upcoming local night");

console.log("Jason Home 2 authoritative night resolver: PASS");
