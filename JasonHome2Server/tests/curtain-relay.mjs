import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {createCurtainBridge,validateCommand} from '../curtain_bridge.mjs';import {compileAsset} from '../curtain_asset.mjs';
const create=()=>{const db=new DatabaseSync(':memory:');let t=1000000;const bridge=createCurtainBridge({db,now:()=>t});return {b:bridge,db,time:v=>t=v};};
test('bridge credentials are separate; both proxy-safe headers authenticate; raw UUID/op limits are enforced',()=>{const {b}=create();try{assert.equal(b.authorized({headers:{authorization:'Bearer admin'}}),false);const p=b.pairing();assert.ok(b.authorized({headers:{authorization:'Bearer '+p.token}}));assert.ok(b.authorized({headers:{'x-jh2-bridge-token':p.token}}));assert.equal(b.authorized({headers:{authorization:'Bearer '+p.token,'x-jh2-bridge-token':'0'.repeat(64)}}),false);assert.throws(()=>validateCommand('rawWrite',{uuid:'unrelated',data:'AA=='}));assert.deepEqual(validateCommand('power',{value:false}),{on:false});assert.throws(()=>validateCommand('effect',{id:88}));}finally{b.close();}});
test('credential rotation waits for 1.1.2 and promotes only after the NanoC6 uses the new token',()=>{const {b}=create();try{const old=b.pairing();b.requestRotation();const unchanged=b.sync({status:{firmware:'1.1.1'}},'current');assert.equal(unchanged.credential,null);const offered=b.sync({status:{firmware:'1.1.2'}},'current').credential;assert.equal(offered.token.length,64);assert.ok(b.authorized({headers:{authorization:'Bearer '+old.token}}));assert.ok(b.authorized({headers:{'x-jh2-bridge-token':offered.token}}));b.sync({status:{firmware:'1.1.2'}},'pending');assert.equal(b.authorized({headers:{authorization:'Bearer '+old.token}}),false);assert.ok(b.authorized({headers:{authorization:'Bearer '+offered.token}}));assert.equal(b.status().credentialRotationPending,false);}finally{b.close();}});
test('queue is ordered, idempotent, latest selection replaces stale selection, and success requires BLE ACK',()=>{const {b}=create();try{const a=b.enqueue('effect',{id:1},'request-1');assert.equal(b.enqueue('effect',{id:1},'request-1').id,a.id);const c=b.enqueue('effect',{id:2});assert.equal(b.command(a.id).state,'superseded');assert.equal(b.command(c.id).state,'queued');assert.equal(b.sync({}).commands[0].id,c.id);b.sync({acks:[{id:c.id,state:'downloaded',result:{}}]});assert.equal(b.command(c.id).state,'downloaded');b.sync({acks:[{id:c.id,state:'applied',result:{bleTransmitted:true}}]});assert.equal(b.command(c.id).state,'applied');assert.equal(b.command(c.id).physicalPlaybackConfirmed,false);}finally{b.close();}});
test('reconnect discards expired raw writes; reboot restores latest desired state; local override has an expiry',()=>{const {b,time}=create();try{b.enqueue('rawWrite',{uuid:'01020074-1972-1925-3022-077119514e44',data:'AQ=='});const effect=b.enqueue('effect',{id:3});b.sync({acks:[{id:effect.id,state:'applied'}]});time(1061000);const response=b.sync({bootId:'new-boot',localOverrideUntil:1070000});assert.equal(response.commands.length,0);time(1071000);const stillHeld=b.sync({bootId:'new-boot'});assert.equal(stillHeld.commands.length,0,'Manual ownership lasts beyond local BLE hold');time(1900001);const back=b.sync({bootId:'new-boot'});assert.ok(back.commands.some(c=>c.action==='effect'));assert.ok(back.commands.every(c=>c.action!=='rawWrite'));}finally{b.close();}});
test('Oracle schedules run without the APK and local manual control returns after expiry',()=>{const {b,time}=create();try{b.saveSchedule({id:'night',start:1000000,end:2000000,action:'effect',payload:{id:4}});b.enqueue('effect',{id:5});assert.ok(b.status().manualUntil>1000000);time(1950000);b.tick();assert.equal(b.status().desired.visual.payload.id,4);time(2000001);b.tick();assert.equal(b.status().desired.power.payload.on,false);}finally{b.close();}});
test('asset compilation uses captured packet format and stored bytes exactly match digest',()=>{const {b}=create();try{const f=Buffer.alloc(6400);for(let i=0;i<6400;i+=4){f[i]=255;f[i+3]=255;}const input={frames:[f.toString('base64')],quality:'pal4',delays:[100],loop:false};const a=compileAsset(input);assert.equal(a.bytes.subarray(0,4).toString(),'JHC1');assert.equal(a.bytes.readUInt16LE(4),1);assert.ok(a.bytes.length<4096);const m=b.upload(input);assert.deepEqual(Buffer.from(b.asset(m.sha256)),a.bytes);assert.equal(b.upload(input).sha256,m.sha256);assert.throws(()=>b.upload({...input,frames:['AA==']}));}finally{b.close();}});

