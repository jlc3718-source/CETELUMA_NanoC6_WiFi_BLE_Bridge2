import type { Env, Scene } from "./types";

function base(env:Env){
  const url=(env.JASON_HOME_RELAY_URL||"").trim().replace(/\/+$/,"");
  if(!url)return "";
  if(!/^https:\/\//i.test(url))throw new Error("Jason Home relay URL must use HTTPS");
  return url;
}
export function relayConfigured(env:Env){
  return !!((env.JASON_HOME_RELAY_URL||"").trim()&&(env.JASON_HOME_RELAY_TOKEN||"").trim());
}
async function call(env:Env,path:string,method="GET",body?:unknown){
  const root=base(env),token=(env.JASON_HOME_RELAY_TOKEN||"").trim();
  if(!root||!token)throw new Error("Jason Home Linux relay is not configured");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(root+path,{
      method,
      headers:{
        "authorization":"Bearer "+token,
        ...(body===undefined?{}:{"content-type":"application/json"})
      },
      body:body===undefined?undefined:JSON.stringify(body),
      signal:controller.signal
    });
    const text=await response.text();let obj:any;
    try{obj=text?JSON.parse(text):{};}catch{throw new Error(`Relay ${path} HTTP ${response.status} returned non-JSON`);}
    if(!response.ok||obj?.ok===false)throw new Error(obj?.error||`Relay ${path} HTTP ${response.status}`);
    return obj;
  }finally{clearTimeout(timer);}
}
export async function relayReady(env:Env){return call(env,"/ready");}
export async function relayReconnect(env:Env){return call(env,"/reconnect","POST",{});}
export async function relayProbe(env:Env,target:string){return call(env,"/probe","POST",{target});}
export async function relayCommand(env:Env,target:string,scene:Scene){return call(env,"/command","POST",{target,...scene});}
