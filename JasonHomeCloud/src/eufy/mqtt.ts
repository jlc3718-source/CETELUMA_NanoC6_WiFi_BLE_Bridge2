import { connect as tlsConnect } from "node:tls";
import { md5, randomId } from "./crypto";
import { dpCommand } from "./wire";

export interface MqttCredentials {
  endpoint_addr:string;
  endpoint_port?:number;
  certificate_pem:string;
  private_key:string;
  aws_root_ca1_pem:string;
  user_id?:string;
  app_name?:string;
}
export interface MqttTarget { name:string; model:string; serial:string; account:string; }
export interface CommandFrame { opcode:number; fields:Uint8Array; label:string; }

function utf(value:string):Buffer{const b=Buffer.from(value,"utf8");const h=Buffer.alloc(2);h.writeUInt16BE(b.length,0);return Buffer.concat([h,b]);}
function packet(header:number,body:Uint8Array):Buffer{const bytes:number[]=[];let n=body.length;do{let x=n%128;n=Math.floor(n/128);if(n>0)x|=128;bytes.push(x);}while(n>0);return Buffer.concat([Buffer.from([header,...bytes]),Buffer.from(body)]);}
function connectPacket(clientId:string):Buffer{return packet(0x10,Buffer.concat([utf("MQTT"),Buffer.from([4,2,0,45]),utf(clientId)]));}
function subscribePacket(topics:string[]):Buffer{const parts=[Buffer.from([0,1])];for(const t of topics)parts.push(utf(t),Buffer.from([1]));return packet(0x82,Buffer.concat(parts));}
function publishPacket(topic:string,packetId:number,payload:Uint8Array):Buffer{const id=Buffer.alloc(2);id.writeUInt16BE(packetId,0);return packet(0x32,Buffer.concat([utf(topic),id,Buffer.from(payload)]));}
function pubAck(packetId:number):Buffer{return Buffer.from([0x40,0x02,(packetId>>>8)&255,packetId&255]);}

interface ParsedPacket{header:number;data:Buffer;type:number;qos:number;}
class Reader{
  private buf=Buffer.alloc(0);private queue:ParsedPacket[]=[];private waits:Array<(p:ParsedPacket)=>void>=[];
  push(data:Buffer){this.buf=Buffer.concat([this.buf,data]);this.parse();}
  private parse(){
    while(this.buf.length>=2){
      const header=this.buf[0];let mul=1,len=0,pos=1,done=false;
      for(let i=0;i<4;i++){if(pos>=this.buf.length)return;const x=this.buf[pos++];len+=(x&127)*mul;if((x&128)===0){done=true;break;}mul*=128;}
      if(!done||this.buf.length<pos+len)return;
      const data=this.buf.subarray(pos,pos+len);this.buf=this.buf.subarray(pos+len);
      const p={header,data,type:header>>>4,qos:(header>>>1)&3};const w=this.waits.shift();if(w)w(p);else this.queue.push(p);
    }
  }
  next(timeoutMs=12000):Promise<ParsedPacket>{
    const q=this.queue.shift();if(q)return Promise.resolve(q);
    return new Promise((resolve,reject)=>{let settled=false;const fn=(p:ParsedPacket)=>{if(settled)return;settled=true;clearTimeout(timer);resolve(p);};this.waits.push(fn);const timer=setTimeout(()=>{if(settled)return;settled=true;const i=this.waits.indexOf(fn);if(i>=0)this.waits.splice(i,1);reject(new Error("MQTT read timeout"));},timeoutMs);});
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

export async function sendMqtt(creds:MqttCredentials,target:MqttTarget,frames:CommandFrame[],installId:string,waitMs=2500):Promise<{published:number;report?:Record<string,unknown>}>{
  const host=creds.endpoint_addr,port=creds.endpoint_port||8883;
  if(!host||!creds.certificate_pem||!creds.private_key||!creds.aws_root_ca1_pem)throw new Error("Incomplete Eufy MQTT credentials");
  const clientId=`cf-eufy_life-${creds.user_id||"u"}-${md5(installId).slice(0,12)}-${target.serial.slice(-4)}-${randomId(3)}`;
  const socket:any=tlsConnect({host,port,servername:host,key:creds.private_key,cert:creds.certificate_pem,ca:creds.aws_root_ca1_pem,rejectUnauthorized:true});
  const reader=new Reader();socket.on("data",(d:any)=>reader.push(Buffer.from(d)));
  await new Promise<void>((resolve,reject)=>{socket.once("secureConnect",()=>resolve());socket.once("error",reject);});
  try{
    socket.write(connectPacket(clientId));
    let p=await reader.next();if(p.type!==2||p.data.length!==2)throw new Error("Invalid MQTT CONNACK");
    const rc=p.data[1];if(rc!==0)throw new Error(`MQTT CONNACK refused with code ${rc}${rc===2?" (client identifier rejected)":""}`);
    socket.write(subscribePacket(topics(target)));let sub=false;
    for(let n=0;n<10&&!sub;n++){p=await reader.next();if(p.type===9){sub=true;break;}if(p.type===3)handlePublish(socket,p,target);}
    if(!sub)throw new Error("No MQTT SUBACK received");
    let packetId=2;
    for(let i=0;i<frames.length;i++){
      const ts=Math.floor(Date.now()/1000),f=frames[i],dp=dpCommand(f.opcode,target.account,f.fields,ts);
      const inner={account_id:target.account,device_sn:target.serial,data:Buffer.from(dp).toString("base64"),trans:""};
      const head={version:"1.0.0.1",client_id:clientId,sess_id:"0000",msg_seq:i+1,seed:"",timestamp:ts,cmd_status:1,cmd:17,sign_code:0};
      const payload=Buffer.from(JSON.stringify({head,payload:JSON.stringify(inner)}),"utf8");
      socket.write(publishPacket(`cmd/eufy_life/${target.model}/${target.serial}/req`,packetId++,payload));
      if(i+1<frames.length)await new Promise(r=>setTimeout(r,160));
    }
    const deadline=Date.now()+waitMs;let report:Record<string,unknown>|undefined;
    while(Date.now()<deadline){try{p=await reader.next(Math.min(800,Math.max(50,deadline-Date.now())));}catch{continue;}if(p.type===3){const r=handlePublish(socket,p,target);if(r)report=r;}}
    return {published:frames.length,report};
  }finally{try{socket.end();}catch{}try{socket.destroy();}catch{}}
}
