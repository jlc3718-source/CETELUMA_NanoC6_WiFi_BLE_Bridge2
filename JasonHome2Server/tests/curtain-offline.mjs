import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext,Script} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const converter=readFileSync(join(root,'curtain_converter.html'),'utf8');
const scripts=[...converter.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
test('HTML converter scripts parse and show offline controls',()=>{
 assert.equal(scripts.length,4);
 for(const [i,match] of scripts.entries())new Script(match[1],{filename:'curtain-studio-'+i+'.js'});
 for(const term of ['id="prepareOffline"','id="offlineStatus"','id="saveDraft"','id="clearDraft"','restoreOfflineDraft();','scheduleDraftSave();']){
  assert.ok(converter.includes(term),'Missing offline control '+term);
 }
 assert.match(converter,/\$\('sendLive'\)\.disabled=busy\|\|!sourceImage\|\|\(!oracleStudio\(\)\&\&!connected\)/);
 assert.match(converter,/\$\('build'\)\.disabled=busy\|\|!sourceImage/);
 assert.match(converter,/\$\('install'\)\.disabled=busy\|\|!connected\|\|!prepared/);
});
function makeHarness(){
 const saved=new Map(),selectors={};
 const field=(id)=>{
  if(!selectors[id])selectors[id]={value:id==='motion'?'gif':id==='quality'?'pal8':'0',textContent:'',tagName:'SELECT',options:[]};
  return selectors[id];
 };
 const db={
  close(){},
  objectStoreNames:{contains(){return true;}},
  transaction(){
   const tx={};
   tx.objectStore=()=>({
    get(key){return request(()=>saved.get(key),tx);},
    put(value,key){return request(()=>saved.set(key,structuredClone(value)),tx);},
    delete(key){return request(()=>saved.delete(key),tx);}
   });
   return tx;
  }
 };
 function request(fn,tx){
  const req={};
  queueMicrotask(()=>{try{req.result=fn();req.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.());}catch(err){req.error=err;req.onerror?.();}});
  return req;
 }
 const indexedDB={open(){
  const req={result:db};
  queueMicrotask(()=>req.onsuccess?.());
  return req;
 }};
 let bleCalls=0;
 const ctx={
  window:{indexedDB},indexedDB,CID:83928,document:{addEventListener(){}},Blob,Uint8Array,Uint8ClampedArray,Promise,
  clearTimeout,setTimeout,structuredClone,queueMicrotask,Date,Error,Number,String,Object,Array,JSON,
  sourceImage:new Uint8ClampedArray(6400),frames:[new Uint8ClampedArray(6400),new Uint8ClampedArray(6400)],
  frameDelays:[90,120],importedName:'offline-animation.gif',photoMaster:null,
  sourceMeta:{width:2048,height:2048,size:35000000},prepared:null,preparedLive:null,sharedGifPalette:null,
  gifStages:[],gifBaselines:[],aiGifCrop:null,
  autosaveTimer:null,draftRestore:false,saveChain:Promise.resolve(),projectGeneration:0,
  busy:false,getEncoding:()=>({kind:'palette',colors:8}),$:(id)=>field(id),
  formatBytes:(n)=>String(n),log(){},say(){},ui(){},stopPreview(){},
  frameControls(){},renderImage(){},delay:()=>Promise.resolve(),
  livePackets:()=>[new Uint8Array([1,2,3]),new Uint8Array([4,5])],
  makeRGBPackets:()=>{bleCalls++;return [];},nativeFromImage:()=>new Uint8Array(4096),
  plan:()=>({parts:Array(9)}),operation:async(fn)=>fn(),
  connect:()=>{bleCalls++;throw Error('Unexpected Bluetooth call');},
 };
 const start=converter.indexOf('const DRAFT_DB='),end=converter.lastIndexOf('restoreOfflineDraft();')+'restoreOfflineDraft();'.length;
 assert.ok(start>0&&end>start);
 const code=converter.slice(start,end);
 runInNewContext(code,ctx,{timeout:10000});
 return {ctx,field,saved,getBleCalls:()=>bleCalls};
}
test('GIF offline preparation and IndexedDB persistence never use Bluetooth',async()=>{
 const {ctx,field,saved,getBleCalls}=makeHarness();
 await ctx.prepareForCurtainOffline();
 assert.equal(ctx.preparedLive.packetGroups.length,2);
 assert.equal(ctx.preparedLive.packetGroups[0].length,2);
 assert.equal(saved.get('latest').name,'offline-animation.gif');
 assert.equal(saved.get('latest').frames.length,2);
 assert.equal(saved.get('latest').meta.size,35000000);
 assert.equal(getBleCalls(),0);
 field('quality').value='pal16';
 await ctx.saveDraftNow();
 assert.equal(saved.get('latest').settings.quality,'pal16');
 ctx.frames=[];ctx.sourceImage=null;
 await ctx.restoreOfflineDraft();
 assert.equal(ctx.frames.length,2);
 assert.equal(ctx.sourceImage.length,6400);
 assert.equal(field('quality').value,'pal16');
 assert.equal(getBleCalls(),0);
});
test('Native effect prepared offline is persisted and reloadable',async()=>{
 const {ctx,field,saved,getBleCalls}=makeHarness();
 field('motion').value='scroll';
 await ctx.prepareForCurtainOffline();
 assert.equal(ctx.prepared.length,4096);
 assert.equal(saved.get('latest').nativeEffect.length,4096);
 ctx.prepared=null;
 await ctx.restoreOfflineDraft();
 assert.equal(ctx.prepared.length,4096);
 assert.equal(getBleCalls(),0);
});
test('Clearing a saved project does not send to curtain',async()=>{
 const {ctx,saved}=makeHarness();
 await ctx.saveDraftNow();
 assert.equal(saved.size,1);
 await ctx.transactDraft('delete');
 assert.equal(saved.size,0);
});

