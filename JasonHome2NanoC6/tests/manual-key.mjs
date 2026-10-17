import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the shipped receive controls without a physical Nano or real key.
function receiver(){
 const ids=['ct','or','fw','curtain','oracle','firmware','connect','disconnect','on','off','result','receiveKey','receiveCommands','oracleKey','oracleStatus','version','ble','pinBox','pin','unlock','check','install','auto','update'];
 const nodes=Object.fromEntries(ids.map(id=>[id,{value:'',textContent:'',disabled:false,hidden:false,dataset:{}}]));
 const calls=[];let configured=false;
 const context={document:{hidden:false,getElementById:id=>nodes[id]},setTimeout,setInterval(){},Promise,console,
  fetch:async(path,options={})=>{
   const body=options.body?JSON.parse(options.body):undefined;calls.push({path,body});
   if(path==='/api/bridge/pair')configured=true;
   const data=path==='/api/health'?{ok:true,version:'1.1.15',timeValid:true,oracle:{configured,online:configured},curtain:{connected:true}}:path==='/api/firmware/access'?{ok:true,unlocked:false}:{ok:true};
   return {ok:true,json:async()=>data};
  }};
 const page=readFileSync(new URL('../include/BridgePage.h',import.meta.url),'utf8');
 vm.runInNewContext(page.match(/<script>([\s\S]*?)<\/script>/)[1],context);
 return {nodes,calls};
}

test('Receive key rejects incomplete input without changing Nano settings',async()=>{
 const {nodes,calls}=receiver();nodes.oracleKey.value='incomplete key';
 await nodes.receiveKey.onclick();
 assert.equal(calls.some(c=>c.path==='/api/bridge/pair'),false);
 assert.match(nodes.oracleStatus.textContent,/complete key/);
 assert.equal(nodes.receiveKey.disabled,false);
});
test('manual key is saved once, cleared from the input, then Receive commands resumes the existing receiver',async()=>{
 const {nodes,calls}=receiver();
 const key={endpoint:'https://150.136.245.51/jason-home-2',bridgeId:'2'.repeat(16),token:'3'.repeat(64)};
 nodes.oracleKey.value=JSON.stringify(key);await nodes.receiveKey.onclick();
 assert.deepEqual(calls.find(c=>c.path==='/api/bridge/pair').body,key);
 assert.equal(nodes.oracleKey.value,'');
 assert.equal(nodes.receiveKey.disabled,false);
 await nodes.receiveCommands.onclick();
 assert.deepEqual(calls.filter(c=>c.path.startsWith('/api/bridge/')).map(c=>c.path),['/api/bridge/pair','/api/bridge/resume','/api/bridge/sync']);
 assert.equal(nodes.receiveCommands.disabled,false);
 assert.match(nodes.oracleStatus.textContent,/Receiving commands from Oracle/);
});
