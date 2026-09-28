import { connect as tlsConnect } from "node:tls";
import { promises as dns } from "node:dns";
import { connect as netConnect } from "node:net";
import { sha256 } from "./crypto.js";
import { dpCommand } from "./wire.js";

export interface MqttCredentials {
  endpoint_addr:string;
  endpoint_port?:number;
  certificate_pem:string;
  private_key:string;
  aws_root_ca1_pem:string;
  user_id?:string;
  app_name?:string;
  thing_name?:string;
}
export interface MqttTarget { name:string; model:string; serial:string; account:string; }
export interface CommandFrame { opcode:number; fields:Uint8Array; label:string; }
export interface MqttSendResult {
  published:number;
  report?:Record<string,unknown>;
  instance?:string;
  brokerAccepted:boolean;
  deviceReported:boolean;
}
// Keep the last healthy broker route warm in memory so interactive commands avoid slow fallback addresses.
const preferredConnectHost=new Map<string,string>();
const dnsCache=new Map<string,{until:number;ips:string[]}>();

export function mqttCompletionStatus(expectedIds:number[],ackedIds:number[],requireReport:boolean,report?:Record<string,unknown>){
  const acked=new Set(ackedIds),missing=expectedIds.filter(id=>!acked.has(id));
  return {brokerAccepted:missing.length===0,deviceReported:!!report,missing,complete:missing.length===0&&(!requireReport||!!report)};
}
async function withTimeout<T>(promise:Promise<T>,timeoutMs:number,label:string,onTimeout?:()=>void):Promise<T>{
  let timer:any;
  try{
    return await Promise.race([
      promise,
      new Promise<T>((_,reject)=>{timer=setTimeout(()=>{try{onTimeout?.();}catch{}reject(new Error(label+" timeout"));},timeoutMs);})
    ]);
  }finally{if(timer)clearTimeout(timer);}
}

function utf(value:string):Buffer{const b=Buffer.from(value,"utf8");const h=Buffer.alloc(2);h.writeUInt16BE(b.length,0);return Buffer.concat([h,b]);}
function packet(header:number,body:Uint8Array):Buffer{const bytes:number[]=[];let n=body.length;do{let x=n%128;n=Math.floor(n/128);if(n>0)x|=128;bytes.push(x);}while(n>0);return Buffer.concat([Buffer.from([header,...bytes]),Buffer.from(body)]);}
function connectPacket(clientId:string):Buffer{return packet(0x10,Buffer.concat([utf("MQTT"),Buffer.from([4,2,0,60]),utf(clientId)]));}
function subscribePacket(topics:string[]):Buffer{const parts:any[]=[Buffer.from([0,1])];for(const t of topics)parts.push(utf(t),Buffer.from([1]));return packet(0x82,Buffer.concat(parts));}
function publishPacket(topic:string,packetId:number,payload:Uint8Array):Buffer{const id=Buffer.alloc(2);id.writeUInt16BE(packetId,0);return packet(0x32,Buffer.concat([utf(topic),id,Buffer.from(payload)]));}
function pubAck(packetId:number):Buffer{return Buffer.from([0x40,0x02,(packetId>>>8)&255,packetId&255]);}

interface ParsedPacket{header:number;data:Buffer;type:number;qos:number;}
class Reader{
  private buf=Buffer.alloc(0);private queue:ParsedPacket[]=[];private waits:Array<{resolve:(p:ParsedPacket)=>void;reject:(e:any)=>void;timer:any}>=[];private failed:any=null;
  push(data:Buffer){if(this.failed)return;this.buf=Buffer.concat([this.buf,data]);this.parse();}
  fail(err:any){if(this.failed)return;this.failed=err instanceof Error?err:new Error(String(err||"MQTT socket closed"));for(const w of this.waits){clearTimeout(w.timer);w.reject(this.failed);}this.waits=[];}
  private parse(){
    while(this.buf.length>=2){
      const header=this.buf[0];let mul=1,len=0,pos=1,done=false;
      for(let i=0;i<4;i++){if(pos>=this.buf.length)return;const x=this.buf[pos++];len+=(x&127)*mul;if((x&128)===0){done=true;break;}mul*=128;}
      if(!done||this.buf.length<pos+len)return;
      const data=this.buf.subarray(pos,pos+len);this.buf=this.buf.subarray(pos+len);
      const p={header,data,type:header>>>4,qos:(header>>>1)&3};const w=this.waits.shift();if(w){clearTimeout(w.timer);w.resolve(p);}else this.queue.push(p);
    }
  }
  next(timeoutMs=12000,label="MQTT read"):Promise<ParsedPacket>{
    const q=this.queue.shift();if(q)return Promise.resolve(q);
    if(this.failed)return Promise.reject(this.failed);
    return new Promise((resolve,reject)=>{
      const entry:any={resolve,reject,timer:null};
      entry.timer=setTimeout(()=>{const i=this.waits.indexOf(entry);if(i>=0)this.waits.splice(i,1);reject(new Error(label+" timeout"));},timeoutMs);
      this.waits.push(entry);
    });
  }
}
function topics(t:MqttTarget){const b=`eufy_life/${t.model}/${t.serial}`;return [`cmd/${b}/app/res`,`cmd/${b}/res`,`synq/${b}/state_info`,`cmd/${b}/app/ota/res`];}

