import assert from 'node:assert/strict';
import { EufyClient } from '../dist/eufy/client.js';
import { isBrightnessOnlyControl } from '../dist/eufy/light-commands.js';

assert.equal(isBrightnessOnlyControl({brightness:45}),true);
assert.equal(isBrightnessOnlyControl({target:'All',brightness:45}),true);
for(const v of [{},null,{brightness:0},{brightness:101},
  {brightness:45,effect:'Flow1'},{brightness:45,power:true},
  {brightness:45,name:'Manual'},{brightness:45,colors:[0xff00ff]},
  {brightness:45,speed:3},{brightness:'invalid'}])
  assert.equal(isBrightnessOnlyControl(v),false,JSON.stringify(v));

const client=new EufyClient('00000000000000000000000000000001');
let calls=[];
client.command=async(name,frames,waitMs)=>{calls.push({name,frames,waitMs});return {published:frames.length,brokerAccepted:true,deviceReported:false};};
await client.brightness('Garage',45);
assert.equal(calls.length,1);
assert.equal(calls[0].frames.length,1,'Brightness-only command should publish one frame');
assert.equal(calls[0].frames[0].opcode,0x0201);
assert.deepEqual([...calls[0].frames[0].fields],[0xa4,1,45]);
assert.equal(calls[0].name,'Garage');
console.log('Oracle Eufy brightness-only routing: PASS');
