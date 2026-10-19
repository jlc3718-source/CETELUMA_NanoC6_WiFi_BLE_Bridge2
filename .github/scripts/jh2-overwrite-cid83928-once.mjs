// One-time approved destructive test, no backup requested. Operates exclusively on
// pre-existing custom CID 83928 after fresh inventory proves it has ONE owner.
// The Nano MUST still be running installed 1.1.50 (not pending source 1.1.51).
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const host='http://127.0.0.1:8081', sleep=ms=>new Promise(r=>setTimeout(r,ms));
const deadline=Date.now()+9*60_000;
const report={startedAt:new Date().toISOString(),status:'started',targetCid:83928,
  overwriteApproved:true,backupRequested:false,erased:false,uploaded:false,
  catalogConfirmed:false,playCommandSent:false,physicalPlaybackConfirmed:false,events:[]};
let cookie='',stage='preflight';
function log(event,fields={}){const entry={t:new Date().toISOString(),event,...fields};report.events.push(entry);console.log(JSON.stringify(entry));}
async function api(path,body){
 const r=await fetch(host+path,{method:body===undefined?'GET':'POST',
   headers:{'content-type':'application/json',...(cookie?{cookie}:{})},
   body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 const data=await r.json();
 if(!r.ok||data.ok===false)throw Error(data.error||data.message||'Oracle API status '+r.status);
 if(path==='/api/session')cookie=r.headers.get('set-cookie')?.split(';')[0]||'';
 return data;
}
async function status(){
 const s=await api('/api/curtain/status');const c=s.curtain||{};
 return {fw:s.firmware,online:!!s.online,connected:!!c.connected,mtu:c.mtu||0,
  queued:s.queued||0,streaming:!!s.relayStreaming,catalog:c.nativeCatalogUnique||0,
  section:!!c.nativeTargetSectionComplete,matches:c.nativeTarget83928Count,
  targets:c.nativeTarget83928||[],noticeDrops:c.nativeNoticeDrops??null};
}
function ready(s){return s.fw==='1.1.50'&&s.online&&s.connected&&s.mtu>=500&&!s.queued&&!s.streaming;}
async function send(action,payload,limitMs=85000){
 const q=await api('/api/curtain/call',{action,payload,idempotencyKey:'jh2-overwrite-'+crypto.randomUUID()});
 const until=Date.now()+limitMs;let c;
 do{const result=await api('/api/curtain/command?id='+q.commandId);c=result.command;
   if(['applied','failed','superseded','expired'].includes(c?.state))break;
   await sleep(700);
 }while(Date.now()<until&&Date.now()<deadline);
 const result=c?.result||{};
 log('COMMAND',{id:q.commandId,action,state:c?.state||'timeout',bleTransmitted:result.bleTransmitted||false,
   message:String(result.message||'').slice(0,220)});
 if(c?.state!=='applied'||result.ok===false||(action!=='nativeSlotUpload'&&result.bleTransmitted!==true))
  throw Error('Command #'+q.commandId+' '+action+' not applied: '+(result.message||c?.state||'timeout'));
 return {id:q.commandId,result};
}
function vi(x){const out=[];do{let b=x&127;x=Math.floor(x/128);out.push(b|(x?128:0));}while(x);return out;}
let seq=107;
function command(op,cid){
 const arr=Buffer.alloc(cid===undefined?24:24+1+vi(cid).length);
 arr[0]=seq;arr[1]=1;arr[4]=0xf0;arr[5]=4;arr[6]=0;arr[7]=seq;
 arr[10]=op>>8;arr[11]=op&255;
 if(cid!==undefined){arr[24]=8;arr.set(vi(cid),25);}
 seq=(seq+1)&255;
 return arr;
}
const commandUuid='01020074-1972-1925-3022-077119514e44';
async function raw(op,cid){return send('rawWrite',{uuid:commandUuid,data:command(op,cid).toString('base64')},35000);}
async function catalog(opts={}){
 // Maintain an up-to-date target section; no other CID can be erased.
 await raw(205);await raw(167);await raw(2904);
 let last;
 for(let i=0;i<14;i++){last=await status();if(last.section&&last.catalog>=(opts.minCount??88))break;await sleep(1100);}
 log('CATALOG',{phase:opts.phase||'refresh',...last});
 if(!last.section||last.catalog<(opts.minCount??88))throw Error('Incomplete live controller inventory');
 return last;
}
function ensureOriginal(s){
 if(!ready(s)||s.catalog<89||!s.section||s.matches!==1||s.targets.length!==1||
   s.targets[0].cid!==83928||s.targets[0].effectId!==88||s.targets[0].slot!==33)
  throw Error('Original custom effect does not have a single verified owner slot 33; no overwrite');
}
function ensureAbsent(s){
 if(!ready(s)||s.catalog<88||!s.section||s.matches!==0||s.targets.length!==0)
  throw Error('Custom CID83928 is not verified absent; upload cancelled');
}
try{
 if(!process.env.JH2_TEST_TOKEN)throw Error('No authorized Oracle authentication available');
 await api('/api/session',{token:process.env.JH2_TEST_TOKEN});
 // Generate 40x40, four-frame blinking orange face from existing offline
 // SmartDawn native encoder; do not trust a generic image/GIF byte stream.
 const w={};vm.runInNewContext(fs.readFileSync('/app/web/curtain_native_research.js','utf8'),
  {window:w,Uint8Array,Uint8ClampedArray,DataView,TextEncoder,console});
 const frames=w.JH2NativeResearch.sampleFrames();
 const native=w.JH2NativeResearch.encodeSmartDawn(frames,{cid:83928,timestamp:4,name:'JH2 NEW PUMPKIN TEST'});
 const bytes=Buffer.from(native);
 if(bytes.length!==28672||bytes.subarray(0,4).toString()!=='DNMX'||bytes.readUInt32LE(14)!==83928)
   throw Error('Generated native SmartDawn file failed local checks');
 const digest=crypto.createHash('sha256').update(bytes).digest('hex');
 log('NEW_ANIMATION_PREPARED',{bytes:bytes.length,frames:frames.length,sha256:digest});
 let live=await status();log('INITIAL_STATUS',live);
 if(!ready(live))throw Error('Nano disconnected, busy or not running installed 1.1.50');
 stage='stage';
 const staged=await api('/api/curtain/assets',{nativeEff:bytes.toString('base64'),name:'JH2 NEW PUMPKIN TEST'});
 if(!staged.native||staged.bytes!==bytes.length||staged.sha256!==digest)
  throw Error('Oracle rejected native test animation or changed bytes');
 log('ORACLE_STAGED',{sha256:staged.sha256,bytes:staged.bytes});
 stage='verifyOriginal';
 let before=await catalog({minCount:89,phase:'beforeErase'});
 ensureOriginal(before);
 // The user explicitly approved discarding the old custom animation and
 // forbade spending time on a copy. No backup or alternate CID used.
 stage='erase';
 log('ERASE_AUTHORIZED',{cid:83928,slot:33,effectId:88});
 await raw(2909,83928);
 report.erased=true;
 stage='verifyErased';
 await sleep(1100);
 const absent=await catalog({minCount:88,phase:'afterErase'});
 ensureAbsent(absent);
 log('ERASE_VERIFIED',{cid:83928,remainingEffects:absent.catalog});
 stage='upload';
 const upload=await send('nativeSlotUpload',{sha256:staged.sha256},180000);
 report.uploaded=true;log('UPLOAD_ACK',{id:upload.id,sha256:digest});
 stage='readBack';
 await sleep(1800);
 const after=await catalog({minCount:89,phase:'afterUpload'});
 if(!ready(after)||!after.section||after.matches!==1||after.targets.length!==1||
     after.targets[0].cid!==83928||after.catalog<89)
    throw Error('Controller did not confirm newly saved CID83928 after upload');
 report.catalogConfirmed=true;
 const slot=after.targets[0].slot;
 log('SAVED_EFFECT_VERIFIED',{cid:83928,slot,effectId:after.targets[0].effectId,catalog:after.catalog});
 stage='play';
 const played=await send('nativePlay',{cid:83928,slot},60000);
 report.playCommandSent=true;
 await sleep(2000);live=await status();
 if(!live.online||!live.connected)throw Error('BLE link dropped after new animation playback');
 log('PLAYBACK_ACK',{commandId:played.id,slot,physicalPlaybackConfirmed:false});
 report.status='blePlaybackAck_visualConfirmationRequired';
}catch(e){report.status='failed';report.failedStage=stage;report.error=String(e.message||e);log('TEST_STOPPED',{stage,error:report.error,erased:report.erased,uploaded:report.uploaded});process.exitCode=1;}
finally{
 report.finishedAt=new Date().toISOString();
 fs.writeFileSync('/tmp/jh2-overwrite-83928-report.json',JSON.stringify(report,null,2));
}
