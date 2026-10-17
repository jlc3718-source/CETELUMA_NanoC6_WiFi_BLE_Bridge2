import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNanoC6BrightnessSync} from '../nanoc6_sync.mjs';

const create=(store,upstream,bridge)=>createNanoC6BrightnessSync({
 meta:(key,fallback)=>store.has(key)?store.get(key):fallback,
 put:(key,value)=>store.set(key,value),upstream,bridge,logger:{warn:()=>{}}
});

test('Eufy follower remains opt-in and schedules ON, brightness, OFF, then ON again',async()=>{
 const store=new Map(),sent=[];
 let scene={power:true,brightness:40};
 const bridge={enqueue:(action,payload,idempotency,source)=>{
  const job={id:sent.length+1,action,payload,idempotency,source};sent.push(job);return job;
 },status:()=>({online:true})};
 const follower=create(store,async()=>({calendar:{current:scene?{scene}:null}}),bridge);
 try{
  assert.equal(follower.status().enabled,false);
  await follower.poll();assert.equal(sent.length,0);
  await follower.setEnabled(true);
  assert.equal(sent.length,0,'Enabling is opt-in; next scheduler poll takes effect');
  await follower.poll();
  assert.deepEqual(sent.map(x=>[x.action,x.payload]),[
   ['power',{on:true}],['brightness',{value:40}]
  ]);
  assert.equal(sent.every(x=>x.source==='eufy-sync'),true);
  await follower.poll();assert.equal(sent.length,2,'No duplicates on unchanged scene');
  scene={power:true,brightness:75};await follower.poll();
  assert.deepEqual(sent[2].payload,{value:75});
  scene={power:false,brightness:2};await follower.poll();
  assert.deepEqual(sent[3],{id:4,action:'power',payload:{on:false},idempotency:null,source:'eufy-sync'});
  scene=null;await follower.poll();assert.equal(sent.length,4,'No repeated off in unscheduled gap');
  scene={power:true,brightness:75};await follower.poll();
  assert.deepEqual(sent.slice(4).map(x=>[x.action,x.payload]),[
   ['power',{on:true}],['brightness',{value:75}]
  ]);
  assert.equal(follower.status().lastQueuedPower,true);
  await follower.setEnabled(false);scene={power:false};await follower.poll();
  assert.equal(sent.length,6,'Disabled means no Eufy power or brightness writes');
 }finally{follower.close();}
});

test('No valid Eufy calendar must never turn curtain off',async()=>{
 const store=new Map([['nanoc6_brightness_sync_enabled_v1',true]]),sent=[];
 const follower=create(store,async()=>({calendar:{note:'still loading'}}),{
  status:()=>({online:true}),enqueue:(a,p)=>sent.push([a,p])
 });
 try{
  await follower.poll();
  assert.equal(sent.length,0);assert.match(follower.status().error,/not available/);
 }finally{follower.close();}
});

test('Manual Eufy override controls curtain power, while manual curtain hold defers it',async()=>{
 const store=new Map([['nanoc6_brightness_sync_enabled_v1',true]]),sent=[];
 let localHold=true,override={active:true,scene:{power:false,brightness:90}};
 const follower=create(store,async()=>({override,calendar:{current:{scene:{power:true,brightness:70}}}}),{
  manualHoldActive:()=>localHold,status:()=>({online:true}),
  enqueue:(action,payload)=>sent.push({action,payload})
 });
 try{
  await follower.poll();assert.equal(sent.length,0);
  localHold=false;await follower.poll();assert.deepEqual(sent,[{action:'power',payload:{on:false}}]);
  override={active:true,scene:{power:true,brightness:45}};
  await follower.poll();assert.deepEqual(sent.slice(1),[
   {action:'power',payload:{on:true}},{action:'brightness',payload:{value:45}}
  ]);
 }finally{follower.close();}
});

test('Offline bridge defers and replays latest Eufy scheduled state after reconnect',async()=>{
 const store=new Map([['nanoc6_brightness_sync_enabled_v1',true]]),sent=[];
 let bridgeLive=false,scene={power:true,brightness:64};
 const follower=create(store,async()=>({calendar:{current:{scene}}}),{
  status:()=>({online:bridgeLive}),enqueue:(action,payload)=>{sent.push({action,payload})}
 });
 try{
  await follower.poll();assert.equal(sent.length,0);
  scene={power:false,brightness:64};
  await follower.poll();assert.equal(sent.length,0);
  bridgeLive=true;await follower.poll();assert.deepEqual(sent,[{action:'power',payload:{on:false}}]);
 }finally{follower.close();}
});

test('Failed power ACK and brightness ACK retry instead of falsely claiming success',async()=>{
 const store=new Map([['nanoc6_brightness_sync_enabled_v1',true]]),sent=[],states=new Map();
 const follower=create(store,async()=>({calendar:{current:{scene:{power:true,brightness:60}}}}),{
  status:()=>({online:true}),enqueue:(action,payload)=>{
   const id=sent.length+1;sent.push({id,action,payload});states.set(id,'queued');return {id};
  },command:id=>({state:states.get(id)})
 });
 try{
  await follower.poll();assert.equal(sent.length,2);
  states.set(1,'failed');states.set(2,'failed');
  await follower.poll();
  assert.deepEqual(sent.slice(2).map(x=>x.action),['power','brightness']);
 }finally{follower.close();}
});

