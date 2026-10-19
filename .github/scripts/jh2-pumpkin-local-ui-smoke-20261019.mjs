import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

// Execute the exact served tab scripts, including their real button handlers.
// The canvas and GIF decoder are deterministic adapters; live mode uses the
// existing authenticated Oracle API and requires real Nano BLE acknowledgments.
const live=process.argv.includes('--live'), calls=[];
const base='http://127.0.0.1:8081';
let cookie='',command=0;
const commandStates=new Map();
async function request(path,body){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',
  headers:{'content-type':'application/json',...(cookie?{cookie}:{})},
  body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const data=await response.json();
 assert.ok(response.ok&&data.ok!==false,data.error||`HTTP ${response.status}`);
 return {data,response};
}
if(live){
 assert.ok(process.env.JH2_UPSTREAM_TOKEN,'Existing web upstream credential missing');
 const {response}=await request('/api/session',{token:process.env.JH2_UPSTREAM_TOKEN});
 cookie=response.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
 let ready=false,last;
 for(let attempt=0;attempt<60;attempt++){
  const {data}=await request('/api/curtain/status');last=data;
  if(data.online&&data.curtain?.connected&&data.curtain.nanoLocalCacheSupported&&Number(data.queued||0)===0){ready=true;break}
  if(attempt%10===0)console.log('WAITING_FOR_EXISTING_NANO_COMMANDS',JSON.stringify({
   queued:data.queued,online:data.online,connected:data.curtain?.connected,
   lastCommandId:data.lastCommand?.id,lastCommandState:data.lastCommand?.state}));
  await new Promise(resolve=>setTimeout(resolve,2000));
 }
 assert.ok(ready,'Nano did not become ready and idle: '+JSON.stringify({queued:last?.queued,
  online:last?.online,ble:last?.curtain?.connected}));
}
async function api(path,body){
 calls.push({path,body});
 if(live){
  const {data}=await request(path,body);
  if(path==='/api/curtain/call')console.log('TAB_COMMAND_QUEUED',data.commandId);
  if(path.startsWith('/api/curtain/command?')&&data.command){
   const c=data.command;
   if(commandStates.get(c.id)!==c.state){
    commandStates.set(c.id,c.state);
    console.log('TAB_COMMAND_STATE',JSON.stringify({id:c.id,state:c.state,bleTransmitted:c.result?.bleTransmitted,message:c.result?.message}));
   }
  }
  return data;
 }
 if(path==='/api/curtain/status')return {online:true,firmware:'1.1.54',curtain:{connected:true,nanoLocalCacheSupported:true,nanoLocalCacheAvailableBytes:256000}};
 if(path==='/api/curtain/assets')return {sha256:'a'.repeat(64),bytes:body.deltaPixels?48:2000};
 if(path==='/api/curtain/call')return {commandId:++command};
 if(path.startsWith('/api/curtain/command?'))return {command:{state:'applied',result:{bleTransmitted:true}}};
 throw Error('Unexpected UI API request '+path);
}
async function source(name){
 if(!live)return fs.readFileSync(new URL('../../JasonHome2Server/'+name,import.meta.url),'utf8');
 const response=await fetch(base+'/'+name,{headers:{cookie},signal:AbortSignal.timeout(15000)});
 assert.equal(response.status,200,name+' is not served');
 assert.match(response.headers.get('content-security-policy')||'',/frame-ancestors 'self'/,
  name+' cannot open in the Curtain tab');
 return response.text();
}
function mount(html,gifFrames=[]){
 const nodes=new Map(),events=new Map();
 function canvas(){
  let data=new Uint8ClampedArray(6400);
  return {width:40,height:40,getContext:()=>({
   createImageData:()=>({data:new Uint8ClampedArray(6400)}),
   putImageData:image=>{data=new Uint8ClampedArray(image.data)},
   clearRect:()=>{data.fill(0)},drawImage:image=>{data.set(image.data)},
   getImageData:()=>({data:new Uint8ClampedArray(data)})
  }),pixels:()=>data};
 }
 for(const match of html.matchAll(/id="([^"]+)"/g))nodes.set(match[1],{
  ...canvas(),disabled:/disabled/.test(html.slice(match.index,html.indexOf('>',match.index))),
  checked:['original','loop'].includes(match[1]),value:match[1]==='delay'?'120':'',
  textContent:'',listeners:{},addEventListener(type,handler){this.listeners[type]=handler;}
 });
 const parent={JH2CurtainApi:api,postMessage(){}},window={parent,addEventListener:(type,handler)=>events.set(type,handler)};
 class Decoder{
  static async isTypeSupported(type){return type==='image/gif'}
  constructor(){this.tracks={ready:Promise.resolve(),selectedTrack:{frameCount:gifFrames.length}}}
  async decode({frameIndex}){const f=gifFrames[frameIndex];return {image:{displayWidth:40,displayHeight:40,data:f.pixels,duration:f.delay*1000,close(){}}}}
  close(){}
 }
 const document={getElementById:id=>nodes.get(id),documentElement:{scrollHeight:900},body:{},createElement:()=>canvas()};
 const context={window,parent,document,location:{origin:base},ImageDecoder:Decoder,
  ResizeObserver:class{observe(){}},Uint8Array,Uint8ClampedArray,
  crypto:webcrypto,btoa:s=>Buffer.from(s,'binary').toString('base64'),
  setTimeout:(fn,ms)=>setTimeout(fn,live?ms:0),console};
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
 assert.equal(scripts.length,1);vm.runInNewContext(scripts[0][1],context);
 return {node:id=>nodes.get(id),events};
}
const native=mount(await source('curtain_native_test.html'));
assert.equal(native.node('send1').disabled,false);
assert.equal(native.node('send2').disabled,true);
assert.equal(native.node('send3').disabled,true);
assert.match(native.node('count2').textContent,/25 changed pixels/);
assert.deepEqual(native.node('preview1').pixels(),native.node('preview3').pixels());
for(let frame=1;frame<=3;frame++){
 assert.equal(native.node('send'+frame).disabled,false);
 await native.node('send'+frame).onclick();
 assert.match(native.node('status').textContent,new RegExp('Frame '+frame+' sent:'));
}
const assets=calls.filter(c=>c.path==='/api/curtain/assets');
assert.equal(assets.length,3);assert.equal(assets[0].body.frames.length,1);
for(const c of assets.slice(1)){
 assert.equal(c.body.deltaPixels.length,25);assert.equal(c.body.frames,undefined);
 assert.ok(c.body.deltaPixels.every(p=>p.x>=24&&p.x<=28&&p.y>=17&&p.y<=21));
}
console.log('NATIVE_TEST_THREE_BUTTONS_AND_25_PIXEL_DELTAS_OK'+(live?'_REAL_BLE_ACKS':''));
const gif=[1,2,3].map((i,k)=>({pixels:native.node('preview'+i).pixels(),delay:[120,320,160][k]}));
const local=mount(await source('curtain_local_test.html'),gif);
assert.equal(local.node('send').disabled,true);
await local.node('localFile').listeners.change({target:{files:[{
 name:'pumpkin.GIF',type:'',size:100,arrayBuffer:async()=>new ArrayBuffer(100)
}]}});
assert.match(local.node('loadStatus').textContent,/Loaded 3 GIF frames/);
assert.equal(local.node('send').disabled,false);local.node('loop').checked=false;
await local.node('send').onclick();
assert.match(local.node('result').textContent,/Nano cached \d+ bytes locally and started playback/);
const gifAsset=calls.filter(c=>c.path==='/api/curtain/assets').at(-1).body;
assert.equal(gifAsset.frames.length,3);assert.deepEqual([...gifAsset.delays],[120,320,160]);
assert.equal(gifAsset.loop,false);
await local.node('refresh').onclick();
assert.match(local.node('result').textContent,/Nano local cache ready/);
assert.ok(calls.filter(c=>c.path==='/api/curtain/call').every(c=>c.body.action==='asset'));
console.log('LOCAL_TEST_GIF_LOAD_TIMING_SEND_AND_STATUS_OK'+(live?'_REAL_BLE_ACK':''));
if(live){
 await new Promise(resolve=>setTimeout(resolve,3000));
 const {data}=await request('/api/curtain/status');
 assert.ok(data.online&&data.curtain?.connected,'Bridge did not remain healthy');
 assert.equal(Number(data.queued||0),0,'Test command remains queued');
 assert.equal(data.assetRetention?.retainedBytes,0,'Oracle did not release Nano-cached animation bytes');
 console.log('LIVE_TABS_VERIFIED_NANO_ONLINE_BLE_CONNECTED_ORACLE_BYTES_ZERO');
}
