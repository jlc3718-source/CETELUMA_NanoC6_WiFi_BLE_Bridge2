import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { EufyClient } from "./eufy/client.js";

const PORT=Math.max(1,Number(process.env.PORT||"8080"));
const EMAIL=process.env.EUFY_EMAIL||"";
const PASSWORD=process.env.EUFY_PASSWORD||"";
const TOKEN=process.env.JASON_HOME_RELAY_TOKEN||"";
const INSTALL_ID=(process.env.EUFY_INSTALL_ID||createHash("sha256").update("jason-home-relay:"+EMAIL).digest("hex").slice(0,32)).toLowerCase();

if(!EMAIL||!PASSWORD)throw new Error("EUFY_EMAIL and EUFY_PASSWORD are required");
if(!TOKEN)throw new Error("JASON_HOME_RELAY_TOKEN is required");
if(!/^[0-9a-f]{32}$/.test(INSTALL_ID))throw new Error("EUFY_INSTALL_ID must be 32 hex characters");

const NAMES=["Pool","House","Garage","Shed"] as const;
let client:EufyClient|null=null;
let readyNames:string[]=[];
let preparePromise:Promise<EufyClient>|null=null;
let queue:Promise<void>=Promise.resolve();

function secureEqual(a:string,b:string){
  const aa=Buffer.from(a),bb=Buffer.from(b);
  return aa.length===bb.length&&timingSafeEqual(aa,bb);
}
function authorized(req:http.IncomingMessage){
  const h=req.headers.authorization||"";
  return h.startsWith("Bearer ")&&secureEqual(h.slice(7),TOKEN);
}
function json(res:http.ServerResponse,status:number,value:unknown){
  const body=JSON.stringify(value);
  res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","content-length":Buffer.byteLength(body)});
  res.end(body);
}
async function readJson(req:http.IncomingMessage){
  const chunks:Buffer[]=[];let total=0;
  for await(const chunk of req){
    const b=Buffer.from(chunk);total+=b.length;
    if(total>65536)throw new Error("Request body too large");
    chunks.push(b);
  }
  if(!chunks.length)return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function ensureClient(force=false){
  if(force){client=null;readyNames=[];preparePromise=null;}
  if(client&&readyNames.length===4)return client;
  if(preparePromise)return preparePromise;
  preparePromise=(async()=>{
    const c=new EufyClient(INSTALL_ID);
    await c.login(EMAIL,PASSWORD);
    await c.prepare();
    const names=c.readyNames();
    for(const n of NAMES)if(!names.includes(n))throw new Error("Missing Eufy light: "+n);
    client=c;readyNames=names;
    return c;
  })().finally(()=>{preparePromise=null;});
  return preparePromise;
}
async function serialized<T>(fn:()=>Promise<T>):Promise<T>{
  const previous=queue;
  let release!:()=>void;
  queue=new Promise<void>(resolve=>{release=resolve;});
  await previous.catch(()=>{});
  try{return await fn();}finally{release();}
}
function safeTarget(v:any){
  const t=String(v||"All");
  if(t==="All"||NAMES.includes(t as any))return t;
  throw new Error("Unknown target "+t);
}
function safeScene(input:any){
  const colors=Array.isArray(input?.colors)?input.colors.map((x:any)=>typeof x==="number"?(x&0xffffff):parseInt(String(x).replace("#",""),16)&0xffffff).filter((x:any)=>Number.isFinite(x)).slice(0,8):[0xffffff];
  return {
    power:input?.power===false?false:true,
    brightness:Math.max(1,Math.min(100,Number(input?.brightness??75)||75)),
    effect:String(input?.effect||"Solid / Static").slice(0,64),
    colors:colors.length?colors:[0xffffff],
    speed:Math.max(1,Math.min(5,Number(input?.speed??3)||3))
  };
}
async function executeCommand(input:any){
  return serialized(async()=>{
    const c=await ensureClient(false);
    const target=safeTarget(input?.target),scene=safeScene(input),names=target==="All"?[...NAMES]:[target as typeof NAMES[number]];
    const detail:any[]=[];
    for(const name of names){
      try{
        const r=scene.power?await c.scene(name,scene.effect,scene.colors,scene.speed,scene.brightness):await c.power(name,false);
        detail.push({name,ok:true,report:r.report||null,instance:(r as any).instance||null});
      }catch(e:any){
        detail.push({name,ok:false,error:e?.message||String(e)});
      }
    }
    const ok=detail.filter(x=>x.ok).length;
    if(ok===0)throw new Error(detail.map(x=>x.error).filter(Boolean).join("; ")||"No command completed");
    return {ok:true,updated:ok,total:names.length,detail};
  });
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||"/","http://localhost");
    if(req.method==="GET"&&url.pathname==="/health")return json(res,200,{ok:true,service:"jason-home-eufy-relay",runtime:"linux-node",time:new Date().toISOString()});
    if(!authorized(req))return json(res,401,{ok:false,error:"Unauthorized"});

    if(req.method==="GET"&&url.pathname==="/ready"){
      const c=await ensureClient(false);
      return json(res,200,{ok:true,ready:true,status:`Ready ${c.readyNames().length}/4`,readyNames:c.readyNames()});
    }
    if(req.method==="POST"&&url.pathname==="/reconnect"){
      const c=await ensureClient(true);
      return json(res,200,{ok:true,status:`Ready ${c.readyNames().length}/4`,readyNames:c.readyNames()});
    }
    if(req.method==="POST"&&url.pathname==="/probe"){
      const body:any=await readJson(req),target=safeTarget(body.target||"Pool");
      if(target==="All")throw new Error("Probe requires one light target");
      const result=await serialized(async()=>{const c=await ensureClient(false);return c.status(target);});
      return json(res,200,{ok:true,target,published:result.published,report:result.report||null,instance:(result as any).instance||null});
    }
    if(req.method==="POST"&&url.pathname==="/command"){
      const body:any=await readJson(req);
      return json(res,200,await executeCommand(body));
    }
    return json(res,404,{ok:false,error:"Not found"});
  }catch(e:any){
    const msg=e?.message||String(e);
    console.error("[relay]",msg);
    if(/session|auth|login|certificate/i.test(msg)){client=null;readyNames=[];}
    return json(res,500,{ok:false,error:msg});
  }
});
server.keepAliveTimeout=65000;
server.listen(PORT,"0.0.0.0",()=>console.log(`Jason Home Eufy relay listening on ${PORT}`));
