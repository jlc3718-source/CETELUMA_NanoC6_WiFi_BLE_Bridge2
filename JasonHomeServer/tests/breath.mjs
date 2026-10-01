import assert from "node:assert/strict";
import fs from "node:fs";
import {buildEffect,brightness as brightnessFields,OP_COLOR,OP_SHOW,nativeE120Fields,e120SpeedValue,styleDefinition} from "../dist/eufy/light-commands.js";
import {buildFactoryFields} from "../dist/eufy/factory-presets.js";
import {effectReportMatches} from "../dist/eufy/mqtt.js";
// Independent original SDK snapshots: mega-yfue/eufy-sdk @ 52490349627c9a177d87a2b1e67b2b43dd50cbc1.
// These establish encoding parity; they do not establish visible behavior on physical E120 lights.
const fixtures=JSON.parse(fs.readFileSync(new URL("sdk-effects.json",import.meta.url)));
for(const f of fixtures){
 const solid=f.solid!==undefined;
 if(solid)continue;
 const preset=styleDefinition(f.effect,f.colors,[1,3,5,8,10][(f.speed??3)-1],f.reverse??false);
 assert.equal(Buffer.from(buildFactoryFields("T8L02",preset)).toString("hex"),f.hex,f.effect);
}
assert.equal(effectReportMatches({effectId:10996},10996),true);
assert.equal(effectReportMatches({effectId:10775},10996),false);
assert.equal(effectReportMatches({brightness:50},10996),null);
assert.throws(()=>buildEffect("T8L02","unknown",[0xff0000],3,false),/Unsupported/);
console.log(`Factory effects: independent SDK snapshots and report matching PASS`);

// E120 native mode regression: model-specific opcode, mode, speed and direction.
const modes={Static:20006,Flow1:20000,Flow2:20001,Cycle:20002,Streamlight:20003,Twinkle:20004,Breathe:20005,Jump:20002,Breath:20005,Strobe:20004,Chase:20000,"Gradient Sweep":20000,"Candy Cane":20000,"Twinkle / Sparkle":20004,"Wipe / Fill":20003,"Meteor / Comet":20003,"Rainbow Flow":20000,"Pulse Wave":20005};
for(const [effect,mode] of Object.entries(modes))for(const speed of [1,2,3,4,5,6,7,8,9,10])for(const colors of [[0xff0000],[0xff0000,0x00ff00]]){
 const command=buildEffect("T8L00",effect,colors,speed,false);
 assert.equal(command.opcode,OP_COLOR,"E120 must use its native animation opcode");
 const bytes=Buffer.from(command.fields);
 assert.equal(bytes.readUInt16LE(2),mode,effect);
 const fields=new Map();for(let i=0;i<bytes.length;){const tag=bytes[i++],length=bytes[i++];fields.set(tag,bytes.subarray(i,i+length));i+=length;}
 assert.equal(fields.get(0xac).readUInt32LE(),0xffffffff,"personal modes must not reference catalog 10034");
 assert.deepEqual([...bytes.subarray(8,11)],[0xa5,1,e120SpeedValue(speed)]);
}
for(const effect of ["Chase","Candy Cane"]){
 const reversed=buildEffect("T8L00",effect,[0xff0000],3,true);
 assert.equal(Buffer.from(reversed.fields).readUInt16LE(2),20001);
}
console.log("E120 native modes, all speeds, palette grouping and reversed chase PASS");

function tags(bytes){const out={};for(let i=0;i<bytes.length;){const tag=bytes[i++],length=bytes[i++];out[tag.toString(16)]=Buffer.from(bytes.subarray(i,i+length)).toString("hex");i+=length;}return out;}
for(const value of [1,10,20,30,40,50,60,70,80,90,100]){
  assert.equal(tags(brightnessFields(value)).a4,value.toString(16).padStart(2,"0"),"native 0x0201 A4 brightness "+value);
}
console.log("Captured native brightness A4 encoding 1-100 PASS");
// Live Eufy app speed-only frames, observed 2026-09-29, Pool / Breathe.
for(const rawSpeed of [1,10])assert.deepEqual(tags(nativeE120Fields(20005,rawSpeed,[],60)),{
 a3:"254e",a4:"0000",a5:rawSpeed===1?"01":"0a",a6:"00",a8:"64",a9:"00000000",aa:"00",ac:"ffffffff",ae:"00",b0:"00"
});
const blue=tags(buildEffect("T8L00","Breathe",[0x0000ff],10,false).fields);
assert.equal(blue.a6,"010000ff00");assert.equal(blue.a7,"3c"+Array.from({length:60},(_,i)=>i.toString(16).padStart(2,"0")).join(""));
assert.equal(blue.a5,"0a");assert.equal(blue.a9,"00000000");
assert.equal(tags(buildEffect("T8L00","Breathe",[0xff0000,0x0000ff],5,false,42).fields).a8,"2a");
const grouped=Buffer.from(tags(buildEffect("T8L00","Breathe",[0xff0000,0x0000ff],5,false).fields).a7,"hex");
const members=[];for(let i=0;i<grouped.length;){const n=grouped[i++];assert.equal(n,30);members.push(...grouped.subarray(i,i+n));i+=n;}
assert.deepEqual(members.sort((a,b)=>a-b),Array.from({length:60},(_,i)=>i));
console.log("E120 live speed-only fixtures, blue palette, four-byte A9, brightness and complete color-group coverage PASS");