function decodeDeviceFrame(payload:Buffer,target:MqttTarget):Record<string,unknown>|null{
  try{
    const env=JSON.parse(payload.toString("utf8")),outer=typeof env.payload==="string"?JSON.parse(env.payload):env.payload;if(!outer)return null;
    const sn=outer.sn||outer.device_sn||target.serial;if(sn!==target.serial)return null;
    const nested=Buffer.from(outer.data,"base64").toString("utf8"),frame=Buffer.from(JSON.parse(nested).data,"hex");
    if(frame.length<10||frame[0]!==0xff||frame[1]!==9)return null;let x=0;for(const v of frame)x^=v;if(x!==0)return null;
    const cmd=(frame[7]<<8)|frame[8];if(cmd!==0x0a00&&cmd!==0x0204)return null;const result:any={cmd};const start=(cmd>>>8)===10?10:9;
    for(let i=start;i+1<frame.length-1;){const tag=frame[i],len=frame[i+1];i+=2;if(i+len>frame.length-1)break;if((tag===0xa1||tag===0xa2)&&len>0&&len<=4){let v=0;for(let k=0;k<len;k++)v|=frame[i+k]<<(8*k);if(tag===0xa1)result.power=v!==0;else result.brightness=v;}i+=len;}
    return result;
  }catch{return null;}
}
function handlePublish(socket:any,p:ParsedPacket,target:MqttTarget):Record<string,unknown>|null{
  let off=0;if(p.data.length<2)return null;const n=p.data.readUInt16BE(off);off+=2;if(off+n>p.data.length)return null;const topic=p.data.subarray(off,off+n).toString("utf8");off+=n;
  if(p.qos===1){if(off+2>p.data.length)return null;const id=p.data.readUInt16BE(off);off+=2;socket.write(pubAck(id));}
  const parts=topic.split("/");if(parts.length<5||parts[1]!=="eufy_life"||parts[2]!==target.model||parts[3]!==target.serial)return null;
  return decodeDeviceFrame(p.data.subarray(off),target);
}

