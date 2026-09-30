import { aesDecryptText, aesEncryptText, encryptPassword, md5, newEcdh, randomId, sign, LOCAL_KEY_HEX } from "./crypto.js";
import type { MqttCredentials, MqttTarget, CommandFrame } from "./mqtt.js";
import { effectReportMatches, startPoolCapture, mqttConnectionMode, sendMqtt, warmPersistentMqtt } from "./mqtt.js";
import { OP_SETUP, OP_SHOW, buildEffect, brightness as brightnessFields, isSolidEffect } from "./light-commands.js";
import { buildFactoryFields, collectFactoryEffectIds, normalizeFactoryEntry, reverseFactoryPresetDirection, type EufyFactoryPreset } from "./factory-presets.js";
import { powerFields, statusFields } from "./wire.js";

export interface EufySession { region:string; bootstrap:string; token:string; uid:string; accountUid:string; }
interface LightSpec { name:string; model:string; serials:string[]; }
const REVERSED_INSTALLATIONS=new Set(["Pool","Shed"]);
const LIGHTS:LightSpec[]=[
  {name:"Pool",model:"T8L00",serials:["T8L006102353014B"]},
  {name:"House",model:"T8L00",serials:["T8L00610243503A2"]},
  {name:"Garage",model:"T8L02",serials:["T8L028102427474A"]},
  {name:"Shed",model:"T8L02",serials:["T8L0281024470193","T8L0291024470193"]}
];
export function allowedApi(host:string){return /^(?:mega|app-(?:openapi|passport|push|house|devicemanage|light))-(?:us|eu)-pr\.eufy\.com$/.test(host);}
function allowedBroker(host:string){return /^[a-zA-Z0-9.-]+$/.test(host)&&(host.endsWith(".anker.com")||host.endsWith(".eufy.com")||host.endsWith(".amazonaws.com"));}
function nowSec(){return Math.floor(Date.now()/1000);}

