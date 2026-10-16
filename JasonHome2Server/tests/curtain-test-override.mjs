import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext,Script} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const home=dirname(dirname(fileURLToPath(import.meta.url)));
const html=readFileSync(join(home,'curtain_converter.html'),'utf8');
const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const code=scripts.at(-1);
const start=code.indexOf("$('testSlotOverride').onclick=()=>operation(async()=>");
const end=code.indexOf("$('play').onclick=()=>",start);
assert.ok(start>0&&end>start,'test override handler must be standalone before original Play button');
const handler=code.slice(start,end);

test('Experimental override is additive and leaves existing controls and parsable scripts intact',()=>{
 assert.equal(scripts.length,4);
 for(const js of scripts)if(js.trim())new Script(js);
 for(const id of ['sendLive','stopSend','install','build','play','restore','testSlotOverride','testOverrideStatus'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(code,/\$\('testSlotOverride'\)\.disabled=busy\|\|!connected\|\|!sourceImage/);
 assert.match(handler,/await delete928\(\)/);
 assert.match(handler,/await sendFile\(bytes\)/);
 assert.match(handler,/inventory\('test-override-verification'\)/);
 assert.doesNotMatch(handler,/await drawLive\(\)/);
 assert.doesNotMatch(handler,/prepared=/);
});

async function simulate(mode,{connected=true,valid=true,hasSlot=true}={}){
 const events=[],elements={},frame0=new Uint8ClampedArray(6400),sourceImage=new Uint8ClampedArray(6400);
 const $=id=>elements[id]??=(id==='motion'?{value:mode}:{textContent:''});
 const context={
  $,CID:83928,connected,firmware:{},sourceImage,
  frames:mode==='gif'?[frame0,new Uint8ClampedArray(6400)]:[frame0],
  log:x=>events.push(['log',x]),
  stopPreview:()=>events.push(['stopPreview']),
  nativeFromImage:image=>{events.push(['nativeFromImage',image]);return new Uint8Array(4096);},
  plan:()=>{events.push(['plan']);if(!valid)throw Error('Invalid native effect');},
  delete928:async()=>events.push(['delete928']),
  sendFile:async()=>events.push(['sendFile']),
  inventory:async()=>{events.push(['inventory']);return hasSlot?[{cid:83928,slot:3}]:[];},
  say:message=>events.push(['say',message]),
  operation:async fn=>fn(),
  JSON,Error,Number,
 };
 runInNewContext(handler,context);
 let error;
 try{await $('testSlotOverride').onclick();}catch(err){error=err;}
 return {events,elements,frame0,sourceImage,error};
}

test('Static test save writes verified native frame, deletes only via existing guarded delete and confirms slot',async()=>{
 const r=await simulate('static');
 assert.equal(r.error,undefined);
 assert.deepEqual(r.events.filter(x=>['plan','stopPreview','delete928','sendFile','inventory'].includes(x[0])).map(x=>x[0]),['plan','stopPreview','delete928','sendFile','inventory']);
 assert.equal(r.events.find(x=>x[0]==='nativeFromImage')[1],r.sourceImage);
 assert.match(r.elements.testOverrideStatus.textContent,/not guaranteed stationary/);
 assert.match(r.elements.testOverrideStatus.textContent,/83928 saved/);
});

test('GIF override tests native storage with first frame only, does not claim GIF animation saved',async()=>{
 const r=await simulate('gif');
 assert.equal(r.error,undefined);
 assert.equal(r.events.find(x=>x[0]==='nativeFromImage')[1],r.frame0);
 assert.match(r.elements.testOverrideStatus.textContent,/only the first frame was stored/);
 assert.match(r.elements.testOverrideStatus.textContent,/animation remains unverified/);
});

test('Validation failure prevents controller deletion and upload',async()=>{
 const r=await simulate('gif',{valid:false});
 assert.match(String(r.error),/Invalid native effect/);
 assert.equal(r.events.some(x=>x[0]==='delete928'),false);
 assert.equal(r.events.some(x=>x[0]==='sendFile'),false);
 assert.match(r.elements.testOverrideStatus.textContent,/Test override failed/);
});
test('Controller inventory without the target CID cannot be reported as success',async()=>{
 const r=await simulate('static',{hasSlot:false});
 assert.match(String(r.error),/did not confirm/);
 assert.match(r.elements.testOverrideStatus.textContent,/Test override failed/);
});
test('No Bluetooth connection means no deletion or upload',async()=>{
 const r=await simulate('static',{connected:false});
 assert.match(String(r.error),/Connect DN5E58/);
 assert.equal(r.events.some(x=>x[0]==='delete928'),false);
});
