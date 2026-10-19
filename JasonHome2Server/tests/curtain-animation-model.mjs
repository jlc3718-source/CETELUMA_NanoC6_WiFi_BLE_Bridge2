import test from 'node:test';
import assert from 'node:assert/strict';
import {createCurtainAiAnimation,normalizeCurtainAiGuides} from '../curtain_ai_animation.mjs';

const encoded=(()=>{
 const jpeg=Buffer.alloc(724,0x44);
 jpeg[0]=0xff;jpeg[1]=0xd8;jpeg[722]=0xff;jpeg[723]=0xd9;
 return jpeg.toString('base64');
})();
const configure=(imageCalls,options={})=>createCurtainAiAnimation({
 configured:()=>options.configured??true,
 guides:()=>options.guides||{styleGuide:'',motionGuide:''},
 model:'@cf/zai-org/glm-4.7-flash',
 run:async(model,payload)=>{
  assert.equal(model,'@cf/black-forest-labs/flux-1-schnell');
  assert.deepEqual(Object.keys(payload).sort(),['prompt','steps']);
  assert.equal(Object.hasOwn(payload,'seed'),false,'FLUX must never receive an unsupported seed');
  assert.equal(payload.steps,4);
  imageCalls.push(payload);
  return {result:{image:encoded}};
 },
 chat:async()=>{if(options.chatError)throw options.chatError;if('chatResponse' in options)return options.chatResponse;return {choices:[{message:{content:JSON.stringify({
  poses:[
   'eyes completely shut and mouth closed',
   'eyes opening and mouth forming an oval',
   'mouth broad grin with eyes fully opened',
   'mouth half smile with one eyelid lowered'],
  note:'wink'
 })}}]};},
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

test('Malformed text, empty reasoning output and duplicate poses yield four meaningful draw-ready poses',async()=>{
 const broken=[
  '',
  'I cannot give you JSON today',
  '{"poses":["Both eyes closed"]}',
  '{"poses":["same","same","same","same"]}',
  '{"poses":["Closed eyes","Eyes wide open","Big smile"]}',
  '{"poses":['
 ];
 for(const response of broken){
  const client=configure([],{chatResponse:{choices:[{message:{content:response}}]}});
  const result=await client.motion({prompt:'Pumpkin blinking and smiling'});
  assert.equal(result.ok,true);
  assert.equal(result.poses.length,4);
  assert.equal(new Set(result.poses.map(x=>x.toLowerCase())).size,4);
  assert.equal(result.method,'AI-drawn-keyframes');
  assert.equal(result.posePlanSource,'recovered');
  assert.ok(result.poses.some(x=>/pumpkin/i.test(x)));
 }
});
test('Visual pose plan fallback follows butterfly and flame prompts, never fake sliding',async()=>{
 for(const [prompt,part] of [['Blue butterfly flaps its wings','wing'],['A candle flame dances','flame']]){
  const client=configure([],{chatResponse:{choices:[{message:{content:''}}]}});
  const result=await client.motion({prompt});
  assert.equal(result.poses.length,4);
  assert.ok(result.poses.every(x=>x.toLowerCase().includes(part)));
  assert.ok(result.poses.every(x=>!/whole-sprite panning/.test(x)));
 }
});
test('Cloudflare quota and authentication errors do not consume four expensive image calls',async()=>{
 const error=Object.assign(Error('Cloudflare quota exhausted'),{status:429});
 const client=configure([],{chatError:error});
 await assert.rejects(client.motion({prompt:'Pumpkin blinking'}),e=>e.status===429);
});
test('Prompt tuning is validated and applied to both image generation and animation planning',async()=>{
 const calls=[],guides={styleGuide:'Wide expressive triangle eyes and blocky outlines',
 motionGuide:'Wink the left eye, move only its carved mouth'};
 let chatPrompt='';
 const client=createCurtainAiAnimation({configured:()=>true,model:'@cf/zai-org/glm-4.7-flash',
  guides:()=>guides,
  run:async(m,p)=>{calls.push(p);return {result:{image:encoded}};},
  chat:async p=>{chatPrompt=p.messages[0].content;return {choices:[{message:{content:''}}]};},
  text:p=>p?.choices?.[0]?.message?.content??''
 });
 await client.generate({prompt:'A pumpkin smiling'});
 await client.motion({prompt:'A pumpkin smiling'});
 assert.match(calls[0].prompt,/Wide expressive triangle eyes/);
 assert.match(chatPrompt,/Wink the left eye/);
 assert.deepEqual(normalizeCurtainAiGuides(guides),guides);
 assert.throws(()=>normalizeCurtainAiGuides({styleGuide:'valid',unknown:'x'}),/Unsupported/);
 assert.throws(()=>normalizeCurtainAiGuides({motionGuide:'x'.repeat(701)}),/700/);
});
