import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const read=p=>readFileSync(join(root,p),'utf8');
function research(){
 const sandbox={window:{},Uint8Array,Uint8ClampedArray,DataView,TextEncoder,Error,Math,Number,Array,String,Object};
 new Script(read('curtain_native_research.js'),{filename:'curtain_native_research.js'}).runInNewContext(sandbox);
 return sandbox.window.JH2NativeResearch;
}
test('Native test page parses and is isolated from the Studio buttons',()=>{
 const host=read('curtain.js'),testPage=read('curtain_native_test.html'),studio=read('curtain_converter.html');
 for(const id of ['jh2CurtainNativeTestTab','jh2CurtainNativeTestPanel','jh2CurtainNativeTestFrame'])assert.match(host,new RegExp(id));
 assert.match(host,/curtain_native_test\.html/);assert.match(host,/jh2-native-test-frames/);
 assert.match(host,/event\.origin!==location\.origin/);
 assert.match(host,/sender=event\.source===studioFrame\.contentWindow/);
 assert.match(studio,/id="testNativeFrames"/);
 assert.match(studio,/kind:'jh2-native-test-open'/);
 for(const id of ['sample','preview','dryRun','download','readInventory','allowWrite','allowReplace','targetCid','upload','play','status'])assert.match(testPage,new RegExp('id="'+id+'"'));
 assert.match(testPage,/curtain_native_research\.js/);assert.match(testPage,/curtain_native_slot\.js/);
 const code=[...testPage.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim());
 assert.equal(code.length,1);new Script(code[0],{filename:'curtain_native_test.html'});
 assert.doesNotMatch(code[0],/2909|writeUpload/,'the page must use the guarded native module for hardware writes');
});
test('Native research DNMX encodes exact 40x40 pixels and round trips headers',()=>{
 const R=research();assert.equal(R.CID,83928);
 const frames=R.sampleFrames();
 assert.equal(frames.length,4);for(const frame of frames)assert.equal(frame.length,6400);
 const b=R.encode(frames);
 assert.equal(b.length,8192+4*4800);
 assert.deepEqual([...b.subarray(0,4)],[68,78,77,88]);
 const info=R.inspect(b);assert.equal(info.frames,4);assert.equal(info.width,40);assert.equal(info.height,40);
 assert.equal(info.cid,83928);assert.equal(info.hardwareVerified,false);
 const center=(18*40+20)*3+8192;assert.equal(b[center],239);assert.equal(b[center+1],112);
 assert.notDeepEqual([...b.subarray(8192,8192+4800)],[...b.subarray(8192+4800,8192+9600)]);
 const bad=b.slice();new DataView(bad.buffer).setUint32(14,83944,true);
 assert.throws(()=>R.inspect(bad),/83928/);
 const short=b.slice(0,b.length-1);assert.throws(()=>R.inspect(short),/length/);
 assert.throws(()=>R.encode([frames[0]]),/2–24/);
});
test('Native experimental type 0 plan verifies all BLE packets and CRC without touching hardware',()=>{
 const R=research(),b=R.encode(R.sampleFrames()),p=R.planUpload(b);
 assert.equal(p.uploadType,0);assert.equal(p.bytes,b.length);assert.equal(p.chunks,Math.ceil(b.length/500));
 assert.equal(p.parts.length,p.chunks);assert.equal(p.parts[0].length,508);
 assert.equal(p.parts.at(-1).length,8+b.length%500);
 assert.equal(p.request[0],12);assert.equal(p.request[3],0x11);
 assert.deepEqual([...p.request.slice(8,12)],[8,12,16,0], 'opcode 2930 fields include type=0');
 const payload=Buffer.concat(p.parts.map(p=>Buffer.from(p.subarray(8))));
 assert.deepEqual(payload,Buffer.from(b));
 assert.equal(p.firmwareSupportUnverified,true);
});
test('Hardware experiment remains limited to reserved CID, rechecks inventory and does not auto-play',()=>{
 const slot=read('curtain_native_slot.js'),page=read('curtain_native_test.html');
 new Script(slot,{filename:'curtain_native_slot.js'});
 assert.match(slot,/const CID=83928/);assert.match(slot,/async function researchUpload/);
 assert.match(slot,/async function inspect/);assert.match(slot,/async function playResearch/);
 assert.match(slot,/if\(occupied&&!replaceReserved\)throw Error/);
 assert.match(slot,/await ddp\(t,2909,CID\)/);assert.match(slot,/await inventory\(t\)/);
 assert.match(slot,/const after=await inventory\(t\),stored=after\.find\(e=>e\.cid===CID\)/);
 const experimental=slot.slice(slot.indexOf('async function researchUpload'),slot.indexOf('async function playResearch'));
 assert.doesNotMatch(experimental,/ddp\(t,2606/,'research upload must never auto-play unverified effects');
 assert.match(page,/!\$('allowReplace'\)\.checked/);
 assert.match(page,/!\$('allowWrite'\)\.checked/);
 assert.match(page,/value\.trim\(\)==='83928'/);
});