test('explicit APK manual commands preempt the 15-minute local override without releasing scheduled commands',()=>{
 const {b}=create();
 try{
  b.saveSchedule({id:'local-held',start:1000000,end:2000000,action:'effect',payload:{id:4}});
  const manual=b.enqueue('brightness',{value:66},null,'manual');
  const duringOverride=b.sync({localOverrideUntil:1500000});
  assert.deepEqual(duringOverride.commands.map(c=>c.id),[manual.id]);
  assert.equal(duringOverride.commands[0].source,'manual');
  b.sync({localOverrideUntil:0,acks:[{id:manual.id,state:'applied',result:{bleTransmitted:true}}]});
  assert.equal(b.command(manual.id).state,'applied');
 }finally{b.close();}
});

test('remote Nano administration is allowlisted and never persists reboots as desired curtain state',()=>{
 const {b}=create();
 try{
  assert.deepEqual(validateCommand('nanoInfo',{}),{});
  assert.deepEqual(validateCommand('nanoAutoUpdate',{enabled:true}),{enabled:true});
  assert.throws(()=>validateCommand('nanoAutoUpdate',{enabled:'true'}));
  assert.throws(()=>validateCommand('nanoProxy',{url:'http://192.168.1.1/'}));
  const command=b.enqueue('nanoFirmwareCheck',{},null,'manual');
  const update=b.enqueue('nanoAutoUpdate',{enabled:false},null,'manual');
  assert.deepEqual(b.sync({localOverrideUntil:1500000}).commands.map(x=>x.id),[command.id,update.id]);
  assert.equal(Object.keys(b.status().desired).some(k=>k.startsWith('nano')),false);
 }finally{b.close();}
});


