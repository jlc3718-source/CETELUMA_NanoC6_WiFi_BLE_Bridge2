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
  transport?:"persistent"|"individual"|"individual-fallback";
}
// Keep the last healthy broker route warm in memory so interactive commands avoid slow fallback addresses.
const preferredConnectHost=new Map<string,string>();
const dnsCache=new Map<string,{until:number;ips:string[]}>();

export function captureFrame(data:string):Buffer{
  const bytes=Buffer.from(data,"base64");
  return bytes[0]===255&&bytes[1]===9?bytes:Buffer.from(JSON.parse(bytes.toString()).data,"hex");
}
let commandCapture:any={active:false,samples:[]};
let stopCaptureSocket:(()=>void)|null=null;
export function commandCaptureStatus(){return {...commandCapture,samples:[...commandCapture.samples]};}
export function stopCommandCapture(){stopCaptureSocket?.();stopCaptureSocket=null;commandCapture.active=false;return commandCaptureStatus();}
export async function startCommandCapture(creds:MqttCredentials,target:MqttTarget,durationMs=1800000){
  stopCommandCapture();
  const started=Date.now(),ends=started+durationMs;
  commandCapture={active:false,startedAt:new Date(started).toISOString(),endsAt:new Date(ends).toISOString(),target:target.name,model:target.model,samples:[],requestTopicsGranted:false};
  const state=commandCapture,reader=new Reader();
  const socket=tlsConnect({host:creds.endpoint_addr,port:creds.endpoint_port||8883,servername:creds.endpoint_addr,key:creds.private_key,cert:creds.certificate_pem,ca:creds.aws_root_ca1_pem,rejectUnauthorized:true});
  socket.on("data",(data:any)=>reader.push(Buffer.from(data)));
  socket.on("error",()=>reader.fail(new Error("Capture socket error")));
  socket.on("close",()=>reader.fail(new Error("Capture socket closed")));
  stopCaptureSocket=()=>{state.active=false;socket.destroy();};
  try{
    await withTimeout(new Promise<void>((resolve,reject)=>{socket.once("secureConnect",resolve);socket.once("error",reject);}),8000,"Capture TLS",()=>socket.destroy());
    const captureName=target.name.toLowerCase().replace(/[^a-z0-9]+/g,"-");
    socket.write(connectPacket(`android-eufy_life-${creds.user_id||"u"}-${captureName}-capture-${Math.random().toString(16).slice(2)}`));
    const ack=await reader.next(8000,"Capture CONNACK");
    if(ack.type!==2||ack.data[1]!==0)throw new Error("Capture broker refused connection");
    const base=`cmd/eufy_life/${target.model}/${target.serial}`;
    const requested=[base+"/req",base+"/app/req",...topics(target)];
    socket.write(subscribePacket(requested));
    let sub=await reader.next(8000,"Capture SUBACK");
    while(sub.type===3){
      if(sub.qos===1){const size=sub.data.readUInt16BE(0);socket.write(pubAck(sub.data.readUInt16BE(2+size)));}
      sub=await reader.next(8000,"Capture SUBACK");
    }
    if(sub.type!==9||sub.data.length!==requested.length+2)throw new Error("Capture subscription reply invalid");
    state.subscriptions=requested.map((topic,i)=>({topic:topic.replace(target.serial,target.name),granted:sub.data[i+2]!==128}));
    state.requestTopicsGranted=sub.data[2]!==128||sub.data[3]!==128;
    if(!state.subscriptions.some((s:any)=>s.granted))throw new Error("Capture topics denied by broker");
    state.active=true;
    void (async()=>{
      let pingAt=Date.now();
      try{
        while(state.active&&Date.now()<ends){
          if(Date.now()-pingAt>15000){socket.write(packet(0xc0,Buffer.alloc(0)));pingAt=Date.now();}
          let p:ParsedPacket;try{p=await reader.next(1000,"Capture poll");}catch(e:any){if(e.message==="Capture poll timeout")continue;throw e;}
          if(p.type!==3)continue;
          let off=2;const length=p.data.readUInt16BE(0),topic=p.data.subarray(off,off+length).toString();off+=length;
          if(p.qos===1){socket.write(pubAck(p.data.readUInt16BE(off)));off+=2;}
          try{
            const envelope=JSON.parse(p.data.subarray(off).toString()),outer=typeof envelope.payload==="string"?JSON.parse(envelope.payload):envelope.payload;
            if(!outer||((outer.sn||outer.device_sn||target.serial)!==target.serial))continue;
            const frame=captureFrame(outer.data);
            if(frame.length<10||frame[0]!==255||frame[1]!==9)continue;
            let checksum=0;for(const byte of frame)checksum^=byte;if(checksum!==0)continue;
            const opcode=frame.readUInt16BE(7),fields:Record<string,string>={};
            for(let i=opcode===0x0a00?10:9;i+1<frame.length-1;){const tag=frame[i++],size=frame[i++];if(i+size>frame.length-1)break;if(tag>=0xa3)fields[tag.toString(16)]=frame.subarray(i,i+size).toString("hex");i+=size;}
            state.samples.push({at:new Date().toISOString(),direction:topic.endsWith("/req")?"command":"report",opcode,fields});
            if(state.samples.length>600)state.samples.shift();
          }catch{}
        }
      }catch(e:any){state.error=e.message;}
      finally{state.active=false;socket.destroy();}
    })();
    return commandCaptureStatus();
  }catch(e){socket.destroy();state.active=false;throw e;}
}

