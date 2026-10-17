/* SmartDawn verified CID 83928 native effect installer.
   This module accepts ONLY an already encoded native DN1FE .eff file.
   JHC1 Oracle animations are NOT native .eff files; converting them here
   without a validated controller animation/no-scroll format would be unsafe.
   Ported from the 2026-10-15 successful 2904/2909/2930/2606 uploader. */
(function(){
'use strict';
const CID=83928, SERVICE='00000074-1972-1925-3022-077119514e44';
const WRITE='01020074-1972-1925-3022-077119514e44';
const UPLOAD='27923001-2072-1925-3022-077119514e44';
const NOTIFY='01010074-1972-1925-3022-077119514e44';
let seq=0,msg=0,catalog=[],seenInventory=false,packetResponses=new Map();
let startWait=null,endWait=null,inventoryWait=null,receiverInstalled=false;
const INBOUND_WAIT_MS=45000; // Oracle -> Nano command and Nano -> Oracle notification each need 5 s relay cycles.
let observedNotifications=0,lastSmartDawnOp=null,lastInventoryRead=null;
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
function b64(data){let str='';for(let i=0;i<data.length;i+=512)str+=String.fromCharCode(...data.subarray(i,i+512));return btoa(str);}
function varint(n){if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid native protobuf integer');const a=[];do{let v=n&127;n=Math.floor(n/128);if(n)v|=128;a.push(v)}while(n);return a;}
function decodeVarint(b,i){let v=0,f=1;for(let k=0;k<10;k++){if(i>=b.length)throw Error('Truncated native protobuf');const c=b[i++];v+=(c&127)*f;if(!(c&128))return [v,i];f*=128;}throw Error('Native protobuf overflow');}
function proto(b){let p=0,out=[];while(p<b.length){let t;[t,p]=decodeVarint(b,p);const field=Math.floor(t/8),wire=t&7;let v;if(wire===0)[v,p]=decodeVarint(b,p);else if(wire===2){let n;[n,p]=decodeVarint(b,p);if(p+n>b.length)throw Error('Truncated protobuf field');v=b.slice(p,p+n);p+=n;}else if(wire===5){p+=4;continue;}else if(wire===1){p+=8;continue;}else throw Error('Unrecognized protobuf wire');out.push([field,v,wire]);}return out;}
function decodeEffects(body){let out=[];for(const [field,b,wire] of proto(body)){if(field!==1||wire!==2)continue;const entry={};for(const [f,v,w]of proto(b))if(w===0){if(f===3)entry.slot=v;if(f===4)entry.cid=v;}if(Number.isInteger(entry.cid)&&Number.isInteger(entry.slot))out.push(entry);}return out;}
function callback(name){if(name==='start')return startWait;if(name==='end')return endWait;return inventoryWait;}
function signal(name,data){const c=callback(name);if(!c)return;if(name==='start')startWait=null;else if(name==='end')endWait=null;else inventoryWait=null;clearTimeout(c.timer);c.resolve(data);}
function waitFor(name,ms){if(callback(name))throw Error('Native upload already waiting for '+name);
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{if(name==='start')startWait=null;else if(name==='end')endWait=null;else inventoryWait=null;reject(Error('SmartDawn '+name+' response timeout'))},ms);
 const obj={resolve,reject,timer};if(name==='start')startWait=obj;else if(name==='end')endWait=obj;else inventoryWait=obj;});}
