import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createCurtainBridge} from '../curtain_bridge.mjs';

test('a failed home-LAN attempt preserves the active bridge key; only Nano authentication promotes the grant',()=>{
 const db=new DatabaseSync(':memory:');let t=1000000;const b=createCurtainBridge({db,now:()=>t});
 try{
  const original=b.pairing(),grant=b.autoPairing();
  assert.equal(grant.token.length,64);assert.notEqual(grant.token,original.token);
  const auth=token=>b.authenticate({headers:{'x-jh2-bridge-token':token}});
  assert.equal(auth(original.token),'current');assert.equal(auth(grant.token),'bootstrap');
  assert.equal(b.autoPairing().token,grant.token,'Overlapping phone attempts share a bounded grant');
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM curtain_meta').all()).includes(grant.token),'No plaintext key in persistent metadata');
  b.sync({bootId:'real-nano',status:{firmware:'1.1.13',commandTransport:'wss-duplex'}},'bootstrap');
  assert.equal(auth(grant.token),'current');assert.equal(auth(original.token),null);
 }finally{b.close();db.close();}
});
test('unused automatic grant expires without disconnecting the existing Nano',()=>{
 const db=new DatabaseSync(':memory:');let t=1000000;const b=createCurtainBridge({db,now:()=>t});
 try{
  const original=b.pairing(),grant=b.autoPairing();t+=120001;
  assert.equal(b.authenticate({headers:{'x-jh2-bridge-token':grant.token}}),null);
  assert.equal(b.authenticate({headers:{'x-jh2-bridge-token':original.token}}),'current');
  assert.notEqual(b.autoPairing().token,grant.token);
 }finally{b.close();db.close();}
});
test('an online Nano is not rotated by app startup',()=>{
 const db=new DatabaseSync(':memory:');const b=createCurtainBridge({db});try{
  b.pairing();b.sync({status:{firmware:'1.1.12'}});
  assert.deepEqual(b.autoPairing(),{ok:true,alreadyOnline:true});
 }finally{b.close();db.close();}
});
function phone({online=false,available=true,localWorks=true,loadControlsDuringSetup=false}={}){
 const calls=[],scheduled=[];let paired=false;
 const document={hidden:false,readyState:'loading',getElementById:()=>null,querySelector:()=>null,addEventListener(){}};
 const context={document,location:{pathname:'/jason-home-2/'},console,
  fetch:async(url,options={})=>{
   calls.push({url,body:options.body&&JSON.parse(options.body)});
   let data;
   if(url.endsWith('/api/curtain/status'))data={ok:true,online:online||paired};
   else if(url.endsWith('/api/curtain/call'))data={ok:true,commandId:4180,bridgeOnline:online||paired};
   else if(url.includes('/api/curtain/command?id='))data={ok:true,command:{id:4180,state:'applied',result:{bleTransmitted:true}}};
   else if(url.endsWith('/api/curtain/pair'))data={ok:true,token:'3'.repeat(64),bridgeId:'2'.repeat(16),endpoint:'https://150.136.245.51/jason-home-2'};
   else if(url.endsWith('/api/curtain/autopair')&&options.body&&JSON.parse(options.body).diagnostic)data={ok:true};
   else if(url.endsWith('/api/curtain/autopair'))data={ok:true,token:'1'.repeat(64),bridgeId:'2'.repeat(16),endpoint:'https://150.136.245.51/jason-home-2'};
   else throw Error('Unexpected endpoint '+url);
   return {ok:true,json:async()=>data};
  },
  setTimeout(fn,ms){if(ms===250){scheduled.push(fn);return 0;}return setTimeout(fn,ms===500?0:ms);},
  clearTimeout,setInterval(){},queueMicrotask,crypto:{randomUUID:()=> 'test-id'},
 };
 context.window=context;context.addEventListener=()=>{};
 context.AndroidCurtain={localControllerAvailable:()=>available,call(id,action,payload){
  calls.push({action,payload:JSON.parse(payload)});
  assert.equal(action,'pairNano');
  if(localWorks)paired=true;
  if(loadControlsDuringSetup)vm.runInNewContext(readFileSync(new URL('../curtain.js',import.meta.url),'utf8'),context);
  queueMicrotask(()=>context.__curtainNativeResult(id,localWorks?{ok:true}:{ok:false,error:'Not on home Wi-Fi'}));
 }};
 vm.runInNewContext(readFileSync(new URL('../curtain_remote.js',import.meta.url),'utf8'),context);
 return {context,calls,scheduled};
}
test('legacy explicit LAN setup remains callable but opening the APK never starts it',async()=>{
 const p=phone();assert.equal(p.scheduled.length,0);
 assert.equal(await p.context.JH2EnsureNanoPairing(),true);
 assert.equal(p.calls.filter(c=>c.action==='pairNano').length,1);
 assert.equal(p.calls.some(c=>c.url?.endsWith('/api/curtain/pair')),false);
});
test('an offline APK command never starts Nano setup or writes its connection settings',async()=>{
 const p=phone();
 await assert.rejects(p.context.JH2OracleCurtainCall('power',{on:true}),/Manual Oracle connection/);
 assert.deepEqual(p.calls.map(c=>c.url),['/jason-home-2/api/curtain/call']);
 assert.equal(p.scheduled.length,0);
});
test('an online APK command waits for its real acknowledgement without reconfiguring the Nano',async()=>{
 const p=phone({online:true});
 const result=await p.context.JH2OracleCurtainCall('power',{on:true});
 assert.equal(result.bleTransmitted,true);
 assert.deepEqual(p.calls.map(c=>c.url),['/jason-home-2/api/curtain/call','/jason-home-2/api/curtain/command?id=4180']);
});
test('creating a manual key is explicit and prevents subsequent legacy setup calls',async()=>{
 const p=phone();const key=await p.context.JH2CreateManualKey();
 assert.equal(key.token.length,64);
 assert.deepEqual(p.calls[0],{url:'/jason-home-2/api/curtain/pair',body:{manual:true}});
 assert.equal(await p.context.JH2EnsureNanoPairing(true),false);
 assert.equal(p.calls.length,1);
});
test('mobile-data/local-discovery failure is quiet and never invokes public Nano pairing',async()=>{
 const p=phone({localWorks:false});assert.equal(await p.context.JH2EnsureNanoPairing(),false);
 assert.equal(p.calls.some(c=>c.url?.includes('craumer.tplinkdns.com')),false);
 assert.equal(await p.context.JH2EnsureNanoPairing(),false);
 assert.equal(p.calls.filter(c=>c.action==='pairNano').length,1,'Failed attempts are rate limited');
});
test('startup skips pairing when Oracle already has a live channel',async()=>{
 const p=phone({online:true});assert.equal(await p.context.JH2EnsureNanoPairing(),true);
 assert.equal(p.calls.some(c=>c.action==='pairNano'||c.url?.endsWith('/autopair')),false);
});
test('a browser without the trusted APK helper cannot start automatic LAN provisioning',async()=>{
 const p=phone({available:false});assert.equal(await p.context.JH2EnsureNanoPairing(),false);assert.equal(p.calls.some(c=>c.action==='pairNano'),false);assert.equal(p.calls.some(c=>c.body?.diagnostic?.code==='helper_missing'),true);
});