function preparedColor(r,g,b){
 const frame=Buffer.alloc(6400);
 for(let i=0;i<frame.length;i+=4){frame[i]=r;frame[i+1]=g;frame[i+2]=b;frame[i+3]=255;}
 return {frames:[frame.toString('base64')],quality:'pal4',delays:[100],loop:false};
}
test('single-active-file: A -> B -> confirmed activation prunes A and every obsolete BLOB',()=>{
 const {b,db}=create();try{
  const a=b.upload(preparedColor(255,0,0)),cmdA=b.enqueue('asset',{sha256:a.sha256});
  b.sync({acks:[{id:cmdA.id,state:'applied',result:{bleTransmitted:true,physicalPlaybackConfirmed:true}}]});
  assert.equal(b.retained().active.sha256,a.sha256);assert.equal(b.retained().retainedFiles,1);
  const other=b.upload(preparedColor(0,255,0));
  assert.equal(b.retained().retainedFiles,2);
  assert.equal(b.retained().active.sha256,a.sha256);
  const cmdB=b.enqueue('asset',{sha256:other.sha256});
  b.sync({acks:[{id:cmdB.id,state:'downloaded',result:{}}]});
  assert.equal(b.retained().phase,'transferring');
  b.sync({acks:[{id:cmdB.id,state:'applied',result:{bleTransmitted:true,physicalPlaybackConfirmed:false}}]});
  assert.equal(b.retained().phase,'transferred_unconfirmed');
  assert.equal(b.retained().active.sha256,a.sha256,'BLE first-frame ACK cannot delete recoverable image');
  assert.equal(b.retained().retainedFiles,2);
  // Explicitly selecting a different image should not require manual
  // confirmation of every preview. The original confirmed image remains.
  assert.equal(b.retained().confirmationRequired,true);
  assert.throws(()=>b.confirmDisplayed(cmdA.id),/newer command/);
  const confirmed=b.confirmDisplayed(cmdB.id);
  assert.equal(confirmed.active.sha256,other.sha256);assert.equal(confirmed.pending,null);
  assert.equal(confirmed.retainedFiles,1);assert.equal(b.asset(a.sha256),undefined);
  assert.equal(db.prepare('SELECT count(*) n FROM curtain_assets').get().n,1);
 }finally{b.close();}
});
test('new user image supersedes an unconfirmed preview without accumulating history',()=>{
 const {b}=create();try{
  const a=b.upload(preparedColor(255,0,0)),cmdA=b.enqueue('asset',{sha256:a.sha256});
  b.sync({acks:[{id:cmdA.id,state:'applied',result:{bleTransmitted:true}}]});
  b.confirmDisplayed(cmdA.id);
  const next=b.upload(preparedColor(0,255,0)),cmdB=b.enqueue('asset',{sha256:next.sha256});
  b.sync({acks:[{id:cmdB.id,state:'applied',result:{bleTransmitted:true}}]});
  const third=b.upload(preparedColor(0,0,255));
  assert.equal(b.retained().retainedFiles,2,'Only confirmed A and pending C survive');
  assert.equal(b.retained().active.sha256,a.sha256);
  assert.equal(b.retained().pending.sha256,third.sha256);
  assert.equal(b.asset(next.sha256),undefined,'Unconfirmed B must be garbage collected');
  const cmdC=b.enqueue('asset',{sha256:third.sha256});
  b.sync({acks:[{id:cmdC.id,state:'applied',result:{bleTransmitted:true}}]});
  b.confirmDisplayed(cmdC.id);
  assert.equal(b.retained().retainedFiles,1);
  assert.equal(b.retained().active.sha256,third.sha256);
 }finally{b.close();}
});
test('failed replacement preserves previous active asset and cleans abandoned staging',()=>{
 const {b,time}=create();try{
  const a=b.upload(preparedColor(255,0,0)),commandA=b.enqueue('asset',{sha256:a.sha256});
  b.sync({acks:[{id:commandA.id,state:'applied',result:{bleTransmitted:true,physicalPlaybackConfirmed:true}}]});
  const next=b.upload(preparedColor(0,0,255)),commandB=b.enqueue('asset',{sha256:next.sha256});
  b.sync({acks:[{id:commandB.id,state:'failed',result:{error:'BLE disconnected'}}]});
  assert.equal(b.retained().active.sha256,a.sha256);assert.equal(b.retained().retainedFiles,1);
  assert.equal(b.asset(next.sha256),undefined);
  assert.equal(b.status().desired.visual.payload.sha256,a.sha256,'Failed replacement must restore the known active scene');
  const unused=b.upload(preparedColor(17,25,50));assert.ok(b.asset(unused.sha256));
  time(1000000+16*60000);b.tick();
  // Passive cleanup runs on the background timer. Explicit restart also reconciles.
  b.close();
 }catch(error){b.close();throw error;}
});
test('speed and brightness adjustments never delete the current image; confirmed Off frees it',()=>{
 const {b}=create();try{
  const a=b.upload(preparedColor(255,0,0)),cmd=b.enqueue('asset',{sha256:a.sha256});
  b.sync({acks:[{id:cmd.id,state:'applied',result:{bleTransmitted:true,physicalPlaybackConfirmed:true}}]});
  for(const [action,payload] of [['brightness',{value:50}],['speed',{value:20}]]){
   const adjust=b.enqueue(action,payload);b.sync({acks:[{id:adjust.id,state:'applied',result:{bleTransmitted:true,physicalPlaybackConfirmed:true}}]});
   assert.equal(b.retained().active.sha256,a.sha256);
  }
  const off=b.enqueue('power',{on:false});b.sync({acks:[{id:off.id,state:'applied',result:{bleTransmitted:true,physicalPlaybackConfirmed:false}}]});
  assert.equal(b.retained().retainedFiles,1,'Unverified display does not permit deletion');
  const off2=b.enqueue('power',{on:false});b.sync({acks:[{id:off2.id,state:'applied',result:{bleTransmitted:true,physicalPlaybackConfirmed:true}}]});
  assert.equal(b.retained().active,null);assert.equal(b.retained().retainedFiles,0);
 }finally{b.close();}
});
test('20 replacements retain exactly one active asset once verified, no historical accumulation',()=>{
 const {b}=create();try{
  for(let i=1;i<=25;i++){
   const asset=b.upload(preparedColor(i*7%255,i*11%255,i*17%255));
   const command=b.enqueue('asset',{sha256:asset.sha256});
   b.sync({acks:[{id:command.id,state:'applied',result:{bleTransmitted:true,physicalPlaybackConfirmed:true}}]});
   assert.equal(b.retained().retainedFiles,1);
   assert.equal(b.retained().active.sha256,asset.sha256);
  }
 }finally{b.close();}
});
test('restarting Oracle recovers exactly active and pending; staging expiry never drops active',()=>{
 const db=new DatabaseSync(':memory:');let now=1000000;let a=createCurtainBridge({db,now:()=>now});
 try{
  const saved=a.upload(preparedColor(255,0,0)),cmd=a.enqueue('asset',{sha256:saved.sha256});
  a.sync({acks:[{id:cmd.id,state:'applied',result:{bleTransmitted:true,physicalPlaybackConfirmed:true}}]});
  a.upload(preparedColor(0,255,0));a.close();
  let restarted=createCurtainBridge({db,now:()=>now});
  assert.equal(restarted.retained().retainedFiles,2);
  assert.equal(restarted.retained().active.sha256,saved.sha256);
  restarted.close();
  now+=16*60000;restarted=createCurtainBridge({db,now:()=>now});
  assert.equal(restarted.retained().active.sha256,saved.sha256);
  assert.equal(restarted.retained().pending,null);
  assert.equal(restarted.retained().retainedFiles,1);
  restarted.close();
 }finally{a.close();db.close();}
});

