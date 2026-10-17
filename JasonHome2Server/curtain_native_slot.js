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
 const cid=new DataView(data.buffer,data.byteOffset,data.byteLength).getUint32(4,true);
 // The only E-89 source template we captured is *known to scroll*.
 // Never accept it as a native no-scroll animation by accident.
 if(cid===83944)throw Error('E-89 scrolling template is not a verified no-scroll animation');
 if(cid!==CID)throw Error('Refusing to overwrite another effect: native file CID must be 83928');
 const chunks=Math.ceil(data.length/500),id=12;
 const field=(n,v)=>[(n<<3),...varint(v)];
 const header=Uint8Array.from([...field(1,id),...field(2,3),...field(3,data.length),...field(4,0),...field(5,chunks),...field(6,500),...field(7,0),...field(9,CID)]);
 const request=wrap(header,id,chunks,chunks,true),parts=Array.from({length:chunks},(_,i)=>wrap(data.slice(i*500,(i+1)*500),id,chunks,chunks-i-1));
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
async function inventory(t){
 catalog=[];packetResponses.clear();seenInventory=false;
 const waiter=waitFor('inventory',5000);
 await ddp(t,2904);await waiter;await sleep(1600);
 if(!seenInventory||catalog.length<1)throw Error('Native inventory unavailable; controller slot untouched');
 return catalog.slice();
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
  const started=waitFor('start',30000);await t.writeUpload(pack.request);
  const start=await started;
  if((start[1]??0)!==0||(start[3]??0)!==0)throw Error('SmartDawn rejected upload start');
  const done=waitFor('end',60000);
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
window.JH2NativeSlot={upload,filePlan};
})();
