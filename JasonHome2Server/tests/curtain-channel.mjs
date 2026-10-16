import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {WebSocket} from '../curtain_transport/node_modules/ws/wrapper.mjs';
import {createCurtainBridge} from '../curtain_bridge.mjs';
import {attachCurtainChannel} from '../curtain_channel.mjs';

function next(ws){return new Promise((resolve,reject)=>{
 const timeout=setTimeout(()=>{ws.off('message',receive);reject(Error('No command was pushed'));},1500);
 const receive=bytes=>{clearTimeout(timeout);resolve(JSON.parse(bytes.toString()));};
 ws.once('message',receive);
});}
async function fixture(){
 const db=new DatabaseSync(':memory:'),bridge=createCurtainBridge({db}),server=http.createServer();
 const channel=attachCurtainChannel(server,bridge);server.listen(0,'127.0.0.1');await once(server,'listening');
 const pairing=bridge.pairing(),url='ws://127.0.0.1:'+server.address().port+'/api/curtain-bridge/channel';
 const ws=new WebSocket(url,{headers:{'X-JH2-Bridge-Token':pairing.token}});await once(ws,'open');
 const report={type:'state',reportId:1,bootId:'physical-bridge-test',status:{firmware:'1.1.13',curtain:{connected:true}}};
 const welcome=next(ws);ws.send(JSON.stringify(report));await welcome;
 return {bridge,ws,report,url,close:async()=>{ws.terminate();for(const peer of channel.clients)peer.terminate();await new Promise(r=>server.close(r));channel.close();bridge.close();db.close();}};
}
test('Oracle pushes the actual command immediately and accepts its ACK on the same socket',async()=>{
 const f=await fixture();try{
  const received=next(f.ws),start=performance.now(),command=f.bridge.enqueue('brightness',{value:63});
  const pushed=await received;
  assert.equal(pushed.commands[0].id,command.id);assert.deepEqual(pushed.commands[0].payload,{value:63});
  assert.ok(performance.now()-start<500,'Delivery must not wait for a Nano poll');
  const receipt=next(f.ws);
  f.ws.send(JSON.stringify({...f.report,reportId:2,acks:[{id:command.id,state:'applied',result:{bleTransmitted:true}}]}));
  const acknowledged=await receipt;
  assert.equal(acknowledged.reportId,2);assert.equal(f.bridge.command(command.id).state,'applied');
  assert.equal(acknowledged.commands.length,0);
 }finally{await f.close();}
});
test('repeated BLE-busy samples do not replay a completed scene or fill the recovery queue',()=>{
 const db=new DatabaseSync(':memory:'),b=createCurtainBridge({db});try{
  b.sync({bootId:'same',status:{curtain:{connected:true}}});
  const c=b.enqueue('effect',{id:3});b.sync({acks:[{id:c.id,state:'applied'}],status:{curtain:{connected:true}}});
  for(let i=0;i<100;i++){
   b.sync({bootId:'same',status:{curtain:{connected:false,busy:true}}});
   assert.equal(b.status().curtain.connected,true);
   assert.equal(b.sync({bootId:'same',status:{curtain:{connected:true}}}).commands.length,0);
  }
  assert.equal(b.revision(),c.id);
 }finally{b.close();db.close();}
});
test('an actual BLE reconnect recovers desired state once',()=>{
 const db=new DatabaseSync(':memory:'),b=createCurtainBridge({db});try{
  b.sync({bootId:'same',status:{curtain:{connected:true}}});
  const c=b.enqueue('effect',{id:3});b.sync({acks:[{id:c.id,state:'applied'}]});
  b.sync({status:{curtain:{connected:false}}});
  const recovered=b.sync({status:{curtain:{connected:true}}});assert.equal(recovered.commands.length,1);
  assert.equal(b.sync({status:{curtain:{connected:true}}}).commands[0].id,recovered.commands[0].id);
 }finally{b.close();db.close();}
});
test('local hold cannot hide a manual command behind eight scheduled commands',()=>{
 const db=new DatabaseSync(':memory:'),b=createCurtainBridge({db});try{
  for(let i=0;i<8;i++)b.enqueue('status',{},null,'schedule');
  const manual=b.enqueue('brightness',{value:75});
  assert.deepEqual(b.sync({localOverrideUntil:Date.now()+60000}).commands.map(c=>c.id),[manual.id]);
 }finally{b.close();db.close();}
});
test('unauthenticated sockets cannot open the command channel',async()=>{
 const f=await fixture();try{
  const bad=new WebSocket(f.url);bad.on('error',()=>{});
  const status=await new Promise(resolve=>bad.once('unexpected-response',(req,res)=>{resolve(res.statusCode);res.resume();bad.terminate();}));
  assert.equal(status,401);
 }finally{await f.close();}
});

test('downloaded animation does not block the next power-off command',async()=>{
 const f=await fixture();try{
  const pushed=next(f.ws),first=f.bridge.enqueue('effect',{id:1});await pushed;
  const pending=next(f.ws),off=f.bridge.enqueue('power',{on:false});await pending;
  const response=next(f.ws);
  f.ws.send(JSON.stringify({...f.report,reportId:2,acks:[{id:first.id,state:'downloaded',result:{}}]}));
  assert.equal((await response).commands[0].id,off.id);
 }finally{await f.close();}
});