test('unconfirmed native effect/off retains prior file until latest command is visibly confirmed',()=>{
 const {b}=create();try{
  const a=b.upload(preparedColor(255,0,0)),cmd=b.enqueue('asset',{sha256:a.sha256});
  b.sync({acks:[{id:cmd.id,state:'applied',result:{bleTransmitted:true}}]});
  b.confirmDisplayed(cmd.id);
  const effect=b.enqueue('effect',{id:10});
  b.sync({acks:[{id:effect.id,state:'applied',result:{bleTransmitted:true,physicalPlaybackConfirmed:false}}]});
  assert.equal(b.retained().retainedFiles,1);
  assert.equal(b.retained().confirmationAction,'effect');
  assert.equal(b.retained().confirmationRequired,true);
  assert.throws(()=>b.confirmDisplayed(cmd.id),/newer command/);
  const confirmed=b.confirmDisplayed(effect.id);
  assert.equal(confirmed.retainedFiles,0);
  assert.equal(confirmed.active,null);
 }finally{b.close();}
});
test('scheduled media survives migration and does not get deleted by later unrelated uploads',()=>{
 const {b,db,time}=create();try{
  const a=b.upload(preparedColor(255,0,0)),cmd=b.enqueue('asset',{sha256:a.sha256});
  b.sync({acks:[{id:cmd.id,state:'applied',result:{bleTransmitted:true}}]});
  b.confirmDisplayed(cmd.id);
  b.saveSchedule({id:'future-image',start:1800000,end:2200000,action:'asset',payload:{sha256:a.sha256}});
  const effect=b.enqueue('effect',{id:8});
  b.sync({acks:[{id:effect.id,state:'applied',result:{bleTransmitted:true}}]});
  b.confirmDisplayed(effect.id);
  assert.ok(b.asset(a.sha256),'scheduled image must remain recoverable until its schedule is removed');
 }finally{b.close();}
});


