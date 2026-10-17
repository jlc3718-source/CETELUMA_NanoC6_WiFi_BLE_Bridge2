import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const read=p=>readFileSync(join(root,p),'utf8');
function modules(){
 const sandbox={window:{},Uint8Array,Uint8ClampedArray,DataView,TextEncoder,TextDecoder,Math,Number,Object,String,Array,Date};
 new Script(read('curtain_native_research.js'),{filename:'curtain_native_research.js'}).runInNewContext(sandbox);
 sandbox.window.JH2NativeResearch=sandbox.window.JH2NativeResearch;
 new Script(read('curtain_native_slot.js'),{filename:'curtain_native_slot.js'}).runInNewContext(sandbox);
 return {R:sandbox.window.JH2NativeResearch,N:sandbox.window.JH2NativeSlot};
}
test('Native Test has AVI actions plus a read-only slot/ID inspector with a dropdown',()=>{
 const page=read('curtain_native_test.html'),host=read('curtain.js');
 const ids=[...page.matchAll(/<button\s[^>]*id="([^"]+)"/g)].map(x=>x[1]);
 assert.deepEqual(ids,['load','convert','inspect']);
 assert.match(page,/id="slotSelect" disabled/);
 assert.match(page,/id="slotDetails"/);
 assert.match(page,/id="allSlots" hidden/);
 assert.match(page,/Read Controller Slots \/ IDs/);
 assert.match(page,/N\.inspect\(show\)/);
 assert.match(page,/\.id\?\?0/);
 assert.match(page,/Effect ID:/);
 assert.match(page,/CID:/);
 assert.match(page,/typeLabel\(e\.type\)/);
 assert.match(page,/e\.cid===83928/);
 assert.match(page,/1\. Load Test AVI/);
 assert.match(page,/2\. Convert &amp; Send to Controller/);
 assert.match(page,/R\.sampleFrames\(\)/);
 assert.match(page,/R\.readAviFrames\(avi\.bytes\)/);
 assert.match(page,/R\.encodeSmartDawn\(source/);
 assert.match(page,/R\.inspectSmartDawnEff\(eff\)/);
 assert.match(page,/N\.smartDawnUpload\(eff,\(message,entries\)=>/);
 assert.match(page,/renderSlots\(entries\)/);
 assert.doesNotMatch(page,/vendor-video|effect\/list|SuperPix cloud|JH2CurtainApi|\.download\s*=|URL\.createObjectURL/);
 assert.match(host,/curtain_native_test\.html/);
 const code=[...page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(x=>x.trim());
 assert.equal(code.length,1);new Script(code[0],{filename:'curtain_native_test.html'});
});
test('generated small AVI decodes to exact source RGB pixels and distinct frames',()=>{
 const {R}=modules(),frames=R.sampleFrames(),avi=R.makeAvi(frames,400);
 assert.equal(avi.frames,4);assert.equal(avi.width,40);assert.equal(avi.height,40);
 assert.equal(R.inspectAvi(avi.bytes).frames,4);
 const decoded=R.readAviFrames(avi.bytes);
 assert.equal(decoded.length,frames.length);
 for(let n=0;n<frames.length;n++)assert.deepEqual(Buffer.from(decoded[n]),Buffer.from(frames[n]));
 assert.notDeepEqual(Buffer.from(decoded[0]),Buffer.from(decoded[1]));
 const bad=avi.bytes.slice();bad[0]=0;assert.throws(()=>R.readAviFrames(bad),/AVI/);
});
test('SmartDawn 1.2.4 EffectLocalMaker DNMX v3 / DNX2 byte-for-byte metadata',()=>{
 const {R}=modules(),frames=R.readAviFrames(R.makeAvi(R.sampleFrames(),400).bytes);
 frames[0].set([13,23,37,255],(7*40+12)*4);
 frames[0].set([201,122,82,255],(1*40+0)*4);
 const b=R.encodeSmartDawn(frames,{name:'JH2 TEST',timestamp:123456789}),d=new DataView(b.buffer);
 assert.equal(b.length,28672,'4096-byte aligned total: 8192+4*4800 then padding');
 assert.equal(String.fromCharCode(...b.slice(0,4)),'DNMX');
 assert.equal(b[4],3,'manufacturer DNMX version 3');assert.equal(b[5],1);
 assert.equal(d.getUint16(6,true),40);assert.equal(d.getUint16(8,true),40);
 assert.equal(d.getUint32(10,true),4800);assert.equal(d.getUint32(14,true),83928);
 assert.equal(d.getUint32(18,true),123456789);
 assert.equal(new TextDecoder().decode(b.slice(38,46)),'JH2 TEST');
 assert.equal(b[124],20);
 assert.equal(d.getUint32(128,true),4096);
 assert.equal(d.getUint16(132,true),4800);
 assert.equal(d.getUint16(134,true),4);
 assert.equal(b[136],0);assert.equal(b[137],0);assert.equal(b[138],1);assert.equal(b[141],0);
 assert.equal(String.fromCharCode(...b.slice(4096,4100)),'DNX2');
 assert.equal(b[4100],3);
 assert.equal(d.getUint32(4101,true),4800);
 assert.equal(d.getUint32(4105,true),4);
 assert.equal(d.getUint16(4109,true),40);assert.equal(d.getUint16(4111,true),40);
 assert.equal(b[4096+157],1);assert.equal(b[4096+158],20);
 // In manufacturer code: for (x=0..39) for (y=0..39),
 // pixel source is ((x+y*width)*4), output is contiguous RGB.
 const at=8192+(12*40+7)*3;
 assert.deepEqual([...b.subarray(at,at+3)],[13,23,37]);
 const secondary=8192+(0*40+1)*3;
 assert.deepEqual([...b.subarray(secondary,secondary+3)],[201,122,82]);
 for(let i=8192+4*4800;i<b.length;i++)assert.equal(b[i],0,'padding must be zero');
 const meta=R.inspectSmartDawnEff(b);
 assert.equal(meta.format,'DNMX');assert.equal(meta.itemHeader,'DNX2');
 assert.equal(meta.cid,83928);assert.equal(meta.frames,4);assert.equal(meta.hardwareVerified,false);
 assert.throws(()=>R.encodeSmartDawn(frames,{cid:83944}),/83928/);
 const wrong=b.slice();wrong[4]=1;assert.throws(()=>R.inspectSmartDawnEff(wrong),/DNMX v3/);
 const broken=b.slice();new DataView(broken.buffer).setUint32(14,83944,true);
 assert.throws(()=>R.inspectSmartDawnEff(broken),/83928/);
 const truncated=b.subarray(0,b.length-1);assert.throws(()=>R.inspectSmartDawnEff(truncated),/4096/);
});
test('manufacturer native type-0 upload stays on reserved CID 83928 and retains play ordering',()=>{
 const {R,N}=modules(),b=R.encodeSmartDawn(R.sampleFrames(),{timestamp:0});
 const plan=N.planVendorEff(b,83928);
 assert.equal(plan.cid,83928);assert.equal(plan.sourceCid,83928);
 assert.equal(plan.format,'DNMX');assert.equal(plan.bytes,b.length);
 assert.ok(plan.request[0]>=1&&plan.request[0]<=240);assert.equal(plan.request[0],plan.sessionId);assert.equal(plan.request[3],17);
 const wire=Buffer.from(plan.request);assert.ok(wire.includes(Buffer.from('83928.eff')));
 assert.equal(plan.request[8],8,'Protobuf UploadRequest.id is field 1');
 const code=plan.request[9],twoBytes=(code&128)!==0;
 const decodedSession=(code&127)|(twoBytes?(plan.request[10]&127)<<7:0);
 assert.equal(decodedSession,plan.sessionId,'Variable-length session ID must match the BLE wrapper');
 const afterId=twoBytes?11:10;
 assert.deepEqual([...plan.request.slice(afterId,afterId+2)],[16,0],'type=0 per manufacturer');
 assert.equal(plan.parts.every(p=>p[0]===plan.sessionId),true,'All BLE data fragments share the upload session ID');
 assert.deepEqual(Buffer.concat(plan.parts.map(p=>Buffer.from(p.subarray(8)))),Buffer.from(b));
 const bad=b.slice();new DataView(bad.buffer).setUint32(14,93444,true);
 assert.throws(()=>N.planVendorEff(bad,83928),/CID/);
 const slot=read('curtain_native_slot.js');
 assert.match(slot,/async function smartDawnUpload\(bytes,progress=/);
 assert.match(slot,/inspectSmartDawnEff\(bytes\)/);
 assert.match(slot,/return vendorUpload\(bytes,CID,progress\)/);
 const transport=slot.slice(slot.indexOf('async function vendorUpload'),slot.indexOf('async function smartDawnUpload'));
 assert.ok(transport.indexOf('const plan=planVendorEff')<transport.indexOf('const t=await connection()'));
 assert.ok(transport.indexOf('await inventory(t)')<transport.indexOf('await ddp(t,2909,CID)'));
 assert.ok(transport.indexOf('await ddp(t,2606,CID,newSlot.slot)')>transport.indexOf('const after=await inventory(t)'));
 assert.doesNotMatch(transport,/83494|83944/,'must not touch production/factory effects');
});
test('each native AVI upload gets a fresh SmartDawn session ID and waits for actual start ACK',()=>{
 const {R,N}=modules(),data=R.encodeSmartDawn(R.sampleFrames(),{timestamp:0});
 const one=N.planVendorEff(data,83928),two=N.planVendorEff(data,83928);
 assert.ok(one.sessionId>0&&one.sessionId<256);
 assert.ok(two.sessionId>0&&two.sessionId<256);
 assert.notEqual(two.sessionId,one.sessionId,'No fixed session 12 reused on the next upload');
 assert.equal(one.request[0],one.sessionId);
 assert.equal(two.request[0],two.sessionId);
 assert.equal(one.parts.every(p=>p[0]===one.sessionId),true);
 assert.equal(two.parts.every(p=>p[0]===two.sessionId),true);
 const source=read('curtain_native_slot.js');
 const uploader=source.slice(source.indexOf('async function vendorUpload('),source.indexOf('async function smartDawnUpload('));
 assert.match(uploader,/waitFor\('start',65000\)/);
 assert.match(uploader,/no animation data was transferred/);
 assert.match(uploader,/uploadTrace\(\)/);
 assert.match(uploader,/response\[5\]/,'Manufacturer SimpleMessage i3 is field five');
 assert.match(uploader,/await started/);
 assert.ok(uploader.indexOf('await started')<uploader.indexOf('for(let i=0;i<plan.parts.length;i++)'),'No data chunks until explicit controller ACK');
 assert.match(uploader,/await ddp\(t,2909,CID\)/);
 assert.match(uploader,/progress\('Controller inventory read: '/);

 assert.doesNotMatch(uploader,/2909,83944|2943|eraseAll/);
});
test('slot inspector preserves all inventory entries and gives a relay-safe notification deadline',()=>{
 const source=read('curtain_native_slot.js'),page=read('curtain_native_test.html');
 assert.match(source,/const INBOUND_WAIT_MS=45000/);
 assert.match(source,/const waiter=waitFor\('inventory',INBOUND_WAIT_MS\)/);
 assert.match(source,/async function inspect\(progress=\(\)=>\{\}\)/);
 assert.match(source,/return await inventory\(t,progress\)/);
 assert.match(source,/catalog\.slice\(\)\.sort\(\(a,b\)=>a\.id-b\.id/);
 assert.match(source,/observedNotifications-before/);
 assert.match(source,/lastSmartDawnOp/);
 assert.match(source,/Nothing deleted or uploaded/);
 // 2904 must be a read-only request; nothing here can erase a slot or trigger Play.
 const inventory=source.slice(source.indexOf('async function inventory(t,'),source.indexOf('async function upload(bytes,'));
 assert.match(inventory,/await ddp\(t,2904\)/);
 assert.doesNotMatch(inventory,/2909|2606|writeUpload/);
 const inspect=source.slice(source.indexOf('async function inspect('),source.indexOf('async function researchUpload('));
 assert.doesNotMatch(inspect,/2909|2606|writeUpload/);
 const handler=page.slice(page.indexOf("$('inspect').onclick="),page.indexOf("window.addEventListener('message'",page.indexOf("$('inspect').onclick=")));
 assert.match(handler,/renderSlots\(all\)/);
 assert.match(handler,/update\(\)/);
 assert.doesNotMatch(handler,/N\.vendorUpload|N\.smartDawnUpload|playResearch|delete|\.download/);
});
test('SmartDawn inventory accepts legitimate F0 replies and duplicate BLE fragments without touching a slot',async()=>{
 const src=read('curtain_native_slot.js').replace('window.JH2NativeSlot={','window.JH2NativeSlot={_receive:receive,_inventory:inventory,');
 const sandbox={window:{console},Uint8Array,DataView,TextEncoder,TextDecoder,Number,Math,Map,Array,String,Date,
  navigator:{bluetooth:null},setTimeout,clearTimeout,setInterval,clearInterval};
 new Script(src).runInNewContext(sandbox);
 const N=sandbox.window.JH2NativeSlot;
 const v=n=>{let p=Number(n),out=[];do{let x=p&127;p=Math.floor(p/128);out.push(x|(p?128:0))}while(p);return out};
 const effect=(slot,cid)=>{const entry=[24,...v(slot),32,...v(cid)];return [10,...v(entry.length),...entry]};
 const body=Uint8Array.from([...effect(2,83928),...effect(1,12345)]);
 const frame=new Uint8Array(20+body.length);frame[0]=0xF0;frame[1]=1;frame[6]=2904>>8;frame[7]=2904&255;frame.set(body,20);
 const cut=29,head=Uint8Array.from([55,2,1,0,...frame.slice(0,cut)]),tail=Uint8Array.from([55,2,0,0,...frame.slice(cut)]);
 const writes=[],t={writeCmd:async b=>{writes.push(Buffer.from(b));const op=b[10]*256+b[11];if(op===2904){N._receive(head);N._receive(head);N._receive(tail);}}};
 const entries=await N._inventory(t,()=>{},{minExpected:2,quietMs:30,maxMs:450});
 assert.deepEqual(Array.from(entries,x=>[x.slot,x.cid]),[[1,12345],[2,83928]]);
 assert.deepEqual(writes.map(w=>w[10]*256+w[11]),[205,167,2904,2904]);
 assert.equal(writes.every(w=>w[4]===240&&w[5]===4),true);
});
test('EffectList streams 87 effects across five responses, preserving ID zero and repeated 15924 CIDs',async()=>{
 const src=read('curtain_native_slot.js').replace('window.JH2NativeSlot={','window.JH2NativeSlot={_receive:receive,_inventory:inventory,');
 const sandbox={window:{console},Uint8Array,DataView,TextEncoder,TextDecoder,Number,Math,Map,Array,String,Date,
  navigator:{bluetooth:null},setTimeout,clearTimeout,setInterval,clearInterval};
 new Script(src).runInNewContext(sandbox);
 const N=sandbox.window.JH2NativeSlot;
 const vint=n=>{const out=[];do{let byte=n&127;n=Math.floor(n/128);out.push(byte|(n?128:0));}while(n);return out};
 const field=(n,v)=>[n*8,...vint(v)];
 const ef=i=>{
  const slot=i<55?i:i-55,cid=i<55?15924:15193+i-55;
  const title=new TextEncoder().encode('Effect '+i);
  const entry=[...field(1,i),...field(2,3),...(slot?[...field(3,slot)]:[]),...field(4,cid),50,...vint(title.length),...title];
  return [10,...vint(entry.length),...entry];
 };
 const send=(list,num)=>{
  const payload=Uint8Array.from(list.flatMap(ef)),frame=new Uint8Array(20+payload.length);
  frame[0]=0xF1;frame[1]=1;frame[2]=num>>8;frame[3]=num&255;
  frame[6]=2904>>8;frame[7]=2904&255;frame.set(payload,20);
  const half=Math.ceil(frame.length/2),first=Uint8Array.from([num,2,1,0,...frame.slice(0,half)]),last=Uint8Array.from([num,2,0,0,...frame.slice(half)]);
  N._receive(first);N._receive(first);N._receive(last);
 };
 const groups=[Array.from({length:19},(_,i)=>i),Array.from({length:19},(_,i)=>i+19),
   Array.from({length:18},(_,i)=>i+38),Array.from({length:19},(_,i)=>i+56),
   Array.from({length:12},(_,i)=>i+75)];
 let requests=[],responded=false;const transport={writeCmd:async b=>{
  const op=b[10]*256+b[11];requests.push(op);
  if(op!==2904||responded)return;
  responded=true;
  for(let i=0;i<groups.length;i++)setTimeout(()=>send(groups[i],i+1),i*12);
 }};
 const result=await N._inventory(transport,()=>{},{quietMs:35,maxMs:1500,minExpected:87});
 assert.equal(result.length,87,'No 19-entry early completion allowed');
 assert.equal(result.batches,5);
 assert.equal(result.partial,false);
 assert.deepEqual(Array.from(result.slice(0,3),x=>[x.id,x.slot,x.cid]),[[0,0,15924],[1,1,15924],[2,2,15924]]);
 assert.equal(result.filter(x=>x.cid===15924).length,55);
 assert.equal(result.at(-1).id,86);
 assert.equal(result.at(-1).title,'Effect 86');
 assert.deepEqual(requests,[205,167,2904,2904],'Original handshake first, then two verification reads');
});
test('inventory restores working manufacturer 205/167 handshake and reissues read-only 2904',()=>{
 const source=read('curtain_native_slot.js');
 const scan=source.slice(source.indexOf('async function inventory(t,'),source.indexOf('async function upload(bytes,'));
 assert.match(scan,/attempt<=2/);
 assert.match(scan,/if\(!initializedReadConnections\.has\(t\)\)/);
 assert.match(scan,/await ddp\(t,205\)/);
 assert.match(scan,/await ddp\(t,167\)/);
 assert.match(scan,/initializedReadConnections\.add\(t\)/);
 assert.match(scan,/await ddp\(t,2904\)/);
 assert.match(scan,/inventoryResponseAt/);
 assert.match(scan,/inventoryBatchCount/);
 assert.doesNotMatch(scan,/2909|2606|writeUpload/);
 const ddp=source.slice(source.indexOf('async function ddp('),source.indexOf('async function inventory('));
 assert.match(ddp,/bleTransmitted===false/);
 assert.match(ddp,/connected===false/);
});
test('original catalog reader maps EffectInfo fields exactly and accepts CID 15924 shared across 55 effects',()=>{
 const source=read('curtain_native_slot.js');
 const map=source.slice(source.indexOf('function newEffectList('),source.indexOf('function callback('));
 assert.match(map,/if\(k===1\)item\.id=t/);
 assert.match(map,/if\(k===2\)item\.type=t/);
 assert.match(map,/if\(k===3\)item\.slot=t/);
 assert.match(map,/if\(k===4\)item\.cid=t/);
 assert.match(map,/if\(item\.cid!=null\)out\.push\(item\)/);
 assert.match(source,/const KNOWN_FACTORY_EFFECTS=88/);
 assert.match(source,/const initializedReadConnections=new WeakSet\(\)/);
 const inventory=source.slice(source.indexOf('async function inventory(t,'),source.indexOf('async function upload(bytes,'));
 assert.ok(inventory.indexOf('await ddp(t,205)')<inventory.indexOf('await ddp(t,167)'));
 assert.ok(inventory.indexOf('await ddp(t,167)')<inventory.indexOf('await ddp(t,2904)'));
 assert.doesNotMatch(inventory,/2909|2930|2606/);
});
test('real 2026-10-14 HCI capture requires 399-byte MTU for 396-byte inventory notifications',()=>{
 const native=read('curtain_native_slot.js');
 const connection=native.slice(native.indexOf('async function connection(){'),native.indexOf('async function ddp('));
 assert.match(connection,/let reported=Number\(live\.curtain\?\.mtu\|\|0\)/);
 assert.match(connection,/reported>0&&reported<399/);
 assert.match(connection,/live\.curtain\?\.connected===true/);
 assert.match(connection,/window\.JH2NativeTransport='existing-nano-ble'/);
 assert.doesNotMatch(connection,/rpc\('subscribeRaw'/);
 assert.match(connection,/oracleApi\('\/api\/curtain\/status'\)/);
 assert.match(connection,/working phone used 512/);
 assert.ok(connection.indexOf('reported>0&&reported<399')<connection.indexOf('timer=setInterval(receiveOracle'),'Reject an inadequate MTU before inventory reads');
 const inspect=native.slice(native.indexOf('async function inspect('),native.indexOf('async function researchUpload('));
 assert.match(inspect,/NanoC6 negotiated BLE MTU/);
});
test('duplicate 83928 CIDs observed in E-87 and E-88 never trigger an ambiguous delete',()=>{
 const source=read('curtain_native_slot.js');
 for(const fn of ['async function upload(','async function researchUpload(','async function vendorUpload(']){
  const start=source.indexOf(fn),next=source.indexOf('async function ',start+fn.length);
  const chunk=source.slice(start,next<0?undefined:next);
  assert.match(chunk,/\.filter\([^\n]+\.cid===CID\)/,'Each uploader must inventory every record matching test CID');
  assert.match(chunk,/\.length>1/,'Duplicate CID must stop all writes');
  assert.ok(chunk.indexOf('.length>1')<chunk.indexOf('await ddp(t,2909,CID)'),'CID collision gate must precede erase');
 }
});
test('native RPC timeout exceeds Oracle delivery wait, and rawWrite transport is reusable',()=>{
 const source=read('curtain_native_slot.js'),remote=read('curtain_remote.js'),bridge=read('curtain_bridge.mjs');
 assert.match(source,/setTimeout\(\(\)=>\{pending\.delete\(id\);reject\(Error\([\s\S]*?\)\)\},190000\)/);
 assert.match(remote,/action==='rawWrite'\?165000/);
 assert.match(remote,/Command #/);
 assert.match(remote,/lastState/);
 assert.match(bridge,/action==='rawWrite'\?now\(\)\+240000/);
 assert.match(bridge,/\(action==='connect'\|\|action==='subscribeRaw'\)\?now\(\)\+150000/);
 assert.ok(190000>165000&&240000>190000,'Deadlines must be ordered: relay TTL > iframe timer > Oracle command poll');
});
test('Oracle publisher keeps existing authenticated static files for native UI and JS',()=>{
 const script=read('../.github/scripts/deploy-curtain-relay.py');
 assert.match(script,/curtain_native_test\.html/);
 assert.match(script,/curtain_native_research\.js/);
 assert.match(script,/curtain_native_slot\.js/);
 assert.match(script,/eufyReady/);
});
