import test from 'node:test';
import assert from 'node:assert/strict';
import {encode40PNG,cleanScene,render40,templateScene,createLocalAI} from '../local_ai.mjs';
const orange=templateScene('Smiling orange pumpkin');
test('Model-independent pixel art outputs real 40x40 PNG',()=>{
 const pixels=render40(orange),png=encode40PNG(pixels);
 assert.equal(pixels.length,6400);
 assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 assert.equal(png.readUInt32BE(16),40);assert.equal(png.readUInt32BE(20),40);
 assert.ok(orange.shapes.length>4);
});
test('Untrusted scene is capped to 28 safe shapes and clamped coordinates',()=>{
 const s=cleanScene({background:'javascript:alert(1)',shapes:Array.from({length:99},()=>({type:'rect',x:-999,y:200,w:20,h:20,color:'red'}))});
 assert.equal(s.background,'#000000');assert.equal(s.shapes.length,28);
 assert.equal(s.shapes[0].x,-10);assert.equal(s.shapes[0].y,55);
 assert.equal(s.shapes[0].color,'#ff9900');
});
test('Local-only model serves chat, OpenAI-compatible completion, and generated art',async()=>{
 let n=0;
 const request=async(url,options)=>{
  assert.ok(url.startsWith('http://localhost:11434/'),'No outside AI requests permitted');
  if(url.endsWith('/api/tags'))return {ok:true,json:async()=>({models:[{name:'qwen2.5:1.5b-instruct'}]})};
  const payload=JSON.parse(options.body);
  assert.equal(payload.stream,false);assert.equal(payload.keep_alive,0);
  n++;
  const output=n===1?'A friendly chat reply.':n===2?'{"reply":"Sure","draft":null}':JSON.stringify(orange);
  return {ok:true,json:async()=>({message:{content:output},prompt_eval_count:20,eval_count:30})};
 };
 const ai=createLocalAI({url:'http://localhost:11434',request});
 assert.equal((await ai.status()).ok,true);
 assert.match((await ai.chat({message:'Hello there'})).reply,/friendly/);
 const c=await ai.completion({messages:[{role:'user',content:'Make lights'}],response_format:{type:'json_schema',json_schema:{schema:{type:'object'}}}});
 assert.equal(c.choices[0].message.content,'{"reply":"Sure","draft":null}');
 const a=await ai.art({prompt:'Draw a pumpkin'});
 assert.equal(a.width,40);assert.equal(a.sourceKind,'model');
 assert.ok(a.image.startsWith('data:image/png;base64,'));
});
test('Invalid model art falls back locally, clearly labeled',async()=>{
 const ai=createLocalAI({url:'http://localhost:11434',request:async()=>({ok:true,json:async()=>({message:{content:'{nope'}})})});
 const a=await ai.art({prompt:'A ghost'});
 assert.equal(a.sourceKind,'fallback');
 assert.ok(a.image.startsWith('data:image/png;base64,'));
});