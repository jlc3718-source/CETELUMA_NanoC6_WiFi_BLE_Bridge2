// One-time physical control test against the disposable SmartDawn CID 83928.
// Refuse any erase, any occupied/ambiguous target, or any incomplete target section.
// All writes are the known-good 4096-byte DN1FE BACKUP via the deployed Oracle/Nano path.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const host='http://127.0.0.1:8081';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let cookie='';
const report={at:new Date().toISOString(),status:'starting',controllerWrites:0,permanentErase:false,physicalPlaybackConfirmed:false,stages:[]};
const note=(stage,data={})=>{const item={stage,...data};report.stages.push(item);console.log(JSON.stringify(item));};
async function api(path,body){
  const response=await fetch(host+path,{method:body===undefined?'GET':'POST',
    headers:{'content-type':'application/json',...(cookie?{cookie}:{})},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  if(!response.ok||data.ok===false)throw Error(data.error||'Oracle HTTP '+response.status);
  if(path==='/api/session')cookie=response.headers.get('set-cookie')?.split(';')[0]||'';
  return data;
}
async function send(action,payload){
  const queued=await api('/api/curtain/call',{action,payload,idempotencyKey:crypto.randomUUID()});
  let final;
  for(let i=0;i<280;i++){
    const c=await api('/api/curtain/command?id='+queued.commandId);
    final=c.command;
    if(['applied','failed','expired','superseded'].includes(final?.state))break;
    await sleep(450);
  }
  note('COMMAND',{id:queued.commandId,action,state:final?.state,message:final?.result?.message});
  if(final?.state!=='applied')throw Error(action+' '+queued.commandId+' '+(final?.result?.message||final?.state||'not acknowledged'));
  return final;
}
let cursor=0;
async function noticePoll(){
  const data=await api('/api/curtain/notifications?since='+cursor);
  const result=[];
  for(const n of data.notifications||[]){
    if(!Number.isInteger(n.id)||n.id<=cursor)continue;
    cursor=n.id;
    const bytes=Buffer.from(n.data,'base64');
    if(bytes.length<24)continue;
    const op=(bytes[10]<<8)|bytes[11];
    if(op===2931||op===2933||op===2934)result.push({op,rcode:bytes[18],bytes:bytes.length});
  }
  return result;
}
async function waitNotice(op,ms=38000){
  const start=Date.now();
  while(Date.now()-start<ms){
    for(const n of await noticePoll()){
      note('CONTROLLER_REPLY',n);
      if(n.rcode!==0)throw Error('Controller error '+n.rcode+' for upload opcode '+n.op);
      if(n.op===op)return;
    }
    await sleep(900);
  }
  throw Error('Controller opcode '+op+' not returned before timeout');
}
function commandPacket(op,id){
  const b=Buffer.alloc(24);
  b[0]=id;b[1]=1;b[4]=0xf0;b[5]=4;b[7]=id;b[10]=op>>8;b[11]=op&255;
  return b;
}
const controlUuid='01020074-1972-1925-3022-077119514e44';
const uploadUuid='27923001-2072-1925-3022-077119514e44';
const raw=async(uuid,bytes)=>send('rawWrite',{uuid,data:Buffer.from(bytes).toString('base64')});
async function inventoryStatus(){
  const s=await api('/api/curtain/status');
  return {firmware:s.firmware,online:s.online,queued:s.queued,streaming:s.relayStreaming,
    connected:s.curtain?.connected,mtu:s.curtain?.mtu,
    section:s.curtain?.nativeTargetSectionComplete,matches:s.curtain?.nativeTarget83928Count,
    entries:s.curtain?.nativeCatalogUnique};
}
async function readTarget(){
  let first;
  for(let i=0;i<6;i++){
    first=await inventoryStatus();
    note('PREFLIGHT_STATUS',first);
    if(first.firmware==='1.1.50'&&first.online&&first.connected&&!first.queued&&!first.streaming)break;
    if(i<5)await sleep(2500);
  }
  if(first.firmware!=='1.1.50'||!first.online||!first.connected||first.queued||first.streaming)
    throw Error('Bridge not idle or not on confirmed v1.1.50: '+JSON.stringify(first));
  for(const [i,op] of [205,167,2904].entries())await raw(controlUuid,commandPacket(op,91+i));
  await sleep(7000);
  let s=await inventoryStatus();
  if(!s.section){
    await raw(controlUuid,commandPacket(2904,95));
    await sleep(7000);
    s=await inventoryStatus();
  }
  note('TARGET_CATALOG',s);
  if(!s.section||s.matches!==0)throw Error('Reserved test-CID section missing, occupied, or ambiguous: no upload');
  return s;
}
try{
  if(!process.env.JH2_TEST_TOKEN||!process.env.JH2_TEST_BACKUP_B64)throw Error('Authorized test credentials or original backup missing');
  await api('/api/session',{token:process.env.JH2_TEST_TOKEN});
  const backup=Buffer.from(process.env.JH2_TEST_BACKUP_B64,'base64');
  if(backup.length!==4096||backup.subarray(0,4).toString('hex')!=='444e01fe'||
      backup.readUInt32LE(4)!==83928)throw Error('Archive BLE TEST source is not the proven 4 KB native CID 83928 file');
  const window={};
  vm.runInNewContext(fs.readFileSync('/app/web/curtain_native_slot.js','utf8'),
    {window,Uint8Array,DataView,TextEncoder,TextDecoder,console});
  const plan=window.JH2NativeSlot.filePlan(new Uint8Array(backup));
  if(plan.parts.length!==9)throw Error('Legacy verified native upload must have 9 chunks');
  note('BACKUP_VERIFIED',{bytes:backup.length,cid:83928,sha256:crypto.createHash('sha256').update(backup).digest('hex')});
  await readTarget();
  // Stage the unchanged original bytes in Oracle; Nano pulls the complete
  // verified file into RAM and transmits all 9 data packets without another
  // Oracle/API transaction between frames.
  const staged=await api('/api/curtain/assets',{nativeEff:backup.toString('base64')});
  if(!staged.native||staged.bytes!==4096)throw Error('Oracle did not accept the authentic DN1FE control file');
  note('CONTROL_FILE_STAGED',{bytes:staged.bytes,sha256:staged.sha256});
  const reply=await send('nativeSlotUpload',{sha256:staged.sha256});
  note('NATIVE_CONTIGUOUS_UPLOAD_ACK',{state:reply.state,result:reply.result});
  report.controllerWrites=10;
  await sleep(1400);
  await raw(controlUuid,commandPacket(2904,96));
  await sleep(8000);
  const final=await inventoryStatus();
  note('POST_WRITE_INVENTORY',final);
  if(!final.section||final.matches!==1)throw Error('4 KB transfer was acknowledged but reserved CID did not persist');
  report.status='saved_and_read_back';
  note('FOUR_KB_SAVE_CONFIRMED',{cid:83928,firmware:final.firmware});
}catch(e){
  report.status='failed';
  report.error=e.message;
  note('TEST_STOPPED',{reason:e.message,noErase:true});
  process.exitCode=1;
}finally{
  fs.writeFileSync('/tmp/jh2-native-4kb-control.json',JSON.stringify(report,null,2));
}
