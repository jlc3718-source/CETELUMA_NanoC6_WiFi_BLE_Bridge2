import assert from "node:assert/strict";
import { EufyClient } from "../dist/eufy/client.js";
import { isBrightnessOnlyControl } from "../dist/eufy/light-commands.js";

assert.equal(isBrightnessOnlyControl({brightness:37}),true);
assert.equal(isBrightnessOnlyControl({brightness:37,target:"All"}),true);
for(const invalid of [
 {},{target:"All"},{brightness:0},{brightness:101},
 {brightness:"bad"},{brightness:38,effect:"Twinkle"},
 {brightness:38,power:true},{brightness:38,colors:[0xff00ff]},
 {brightness:38,speed:3},{brightness:38,name:"new show"},null
])assert.equal(isBrightnessOnlyControl(invalid),false,JSON.stringify(invalid));

const client=new EufyClient("00000000000000000000000000000001");
let frames=[];
client.command=async(name,commands,waitMs)=>{frames=commands;return {published:commands.length,brokerAccepted:true,deviceReported:false,waitMs};};
await client.brightness("Garage",37);
assert.equal(frames.length,1,"A slider adjustment must be a single MQTT frame");
assert.equal(frames[0].opcode,0x0201);
assert.deepEqual([...frames[0].fields],[0xa4,1,37]);

for(const [name,effect,color,opcode] of [
 ["Pool","Solid / Static",0x5b00e6,0x0206],
 ["Garage","Twinkle / Sparkle",0xff0d00,0x020d]
]){
 await client.scene(name,effect,[color],3,37);
 assert.equal(frames.length,3);
 assert.equal(frames[0].label,"ON");
 assert.equal(frames[1].opcode,opcode);
 assert.match(frames[1].label,/EFFECT/);
 assert.equal(frames[2].label,"BRIGHTNESS");
 assert.equal(frames[2].opcode,0x0201);
 assert.deepEqual([...frames[2].fields],[0xa4,1,37],
   "Eufy brightness must be sent after the effect payload");
}
console.log("Eufy brightness frame ordering and single-command routing: PASS");
