import assert from "node:assert/strict";
import fs from "node:fs";
import {buildEffect,OP_SHOW,OP_COLOR} from "../dist/eufy/light-commands.js";
import {effectReportMatches} from "../dist/eufy/mqtt.js";
// Independent original SDK snapshots: mega-yfue/eufy-sdk @ 52490349627c9a177d87a2b1e67b2b43dd50cbc1.
// These establish encoding parity; they do not establish visible behavior on physical E120 lights.
const fixtures=JSON.parse(fs.readFileSync(new URL("sdk-effects.json",import.meta.url)));
for(const f of fixtures){
 const solid=f.solid!==undefined;
 const result=buildEffect("T8L02",solid?"Solid / Static":f.effect,solid?[f.solid]:f.colors,f.speed??3,f.reverse??false);
 assert.equal(result.opcode,solid?OP_COLOR:OP_SHOW);
 assert.equal(Buffer.from(result.fields).toString("hex"),f.hex,f.effect??"Solid");
}
assert.equal(effectReportMatches({effectId:10996},10996),true);
assert.equal(effectReportMatches({effectId:10775},10996),false);
assert.equal(effectReportMatches({brightness:50},10996),null);
assert.throws(()=>buildEffect("T8L02","unknown",[0xff0000],3,false),/Unsupported/);
console.log(`Effects: ${fixtures.length} independent SDK snapshots and report matching PASS`);

// E120 native mode regression: model-specific opcode, mode, speed and direction.
const modes={Flow1:20000,Flow2:20001,Cycle:20002,Streamlight:20003,Twinkle:20004,Breathe:20005,Jump:20002,Breath:20005,Strobe:20004,Chase:20000,"Gradient Sweep":20000,"Candy Cane":20000,"Twinkle / Sparkle":20004,"Wipe / Fill":20003,"Meteor / Comet":20003,"Rainbow Flow":20000,"Pulse Wave":20005};
for(const [effect,mode] of Object.entries(modes))for(const speed of [1,2,3,4,5])for(const colors of [[0xff0000],[0xff0000,0x00ff00]]){
 const command=buildEffect("T8L00",effect,colors,speed,false);
 assert.equal(command.opcode,OP_COLOR,"E120 must use its native animation opcode");
 const bytes=Buffer.from(command.fields);
 assert.equal(bytes.readUInt16LE(2),mode,effect);
 const fields=new Map();for(let i=0;i<bytes.length;){const tag=bytes[i++],length=bytes[i++];fields.set(tag,bytes.subarray(i,i+length));i+=length;}
 assert.equal(fields.get(0xac).readUInt32LE(),0xffffffff,"personal modes must not reference catalog 10034");
 assert.deepEqual([...bytes.subarray(8,11)],[0xa5,1,speed]);
}
for(const effect of ["Chase","Candy Cane"]){
 const reversed=buildEffect("T8L00",effect,[0xff0000],3,true);
 assert.equal(Buffer.from(reversed.fields).readUInt16LE(2),20001);
}
console.log("E120 native modes, all speeds, palette grouping and reversed chase PASS");
