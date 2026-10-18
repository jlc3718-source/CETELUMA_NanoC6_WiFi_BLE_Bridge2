// Runs the exact deployed browser installer against the real Oracle/Nano BLE
// path. Only the disposable CID 83928 is written or replaced.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const root=process.env.JH2_WEB_ROOT||'/app/web';
const host='http://127.0.0.1:8081';let cookie='';
const report={stages:[],physicalPlaybackConfirmed:false};
const print=(stage,data)=>{const item={at:new Date().toISOString(),stage,...data};report.stages.push(item);console.log(JSON.stringify(item));};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(path,body){
 const response=await fetch(host+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 const data=await response.json();if(!response.ok||data.ok===false)throw Error(data.error||'Oracle HTTP '+response.status);
 if(path==='/api/session')cookie=response.headers.get('set-cookie').split(';')[0];return data;
}
await api('/api/session',{token:process.env.JH2_TEST_TOKEN});
const initial=await api('/api/curtain/status');
if(initial.firmware!=='1.1.49'||!initial.online||!initial.curtain?.connected||initial.queued||initial.relayStreaming)
 throw Error('Live bridge is not idle, connected Nano 1.1.49; no storage operation queued');
print('PRECHECK',{firmware:initial.firmware,mtu:initial.curtain.mtu});
const origin=host,listeners=new Set(),parent={JH2_ORACLE_CURTAIN:true,JH2CurtainApi:api};
const dispatch=data=>{for(const callback of [...listeners])callback({origin,source:parent,data});};
parent.postMessage=async message=>{
 if(message.kind!=='jh2-curtain-request')return;
 try{
  const queued=await api('/api/curtain/call',{action:message.action,payload:message.payload,idempotencyKey:'native-field-'+crypto.randomUUID()});
  let command;
  for(let tries=0;tries<340;tries++){
   await sleep(500);({command}=await api('/api/curtain/command?id='+queued.commandId));
   if(['applied','failed','expired','superseded'].includes(command.state))break;
  }
  print('COMMAND',{id:queued.commandId,action:message.action,state:command?.state,result:command?.result});
  if(command?.state!=='applied')throw Error(command?.result?.message||'Native command not applied');
  dispatch({kind:'jh2-curtain-response',id:message.id,ok:true,result:{ok:true,...command.result,commandId:queued.commandId}});
 }catch(error){dispatch({kind:'jh2-curtain-response',id:message.id,ok:false,error:error.message});}
};
const window={parent,console,addEventListener:(kind,fn)=>{if(kind==='message')listeners.add(fn);},removeEventListener:(kind,fn)=>{if(kind==='message')listeners.delete(fn);}};
const context=vm.createContext({window,navigator:{},location:{origin},Uint8Array,Uint8ClampedArray,DataView,TextEncoder,TextDecoder,console,Date,atob,btoa,setInterval,clearInterval,setTimeout,clearTimeout});
vm.runInContext(fs.readFileSync(root+'/curtain_native_slot.js','utf8'),context);
vm.runInContext(fs.readFileSync(root+'/curtain_native_research.js','utf8'),context);
const N=window.JH2NativeSlot,R=window.JH2NativeResearch;
const progress=(message,entries)=>print('PROGRESS',{message,...(entries?{count:entries.length,partial:entries.partial,targetSectionComplete:entries.targetSectionComplete,targets:entries.targetMatches}:{})});
const protect=entries=>entries.filter(e=>e.cid!==83928).map(({id,slot,cid,type})=>({id,slot,cid,type})).sort((a,b)=>a.id-b.id);
try{
 const before=await N.inspect(progress);if(N.targetState(before))throw Error('Test CID was occupied before this test; no overwrite attempted');
 report.protectedBefore=protect(before);
 const frames=R.sampleFrames();const first=R.encodeSmartDawn(frames,{timestamp:1,name:'JH2 SLOT TEST A'});
 print('NATIVE_FILE',{bytes:first.length,frames:4,sha256:crypto.createHash('sha256').update(first).digest('hex')});
 const installed=await N.smartDawnUpload(first,progress);print('NATIVE_WRITE',installed);
 const alternate=frames.map(frame=>new Uint8ClampedArray(frame));
 for(const frame of alternate)for(let y=3;y<6;y++)for(let x=18;x<22;x++)frame.set([0,190,80,255],(y*40+x)*4);
 const second=R.encodeSmartDawn(alternate,{timestamp:2,name:'JH2 SLOT TEST B'});
 const rewritten=await N.smartDawnUpload(second,progress);print('NATIVE_REWRITE',rewritten);
 await sleep(15000);
 const after=await N.inspect(progress),stored=N.targetState(after);
 if(!stored)throw Error('Test CID did not remain in controller inventory');
 report.protectedAfter=protect(after);
 if(JSON.stringify(report.protectedBefore)!==JSON.stringify(report.protectedAfter))throw Error('Unrelated returned effect records changed');
 const status=await api('/api/curtain/status');
 if(!status.online||!status.curtain?.connected||status.queued)throw Error('Bridge did not remain connected and idle after native play');
 if(status.desired?.visual?.action!=='nativePlay'||status.desired.visual.payload.cid!==83928)throw Error('Native playback was not persisted as Oracle desired state');
 report.success=true;report.final={cid:stored.cid,slot:stored.slot,effectId:stored.id,firmware:status.firmware};
 print('READ_WRITE_REWRITE_PERSISTENCE_PASS',report.final);
}catch(error){report.success=false;report.error=error.message;print('FIELD_TEST_FAILED',{error:error.message});process.exitCode=1;}
finally{fs.writeFileSync('/tmp/jh2-native-slot-field-test.json',JSON.stringify(report,null,2));}
