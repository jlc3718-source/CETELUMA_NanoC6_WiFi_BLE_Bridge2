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
