import type { Env } from "./types";
export { JasonHomeController } from "./controller";

function json(value:unknown,status=200){
  return new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}
function bearer(req:Request){
  const h=req.headers.get("authorization")||"";
  return h.toLowerCase().startsWith("bearer ")?h.slice(7).trim():"";
}

export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname==="/api/health"){
      return json({ok:true,service:"jason-home-cloud",architecture:"worker+durable-object",time:new Date().toISOString()});
    }
    if(!env.JASON_HOME_API_TOKEN||bearer(request)!==env.JASON_HOME_API_TOKEN){
      return json({ok:false,error:"Unauthorized"},401);
    }
    const id=env.HOME.idFromName("home-v2");
    const stub=env.HOME.get(id);
    return stub.fetch(request);
  }
};
