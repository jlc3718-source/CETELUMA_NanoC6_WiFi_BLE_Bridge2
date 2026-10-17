import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the shipped receive controls without a physical Nano or real key.
function receiver({devices=[],queued=false,bleFails=false}={}){
 const ids=['ct','or','fw','curtain','oracle','firmware','scan','device','connect','disconnect','on','off','result','receiveKey','receiveCommands','oracleKey','oracleStatus','version','ble','pinBox','pin','unlock','check','install','auto','update'];
 const nodes=Object.fromEntries(ids.map(id=>[id,{value:'',textContent:'',disabled:false,hidden:false,dataset:{},children:[],replaceChildren(){this.children=[];},appendChild(e){this.children.push(e);}}]));
 const calls=[];let configured=false;
 const context={document:{hidden:false,getElementById:id=>nodes[id],createElement:()=>({value:'',textContent:''})},setTimeout:(fn,ms)=>setTimeout(fn,ms===250?0:ms),setInterval(){},Promise,console,
  fetch:async(path,options={})=>{
   const body=options.body?JSON.parse(options.body):undefined;calls.push({path,body});
   if(path==='/api/bridge/pair')configured=true;
   const done=bleFails?{ok:false,error:'Selected controller not found'}:{ok:true,devices,message:'Bluetooth request complete'};
   const data=path==='/api/health'?{ok:true,version:'1.1.16',timeValid:true,oracle:{configured,online:configured},curtain:{connected:true}}:path==='/api/firmware/access'?{ok:true,unlocked:false}:path==='/api/curtain/call'?(queued?{ok:true,pending:true,requestId:1}:done):path.startsWith('/api/curtain/call?')?done:{ok:true};
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
test('Scan lists the advertised devices and Connect sends the selected address to the worker',async()=>{
 const devices=[{name:'DN5E58',address:'08:d1:f9:98:5e:5a',rssi:-45},{name:'Second curtain',address:'11:22:33:44:55:66',rssi:-60}];
 const {nodes,calls}=receiver({devices,queued:true});await nodes.scan.onclick();
 assert.equal(nodes.device.children.length,3);
 assert.match(nodes.device.children[2].textContent,/Second curtain/);
 nodes.device.value=devices[1].address;await nodes.connect.onclick();
 assert.deepEqual(calls.filter(c=>c.path==='/api/curtain/call').map(c=>c.body),[{action:'scan',payload:{},async:true},{action:'connect',payload:{address:devices[1].address},async:true}]);
 assert.equal(nodes.connect.disabled,false);assert.equal(nodes.scan.disabled,false);
});
test('a failed Bluetooth attempt releases the page controls and displays its actual error',async()=>{
 const {nodes}=receiver({queued:true,bleFails:true});nodes.device.value='11:22:33:44:55:66';await nodes.connect.onclick();
 assert.match(nodes.result.textContent,/Selected controller not found/);
 for(const id of ['scan','connect','disconnect','on','off'])assert.equal(nodes[id].disabled,false);
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