test('Image / GIF Studio sends to Oracle while BLE disconnected, with a durable queued command',async()=>{
 const marker=converter.indexOf('function makeOracleScrollFrames(');
 const end=converter.indexOf('function stopPreview()',marker);
 assert.ok(marker>0&&end>marker);
 const body=converter.slice(marker,end);
 const calls=[];
 const image=new Uint8ClampedArray(6400);
 for(let i=0;i<image.length;i+=4){image[i]=i%255;image[i+3]=255;}
 const fields={quality:{value:'pal8'},motion:{value:'gif'},progress:{value:0}};
 const fakeParent={
  JH2_ORACLE_CURTAIN:true,
  JH2CurtainApi:async(path,payload)=>{
   calls.push({path,payload});
   if(path==='/api/curtain/assets')return {ok:true,sha256:'a'.repeat(64),bytes:3500};
   if(path==='/api/curtain/call')return {ok:true,queued:true,commandId:55,state:'queued'};
   throw Error('Unexpected Oracle route '+path);
  }
 };
 const ctx={
  window:{parent:fakeParent},Uint8ClampedArray,Uint8Array,Promise,Number,Error,btoa,
  crypto:{randomUUID:()=> 'test-uuid'},sourceImage:image,frames:[image,image],
  frameDelays:[90,110],importedName:'test.gif',oracleStreamRequested:false,
  stopLive:false,connected:false,binWriter:null,oracleStudio:()=>true,
  $:id=>fields[id]||(fields[id]={value:0}),
  say(){},ui(){},log(){},delay:async()=>{},
  getEncoding(){throw Error('Direct BLE encoding should not be used');}
 };
 runInNewContext(body,ctx,{timeout:10000});
 await ctx.drawLive();
 assert.equal(calls[0].path,'/api/curtain/assets');
 assert.equal(calls[0].payload.frames.length,2);
 assert.equal(calls[0].payload.loop,true);
 assert.equal(calls[1].payload.action,'asset');
 assert.equal(calls[1].payload.payload.sha256,'a'.repeat(64));
 assert.equal(ctx.oracleStreamRequested,true);
 assert.equal(fakeParent.JH2CurtainLastSelection.action,'asset');
 assert.equal(fields.progress.value,100);
 calls.length=0;fields.motion.value='scroll';
 await ctx.drawLive();
 assert.equal(calls[0].payload.frames.length,40);
 assert.equal(calls[0].payload.loop,true);
 calls.length=0;fields.motion.value='static';
 await ctx.drawLive();
 assert.equal(calls[0].payload.frames.length,1);
 assert.equal(calls[0].payload.loop,false);
});
