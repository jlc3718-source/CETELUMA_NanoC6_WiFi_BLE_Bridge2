import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createVendorVideo} from '../curtain_vendor_video.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const read=p=>readFileSync(join(root,p),'utf8');
function research(){
 const sandbox={window:{},Uint8Array,Uint8ClampedArray,DataView,TextEncoder,Math,Number,Object,String,Array};
 new Script(read('curtain_native_research.js')).runInNewContext(sandbox);
 return sandbox.window.JH2NativeResearch;
}
test('native test tab is only two buttons and a preview, no extra upload modes',()=>{
 const page=read('curtain_native_test.html'),host=read('curtain.js');
 assert.deepEqual([...page.matchAll(/<button\s[^>]*id="([^"]+)"/g)].map(x=>x[1]),['load','convert']);
 assert.match(page,/1\. Load Test AVI/);assert.match(page,/2\. Convert &amp; Send to Controller/);
 assert.match(page,/R\.sampleFrames\(\)/);
 assert.match(page,/vendor-video\/start/);
 assert.match(page,/vendor-video\/status/);
 assert.match(page,/N\.vendorUpload\(bytes,ready\.cid,show\)/);
 assert.match(page,/N\.planVendorEff\(bytes,ready\.cid\)/);
 assert.doesNotMatch(page,/URL\.createObjectURL|\.download\s*=/);
 assert.match(host,/curtain_native_test\.html/);
 const scripts=[...page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(x=>x.trim());
 assert.equal(scripts.length,1);new Script(scripts[0]);
});
test('40x40 sample produces an AVI with 4 distinct RGB24 video frames',()=>{
 const R=research(),frames=R.sampleFrames(),avi=R.makeAvi(frames,400);
 assert.equal(frames.length,4);assert.equal(avi.frames,4);assert.equal(avi.width,40);assert.equal(avi.height,40);
 assert.equal(Buffer.from(avi.bytes).toString('ascii',0,4),'RIFF');
 assert.equal(R.inspectAvi(avi.bytes).frames,4);
 assert.deepEqual([...frames[0].subarray(0,4)],[0,0,0,255]);
 assert.notDeepEqual([...frames[0]],[...frames[1]]);
});
test('manufacturer conversion path uses native video upload, poll and effect retrieval',async()=>{
 const source=read('curtain_vendor_video.mjs'),server=read('server.mjs');
 for(const route of ['/upload/video','/encode/video','/effect/list','/effect/get/'])assert.ok(source.includes(route),route);
 for(const term of ['application/octet-stream','application/x-www-form-urlencoded','sid','video:upload.message','width:"40"','height:"40"','createVendorVideo'])assert.ok(source.includes(term),term);
 assert.match(source,/HOST="https:\/\/hk\.daniaokeji\.com\/webs"/);
 assert.match(source,/candidate.*x\.name===job\.name/);
 assert.match(source,/effectCid!==cid/);
 assert.match(server,/createVendorVideo\(curtainRelay\)/);
 assert.match(server,/\/api\/curtain\/vendor-video\/start/);
 assert.match(server,/\/api\/curtain\/vendor-video\/status/);
 const client=createVendorVideo({status(){return {curtain:{sn:'DN5E58'}}}});
 await assert.rejects(client.start({avi:'bad base64'}),/valid small AVI/);
});
test('vendor installer accepts only original manufacturer native .eff, remaps reserved CID and plays after inventory',()=>{
 const native=read('curtain_native_slot.js');
 new Script(native);
 assert.match(native,/const CID=83928/);
 assert.match(native,/function planVendorEff\(data,cloudCid\)/);
 assert.match(native,/kind!=='DNMX'&&kind!=='DNCX'/);
 assert.match(native,/view\.getUint16\(6,true\)!==40/);
 assert.match(native,/new DataView\(fixed\.buffer\)\.setUint32\(14,CID,true\)/);
 assert.match(native,/new TextEncoder\(\)\.encode\('83928\.eff'\)/);
 assert.match(native,/async function vendorUpload\(/);
 assert.match(native,/await ddp\(t,2909,CID\)/);
 assert.match(native,/await ddp\(t,2606,CID,newSlot\.slot\)/);
 const part=native.slice(native.indexOf('async function vendorUpload'),native.indexOf('async function playResearch'));
 assert.ok(part.indexOf('const plan=planVendorEff')<part.indexOf('const t=await connection()'));
 assert.ok(part.indexOf('await inventory(t)')<part.indexOf('await ddp(t,2909,CID)'));
});
test('Oracle publisher copies the conversion module and preserves existing Eufy application',()=>{
 const py=read('../.github/scripts/deploy-curtain-relay.py');
 assert.match(py,/curtain_vendor_video\.mjs/);
 assert.match(py,/vendorVideo=createVendorVideo/);
 assert.match(py,/eufyReady/);
});