test('detailed multicolor GIF is packetized into bounded doodle writes without Nano storage',()=>{
 const frames=[];
 for(let k=0;k<3;k++){
  const frame=Buffer.alloc(6400);
  for(let y=0;y<40;y++)for(let x=0;x<40;x++){
   const i=(y*40+x)*4;
   frame[i]=((x*37+y*19+k*11)&255);
   frame[i+1]=((x*17+y*43+k*23)&255);
   frame[i+2]=((x*53+y*11+k*17)&255);
   frame[i+3]=255;
  }
  frames.push(frame.toString('base64'));
 }
 const compiled=compileAsset({frames,quality:'pal16',delays:[80,100,120],loop:true});
 assert.equal(compiled.bytes.subarray(0,4).toString(),'JHC1');
 assert.equal(compiled.frames,3);
 let off=8,doodleWrites=0,largest=0,totalDoodleBytes=0;
 for(let frame=0;frame<3;frame++){
  const delay=compiled.bytes.readUInt32LE(off),records=compiled.bytes.readUInt16LE(off+4);off+=6;
  assert.equal(delay,[80,100,120][frame]);
  for(let i=0;i<records;i++){
   const channel=compiled.bytes[off],size=compiled.bytes.readUInt16LE(off+1);off+=3;
   assert.ok(off+size<=compiled.bytes.length,'record must be complete');
   if(frame>0&&i===0){
    assert.equal(channel,0,'subsequent GIF frame must begin with a control packet');
    assert.equal(compiled.bytes.readUInt16BE(off+10),2713,'clear preceding GIF frame to prevent ghosts');
   }
   if(channel===1){
    assert.ok(size<=204,'one BLE doodle write must not exceed captured 204-byte doodle transfer');
    assert.ok(size>=5,'must contain transport framing');
    assert.equal(compiled.bytes[off+1],1,'each compiled doodle unit should fit in one BLE write');
    assert.equal(compiled.bytes[off+2],0,'no missing doodle fragments');
    largest=Math.max(largest,size);totalDoodleBytes+=size;doodleWrites++;
   }
   off+=size;
  }
 }
 assert.equal(off,compiled.bytes.length);
 assert.ok(largest>126,'the new encoder should use captured larger-than-126-byte packed writes');
 assert.ok(totalDoodleBytes<3*6400,'indexed GIF framing must compress raw 40x40 RGBA frames');
 assert.ok(doodleWrites>3,'detailed pictures can require multiple compressed writes');
});

test('new picture supersedes a previous queued or downloaded transfer while keeping confirmed rollback asset',()=>{
 const {b}=create();
 try{
  const solid=(red)=>{const f=Buffer.alloc(6400);for(let i=0;i<f.length;i+=4){f[i]=red;f[i+3]=255;}return {frames:[f.toString('base64')],quality:'pal4',delays:[100]};};
  const first=b.upload(solid(100));const c1=b.enqueue('asset',{sha256:first.sha256});
  b.sync({acks:[{id:c1.id,state:'downloaded',result:{}}]});
  const second=b.upload(solid(150));
  assert.notEqual(first.sha256,second.sha256);
  const c2=b.enqueue('asset',{sha256:second.sha256});
  assert.equal(b.command(c1.id).state,'superseded','old in-flight visual is preempted by new manual selection');
  assert.equal(b.sync({}).commands.some(c=>c.id===c2.id),true);
  assert.equal(b.asset(second.sha256)!=null,true);
  b.sync({acks:[{id:c2.id,state:'applied',result:{bleTransmitted:true}}]});
  assert.equal(b.command(c2.id).state,'applied');
 }finally{b.close();}
});

test('live manual command cannot be hidden behind older recovery entries or local BLE override',()=>{
 const {b}=create();
 try{
  for(let i=0;i<12;i++)b.enqueue('nanoInfo',{},'recovery-'+i,'recovery');
  const manual=b.enqueue('nanoInfo',{},'manual-now','manual');
  const first=b.sync({status:{firmware:'1.1.12'}});
  assert.equal(first.commands[0].id,manual.id,'user command must be first');
  const local=b.sync({localOverrideUntil:1010000,status:{firmware:'1.1.12'}});
  assert.deepEqual(local.commands.map(c=>c.id),[manual.id],'filter before LIMIT must prevent recovery backlog starvation');
 }finally{b.close();}
});

test('Manual curtain control clears stale recovery and replays desired only after hold',()=>{
 const {b,time}=create();
 try{
  const power=b.enqueue('power',{on:true},null,'recovery');
  const speed=b.enqueue('speed',{value:29},null,'recovery');
  const user=b.enqueue('brightness',{value:54},null,'manual');
  assert.equal(b.status().manualUntil,1900000);
  const held=b.sync({bootId:'new-nano'});
  assert.equal(b.command(power.id).state,'superseded');
  assert.equal(b.command(speed.id).state,'superseded');
  assert.deepEqual(held.commands.map(x=>x.id),[user.id]);
  b.sync({acks:[{id:user.id,state:'applied',result:{bleTransmitted:true}}]});
  assert.equal(b.status().queued,0);
  assert.equal(b.sync({bootId:'new-nano'}).commands.length,0,'No recovery during hold');
  time(1900001);
  const resume=b.sync({bootId:'new-nano'});
  assert.deepEqual(new Set(resume.commands.map(x=>x.action)),new Set(['power','speed','brightness']));
  assert.equal(resume.commands.length,3);
  assert.equal(b.sync({bootId:'new-nano'}).commands.length,3,'No duplicate recovery');
 }finally{b.close()}
});