export function effectReportMatches(report:Record<string,unknown>|undefined,effectId:number):boolean|null{
  if(!report)return null;
  const ids=[report.effectId,report.cloudEffectId].filter((v):v is number=>typeof v==="number"&&Number.isFinite(v));
  return ids.length?ids.includes(effectId):null;
}
export function mqttCompletionStatus(expectedIds:number[],ackedIds:number[],requireReport:boolean,report?:Record<string,unknown>){
  const acked=new Set(ackedIds),missing=expectedIds.filter(id=>!acked.has(id));
  return {brokerAccepted:missing.length===0,deviceReported:!!report,missing,complete:missing.length===0&&(!requireReport||report?.cmd===0x0a00)};
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
      if(timeoutMs>0)entry.timer=setTimeout(()=>{const i=this.waits.indexOf(entry);if(i>=0)this.waits.splice(i,1);reject(new Error(label+" timeout"));},timeoutMs);
      this.waits.push(entry);
    });
  }
}
function topics(t:MqttTarget){const b=`eufy_life/${t.model}/${t.serial}`;return [`cmd/${b}/app/res`,`cmd/${b}/res`,`synq/${b}/state_info`,`cmd/${b}/app/ota/res`];}

export function decodeDeviceFrame(payload:Buffer,target:MqttTarget):Record<string,unknown>|null{
  try{
    const env=JSON.parse(payload.toString("utf8")),outer=typeof env.payload==="string"?JSON.parse(env.payload):env.payload;if(!outer)return null;
    const sn=outer.sn||outer.device_sn||target.serial;if(sn!==target.serial)return null;
    const nested=Buffer.from(outer.data,"base64").toString("utf8"),frame=Buffer.from(JSON.parse(nested).data,"hex");
    if(frame.length<10||frame[0]!==0xff||frame[1]!==9)return null;let x=0;for(const v of frame)x^=v;if(x!==0)return null;
    const cmd=(frame[7]<<8)|frame[8];if(cmd!==0x0a00&&cmd!==0x0204)return null;const result:any={cmd,rawFields:{}};const start=(cmd>>>8)===10?10:9;
    for(let i=start;i+1<frame.length-1;){
      const tag=frame[i],len=frame[i+1];i+=2;if(i+len>frame.length-1)break;
      if(tag>=0xa3)result.rawFields[tag.toString(16)]=frame.subarray(i,i+len).toString("hex");
      if(len>0&&len<=4){
        let v=0;for(let k=0;k<len;k++)v+=frame[i+k]*2**(8*k);
        if(tag===0xa1)result.power=v===1;
        else if(tag===0xa2)result.brightness=v;
        else if(tag===0xa3)result.lampCount=v;
        else if(tag===0xa4)result.effectId=v;
        else if(tag===0xa5)result.colorGradient=v===1;
        else if(tag===0xa6)result.cloudEffectId=v;
        else if(tag===(cmd===0x0a00?0xa8:0xa7))result.effectMode=v;
      }
      i+=len;
    }
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

async function sendMqttIndividual(creds:MqttCredentials,target:MqttTarget,frames:CommandFrame[],installId:string,waitMs=2500):Promise<MqttSendResult>{
  const host=creds.endpoint_addr;
  if(!host||!creds.certificate_pem||!creds.private_key||!creds.aws_root_ca1_pem)throw new Error("Incomplete Eufy MQTT credentials");
  const candidates=await brokerCandidates(host);
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


export type MqttConnectionMode="persistent"|"individual";
export function mqttConnectionMode():MqttConnectionMode{
  return String(process.env.JASON_HOME_MQTT_CONNECTION_MODE||"persistent").trim().toLowerCase()==="individual"?"individual":"persistent";
}

async function brokerCandidates(host:string):Promise<string[]>{
  let ips:string[]=[];
  const cached=dnsCache.get(host);
  if(cached&&Date.now()<cached.until)ips=cached.ips;
  else{
    try{ips=await withTimeout(dns.resolve4(host),4000,"MQTT DNS lookup");}catch{}
    dnsCache.set(host,{until:Date.now()+10*60*1000,ips});
  }
  const directIps=ips.map((x:any)=>String(x).replace(/\.$/,"")).filter((x:string)=>/^\d{1,3}(?:\.\d{1,3}){3}$/.test(x));
  const preferred=preferredConnectHost.get(host);
  return [...new Set([preferred,host,...directIps].filter(Boolean) as string[])];
}

interface PersistentActiveSend{
  expected:Set<number>;
  acked:Set<number>;
  requireReport:boolean;
  report?:Record<string,unknown>;
  resolve:(r:MqttSendResult)=>void;
  reject:(e:any)=>void;
  timer:any;
}

class PersistentMqttSession{
  private active:PersistentActiveSend|null=null;
  private packetId=2;
  private msgSeq=1;
  private keepalive:any=null;
  private failure:Error|null=null;
  private lastPacketAt=Date.now();

  constructor(
    private creds:MqttCredentials,
    readonly target:MqttTarget,
    private installId:string,
    readonly connectHost:string,
    private clientId:string,
    private socket:any,
    private raw:any,
    private reader:Reader
  ){
    try{this.socket.setNoDelay?.(true);}catch{}
    try{this.socket.setKeepAlive?.(true,15000);}catch{}
    this.keepalive=setInterval(()=>{
      if(this.failure)return;
      if(Date.now()-this.lastPacketAt>85000){
        this.fail(new Error("Persistent MQTT keepalive timeout"));
        return;
      }
      try{this.socket.write(Buffer.from([0xc0,0x00]));}
      catch(e){this.fail(e);}
    },25000);
    try{this.keepalive.unref?.();}catch{}
    void this.pump();
  }

  get closed(){return !!this.failure||!!this.socket?.destroyed;}

  close(reason="Persistent MQTT session closed"){
    this.fail(new Error(reason));
  }

  private fail(error:any){
    if(this.failure)return;
    this.failure=error instanceof Error?error:new Error(String(error||"Persistent MQTT session failed"));
    if(this.keepalive)clearInterval(this.keepalive);
    this.keepalive=null;
    const active=this.active;
    this.active=null;
    if(active){clearTimeout(active.timer);active.reject(this.failure);}
    try{this.reader.fail(this.failure);}catch{}
    try{this.socket?.end();}catch{}
    try{this.socket?.destroy();}catch{}
    try{this.raw?.destroy();}catch{}
  }

  private completeIfReady(){
    const active=this.active;if(!active)return;
    const state=mqttCompletionStatus([...active.expected],[...active.acked],active.requireReport,active.report);
    if(!state.complete)return;
    this.active=null;
    clearTimeout(active.timer);
    active.resolve({
      published:active.expected.size,
      report:active.report,
      instance:this.connectHost,
      brokerAccepted:true,
      deviceReported:!!active.report,
      transport:"persistent"
    });
  }

  private async pump(){
    try{
      while(!this.failure){
        const p=await this.reader.next(0,"Persistent MQTT read");
        this.lastPacketAt=Date.now();
        if(p.type===4&&p.data.length>=2){
          this.active?.acked.add(p.data.readUInt16BE(0));
        }else if(p.type===3){
          const report=handlePublish(this.socket,p,this.target);
          if(report&&this.active)this.active.report=report;
        }else if(p.type===14){
          this.fail(new Error("MQTT broker disconnected persistent session"));
          return;
        }
        this.completeIfReady();
      }
    }catch(e){this.fail(e);}
  }

  private nextId(){
    const id=this.packetId;
    this.packetId++;
    if(this.packetId>65535)this.packetId=2;
    return id;
  }

  async send(frames:CommandFrame[],waitMs:number):Promise<MqttSendResult>{
    if(this.failure)throw this.failure;
    if(this.active)throw new Error(this.target.name+" persistent MQTT session is busy");
    const ids=frames.map(()=>this.nextId());
    const requireReport=frames.some(f=>f.opcode===0x0200);
    const result=new Promise<MqttSendResult>((resolve,reject)=>{
      const active:PersistentActiveSend={
        expected:new Set(ids),acked:new Set<number>(),requireReport,resolve,reject,timer:null
      };
      active.timer=setTimeout(()=>{
        if(this.active!==active)return;
        this.active=null;
        const state=mqttCompletionStatus([...active.expected],[...active.acked],active.requireReport,active.report);
        if(!state.brokerAccepted)reject(new Error("Persistent MQTT PUBACK timeout; missing packet ids "+state.missing.join(",")));
        else reject(new Error("Persistent MQTT device report timeout"));
      },waitMs);
      this.active=active;
    });

    try{
      for(let i=0;i<frames.length;i++){
        const ts=Math.floor(Date.now()/1000),f=frames[i],dp=dpCommand(f.opcode,this.target.account,f.fields,ts);
        const inner={account_id:this.target.account,device_sn:this.target.serial,data:Buffer.from(dp).toString("base64"),trans:""};
        const head={version:"1.0.0.1",client_id:this.clientId,sess_id:"0000",msg_seq:this.msgSeq++,seed:"",timestamp:ts,cmd_status:1,cmd:17,sign_code:0};
        const payload=Buffer.from(JSON.stringify({head,payload:JSON.stringify(inner)}),"utf8");
        this.socket.write(publishPacket(`cmd/eufy_life/${this.target.model}/${this.target.serial}/req`,ids[i],payload));
        if(i+1<frames.length)await new Promise(r=>setTimeout(r,120));
      }
    }catch(e){
      this.fail(e);
      throw e;
    }
    return result;
  }
}

const persistentSessions=new Map<string,PersistentMqttSession>();

function persistentKey(creds:MqttCredentials,target:MqttTarget,installId:string){
  return [creds.endpoint_addr,creds.endpoint_port||8883,target.serial,sha256(creds.certificate_pem).slice(0,12),installId].join("|");
}

function removePersistentSession(session:PersistentMqttSession){
  for(const [key,value] of persistentSessions)if(value===session)persistentSessions.delete(key);
}

async function openPersistentOnInstance(creds:MqttCredentials,target:MqttTarget,installId:string,connectHost:string):Promise<PersistentMqttSession>{
  const brokerHost=creds.endpoint_addr,port=creds.endpoint_port||8883;
  const brokerUser=creds.user_id===undefined||creds.user_id===null?"u":String(creds.user_id);
  const appName=(creds.app_name&&String(creds.app_name).trim())||"eufy_life";
  const mqttUuid=sha256(installId).slice(0,16);
  const clientId=`android-${appName}-${brokerUser}-${mqttUuid}-${target.serial.slice(-6)}-persistent-${Math.floor(Math.random()*65536).toString(16)}`;
  const isIp=/^\d{1,3}(?:\.\d{1,3}){3}$/.test(connectHost);
  let raw:any=null,socket:any=null;
  try{
    if(isIp){
      raw=netConnect({host:connectHost,port});
      await withTimeout(new Promise<void>((resolve,reject)=>{raw.once("connect",resolve);raw.once("error",reject);}),5000,"Persistent MQTT TCP connect",()=>raw?.destroy());
      socket=tlsConnect({socket:raw,servername:brokerHost,key:creds.private_key,cert:creds.certificate_pem,ca:creds.aws_root_ca1_pem,rejectUnauthorized:true});
    }else{
      socket=tlsConnect({host:connectHost,port,servername:brokerHost,key:creds.private_key,cert:creds.certificate_pem,ca:creds.aws_root_ca1_pem,rejectUnauthorized:true});
    }
    const reader=new Reader();
    socket.on("data",(d:any)=>reader.push(Buffer.from(d)));
    socket.on("error",(e:any)=>reader.fail(new Error("Persistent MQTT socket error: "+(e?.message||String(e)))));
    socket.on("end",()=>reader.fail(new Error("Persistent MQTT broker ended connection")));
    socket.on("close",()=>reader.fail(new Error("Persistent MQTT broker closed connection")));
    await withTimeout(new Promise<void>((resolve,reject)=>{socket.once("secureConnect",resolve);socket.once("error",reject);}),6000,"Persistent MQTT TLS handshake",()=>socket?.destroy());

    await withTimeout(new Promise<void>((resolve,reject)=>{
      socket.write(connectPacket(clientId),(err:any)=>err?reject(err):resolve());
    }),3000,"Persistent MQTT CONNECT write",()=>socket?.destroy());

    let p=await reader.next(8000,"Persistent MQTT CONNACK");
    if(p.type!==2||p.data.length!==2)throw new Error("Invalid persistent MQTT CONNACK");
    const rc=p.data[1];if(rc!==0)throw new Error(`Persistent MQTT CONNACK refused with code ${rc}`);

    socket.write(subscribePacket(topics(target)));
    let sub=false;const subDeadline=Date.now()+8000;
    while(Date.now()<subDeadline&&!sub){
      p=await reader.next(Math.min(7000,Math.max(50,subDeadline-Date.now())),"Persistent MQTT SUBACK");
      if(p.type===9){
        if(p.data.length!==6||p.data[0]!==0||p.data[1]!==1)throw new Error("Malformed persistent MQTT SUBACK");
        let granted=0;for(let i=0;i<4;i++){const q=p.data[i+2];if(q!==128&&q<=2)granted++;}
        if(granted===0)throw new Error("All persistent MQTT subscriptions denied");
        if(p.data[2]===128)throw new Error(target.name+" state topic denied on persistent broker session");
        sub=true;
      }else if(p.type===3)handlePublish(socket,p,target);
    }
    if(!sub)throw new Error("No persistent MQTT SUBACK received");
    return new PersistentMqttSession(creds,target,installId,connectHost,clientId,socket,raw,reader);
  }catch(e){
    try{socket?.end();}catch{}
    try{socket?.destroy();}catch{}
    try{raw?.destroy();}catch{}
    throw e;
  }
}

async function getPersistentSession(creds:MqttCredentials,target:MqttTarget,installId:string):Promise<PersistentMqttSession>{
  const key=persistentKey(creds,target,installId);
  const existing=persistentSessions.get(key);
  if(existing&&!existing.closed)return existing;
  if(existing){persistentSessions.delete(key);existing.close();}

  for(const [otherKey,session] of persistentSessions){
    if(session.target.serial===target.serial&&otherKey!==key){
      persistentSessions.delete(otherKey);
      session.close("Persistent MQTT credentials changed");
    }
  }

  const failures:string[]=[];
  for(const candidate of await brokerCandidates(creds.endpoint_addr)){
    try{
      const session=await openPersistentOnInstance(creds,target,installId,candidate);
      preferredConnectHost.set(creds.endpoint_addr,candidate);
      persistentSessions.set(key,session);
      return session;
    }catch(e:any){
      if(preferredConnectHost.get(creds.endpoint_addr)===candidate)preferredConnectHost.delete(creds.endpoint_addr);
      failures.push(`${candidate}: ${e?.message||String(e)}`);
    }
  }
  throw new Error("Persistent MQTT broker discovery failed: "+failures.join(" | "));
}

export async function warmPersistentMqtt(creds:MqttCredentials,target:MqttTarget,installId:string):Promise<void>{
  if(mqttConnectionMode()!=="persistent")return;
  await getPersistentSession(creds,target,installId);
}

export function mqttConnectionStatus(){
  const live=[...persistentSessions.values()].filter(s=>!s.closed);
  return {mode:mqttConnectionMode(),persistentSessions:live.length,targets:live.map(s=>s.target.name).sort()};
}

async function sendMqttPersistent(creds:MqttCredentials,target:MqttTarget,frames:CommandFrame[],installId:string,waitMs:number):Promise<MqttSendResult>{
  let firstError:any=null;
  for(let attempt=0;attempt<2;attempt++){
    let session:PersistentMqttSession|null=null;
    try{
      session=await getPersistentSession(creds,target,installId);
      return await session.send(frames,waitMs);
    }catch(e){
      firstError??=e;
      if(session){removePersistentSession(session);session.close("Persistent MQTT command failed; reconnecting");}
    }
  }
  try{
    const fallback=await sendMqttIndividual(creds,target,frames,installId,waitMs);
    return {...fallback,transport:"individual-fallback"};
  }catch(fallbackError:any){
    throw new Error(`Persistent MQTT failed (${firstError?.message||String(firstError)}); individual fallback failed (${fallbackError?.message||String(fallbackError)})`);
  }
}

export async function sendMqtt(creds:MqttCredentials,target:MqttTarget,frames:CommandFrame[],installId:string,waitMs=2500):Promise<MqttSendResult>{
  if(mqttConnectionMode()==="individual"){
    const result=await sendMqttIndividual(creds,target,frames,installId,waitMs);
    return {...result,transport:"individual"};
  }
  return sendMqttPersistent(creds,target,frames,installId,waitMs);
}
