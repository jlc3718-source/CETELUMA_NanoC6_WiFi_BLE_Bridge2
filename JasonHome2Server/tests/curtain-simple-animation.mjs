import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {compileAsset} from '../curtain_asset.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const script=readFileSync(join(root,'curtain_loop_animation.js'),'utf8');
const html=readFileSync(join(root,'curtain_ai_animation.html'),'utf8');
const context={window:{},Uint8ClampedArray,Math};
runInNewContext(script,context);
const L=context.window.JH2LoopAnimation;

function pumpkin(){
 const pixels=new Uint8ClampedArray(6400);
 for(let y=7;y<=33;y++)for(let x=7;x<=33;x++){
  const k=(y*40+x)*4;
  pixels.set([255,110,0,255],k);
 }
 // Right carved eye at approximately 68% x and 38% y.
 for(let y=15;y<=19;y++)for(let x=22;x<=26;x++){
  const k=(y*40+x)*4;
  pixels.set([0,0,0,255],k);
 }
 // Carved smile is intentionally separate from the eye.
 for(let y=25;y<=28;y++)for(let x=18;x<=23;x++){
  const k=(y*40+x)*4;
  pixels.set([0,0,0,255],k);
 }
 return pixels;
}
function parseAsset(bytes){
 assert.equal(bytes.subarray(0,4).toString(),'JHC1');
 const frames=bytes.readUInt16LE(4),counts=[];
 let position=8;
 for(let frame=0;frame<frames;frame++){
  const delay=bytes.readUInt32LE(position),packets=bytes.readUInt16LE(position+4);
  position+=6;
  const channels=[];
  for(let i=0;i<packets;i++){
   const channel=bytes[position],length=bytes.readUInt16LE(position+1);
   position+=3;
   assert.ok(length>0&&position+length<=bytes.length);
   channels.push(channel);
   position+=length;
  }
  counts.push({delay,packets,channels});
 }
 assert.equal(position,bytes.length);
 return counts;
}
test('Wink: original art, tiny 5x5 edit, exact restoration, no full-body redraw',()=>{
 const base=pumpkin(),snapshot=Buffer.from(base);
 for(const n of [4,8,12,24]){
  const frames=L.buildSimpleAnimation(base,{count:n,prompt:'An orange pumpkin winks one eye'});
  assert.equal(frames.length,n);
  assert.equal(L.deltaCount(frames[0],frames.at(-1)),0);
  assert.deepEqual(Buffer.from(base),snapshot,'base must never change');
  const counts=L.validate(frames);
  assert.ok(Math.max(...counts)<=25,'only up to 5x5 pixels change per frame');
  assert.ok(counts.some(v=>v>0),'wink must be visible');
  for(const frame of frames){
   for(let y=0;y<40;y++)for(let x=0;x<40;x++){
    const at=(y*40+x)*4,changed=frame[at]!==base[at]||
     frame[at+1]!==base[at+1]||frame[at+2]!==base[at+2];
    if(changed)assert.ok(x>=22&&x<=26&&y>=15&&y<=19,'non-eye pixel changed');
   }
  }
 }
});
test('The Nano asset contains a single initial full frame, then only tiny sparse writes',()=>{
 const base=pumpkin(),frames=L.buildSimpleAnimation(base,{count:24,prompt:'Pumpkin winks one eye and smiles'});
 const changes=L.validate(frames);
 assert.ok(changes.some(v=>v===0),'held frames should cost zero BLE writes');
 assert.ok(changes.every(v=>v<=25));
 const payload=compileAsset({seamlessAnimation:true,frames:frames.map(v=>Buffer.from(v).toString('base64')),
  delays:Array(24).fill(160),loop:true,name:'Pixel wink test'});
 assert.equal(payload.format,'jh2-nano-seamless-delta-v1');
 assert.equal(payload.frames,24);
 assert.ok(payload.bytes.length<25000,'no repeated full 40x40 images');
 const records=parseAsset(payload.bytes);
 assert.equal(records.length,24);
 for(const rec of records.slice(1)){
  assert.equal(rec.delay,160);
  assert.ok(rec.channels.every(ch=>ch===1),'subsequent frames cannot clear and repaint');
 }
 for(let i=1;i<records.length;i++)if(changes[i-1]===0)
  assert.equal(records[i].packets,0,'unchanged frame must send no BLE packets');
});
test('Animate cannot request new AI images or independent keyframe redraws',()=>{
 const start=html.indexOf('async function animate(){'),end=html.indexOf('async function publish(){',start);
 assert.ok(start>=0&&end>start);
 const code=html.slice(start,end);
 assert.match(code,/L\.buildSimpleAnimation\(base/);
 assert.doesNotMatch(code,/await api\(|\/generate|\/motion|drawPose|buildKeyframes/);
 assert.match(code,/max>25/);
});
