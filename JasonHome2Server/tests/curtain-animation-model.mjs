import test from 'node:test';
import assert from 'node:assert/strict';
import {createCurtainAiAnimation} from '../curtain_ai_animation.mjs';

const encoded=(()=>{
 const jpeg=Buffer.alloc(724,0x44);
 jpeg[0]=0xff;jpeg[1]=0xd8;jpeg[722]=0xff;jpeg[723]=0xd9;
 return jpeg.toString('base64');
})();
const configure=(imageCalls,options={})=>createCurtainAiAnimation({
 configured:()=>options.configured??true,
 model:'@cf/zai-org/glm-4.7-flash',
 run:async(model,payload)=>{
  assert.equal(model,'@cf/black-forest-labs/flux-1-schnell');
  assert.deepEqual(Object.keys(payload).sort(),['prompt','steps']);
  assert.equal(Object.hasOwn(payload,'seed'),false,'FLUX must never receive an unsupported seed');
  assert.equal(payload.steps,4);
  imageCalls.push(payload);
  return {result:{image:encoded}};
 },
 chat:async()=>({choices:[{message:{content:JSON.stringify({
  poses:[
   'eyes completely shut and mouth closed',
   'eyes opening and mouth forming an oval',
   'mouth broad grin with eyes fully opened',
   'mouth half smile with one eyelid lowered'],
  note:'wink'
 })}}]}),
 text:result=>result.choices?.[0]?.message?.content
});

test('Generate sends only Cloudflare supported FLUX fields for base and action poses',async()=>{
 const calls=[],client=configure(calls);
 const base=await client.generate({prompt:'Pumpkin winks and smiles'});
 assert.match(base.image,/^data:image\/jpeg;base64,/);
 assert.equal(calls.length,1);
 assert.match(calls[0].prompt,/Initial resting pose/);
 const pose=await client.generate({prompt:'Pumpkin winks and smiles',pose:'eyes completely shut'});
 assert.equal(calls.length,2);
 assert.match(calls[1].prompt,/eyes completely shut/);
 assert.match(calls[1].prompt,/SAME character identity/);
 assert.equal(pose.keyPose,'eyes completely shut');
});

test('Motion plans exactly four distinct character poses instead of a sliding image',async()=>{
 const plan=await configure([]).motion({prompt:'A pumpkin winks'});
 assert.equal(plan.method,'AI-drawn-keyframes');
 assert.equal(plan.poses.length,4);
 assert.equal(new Set(plan.poses).size,4);
});

test('Absent Cloudflare configuration stops generation without issuing requests',async()=>{
 const calls=[],client=configure(calls,{configured:false});
 await assert.rejects(client.generate({prompt:'pumpkin winking'}),/Connect Cloudflare/);
 assert.equal(calls.length,0);
});
