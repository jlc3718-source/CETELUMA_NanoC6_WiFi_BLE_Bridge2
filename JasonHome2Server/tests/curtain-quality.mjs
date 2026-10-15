import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,runInNewContext} from 'node:vm';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const source=readFileSync(join(root,'curtain_quality.js'),'utf8');
new Script(source,{filename:'curtain_quality.js'});
const module={exports:{}};
runInNewContext(source,{module,Uint8ClampedArray,Float32Array,Number,Math,Error,Array});
const q=module.exports;
const W=160, H=160;
function stage(draw){
 const data=new Uint8ClampedArray(W*H*4);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const p=(y*W+x)*4;
  const [r,g,b]=draw(x,y);
  data[p]=r;data[p+1]=g;data[p+2]=b;data[p+3]=255;
 }
 return data;
}
test('40x40 downsample preserves area average and exact alpha',()=>{
 const pixels=stage((x,y)=>x<80?[0,0,0]:[255,140,60]);
 const converted=q.areaDownsample(pixels);
 assert.equal(converted.length,6400);
 assert.deepEqual([...converted.slice(0,4)],[0,0,0,255]);
 assert.deepEqual([...converted.slice((39*4),39*4+4)],[255,140,60,255]);
});
test('subject focus estimates foreground high-information region',()=>{
 const pixels=stage((x,y)=>x>35&&x<88&&y>47&&y<124&&((x+y)%8<4)?[250,230,20]:[5,5,5]);
 const f=q.estimateFocus(pixels);
 assert.ok(f.x>0.24&&f.x<0.64,JSON.stringify(f));
 assert.ok(f.y>0.28&&f.y<0.78,JSON.stringify(f));
});
test('Enhanced Detail retains subject outline and does not create colors outside RGBA limits',()=>{
 const pixels=stage((x,y)=>x>48&&x<108&&y>22&&y<132?[240,60,40]:[4,6,8]);
 const out=q.processEnhanced(pixels,{cx:.48,cy:.5,radius:.34,strength:.8});
 assert.equal(out.length,6400);
 for(let i=0;i<out.length;i+=4){
  assert.equal(out[i+3],255);
  for(let k=0;k<3;k++)assert.ok(out[i+k]>=0&&out[i+k]<=255);
 }
 assert.ok(out.some((x,i)=>i%4===0&&x>160),'Foreground is preserved');
});
test('LED gamma, shadow lift, rolloff and saturation keep intentional black pixels black',()=>{
 const pixels=new Uint8ClampedArray(6400);
 for(let i=3;i<pixels.length;i+=4)pixels[i]=255;
 pixels.set([20,30,40,255],4);pixels.set([240,230,220,255],8);
 const out=q.tone(pixels,{gamma:1.15,lift:12,rolloff:10,saturation:1.15,minimum:6});
 assert.deepEqual([...out.slice(0,4)],[0,0,0,255]);
 assert.ok(out[4]>pixels[4], 'shadows are lifted');
 assert.ok(out[8]<=255&&out[9]<=255&&out[10]<=255,'highlights constrained');
 assert.equal(out.length,6400);
});
test('neutral LED profile does not alter Natural output',()=>{
 const pixels=new Uint8ClampedArray(6400);
 for(let i=0;i<6400;i++)pixels[i]=i%256;
 const out=q.tone(pixels,{gamma:1,lift:0,rolloff:0,saturation:100,minimum:0});
 assert.equal(out,pixels,'exact same pixels and alpha for neutral color profile');
});
test('bad frame size fails early rather than uploading invalid LED pixels',()=>{
 assert.throws(()=>q.areaDownsample(new Uint8ClampedArray(200)),/160x160/);
});
test('AI cloud cannot silently call lights or invent physical pixel density',()=>{
 const html=readFileSync(join(root,'curtain_converter.html'),'utf8');
 const server=readFileSync(join(root,'server.mjs'),'utf8');
 assert.match(html,/id="aiRevamp"/);
 assert.match(html,/api\/curtain\/ai-revamp/);
 assert.match(html,/width:256,height:256/);
 assert.match(html,/function aiRecommend/);
 assert.match(html,/id="undoAiRevamp"/);
 assert.match(server,/@cf\/facebook\/detr-resnet-50/);
 assert.match(server,/if\(method==="POST"&&path==="\/api\/curtain\/ai-revamp"\)/);
});