export class EufyClient {
  region="us-pr";bootstrap="";share="";ident="";token="";uid="";accountUid="";
  authed=false;lights=new Map<string,any>();creds:MqttCredentials|null=null;
  constructor(private installId:string,session?:EufySession){if(session)this.importSession(session);}
  importSession(s:EufySession){this.region=s.region||"us-pr";this.bootstrap=s.bootstrap||"";this.token=s.token||"";this.uid=s.uid||"";this.accountUid=s.accountUid||"";this.authed=!!(this.token&&this.uid&&this.accountUid);this.share="";this.ident="";this.lights.clear();this.creds=null;}
  exportSession():EufySession{return {region:this.region,bootstrap:this.bootstrap,token:this.token,uid:this.uid,accountUid:this.accountUid};}
  private baseHeaders():Record<string,string>{return {"app-name":"eufy_mega","app-version":"6.0.41_26142","app_version":"6.0.41_26142","os-type":"android","os_type":"android","os-version":"36","os_version":"36","phone-model":"JasonHomeOracle","phone_model":"JasonHomeOracle","model-type":"PHONE","country":"US","ab_code":"US","openudid":this.installId,"language":"en","test-flag":"false","user-agent":"ktor-client","accept":"application/json","accept-charset":"UTF-8"};}
  private authHeaders(h:Record<string,string>){if(this.token){h["x-auth-token"]=this.token;h.authorization=this.token;h.gtoken=md5(this.accountUid);}}
  private async raw(host:string,path:string,body:string,headers:Record<string,string>):Promise<any>{
    if(!allowedApi(host))throw new Error(`Unexpected Eufy API hostname: ${host}`);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(`https://${host}${path}`,{method:"POST",headers,body,redirect:"manual",signal:controller.signal});
      const text=await response.text();
      let obj:any;try{obj=JSON.parse(text);}catch{throw new Error(`Eufy ${path} HTTP ${response.status} returned non-JSON`);}obj._http=response.status;return obj;
    }catch(e:any){
      if(e?.name==="AbortError")throw new Error(`Eufy ${path} request timeout`);
      throw e;
    }finally{clearTimeout(timer);}
  }
  private signedHeaders(h:Record<string,string>,key:string,keyId:string,cipher:string){const ts=String(nowSec()),nonce=randomId();h["x-encryption-info"]="algo_ecdh";h["x-replay-info"]="replay";h["x-key-ident"]=keyId;h["x-request-ts"]=ts;h["x-request-once"]=nonce;h["x-signature"]=sign(key,ts,nonce,cipher);}
  private async exchange(){
    const ecdh=newEcdh(),encrypted=aesEncryptText(ecdh.publicHex,LOCAL_KEY_HEX);this.ident=randomId();
    const h=this.baseHeaders();this.authHeaders(h);h["content-type"]="application/json";this.signedHeaders(h,LOCAL_KEY_HEX,this.ident,encrypted);
    const host=this.bootstrap||`app-openapi-${this.region}.eufy.com`,r=await this.raw(host,"/openapi/oauth/key/exchange",JSON.stringify({client_public_key:encrypted}),h);
    if(r.code!==0)throw new Error(`Eufy key exchange failed: HTTP ${r._http}, code ${r.code}`);
    const server=aesDecryptText(r.data.server_public_key,LOCAL_KEY_HEX);this.share=Buffer.from(ecdh.secret(server)).toString("hex").slice(0,32);
  }
  private async signed(service:string,path:string,body:any,authenticated:boolean,scope?:string):Promise<any>{
    if(!this.share)await this.exchange();const cipher=aesEncryptText(JSON.stringify(body),this.share),types=path.startsWith("/passport/")?["text/plain","application/json"]:["application/json","text/plain"];
    for(let attempt=0;attempt<2;attempt++){
      const h=this.baseHeaders();h["content-type"]=types[attempt];this.signedHeaders(h,this.share,this.ident,cipher);if(authenticated)this.authHeaders(h);if(scope)h["app-name"]=scope;
      const r=await this.raw(`app-${service}-${this.region}.eufy.com`,path,cipher,h),code=Number(r.code??-1);
      if(r._http===200&&code===0){let d=r.data;if(typeof d==="string"&&d)d=JSON.parse(aesDecryptText(d,this.share));return d??{};}
      if(attempt===0&&(code===4416||code===10000||r._http===400))continue;
      if(code===401||r._http===401){this.authed=false;this.lights.clear();this.creds=null;}
      throw new Error(`Eufy ${path} failed: HTTP ${r._http}, code ${code}`);
    }
    throw new Error(`Eufy ${path} failed`);
  }
  async login(email:string,password:string){
    if(this.authed)return;
    const h=this.baseHeaders();h["content-type"]="application/json";
    const est=await this.raw("mega-us-pr.eufy.com","/passport/estimate_domain",JSON.stringify({ab:"us",mode:1}),h);
    if(est.code!==0)throw new Error(`Eufy region lookup failed: HTTP ${est._http}, code ${est.code}`);
    const blob=JSON.stringify(est.data||{});this.region=blob.includes("-eu-")?"eu-pr":"us-pr";const domain=est.data?.domain||est.data?.host||"";if(domain&&!domain.startsWith("mega-")&&allowedApi(domain))this.bootstrap=domain;
    await this.exchange();
    const enc=encryptPassword(password),body:any={email,password:enc.cipherText,ab:"US",client_secret_info:{public_key:enc.publicKey},verify_code:"",login_id:"",answer:"",captcha_id:""};
    const result=await this.signed("passport","/passport/login",body,!!this.token),fa=result?.fa_info;if(fa&&fa.info)throw new Error("Eufy email verification is required before cloud deployment");
    this.uid=result.ap_cloud_user_id||result.user_id||result.userId||"";this.accountUid=result.user_id||result.userId||this.uid;this.token=result.auth_token||result.token||"";
    if(!this.uid||!this.accountUid||!this.token)throw new Error("Eufy login returned no usable session");
    this.share="";await this.exchange();this.authed=true;
  }
  private requireLogin(){if(!this.authed)throw new Error("Eufy cloud session is not authenticated");}
  async findLights(){
    this.requireLogin();this.lights.clear();this.creds=null;const bodies:any[]=[{}];
    try{const houses=await this.signed("house","/app/house/get_house_list",{},true);for(const h of houses.house_infos||[])if(h.house_id)bodies.push({house_id:h.house_id});}catch{}
    const found=new Map<string,any>();
    for(const body of bodies){try{const list=await this.signed("house","/app/house/get_devs_list",body,true);for(const d of list.devices||[]){const sn=d.device_sn||"";for(const spec of LIGHTS)if(spec.serials.includes(sn))found.set(sn,d);}}catch{}}
    for(const spec of LIGHTS){let match:any=null,count=0;for(const sn of spec.serials){const d=found.get(sn);if(!d)continue;if(d.device_model!==spec.model||d.category!=="eufy_life")continue;match=d;count++;}if(count===1)this.lights.set(spec.name,match);}
    if(this.lights.size===0)throw new Error("No known Eufy light strings found");
  }
  async certificate(){
    this.requireLogin();if(!this.lights.size)await this.findLights();const c=await this.signed("devicemanage","/app/devicemanage/get_user_mqtt_info",{},true,"eufy_life") as MqttCredentials;
    for(const k of ["endpoint_addr","certificate_pem","private_key","aws_root_ca1_pem"] as const)if(!(c as any)[k])throw new Error(`Eufy MQTT certificate missing ${k}`);
    if(c.user_id===undefined||c.user_id===null)c.user_id=this.uid;
    if(!allowedBroker(c.endpoint_addr)||((c.app_name||"eufy_life")!=="eufy_life"))throw new Error("Unexpected Eufy broker/certificate scope");this.creds=c;
  }
  async prepare(){
    if(!this.authed)throw new Error("Eufy authentication required");
    await this.findLights();
    await this.certificate();
    if(mqttConnectionMode()==="persistent"){
      await Promise.allSettled([...this.lights.keys()].map(name=>warmPersistentMqtt(this.creds!,this.target(name),this.installId)));
    }
  }
  private spec(name:string){const s=LIGHTS.find(x=>x.name===name);if(!s)throw new Error(`Unknown light ${name}`);return s;}
  private target(name:string):MqttTarget{
    const s=this.spec(name),d=this.lights.get(name);if(!d||!s.serials.includes(d.device_sn)||d.device_model!==s.model||d.category!=="eufy_life")throw new Error(`${name} has no validated Eufy record`);
    return {name,model:s.model,serial:d.device_sn,account:d.member?.admin_user_id||this.uid};
  }
  async command(name:string,frames:CommandFrame[],waitMs=2500){if(!this.creds)await this.certificate();return sendMqtt(this.creds!,this.target(name),frames,this.installId,waitMs);}
  async startPoolCapture(){if(!this.creds)await this.certificate();return startPoolCapture(this.creds!,this.target("Pool"));}
  async status(name:string){return this.command(name,[{opcode:0x0200,fields:statusFields(),label:"STATUS"}],3000);}
  async power(name:string,on:boolean){return this.command(name,[{opcode:OP_SETUP,fields:powerFields(on),label:on?"ON":"OFF"}]);}
  async brightness(name:string,value:number){return this.command(name,[{opcode:OP_SETUP,fields:brightnessFields(value),label:`BRIGHTNESS ${value}%`}]);}
  async scene(name:string,effect:string,colors:number[],speed:number,brightness:number){
    const s=this.spec(name),reverse=REVERSED_INSTALLATIONS.has(name),fx=buildEffect(s.model,effect,colors,speed,reverse);
    const result=await this.command(name,[{opcode:OP_SETUP,fields:powerFields(true),label:"ON"},{opcode:fx.opcode,fields:fx.fields,label:`EFFECT ${effect}`},{opcode:OP_SETUP,fields:brightnessFields(brightness),label:"BRIGHTNESS"}],3200);
    const state=await this.status(name);
    const effectId=Buffer.from(fx.fields).readUIntLE(2,fx.fields[1]);
    const verified=!isSolidEffect(effect)?effectReportMatches(state.report,effectId):null;
    if(verified===false)throw new Error(`${name} did not select ${effect}: expected effect ${effectId}, device reports ${state.report?.effectId}/${state.report?.cloudEffectId}`);
    return {...result,report:state.report,deviceReported:state.deviceReported,effectVerified:verified};
  }
  async factoryPresets():Promise<{presets:EufyFactoryPreset[];rawDiscover:unknown;scanned:number}>{
    this.requireLogin();
    const rawDiscover=await this.signed("light","/app/light/discover/list",{},true);
    const ids=collectFactoryEffectIds(rawDiscover);
    for(let id=10001;id<=10999;id++)ids.add(id);
    const all=[...ids].sort((a,b)=>a-b),seen=new Set<number>(),presets:EufyFactoryPreset[]=[];
    for(let i=0;i<all.length;i+=100){
      const batch=await this.signed("light","/app/light/lighteffect/batchget",{light_id:all.slice(i,i+100)},true);
      const list=Array.isArray(batch?.list)?batch.list:[];
      for(const raw of list){
        if(!raw||typeof raw!=="object")continue;
        const p=normalizeFactoryEntry(raw as Record<string,unknown>);
        if(p&&!seen.has(p.lightId)){seen.add(p.lightId);presets.push(p);}
      }
    }
    presets.sort((a,b)=>a.lightId-b.lightId);
    return {presets,rawDiscover,scanned:all.length};
  }
  async factoryPreset(lightId:number):Promise<EufyFactoryPreset>{
    this.requireLogin();
    if(!Number.isInteger(lightId)||lightId<1||lightId>1000000)throw new Error("Invalid factory preset id");
    const batch=await this.signed("light","/app/light/lighteffect/batchget",{light_id:[lightId]},true);
    const list=Array.isArray(batch?.list)?batch.list:[];
    const raw=list.find((x:any)=>Number(x?.light_id)===lightId);
    if(!raw)throw new Error(`Factory preset ${lightId} was not returned by Eufy`);
    const preset=normalizeFactoryEntry(raw as Record<string,unknown>);
    if(!preset)throw new Error(`Factory preset ${lightId} is malformed`);
    return preset;
  }
  async factoryScene(name:string,preset:EufyFactoryPreset,brightnessOverride?:number){
    const s=this.spec(name);
    const directionalPreset=REVERSED_INSTALLATIONS.has(name)?reverseFactoryPresetDirection(preset):preset;
    const fields=buildFactoryFields(s.model,directionalPreset);
    const brightness=brightnessOverride==null
      ?(typeof preset.brightness==="number"?Math.max(1,Math.min(100,Math.round(preset.brightness))):75)
      :Math.max(1,Math.min(100,Math.round(brightnessOverride)));
    const strategy=s.model==="T8L02"?"native-t8l02-020d-experimental":"native-t8l00-020d-experimental";
    const r=await this.command(name,[
      {opcode:OP_SETUP,fields:powerFields(true),label:"ON"},
      {opcode:OP_SHOW,fields,label:`FACTORY ${preset.lightId}`},
      {opcode:OP_SETUP,fields:brightnessFields(brightness),label:"BRIGHTNESS"}
    ],3600);
    const state=await this.status(name);
    const verified=effectReportMatches(state.report,preset.lightId);
    if(verified===false)throw new Error(`${name} did not select factory effect ${preset.lightId}: device reports ${state.report?.effectId}/${state.report?.cloudEffectId}`);
    return {...r,report:state.report,deviceReported:state.deviceReported,effectVerified:verified,strategy,model:s.model};
  }
  readyNames(){return [...this.lights.keys()];}
}