test('Bridge enqueue failures do not mark failed commands synced',async()=>{
 let warning='',store=new Map([['nanoc6_brightness_sync_enabled_v1',true]]);
 const follower=createNanoC6BrightnessSync({
  meta:(k,d)=>store.has(k)?store.get(k):d,put:()=>{},
  upstream:async()=>({calendar:{current:{scene:{brightness:60,power:true}}}}),
  bridge:{enqueue:()=>{throw Error('Bridge enqueue unavailable');}},
  logger:{warn:s=>{warning=s;}}
 });
 try{
  await follower.poll();
  assert.equal(follower.status().lastQueuedPower,null);
  assert.match(follower.status().error,/Bridge enqueue unavailable/);
  assert.match(warning,/Bridge enqueue unavailable/);
 }finally{follower.close();}
});

test('NanoC6 sync refuses enable when Oracle bridge unavailable',async()=>{
 const follower=createNanoC6BrightnessSync({
  meta:(k,d)=>d,put:()=>{throw Error('should not write')},
  upstream:async()=>{throw Error('should not poll')},logger:{warn:()=>{}}
 });
 try{
  assert.equal(follower.status().configured,false);
  await assert.rejects(follower.setEnabled(true),/not configured/);
  await follower.poll();
 }finally{follower.close();}
});

test('Oracle deploy keeps current scheduler follower and native-slot app assets',()=>{
 const script=readFileSync(new URL('../../.github/scripts/deploy-curtain-relay.py',import.meta.url),'utf8');
 assert.match(script,/curtain_bridge\.mjs/);
 assert.match(script,/nanoc6_sync\.mjs/);
 assert.match(script,/curtain_native_slot\.js/);
 assert.match(script,/bridge:curtainRelay/);
 assert.match(script,/live\.index\(bridge_init\)<live\.index\(new_sync\)/);
 assert.match(script,/relay\['pollSeconds'\]==5/);
});

test('linked Eufy master mode automatically follows every power, brightness and schedule transition',async()=>{
 const store=new Map([['nanoc6_brightness_sync_enabled_v1',false]]),sent=[],states=new Map();
 let active={power:false,brightness:45},connected=true,held=false,master=true;
 const bridge={
  eufyMasterEnabled:()=>master,manualHoldActive:()=>held,
  status:()=>({online:connected}),
  enqueue:(action,payload,idempotency,source)=>{const id=sent.length+1;sent.push({id,action,payload,source});states.set(id,'queued');return {id};},
  command:id=>({state:states.get(id)})
 };
 const follower=create(store,async()=>({calendar:{current:active?{scene:active}:null}}),bridge);
 try{
  assert.equal(follower.status().enabled,true,'stored legacy opt-out cannot prevent the Eufy master link');
  assert.equal(follower.status().eufyMasterSchedule,true);
  await follower.poll();
  assert.deepEqual(sent.map(x=>[x.action,x.payload]),[['power',{on:false}]]);
  active={power:true,brightness:54};await follower.poll();
  assert.deepEqual(sent.slice(1).map(x=>[x.action,x.payload]),[['power',{on:true}],['brightness',{value:54}]]);
  active={power:true,brightness:78};await follower.poll();
  assert.deepEqual(sent.at(-1).payload,{value:78},'brightness follows Eufy event changes');
  active=null;await follower.poll();
  assert.deepEqual(sent.at(-1).payload,{on:false},'off time is inherited without creating a second schedule');
  await assert.rejects(follower.setEnabled(false),/Eufy master schedule/);
  assert.equal(follower.status().enabled,true,'linked schedule cannot silently be disabled');
  connected=false;await follower.poll();
  const prior=sent.length;
  active={power:true,brightness:30};
  await follower.poll();assert.equal(sent.length,prior,'offline Nano receives no commands');
  connected=true;await follower.poll();
  assert.deepEqual(sent.slice(prior).map(x=>[x.action,x.payload]),[['power',{on:true}],['brightness',{value:30}]]);
  held=true;await follower.poll();
  active={power:false,brightness:30};const count=sent.length;await follower.poll();
  assert.equal(sent.length,count,'local physical override respected');
  held=false;await follower.poll();
  assert.deepEqual(sent.at(-1).payload,{on:false},'release of local override immediately catches up to Eufy');
 }finally{follower.close()}
});
test('production startup and UI both use Eufy as the only curtain scheduling authority',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../nano_sync.js',import.meta.url),'utf8');
 const curtain=readFileSync(new URL('../curtain.js',import.meta.url),'utf8');
 const remote=readFileSync(new URL('../curtain_remote.js',import.meta.url),'utf8');
 const bridge=server.indexOf('const curtainRelay=createCurtainBridge({db});');
 const master=server.indexOf('curtainRelay.setEufyMasterEnabled(true);');
 const follower=server.indexOf('const nanoC6BrightnessSync=createNanoC6BrightnessSync(');
 assert.ok(bridge>=0&&bridge<master&&master<follower);
 assert.match(curtain,/jh2CurtainEufyScheduleLinked/);
 assert.match(ui,/Curtain follows Eufy schedule/);
 assert.doesNotMatch(ui,/jh2NanoSyncEnabled|type="checkbox"/);
 assert.doesNotMatch(remote,/Oracle curtain schedule|jh2CSSave|jh2CSStart/);
 const script=readFileSync(new URL('../../.github/scripts/deploy-curtain-relay.py',import.meta.url),'utf8');
 assert.match(script,/eufy_master='curtainRelay\.setEufyMasterEnabled\(true\);'/);
});
