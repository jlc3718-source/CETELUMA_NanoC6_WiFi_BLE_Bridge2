// Fixed connection diagnostic. This file is never installed in the application.
// No HTTP argument supplies a prompt, URL, model, executable, or source code.
let timeout=3000;
const result={model:null,availability:{ok:false},text:{ok:false},artwork:{ok:false}};
const error=e=>String(e?.message||'Local AI test failed').slice(0,240);
try {
  const url=process.env.JH2_LOCAL_AI_URL||'http://127.0.0.1:11434';
  const base=new URL(url);
  if(base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]','jh2-ai-llm'].includes(base.hostname)||
     base.port!=='11434'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)
    throw Error('Existing AI URL is outside the fixed Oracle-internal service allowlist');
  const request=(input,init={})=>{
    const target=new URL(input);
    if(target.origin!==base.origin||target.search||target.hash||
       !((target.pathname==='/api/tags'&&(init.method||'GET')==='GET')||
         (target.pathname==='/api/chat'&&init.method==='POST')))
      throw Error('Smoke test refused an unexpected internal request');
    return fetch(target,{...init,redirect:'error',signal:AbortSignal.any([init.signal,AbortSignal.timeout(timeout)].filter(Boolean))});
  };
  const {createLocalAI}=await import('/app/local_ai.mjs');
  const ai=createLocalAI({url,request});
  if(typeof ai.model!=='string'||!/^[A-Za-z0-9._:/-]{1,120}$/.test(ai.model))throw Error('Invalid configured local model name');
  result.model=ai.model;
  try {
    const state=await ai.status();
    result.availability={ok:state?.ok===true};
    if(!result.availability.ok)result.availability.error='Configured model is unavailable in the existing local service';
  }catch(e){result.availability.error=error(e);}
  timeout=35000;
  try {
    const response=await ai.completion({messages:[{role:'user',content:'Reply with exactly OK.'}],max_completion_tokens:50});
    const reply=response?.choices?.[0]?.message?.content;
    result.text={ok:typeof reply==='string'&&!!reply.trim(),reply:typeof reply==='string'?reply.trim().slice(0,160):''};
    if(!result.text.ok)result.text.error='The local implementation returned no text';
  }catch(e){result.text.error=error(e);}
  timeout=110000;
  try {
    const art=await ai.art({prompt:'A single red heart centered on black, made from two ellipses and a triangle.'});
    result.artwork={ok:art?.ok===true,image:art?.image,sourceKind:art?.sourceKind,sourceModel:art?.sourceModel};
  }catch(e){result.artwork.error=error(e);}
}catch(e){result.error=error(e);}
// The image exists only in process memory and the private subprocess pipe.
process.stdout.write(JSON.stringify(result));
