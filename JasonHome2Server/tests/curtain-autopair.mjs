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
function phone({online=false,available=true,localWorks=true}={}){
 const calls=[],scheduled=[];let paired=false;
 const document={hidden:false,readyState:'loading',getElementById:()=>null,querySelector:()=>null,addEventListener(){}};
 const context={document,location:{pathname:'/jason-home-2/'},console,
  fetch:async(url,options={})=>{
   calls.push({url,body:options.body&&JSON.parse(options.body)});
   let data;
   if(url.endsWith('/api/curtain/status'))data={ok:true,online:online||paired};
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
  queueMicrotask(()=>context.__curtainNativeResult(id,localWorks?{ok:true}:{ok:false,error:'Not on home Wi-Fi'}));
 }};
 vm.runInNewContext(readFileSync(new URL('../curtain_remote.js',import.meta.url),'utf8'),context);
 return {context,calls,scheduled};
}
test('opening the APK pairs over its existing LAN bridge without any Settings pane or button',async()=>{
 const p=phone();assert.equal(p.scheduled.length,1);
 assert.equal(await p.context.JH2EnsureNanoPairing(),true);
 assert.equal(p.calls.filter(c=>c.action==='pairNano').length,1);
 assert.equal(p.calls.some(c=>c.url?.endsWith('/api/curtain/pair')),false);
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
 const p=phone({available:false});assert.equal(await p.context.JH2EnsureNanoPairing(),false);assert.equal(p.calls.length,0);
});