// Live Eufy app T8L02 personal-mode captures, Shed, 2026-09-29.
const e22A4={Static:"0000",Flow1:"0100",Flow2:undefined,Cycle:"0100",Streamlight:"0100",Twinkle:"0000",Breathe:"0000"};
for(const [effect,mode] of Object.entries({Static:20006,Flow1:20000,Flow2:20001,Cycle:20002,Streamlight:20003,Twinkle:20004,Breathe:20005})){
 for(const speed of [1,10]){
  const command=buildEffect("T8L02",effect,[0x0000ff],speed,false,100,28);
  assert.equal(command.opcode,OP_COLOR,"E22 personal modes use 0x0206");
  const fields=tags(command.fields);
  assert.equal(Buffer.from(fields.a3,"hex").readUInt16LE(),mode,effect);
  assert.equal(fields.a4,e22A4[effect],effect+" A4");
  assert.equal(fields.a5,speed===1?"01":"0a",effect+" direct speed");
  assert.equal(fields.a6,"010000ff0000",effect+" five-byte RGBCW blue");
  assert.equal(fields.a7,"1c"+Array.from({length:28},(_,i)=>i.toString(16).padStart(2,"0")).join(""),effect+" Shed positions");
  assert.equal(fields.a8,"64");assert.equal(fields.a9,"0000000000");
 }
}
assert.equal(tags(buildEffect("T8L02","Cycle",[0x0000ff],5,true,100,28).fields).a4,"0000","reversed moving mode toggles A4");
assert.equal(Buffer.from(tags(buildEffect("T8L02","Flow1",[0x0000ff],5,true,100,28).fields).a3,"hex").readUInt16LE(),20001,"reversed Flow1 selects Flow2");
const e22Grouped=Buffer.from(tags(buildEffect("T8L02","Breathe",[0xff0000,0x00ff00],10,false,100,28).fields).a7,"hex");
const e22Members=[];for(let i=0;i<e22Grouped.length;){const n=e22Grouped[i++];e22Members.push(...e22Grouped.subarray(i,i+n));i+=n;}
assert.deepEqual(e22Members.sort((a,b)=>a-b),Array.from({length:28},(_,i)=>i));
const segmented=Buffer.from(tags(buildEffect("T8L00","Flow1",[0x00b4b4,0x5b00e6],3,false,100,16,{blocks:[5,3],offset:0,mirror:false}).fields).a7,"hex");
const segGroups=[];for(let i=0;i<segmented.length;){const n=segmented[i++];segGroups.push([...segmented.subarray(i,i+n)]);i+=n;}
assert.deepEqual(segGroups[0],[0,1,2,3,4,8,9,10,11,12]);
assert.deepEqual(segGroups[1],[5,6,7,13,14,15]);
const segmentedReverse=Buffer.from(tags(buildEffect("T8L02","Flow1",[0x00b4b4,0x5b00e6],3,true,100,8,{blocks:[5,3],offset:0,mirror:false}).fields).a7,"hex");
const revGroups=[];for(let i=0;i<segmentedReverse.length;){const n=segmentedReverse[i++];revGroups.push([...segmentedReverse.subarray(i,i+n)]);i+=n;}
assert.deepEqual(revGroups[0],[7,6,5,4,3]);assert.deepEqual(revGroups[1],[2,1,0]);
console.log("E22 seven native modes, direct speeds, RGBCW palette, direction field, segmented addressing and bounded positions PASS");

const {EufyClient}=await import("../dist/eufy/client.js");
for(const name of ["Pool","Garage"]){
 const client=new EufyClient("scene-order-fixture");const batches=[];let selected;
 client.command=async (_name,frames)=>{
  batches.push(frames);
  const effect=frames.find(f=>f.opcode===OP_COLOR||f.opcode===OP_SHOW);
  if(effect)selected=Buffer.from(effect.fields).readUIntLE(2,effect.fields[1]);
  return {published:frames.length,brokerAccepted:true,deviceReported:true,report:{cmd:0x0a00,effectId:selected}};
 };
 await client.scene(name,"Breathe",[0x0000ff],5,42);
 assert.deepEqual(batches[0].map(f=>f.opcode),[0x0201,0x0206,0x0201]);
 assert.equal(tags(batches[0][1].fields).a8,"2a");
 assert.equal(tags(batches[0][2].fields).a4,"2a");
 assert.equal(batches[1][0].opcode,0x0200);
}
console.log("E120 and E22 native effects send captured dedicated brightness and confirm fresh state PASS");
