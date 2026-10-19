// Oracle-only 40x40 AI. No Cloudflare, paid API, package, GPU, or shell dependency.
import {deflateSync} from 'node:zlib';
const W=40,H=40,clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(+v)?+v:a));
const color=(v,f='#000000')=>/^#[a-f0-9]{6}$/i.test(String(v||''))?String(v):f;
const rgb=v=>[1,3,5].map(i=>parseInt(v.slice(i,i+2),16));
function crc32(buf){let c=0xffffffff;for(const v of buf){c^=v;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;}return (c^0xffffffff)>>>0;}
function chunk(name,data){const n=Buffer.alloc(4),k=Buffer.from(name),sum=Buffer.alloc(4);n.writeUInt32BE(data.length);sum.writeUInt32BE(crc32(Buffer.concat([k,data])));return Buffer.concat([n,k,data,sum]);}
export function encode40PNG(rgba){
 if(rgba.length!==6400)throw Error('Expected 40x40 RGBA');
 const head=Buffer.alloc(13);head.writeUInt32BE(40);head.writeUInt32BE(40,4);head[8]=8;head[9]=6;
 const rows=[];for(let y=0;y<40;y++)rows.push(Buffer.from([0]),Buffer.from(rgba.subarray(y*160,y*160+160)));
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
}
export function cleanScene(scene){
 if(!scene||typeof scene!=='object')throw Error('Missing AI artwork');
 const shapes=(Array.isArray(scene.shapes)?scene.shapes:[]).slice(0,28).map(s=>{
  if(!s||!['rect','ellipse','polygon','line'].includes(s.type))return null;
  const o={type:s.type,color:color(s.color,'#ff9900')};
  for(const k of ['x','y','w','h','cx','cy','rx','ry','x2','y2','thickness'])if(s[k]!==undefined)o[k]=clamp(s[k],-10,55);
  if(s.type==='polygon')o.points=Array.isArray(s.points)?s.points.slice(0,20).filter(p=>Array.isArray(p)&&p.length===2).map(p=>p.map(q=>clamp(q,-10,55))):[];
  return o;
 }).filter(Boolean);
 if(!shapes.length)throw Error('AI supplied no shapes');
 return {background:color(scene.background),shapes};
}
export function render40(scene){
 scene=cleanScene(scene);
 const px=new Uint8ClampedArray(6400),bg=rgb(scene.background);
 for(let k=0;k<6400;k+=4)px.set([...bg,255],k);
 const set=(x,y,c)=>{x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=40||y>=40)return;px.set([...c,255],(y*40+x)*4);};
 for(const s of scene.shapes){
  const c=rgb(s.color);
  if(s.type==='rect')for(let y=Math.max(0,Math.floor(s.y??0));y<Math.min(40,Math.ceil((s.y??0)+Math.max(1,s.h??1)));y++)for(let x=Math.max(0,Math.floor(s.x??0));x<Math.min(40,Math.ceil((s.x??0)+Math.max(1,s.w??1)));x++)set(x,y,c);
  if(s.type==='ellipse'){const cx=s.cx??20,cy=s.cy??20,rx=Math.max(1,s.rx??7),ry=Math.max(1,s.ry??7);for(let y=Math.max(0,Math.floor(cy-ry));y<Math.min(40,Math.ceil(cy+ry+1));y++)for(let x=Math.max(0,Math.floor(cx-rx));x<Math.min(40,Math.ceil(cx+rx+1));x++)if(((x-cx)/rx)**2+((y-cy)/ry)**2<=1)set(x,y,c);}
  if(s.type==='polygon'&&s.points?.length>=3){const p=s.points;for(let y=0;y<40;y++)for(let x=0;x<40;x++){let inside=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const [a,b]=p[i],[d,e]=p[j];if((b>y)!==(e>y)&&x<(d-a)*(y-b)/(e-b)+a)inside=!inside;}if(inside)set(x,y,c);}}
  if(s.type==='line'){const a=s.x??0,b=s.y??0,d=(s.x2??39)-a,e=(s.y2??39)-b,L=d*d+e*e,rad=clamp(s.thickness??1,1,6)/2;for(let y=0;y<40;y++)for(let x=0;x<40;x++){const t=L?clamp(((x-a)*d+(y-b)*e)/L,0,1):0;if(Math.hypot(x-a-t*d,y-b-t*e)<=rad)set(x,y,c);}}
 }
 return px;
}
export function templateScene(description){
 const p=String(description).toLowerCase(),black='#000000';
 const o=(cx,cy,rx,ry,color)=>({type:'ellipse',cx,cy,rx,ry,color});
 const r=(x,y,w,h,color)=>({type:'rect',x,y,w,h,color});
 const g=(points,color)=>({type:'polygon',points,color});
 let shapes=[];
 if(/pumpkin|jack.o.lantern|gourd/.test(p))shapes=[o(20,23,16,13,'#ff8b00'),o(13,23,7,11,'#f67800'),o(27,23,7,11,'#ff9e00'),r(18,6,4,6,'#368732'),g([[10,18],[16,18],[13,23]],black),g([[24,18],[30,18],[27,23]],black),g([[11,27],[15,29],[20,30],[25,29],[30,27],[25,33],[15,33]],black)];
 else if(/ghost/.test(p))shapes=[o(20,17,12,13,'#ffffff'),r(8,16,24,16,'#f5f5ff'),g([[8,32],[13,28],[18,33],[23,28],[28,33],[32,29],[32,32]],'#f5f5ff'),o(16,18,2,3,black),o(24,18,2,3,black),o(20,27,3,4,black)];
 else if(/heart|love/.test(p))shapes=[o(13,15,9,8,'#ff3355'),o(27,15,9,8,'#ff3355'),g([[4,18],[20,36],[36,18]],'#ff3355')];
 else if(/christmas|tree/.test(p))shapes=[g([[20,3],[5,30],[35,30]],'#158f36'),g([[20,12],[9,33],[31,33]],'#15a747'),r(17,30,6,7,'#86502d'),r(19,7,2,2,'#ffff55')];
 else if(/star/.test(p))shapes=[g([[20,3],[24,15],[38,15],[27,24],[31,37],[20,29],[9,37],[13,24],[2,15],[16,15]],'#ffdd35')];
 else shapes=[o(20,21,13,13,'#50c6ee'),o(15,18,2,3,black),o(25,18,2,3,black),r(15,27,10,2,black)];
 return {background:black,shapes};
}
const SYSTEM_ART='You are a pixel artist. Return ONLY a JSON object with keys background and shapes. Draw recognizable centered 40 by 40 pixel art, black background, up to 8 colors and 7 to 18 simple shapes. Allowed shapes: {"type":"ellipse","cx":20,"cy":20,"rx":12,"ry":10,"color":"#ff8800"}, {"type":"rect","x":10,"y":10,"w":5,"h":4,"color":"#ffffff"}, {"type":"polygon","points":[[12,17],[17,17],[14,23]],"color":"#000000"}, {"type":"line","x":10,"y":20,"x2":30,"y2":20,"thickness":2,"color":"#ff0000"}. Draw BACK to FRONT. Make eyes and mouths visible. Never use SVG, CSS or prose. Stay within 0-39.';
export function createLocalAI({url=process.env.JH2_LOCAL_AI_URL||'http://jh2-ai-llm:11434',model=process.env.JH2_LOCAL_AI_MODEL||'qwen2.5:1.5b-instruct',request=globalThis.fetch}={}){
 async function requestText(messages,{limit=480,timeout=240000,format}={}){
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeout);
  try{
   const resp=await request(url+'/api/chat',{method:'POST',signal:abort.signal,headers:{'content-type':'application/json'},body:JSON.stringify({model,messages,stream:false,keep_alive:0,options:{num_ctx:2048,num_predict:limit,num_thread:1,temperature:0.25},...(format?{format}:{})})});
   if(!resp.ok)throw Error('Oracle local AI HTTP '+resp.status);
   const payload=await resp.json();
   if(typeof payload?.message?.content!=='string'||!payload.message.content.trim())throw Error('Oracle local AI returned an empty answer');
   return {content:payload.message.content.trim(),promptTokens:payload.prompt_eval_count||0,outputTokens:payload.eval_count||0};
  }finally{clearTimeout(timer);}
 }
 async function status(){
  const abort=new AbortController(),t=setTimeout(()=>abort.abort(),2600);
  try{const r=await request(url+'/api/tags',{signal:abort.signal});if(!r.ok)return {ok:false,model};const j=await r.json();return {ok:Array.isArray(j.models)&&j.models.some(m=>m.name===model),model,provider:'Oracle Local AI',freeTier:true};}
  catch{return {ok:false,model,provider:'Oracle Local AI'};}finally{clearTimeout(t);}
 }
 async function art(body){
  const prompt=String(body?.prompt||'').trim().slice(0,400);if(prompt.length<3)throw Error('Describe the artwork');
  let scene,source=model;
  try{const {content}=await requestText([{role:'system',content:SYSTEM_ART},{role:'user',content:'Draw pixel art: '+prompt}],{limit:560,format:'json'});const a=content.indexOf('{'),b=content.lastIndexOf('}');scene=cleanScene(JSON.parse(content.slice(a,b+1)));}
  catch(e){scene=templateScene(prompt);source='local-template-fallback';}
  const image='data:image/png;base64,'+encode40PNG(render40(scene)).toString('base64');
  return {ok:true,image,sourceModel:source,sourceKind:source===model?'model':'fallback',width:40,height:40,scene};
 }
 async function chat(body){
  const message=String(body?.message||'').trim().slice(0,1600);if(message.length<2)throw Error('Write a message');
  const history=(Array.isArray(body?.history)?body.history:[]).slice(-10).filter(x=>['user','assistant'].includes(x.role)).map(x=>({role:x.role,content:String(x.content||'').slice(0,700)}));
  const {content}=await requestText([{role:'system',content:'You are a friendly, precise assistant inside Jason Home 2. Help design 40x40 pixel artwork and animations, and lighting shows. Be concise. Never claim anything has been published or deployed. Explain changes plainly.'},...history,{role:'user',content:message}],{limit:170});
  return {ok:true,reply:content,model,provider:'Oracle Local AI'};
 }
 async function completion(body){
  const messages=(Array.isArray(body?.messages)?body.messages:[]).slice(-12).map(m=>({role:['system','assistant','user'].includes(m.role)?m.role:'user',content:String(m.content||'').slice(0,2500)}));
  const format=body?.response_format?.type==='json_schema'?(body.response_format?.json_schema?.schema||'json'):undefined;
  const {content,promptTokens,outputTokens}=await requestText(messages,{limit:Math.min(1200,Math.max(50,Number(body.max_completion_tokens)||700)),format});
  return {choices:[{message:{role:'assistant',content}}],usage:{prompt_tokens:promptTokens,completion_tokens:outputTokens},provider:'Oracle Local AI'};
 }
 return {art,chat,completion,status,model};
}