async function sendMqttOnInstance(creds:MqttCredentials,target:MqttTarget,frames:CommandFrame[],installId:string,waitMs:number,connectHost:string):Promise<MqttSendResult&{instance:string}>{
  const brokerHost=creds.endpoint_addr,port=creds.endpoint_port||8883;
  const brokerUser=creds.user_id===undefined||creds.user_id===null?"u":String(creds.user_id);
  const appName=(creds.app_name&&String(creds.app_name).trim())||"eufy_life";
  const mqttUuid=sha256(installId).slice(0,16);
  const clientId=`android-${appName}-${brokerUser}-${mqttUuid}-${target.serial.slice(-6)}-${Date.now()%1000000}-${Math.floor(Math.random()*65536).toString(16)}`;
  const isIp=/^\d{1,3}(?:\.\d{1,3}){3}$/.test(connectHost);
  let raw:any=null,socket:any=null;
  try{
    if(isIp){
      raw=netConnect({host:connectHost,port});
      await withTimeout(new Promise<void>((resolve,reject)=>{raw.once("connect",resolve);raw.once("error",reject);}),5000,"MQTT TCP connect",()=>raw?.destroy());
      socket=tlsConnect({socket:raw,servername:brokerHost,key:creds.private_key,cert:creds.certificate_pem,ca:creds.aws_root_ca1_pem,rejectUnauthorized:true});
    }else{
      socket=tlsConnect({host:connectHost,port,servername:brokerHost,key:creds.private_key,cert:creds.certificate_pem,ca:creds.aws_root_ca1_pem,rejectUnauthorized:true});
    }
    const reader=new Reader();
    try{socket.setNoDelay?.(true);}catch{}
    try{socket.setTimeout?.(10000,()=>{reader.fail(new Error("MQTT socket idle timeout"));try{socket.destroy();}catch{}});}catch{}
    socket.on("data",(d:any)=>reader.push(Buffer.from(d)));
    socket.on("error",(e:any)=>reader.fail(new Error("MQTT socket error: "+(e?.message||String(e)))));
    socket.on("end",()=>reader.fail(new Error("MQTT broker ended connection")));
    socket.on("close",()=>reader.fail(new Error("MQTT broker closed connection")));
    await withTimeout(new Promise<void>((resolve,reject)=>{socket.once("secureConnect",resolve);socket.once("error",reject);}),6000,"MQTT TLS handshake",()=>socket?.destroy());

    await withTimeout(new Promise<void>((resolve,reject)=>{
      socket.write(connectPacket(clientId),(err:any)=>err?reject(err):resolve());
    }),3000,"MQTT CONNECT write",()=>socket?.destroy());

    let p=await reader.next(8000,"MQTT CONNACK");
    if(p.type!==2||p.data.length!==2)throw new Error("Invalid MQTT CONNACK");
    const rc=p.data[1];if(rc!==0)throw new Error(`MQTT CONNACK refused with code ${rc}${rc===2?" (client identifier rejected)":""}`);
    socket.write(subscribePacket(topics(target)));let sub=false;const subDeadline=Date.now()+8000;
    while(Date.now()<subDeadline&&!sub){
      p=await reader.next(Math.min(7000,Math.max(50,subDeadline-Date.now())),"MQTT SUBACK");
      if(p.type===9){
        if(p.data.length!==6||p.data[0]!==0||p.data[1]!==1)throw new Error("Malformed MQTT SUBACK");
        let granted=0;for(let i=0;i<4;i++){const q=p.data[i+2];if(q!==128&&q<=2)granted++;}
        if(granted===0)throw new Error("All MQTT subscriptions denied");
        if(p.data[2]===128)throw new Error(target.name+" state topic denied on broker instance");
        sub=true;break;
      }
      if(p.type===3)handlePublish(socket,p,target);
    }
    if(!sub)throw new Error("No MQTT SUBACK received");

    let packetId=2;
    const publishedIds:number[]=[];
    for(let i=0;i<frames.length;i++){
      const ts=Math.floor(Date.now()/1000),f=frames[i],dp=dpCommand(f.opcode,target.account,f.fields,ts);
      const inner={account_id:target.account,device_sn:target.serial,data:Buffer.from(dp).toString("base64"),trans:""};
      const head={version:"1.0.0.1",client_id:clientId,sess_id:"0000",msg_seq:i+1,seed:"",timestamp:ts,cmd_status:1,cmd:17,sign_code:0};
      const payload=Buffer.from(JSON.stringify({head,payload:JSON.stringify(inner)}),"utf8");
      publishedIds.push(packetId);
      socket.write(publishPacket(`cmd/eufy_life/${target.model}/${target.serial}/req`,packetId++,payload));
      if(i+1<frames.length)await new Promise(r=>setTimeout(r,120));
    }

    const requireReport=frames.some(f=>f.opcode===0x0200);
    const expected=new Set(publishedIds),acked=new Set<number>();
    const deadline=Date.now()+waitMs;let report:Record<string,unknown>|undefined;
    while(Date.now()<deadline){
      try{p=await reader.next(Math.min(500,Math.max(50,deadline-Date.now())),"MQTT response");}
      catch(e:any){if(String(e?.message||e).includes("timeout"))continue;throw e;}
      if(p.type===4&&p.data.length>=2){
        acked.add(p.data.readUInt16BE(0));
      }else if(p.type===3){
        const r=handlePublish(socket,p,target);
        if(r)report=r;
      }
      const state=mqttCompletionStatus([...expected],[...acked],requireReport,report);
      if(state.complete)break;
    }
    const state=mqttCompletionStatus([...expected],[...acked],requireReport,report);
    if(!state.brokerAccepted)throw new Error("MQTT PUBACK timeout; missing packet ids "+state.missing.join(","));
    if(requireReport&&!state.deviceReported)throw new Error("MQTT device report timeout");
    return {published:frames.length,report,instance:connectHost,brokerAccepted:true,deviceReported:!!report};
  }finally{
    try{socket?.end();}catch{}
    try{socket?.destroy();}catch{}
    try{raw?.destroy();}catch{}
  }
}

export async function sendMqtt(creds:MqttCredentials,target:MqttTarget,frames:CommandFrame[],installId:string,waitMs=2500):Promise<MqttSendResult>{
  const host=creds.endpoint_addr;
  if(!host||!creds.certificate_pem||!creds.private_key||!creds.aws_root_ca1_pem)throw new Error("Incomplete Eufy MQTT credentials");
  let ips:string[]=[];
  const cached=dnsCache.get(host);
  if(cached&&Date.now()<cached.until)ips=cached.ips;
  else{
    try{ips=await withTimeout(dns.resolve4(host),4000,"MQTT DNS lookup");}catch{}
    dnsCache.set(host,{until:Date.now()+10*60*1000,ips});
  }
  const directIps=ips.map((x:any)=>String(x).replace(/\.$/,"")).filter((x:string)=>/^\d{1,3}(?:\.\d{1,3}){3}$/.test(x));
  const preferred=preferredConnectHost.get(host);
  const candidates=[...new Set([preferred,host,...directIps].filter(Boolean) as string[])];
  const failures:string[]=[];
  for(const candidate of candidates){
    try{
      const result=await sendMqttOnInstance(creds,target,frames,installId,waitMs,candidate);
      preferredConnectHost.set(host,candidate);
      return result;
    }
    catch(e:any){
      if(preferredConnectHost.get(host)===candidate)preferredConnectHost.delete(host);
      failures.push(`${candidate}: ${e?.message||String(e)}`);
    }
  }
  throw new Error("MQTT broker discovery failed: "+failures.join(" | "));
}