test('a missing historical image cannot reject automatic pairing or block remaining desired controls',()=>{
 const db=new DatabaseSync(':memory:'),b=createCurtainBridge({db});try{
  b.pairing();const grant=b.autoPairing();
  db.prepare('INSERT INTO curtain_meta(key,value) VALUES(?,?)').run('desired',JSON.stringify({visual:{action:'asset',payload:{sha256:'f'.repeat(64)}},brightness:{action:'brightness',payload:{value:66}},power:{action:'power',payload:{on:false}}}));
  const restored=b.sync({bootId:'new-nano',status:{firmware:'1.1.13',curtain:{connected:true}}},'bootstrap');
  assert.equal(restored.ok,true);assert.deepEqual(restored.commands.map(c=>c.action),['brightness','power']);
  assert.equal(b.status().desired.visual,undefined);assert.match(b.retained().lastError,/file is unavailable/);
  assert.equal(b.authenticate({headers:{'x-jh2-bridge-token':grant.token}}),'current');
 }finally{b.close();db.close();}
});

test('late Curtain UI initialization preserves the in-flight native setup callback',async()=>{
 const p=phone({loadControlsDuringSetup:true});
 assert.equal(await p.context.JH2EnsureNanoPairing(),true);
 assert.equal(p.calls.some(c=>c.body?.diagnostic?.stage==='ready'),true);
});
test('connection diagnostics retain only bounded stage codes and never store credential-bearing errors',()=>{
 const db=new DatabaseSync(':memory:'),b=createCurtainBridge({db});try{
  b.autoPairing({diagnostic:{stage:'helper',code:'helper_missing',android:true,error:'secret '.repeat(300)}});
  const report=JSON.parse(db.prepare("SELECT value FROM curtain_meta WHERE key='connectionDiagnostic'").get().value);
  assert.deepEqual(Object.keys(report).sort(),['android','at','code','stage']);
  assert.equal(report.code,'helper_missing');
  assert.throws(()=>b.autoPairing({diagnostic:{stage:'random',code:'helper_missing'}}),/Invalid connection diagnostic/);
 }finally{b.close();db.close();}
});

test('manual recovery key is durable and automatic setup cannot replace it',()=>{
 const db=new DatabaseSync(':memory:');let at=1000000;let b=createCurtainBridge({db,now:()=>at});
 try{
  const automatic=b.autoPairing(),manual=b.pairing({manual:true});
  assert.equal(b.status().manualPairing,true);
  assert.equal(b.authenticate({headers:{'x-jh2-bridge-token':automatic.token}}),null);
  assert.throws(()=>b.autoPairing(),/Manual key setup is active/);
  at+=30*86400000;
  assert.equal(b.authenticate({headers:{'x-jh2-bridge-token':manual.token}}),'current');
  b.close();b=createCurtainBridge({db,now:()=>at});
  assert.equal(b.status().manualPairing,true);
  assert.equal(b.authenticate({headers:{'x-jh2-bridge-token':manual.token}}),'current');
  assert.throws(()=>b.autoPairing(),/Manual key setup is active/);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM curtain_meta').all()).includes(manual.token));
 }finally{b.close();db.close();}
});
