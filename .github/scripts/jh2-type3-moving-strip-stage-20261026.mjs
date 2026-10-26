// Vendor moving-strip Type3 CID85402: Oracle asset admission + Nano-local
// SHA-verifed stage ONLY. No native BLE upload/erase/play/OTA commands here.
import fs from 'node:fs';
import crypto from 'node:crypto';
const base='http://127.0.0.1:8081',cid=85402;
const expected='b7995c899e698ce1758528dd4b287078c1cbb38e1ce2723fca33de60386d52ce';
let cookie='';
const out={cid,sha256:expected,stageAttempted:false,controllerWrites:0,erases:0,physicalInstallVerified:false};
async function request(path,body){
 const headers={'content-type':'application/json',...(cookie?{cookie}:{})};
 const r=await fetch(base+path,{method:body===undefined?'GET':'POST',
  headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(40000)});
 if(path==='/api/session')cookie=(r.headers.get('set-cookie')||'').split(';')[0];
 const raw=await r.text();let d;try{d=JSON.parse(raw)}catch{throw Error('Non-JSON server '+r.status+' at '+path)}
 if(!r.ok||d.ok===false)throw Error((d.error||r.status)+' at '+path);
 return d;
}
try{
 if(!process.env.JH2_TEST_TOKEN)throw Error('Missing Oracle-owned session auth');
 const data=fs.readFileSync('/tmp/jh2-moving-jack-native-type3-newcid.bin');
 if(data.length!==8192||data.toString('hex',0,4)!=='444e01fe'||
  data.readUInt32LE(4)!==cid||data[8]!==2||
  crypto.createHash('sha256').update(data).digest('hex')!==expected)throw Error('Vendor moving-strip native binary has changed');
 await request('/api/session',{token:process.env.JH2_TEST_TOKEN});
 const pre=await request('/api/curtain/status');
 out.pre={firmware:pre.firmware,online:pre.online,ble:pre.curtain?.connected,
  queued:pre.queued,streaming:pre.relayStreaming,free:pre.curtain?.nanoLocalCacheAvailableBytes};
 if(pre.firmware!=='2.0.11'||!pre.online||!pre.curtain?.connected||pre.queued!==0||
  pre.relayStreaming||data.length>pre.curtain.nanoLocalCacheAvailableBytes)
  throw Error('Nano 2.0.11 not ready for 8KB local stage');
 const asset=await request('/api/curtain/assets',{
  nativeEff:data.toString('base64'),nativeCid:cid,name:'Jack Run Moving Strip CID85402'});
 if(asset.sha256!==expected)throw Error('Oracle asset digest mismatch');
 out.oracleAsset={sha256:asset.sha256,bytes:data.length,frames:8,cid};
 const q=await request('/api/curtain/call',{action:'nativeSlotStage',payload:{sha256:expected,cid},
   idempotencyKey:'jack-moving-strip-native-stage-cid85402-once'});
 out.stageAttempted=true;out.stageCommandId=q.commandId;
 for(let i=0;i<125;i++){
  await new Promise(r=>setTimeout(r,1500));
  const command=(await request('/api/curtain/command?id='+q.commandId)).command;
  if(['applied','failed','expired','superseded'].includes(command.state)){
   out.stageAck={id:command.id,state:command.state,result:command.result};
   break;
  }
 }
 out.after=await request('/api/curtain/status');
 out.result=out.stageAck?.state==='applied'?'NANO_LOCAL_NATIVE_SHA_STAGE_VERIFIED_NO_BLE_UPLOAD':'NANO_STAGE_NOT_VERIFIED';
 if(out.result!=='NANO_LOCAL_NATIVE_SHA_STAGE_VERIFIED_NO_BLE_UPLOAD')process.exitCode=1;
}catch(e){out.result='STAGE_FAILED_NO_BLE_UPLOAD';out.error=String(e?.message||e);process.exitCode=1}
finally{console.log('JH2_TYPE3_MOVING_STRIP_STAGE',JSON.stringify(out));}