function receive(view){
 const raw=view instanceof Uint8Array?view:new Uint8Array(view.buffer,view.byteOffset,view.byteLength);
 observedNotifications++;
 if(raw.length<5||raw[3]!==0)return;
 const id=raw[0],count=raw[1],remaining=raw[2];
 if(!count||count>100||remaining>=count)return;
 const index=count-remaining-1;
 let parts=packetResponses.get(id);
 if(!parts||parts.length!==count||index===0){parts=Array(count).fill(null);packetResponses.set(id,parts);}
 parts[index]=raw.slice(4);
 if(parts.some(x=>!x))return;
 packetResponses.delete(id);
 const size=parts.reduce((a,p)=>a+p.length,0),data=new Uint8Array(size);let at=0;
 for(const p of parts){data.set(p,at);at+=p.length;}
 if(data.length<20||data[0]!==0xf1||data[1]!==1)return;
 const op=data[6]*256+data[7],body=data.slice(20);
 lastSmartDawnOp=op;
 try{
  if(op===2904){seenInventory=true;for(const entry of decodeEffects(body)){const n=catalog.findIndex(e=>e.cid===entry.cid&&e.slot===entry.slot);if(n>=0)catalog[n]=entry;else catalog.push(entry);}signal('inventory',true);}
  if(op===2931||op===2934){const result={};for(const [f,v,w]of proto(body))if(w===0)result[f]=v;signal(op===2931?'start':'end',result);}
 }catch(err){if(window.console)console.warn('SmartDawn native notification:',err);}
}
function crc8(bytes){let crc=0;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc&128)?((crc<<1)^0x97)&255:(crc<<1)&255;}return crc;}
function wrap(data,id,total,left,full=false){const out=new Uint8Array(data.length+8);out.set([id,total>>8,total&255,17,255,left>>8,left&255]);out.set(data,8);out[7]=crc8(full?out:data);return out;}
function filePlan(data){
 if(!(data instanceof Uint8Array)||data.length!==4096||[68,78,1,254].some((x,i)=>data[i]!==x))
  throw Error('Native controller slot requires a 4,096-byte DN1FE .eff file, not a JHC1 animation or GIF');
 const sourceCid=new DataView(data.buffer,data.byteOffset,data.byteLength).getUint32(4,true);
 // The only E-89 source template we captured is *known to scroll*.
 // Never accept it as a native no-scroll animation by accident.
 if(sourceCid===83944)throw Error('E-89 scrolling template is not a verified no-scroll animation');
 const native=data.slice(); // never modify the user's imported original
 if(sourceCid!==CID){
  const old=varint(sourceCid),updated=varint(CID);
  if(old.length!==updated.length)throw Error('Native CID does not fit verified SmartDawn header layout');
  let found=0;
  for(let i=8;i<128;i++){
   if(i+old.length>native.length||!old.every((v,j)=>native[i+j]===v))continue;
   native.set(updated,i);found++;
  }
  if(found!==1)throw Error('Native CID metadata does not match known layout; no upload attempted');
  new DataView(native.buffer).setUint32(4,CID,true);
 }
 const chunks=Math.ceil(native.length/500),id=12;
 const field=(n,v)=>[(n<<3),...varint(v)];
 const header=Uint8Array.from([...field(1,id),...field(2,3),...field(3,data.length),...field(4,0),...field(5,chunks),...field(6,500),...field(7,0),...field(9,CID)]);
 const request=wrap(header,id,chunks,chunks,true),parts=Array.from({length:chunks},(_,i)=>wrap(native.slice(i*500,(i+1)*500),id,chunks,chunks-i-1));
 for(const part of parts)if(part[7]!==crc8(part.slice(8)))throw Error('Native packet CRC mismatch');
 return {request,parts};
}
async function connection(){
 if(navigator.bluetooth&&!window.parent?.JH2_ORACLE_CURTAIN){
  const d=await navigator.bluetooth.requestDevice({filters:[{namePrefix:'DN'}],optionalServices:[SERVICE]});
  if(d.name!=='DN5E58')throw Error('Select the DN5E58 SmartDawn curtain');
  const server=await d.gatt.connect(),service=await server.getPrimaryService(SERVICE);
  const cmd=await service.getCharacteristic(WRITE),bin=await service.getCharacteristic(UPLOAD),notify=await service.getCharacteristic(NOTIFY);
  await notify.startNotifications();notify.addEventListener('characteristicvaluechanged',event=>receive(event.target.value));
  const write=async(ch,data)=>{if(ch.properties.writeWithoutResponse&&ch.writeValueWithoutResponse)await ch.writeValueWithoutResponse(data);else if(ch.writeValueWithResponse)await ch.writeValueWithResponse(data);else await ch.writeValue(data);};
  return {writeCmd:data=>write(cmd,data),writeUpload:data=>write(bin,data),close:()=>{try{d.gatt.disconnect()}catch(_){}}};
 }
 if(window.parent===window)throw Error('Open Native Upload inside Jason Home 2 Curtain Studio');
 const pending=new Map();let count=0,closed=false,timer=null,cursor=0,fetching=false;
 const oracleApi=window.parent.JH2CurtainApi;
 // Android WebView deliberately has no direct Bluetooth implementation.
 // NanoC6 forwards BLE notifications to Oracle via authenticated sync;
 // watch that notification feed while uploading each native chunk.
 if(typeof oracleApi!=='function')
  throw Error('Oracle curtain API unavailable; use Chrome Bluetooth or reconnect Jason Home 2');
 const prior=await oracleApi('/api/curtain/notifications?since=0');
 for(const n of prior.notifications||[])cursor=Math.max(cursor,Number(n.id)||0);
 const receiveOracle=async()=>{
  if(closed||fetching)return;fetching=true;
  try{
   const data=await oracleApi('/api/curtain/notifications?since='+cursor);
   for(const n of data.notifications||[]){
    if(!Number.isInteger(n.id)||n.id<=cursor)continue;
    cursor=n.id;
    if(String(n.uuid).toLowerCase()!==NOTIFY)continue;
    receive(Uint8Array.from(atob(n.data),x=>x.charCodeAt(0)));
   }
  }catch(err){if(window.console)console.warn('Native slot Oracle BLE notifications:',err);}
  finally{fetching=false;}
 };
 const listener=event=>{
  if(event.origin!==location.origin||event.source!==window.parent)return;
  const m=event.data||{};
  if(m.kind==='jh2-curtain-notify'&&String(m.uuid).toLowerCase()===NOTIFY){
   try{receive(Uint8Array.from(atob(m.data),x=>x.charCodeAt(0)))}catch(_){}
  }
  if(m.kind==='jh2-curtain-response'&&pending.has(m.id)){const job=pending.get(m.id);pending.delete(m.id);clearTimeout(job.timer);if(m.ok)job.resolve(m.result);else job.reject(Error(m.error||'Native BLE command rejected'));}
 };
 window.addEventListener('message',listener);
 const rpc=(action,payload={})=>new Promise((resolve,reject)=>{
  const id='cv'+(++count),timer=setTimeout(()=>{pending.delete(id);reject(Error('Native '+action+' timed out'))},65000);
  pending.set(id,{resolve,reject,timer});
  window.parent.postMessage({kind:'jh2-curtain-request',id,action,payload},location.origin);
 });
 try{
  await rpc('connect');await rpc('subscribeRaw',{uuid:NOTIFY});
  timer=setInterval(receiveOracle,300);await receiveOracle();
 }catch(e){closed=true;if(timer!==null)clearInterval(timer);window.removeEventListener('message',listener);throw e;}
 const put=(uuid,data)=>rpc('rawWrite',{uuid,data:b64(data)});
 return {writeCmd:data=>put(WRITE,data),writeUpload:data=>put(UPLOAD,data),
  close:()=>{closed=true;if(timer!==null)clearInterval(timer);window.removeEventListener('message',listener);}};
}
async function ddp(t,op,n1,n2){
 const args=[];if(n1!==undefined)args.push(8,...varint(n1));if(n2!==undefined)args.push(16,...varint(n2));
 const packet=new Uint8Array(20+args.length);packet[0]=240;packet[1]=4;
 const id=(++msg)&65535;packet[2]=id>>8;packet[3]=id&255;packet[6]=op>>8;packet[7]=op&255;packet.set(args,20);
 const k=(++seq)&255;for(let at=0;at<packet.length;at+=40){const part=packet.slice(at,at+40),total=Math.ceil(packet.length/40),frame=new Uint8Array(part.length+4);frame.set([k,total,total-1-at/40,0]);frame.set(part,4);await t.writeCmd(frame);await sleep(10);}
}
async function inventory(t,progress=()=>{}){
 // A round trip goes through 5-second Oracle/Nano poll windows in both directions.
 // Arm the waiter before issuing 2904; tolerate multiple relay cycles and give
 // the UI readout of the actual BLE notification state if nothing returns.
 const before=observedNotifications;
 catalog=[];packetResponses.clear();seenInventory=false;
 progress('Requesting native controller slot inventory (2904)…');
 const waiter=waitFor('inventory',INBOUND_WAIT_MS);
 waiter.catch(()=>{}); // May expire before the outbound rawWrite receives its ACK.
 try{
  await ddp(t,2904);
  await waiter;
  if(!seenInventory)throw Error('Controller did not acknowledge inventory');
  // Snapshot only the current 2904 response; every stored slot is shown, not
  // just the disposable testing slot.
  const result=catalog.slice().sort((a,b)=>a.slot-b.slot||a.cid-b.cid);
  lastInventoryRead={at:new Date().toISOString(),count:result.length,notifications:observedNotifications-before};
  return result;
 }catch(error){
  const count=observedNotifications-before;
  const detail=' ('+count+' BLE notifications observed; last native opcode '+(lastSmartDawnOp??'none')+').';
  throw Error(error.message+detail+' Check NanoC6 BLE connection and notifications; no slot was changed.');
 }
}
async function upload(bytes,progress=()=>{}){
 const pack=filePlan(bytes); // validate BEFORE connecting or removing anything
 const t=await connection();
 try{
  progress('Reading controller effect inventory…');
  const before=await inventory(t);let original=before.find(x=>x.cid===CID);
  if(original){
   progress('Erasing ONLY reserved CID 83928…');
   await ddp(t,2909,CID);await sleep(600);
   for(let i=0;i<2;i++){const list=await inventory(t);if(list.some(x=>x.cid===CID))throw Error('Could not verify removal of CID 83928; native upload cancelled');}
  }
  progress('Starting verified 4 KB controller upload…');
  const started=waitFor('start',INBOUND_WAIT_MS);started.catch(()=>{});await t.writeUpload(pack.request);
  const start=await started;
  if((start[1]??0)!==0||(start[3]??0)!==0)throw Error('SmartDawn rejected upload start');
  const done=waitFor('end',Math.max(120000,pack.parts.length*9000+30000));done.catch(()=>{});
  for(let i=0;i<pack.parts.length;i++){await t.writeUpload(pack.parts[i]);progress('Sending native upload chunk '+(i+1)+' / '+pack.parts.length);await sleep(25);}
  const result=await done;if((result[1]??0)!==0)throw Error('SmartDawn rejected native upload completion');
  progress('Checking controller slot inventory…');
  await sleep(500);
  const after=await inventory(t),newSlot=after.find(x=>x.cid===CID);
  if(!newSlot||!Number.isInteger(newSlot.slot))throw Error('Upload ACK received but CID 83928 not listed; playback stopped');
  progress('CID 83928 saved in slot '+newSlot.slot+'. Starting native playback…');
  await ddp(t,2606,CID,newSlot.slot);
  return {cid:CID,slot:newSlot.slot,saved:true,playCommandSent:true,physicalPlaybackConfirmed:false};
 }finally{t.close();}
}
// Research APIs are distinct from the proven 4 KB DN1FE installer.
// Reading catalog does not mutate controller state. No factory CID can be targeted.
async function inspect(progress=()=>{}){const t=await connection();try{return await inventory(t,progress)}finally{t.close()}}
async function researchUpload(data,{replaceReserved=false,progress=()=>{},format='DNMX'}={}){
 if(!window.JH2NativeResearch)throw Error('Research encoder is not loaded');
 if(format!=='AVI'&&format!=='DNMX')throw Error('Unsupported experimental upload format');
 const plan=format==='AVI'?window.JH2NativeResearch.planAviUpload(data):window.JH2NativeResearch.planUpload(data);
 if(plan.meta.cid!==CID||plan.uploadType!==0)throw Error('Research file has invalid CID/upload type');
 const t=await connection();
 try{
  progress('Rechecking all stored effect IDs…');
  const before=await inventory(t),occupied=before.find(e=>e.cid===CID);
  if(occupied&&!replaceReserved)throw Error('Reserved CID 83928 is occupied. No storage writes made; explicit replacement authorization required.');
  if(occupied){
   progress('Erasing only the explicitly approved reserved test CID 83928…');
   await ddp(t,2909,CID);await sleep(600);
   const afterErase=await inventory(t);
   if(afterErase.some(e=>e.cid===CID))throw Error('Test slot 83928 could not be verified empty; cancelling experimental upload');
  }
  progress('Starting unverified '+format+' type-0 upload to CID 83928; firmware may reject it…');
  const started=waitFor('start',INBOUND_WAIT_MS);started.catch(()=>{});await t.writeUpload(plan.request);
  const start=await started;
  if((start[1]??0)!==0||(start[3]??0)!==0)throw Error('Video type-0 start rejected by controller: '+JSON.stringify(start));
  // Type-0 transfer has never been physically verified; do not fake success.
  const done=waitFor('end',Math.max(120000,plan.parts.length*9000+30000));done.catch(()=>{});
  for(let i=0;i<plan.parts.length;i++){
   await t.writeUpload(plan.parts[i]);
   if(i===0||(i+1)%10===0||i+1===plan.parts.length)progress('Experimental type-0 chunk '+(i+1)+' / '+plan.parts.length);
   await sleep(25);
  }
  const finish=await done;
  if((finish[1]??0)!==0)throw Error('SmartDawn rejected experimental upload completion: '+JSON.stringify(finish));
  progress('Upload ACK received. Verifying CID 83928 in live effect catalog…');
  await sleep(750);
  const after=await inventory(t),stored=after.find(e=>e.cid===CID);
  if(!stored||!Number.isInteger(stored.slot))throw Error('Upload acknowledged but native candidate did not persist in controller inventory; playback blocked');
  return {acknowledged:true,cid:CID,slot:stored.slot,format,physicalPlaybackConfirmed:false};
 }finally{t.close()}
}
// AVI uses the same guarded inventory / reserved-slot-only transport,
// but declares 83928.avi in the manufacturer's UploadRequest path field.
// The manufacturer's supported flow normally converts AVI to .eff first.
async function aviUpload(bytes,options={}){
 return researchUpload(bytes,{...options,format:'AVI'});
}
// The vendor encoder returns a real DNMX/DNCX .eff with a temporary cloud CID.
// Remap ONLY that video's CID to the reserved disposable CID 83928.
function planVendorEff(data,cloudCid){
 if(!(data instanceof Uint8Array)||data.length<8192||data.length>600000)throw Error('Vendor .eff has an unsafe size');
 const kind=String.fromCharCode(...data.subarray(0,4));
 if(kind!=='DNMX'&&kind!=='DNCX')throw Error('Vendor did not return DNMX/DNCX effect bytes');
 const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
 if(data[5]!==1||view.getUint16(6,true)!==40||view.getUint16(8,true)!==40)
  throw Error('Vendor effect is not a single 40x40 curtain animation');
 const sourceCid=view.getUint32(14,true);
 if(!Number.isSafeInteger(cloudCid)||cloudCid<=0||cloudCid!==sourceCid)
  throw Error('Vendor effect CID is inconsistent with conversion response');
 const offset=view.getUint32(128,true),frames=view.getUint16(134,true);
 if(offset<4096||offset+4096>data.length||frames<2)throw Error('Converted effect does not contain a valid multi-frame native container');
 // The backend has already verified the original returned file. Upload uses
 // a local COPY, so the vendor bytes can be re-inspected separately.
 const fixed=data.slice();
 new DataView(fixed.buffer).setUint32(14,CID,true);
 const chunks=Math.ceil(fixed.length/500),id=12;
 if(chunks>1200)throw Error('Converted effect would require too many BLE packets');
 const path=new TextEncoder().encode('83928.eff');
 const field=(n,v)=>[(n<<3),...varint(v)];
 const requestBody=Uint8Array.from([...field(1,id),...field(2,0),...field(3,fixed.length),...field(4,0),...field(5,chunks),...field(6,500),...field(7,0),66,...varint(path.length),...path,...field(9,CID)]);
 const request=wrap(requestBody,id,chunks,chunks,true);
 const parts=Array.from({length:chunks},(_,i)=>wrap(fixed.subarray(i*500,(i+1)*500),id,chunks,chunks-i-1));
 for(const p of parts)if(p[7]!==crc8(p.slice(8)))throw Error('Vendor BLE packet CRC error');
 return {request,parts,cloudCid,sourceCid,cid:CID,format:kind,bytes:fixed.length};
}
async function vendorUpload(data,cloudCid,progress=()=>{}){
 const plan=planVendorEff(data,cloudCid); // Validate before any destructive command
 const t=await connection();
 try{
  progress('Reading controller effect list…');
  let before=await inventory(t),old=before.find(e=>e.cid===CID);
  if(old){
   progress('Replacing only reserved test effect CID 83928…');
   await ddp(t,2909,CID);await sleep(600);
   for(let i=0;i<2;i++){const current=await inventory(t);if(current.some(x=>x.cid===CID))throw Error('Reserved slot could not be verified empty; no upload attempted');}
  }
  progress('Sending locally encoded '+plan.format+' native effect ('+plan.bytes+' bytes)…');
  const started=waitFor('start',30000);await t.writeUpload(plan.request);
  const response=await started;
  if((response[1]??0)!==0||(response[3]??0)!==0)
   throw Error('Controller rejected native .eff upload start: '+JSON.stringify(response));
  const done=waitFor('end',Math.max(120000,plan.parts.length*9000+30000));done.catch(()=>{});
  for(let i=0;i<plan.parts.length;i++){
   await t.writeUpload(plan.parts[i]);
   if(i===0||(i+1)%10===0||i+1===plan.parts.length)progress('BLE '+(i+1)+'/'+plan.parts.length);
   await sleep(25);
  }
  const end=await done;
  if((end[1]??0)!==0)throw Error('Controller rejected converted effect completion: '+JSON.stringify(end));
  progress('Verifying effect in controller inventory…');
  await sleep(500);
  const after=await inventory(t),newSlot=after.find(e=>e.cid===CID);
  if(!newSlot||!Number.isInteger(newSlot.slot))throw Error('Native effect upload acknowledged, but CID 83928 was not stored; playback cancelled');
  progress('Calling native Play for CID 83928, slot '+newSlot.slot+'…');
  await ddp(t,2606,CID,newSlot.slot);
  return {cid:CID,slot:newSlot.slot,format:plan.format,installed:true,playCommandSent:true,physicalPlaybackConfirmed:false};
 }finally{t.close()}
}
// SmartDawn 1.2.4's native EffectLocalMaker output: already local,
// no manufacturer network and no AVI bytes ever sent to BLE.
async function smartDawnUpload(bytes,progress=()=>{}){
 if(!window.JH2NativeResearch)throw Error('SmartDawn native encoder is not loaded');
 const meta=window.JH2NativeResearch.inspectSmartDawnEff(bytes);
 if(meta.cid!==CID||meta.version!==3||meta.itemHeader!=='DNX2'||meta.frames<2)
  throw Error('Only validated SmartDawn v3 video effects for CID 83928 may be installed');
 return vendorUpload(bytes,CID,progress);
}
async function playResearch(){
 const t=await connection();
 try{
  const effects=await inventory(t),stored=effects.find(e=>e.cid===CID);
  if(!stored||!Number.isInteger(stored.slot))throw Error('Reserved CID 83928 is absent; play command cancelled');
  await ddp(t,2606,CID,stored.slot);
  return {cid:CID,slot:stored.slot,commandSent:true,physicalPlaybackConfirmed:false};
 }finally{t.close()}
}
window.JH2NativeSlot={upload,filePlan,inspect,researchUpload,aviUpload,playResearch,planVendorEff,vendorUpload,smartDawnUpload};
})();
