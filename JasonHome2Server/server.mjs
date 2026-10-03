import http from "node:http";
import { createHmac, randomBytes, timingSafeEqual, randomUUID, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { lightingNightDate, resolveNightEvents, resolveNightCandidates, resolveNightCandidateScene } from "./night_resolver.mjs";

const root=resolve(process.env.JH2_WEB_ROOT||new URL("./web/",import.meta.url).pathname);
const dataDir=resolve(process.env.JH2_DATA_DIR||"./data");
const catalog=JSON.parse(readFileSync(new URL("./catalog.json",import.meta.url),"utf8"));

const nativeEffects=new Set(["Static","Flow1","Flow2","Cycle","Streamlight","Twinkle","Breathe"]);
const oldEffects={Solid:"Static","Solid / Static":"Static",Jump:"Cycle",Breath:"Breathe",Strobe:"Twinkle",Chase:"Flow1","Gradient Sweep":"Flow1","Candy Cane":"Flow1","Twinkle / Sparkle":"Twinkle","Wipe / Fill":"Streamlight","Meteor / Comet":"Streamlight","Rainbow Flow":"Flow1","Pulse Wave":"Breathe"};
function normalizeEffects(value){
  if(Array.isArray(value)){value.forEach(normalizeEffects);return value;}
  if(value&&typeof value==="object")for(const [key,item] of Object.entries(value)){
    if(["effect","expandedEffect"].includes(key)&&typeof item==="string")value[key]=nativeEffects.has(item)?item:oldEffects[item]||"Flow1";
    else normalizeEffects(item);
  }
  return value;
}

const AI_MODEL=process.env.JH2_AI_MODEL||"@cf/zai-org/glm-4.7-flash";
const AI_ASR_MODEL=process.env.JH2_AI_ASR_MODEL||"@cf/openai/whisper-large-v3-turbo";
const AI_TTS_MODEL=process.env.JH2_AI_TTS_MODEL||"@cf/myshell-ai/melotts";
const AI_DAILY_NEURON_LIMIT=10000;
const AI_TEXT_INPUT_NEURONS_PER_MILLION=5500;
const AI_TEXT_OUTPUT_NEURONS_PER_MILLION=36400;
const AI_ASR_NEURONS_PER_MINUTE=46.63;
const AI_TTS_NEURONS_PER_MINUTE=18.63;
const AI_EFFECTS=["Static","Flow1","Flow2","Cycle","Streamlight","Twinkle","Breathe"];
const AI_SYSTEM=`You are the Jason Home lighting designer. Hold a natural back-and-forth conversation, offer concrete design ideas, and revise earlier ideas when asked.
You can only design using these native effects: Static, Flow1, Flow2, Cycle, Streamlight, Twinkle, Breathe.
Speeds are 1-10 in the UI, but prefer 1-5 for scheduled shows unless the user specifically asks for faster. Pool and Shed are physically reversed by the controller automatically; do not compensate in the recipe.
A draft can have 1-8 layers. Each layer has effect, speed, minutes, shift, blocks, offset, and mirror. shift rotates the palette order. blocks is the repeating number of individually-addressed lamps assigned to each palette color, for example [5,3] means five of color 1 then three of color 2. offset shifts that block pattern along the string. mirror makes the pattern reflect from both ends. Use only the colors in the draft palette; never introduce a new color just for a gap.
If the user is brainstorming or asking for alternatives, reply conversationally and draft may be null. If they have described a concrete show, provide a draft.
target_event should be the exact holiday/event name when possible (for example Christmas Day, Halloween, Independence Day), otherwise date may be YYYY-MM-DD.
Return JSON only with this shape:
{"reply":"natural conversational response","draft":null or {"name":"short show name","target_event":"event name or empty","date":"YYYY-MM-DD or empty","brightness":1-100,"colors":["#RRGGBB"],"layers":[{"effect":"native effect","speed":1-10,"minutes":2-30,"shift":0-7,"blocks":[5,3],"offset":0,"mirror":false}]}}
Never claim a draft has been applied or scheduled; the user must press a button.`;
function layerEffect(value){
  const name=String(value||"Flow1");
  return nativeEffects.has(name)?name:oldEffects[name]||"Flow1";
}
function normalizePattern(value,colorCount){
  if(colorCount<2||!value||typeof value!=="object")return null;
  const raw=Array.isArray(value.blocks)?value.blocks:[];
  const blocks=raw.slice(0,Math.max(2,Math.min(8,colorCount))).map(v=>Math.max(1,Math.min(12,Math.round(Number(v)||1))));
  while(blocks.length<colorCount)blocks.push(blocks[blocks.length%Math.max(1,blocks.length)]||1);
  return blocks.length?{blocks:blocks.slice(0,colorCount),offset:Math.trunc(Number(value.offset)||0),mirror:!!value.mirror}:null;
}
function patternSeed(e){
  const text=String(e?.id||e?.name||"event");let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
  return h>>>0;
}
function defaultPattern(e,phaseIndex,colorCount){
  if(colorCount<2)return null;
  const bank=[[5,3,2,4,6,2,3,1],[4,2,5,3,2,6,1,4],[6,3,2,5,4,1,3,2],[3,2,7,2,4,3,1,5],[5,2,3,6,2,4,3,1],[2,4,6,3,5,2,1,4]];
  const seed=patternSeed(e),row=bank[(seed+phaseIndex)%bank.length],blocks=Array.from({length:Math.min(8,colorCount)},(_,i)=>row[(i+phaseIndex)%row.length]);
  const total=blocks.reduce((a,b)=>a+b,0);
  return {blocks,offset:total?((seed>>>3)+phaseIndex*3)%total:0,mirror:((seed+phaseIndex)&3)===0};
}
function creativePhase(effect,speed,minutes,shift=0,pattern=null){
  return {
    effect:layerEffect(effect),
    speed:Math.max(1,Math.min(5,Math.round(Number(speed)||1))),
    minutes:Math.max(2,Math.min(30,Math.round(Number(minutes)||8))),
    shift:Math.max(-7,Math.min(7,Math.trunc(Number(shift)||0))),
    pattern
  };
}
function patterned(e,phases){
  const count=Math.max(1,Math.min(8,(Array.isArray(e?.colors)?e.colors.length:0)||1));
  return phases.map((p,i)=>({...p,pattern:normalizePattern(p.pattern,count)||defaultPattern(e,i,count)}));
}
function creativeProgram(e){
  const colors=Array.isArray(e?.colors)?e.colors:[],colorCount=Math.max(1,Math.min(8,colors.length||1));
  if(Array.isArray(e?.creativePhases)&&e.creativePhases.length){
    const saved=e.creativePhases.slice(0,8).map(p=>creativePhase(p.effect,p.speed,p.minutes,p.shift||0,normalizePattern(p.pattern,colorCount)));
    if(saved.length===1){const only=saved[0],alt=only.effect==="Breathe"?"Flow1":only.effect==="Flow1"?"Breathe":"Flow1";saved.push(creativePhase(alt,Math.min(only.speed,2),Math.max(4,only.minutes),1));}
    return patterned(e,saved);
  }
  const name=String(e?.name||"").toLowerCase(),base=layerEffect(e?.effect),baseSpeed=Math.max(1,Math.min(5,Number(e?.speed)||2));
  const factory=String(e?.id||"").includes("::factory:");
  const solemn=/(remembrance|memorial|holocaust|pow\/mia|yom kippur|good friday|ash wednesday|gold star|pearl harbor|transgender day of remembrance)/.test(name);
  const patriotic=/(independence|flag day|veterans|armed forces|patriot day|constitution|freedom day|presidents|memorial day|d-day|korean war|purple heart)/.test(name);
  const rainbow=/(pride|lgbtq|coming out|homophobia|transphobia)/.test(name);
  const winter=/(christmas|hanukkah|kwanzaa|winter solstice)/.test(name);
  const carnival=/(mardi gras|cinco de mayo|diwali|lunar new year|st\. patrick|easter|new year)/.test(name);
  const family=/(valentine|mother.?s day|father.?s day|parents.? day|grandparents)/.test(name);
  const p=(effect,speed,minutes,shift=0)=>creativePhase(effect,speed,minutes,shift);
  let out;
  if(factory){const opposite=base==="Flow2"?"Flow1":"Flow2",accent=base==="Twinkle"?"Breathe":base==="Breathe"?"Twinkle":"Breathe";out=[p(base,Math.min(baseSpeed,4),8),p(accent,Math.min(baseSpeed,2),7,1),p(opposite,Math.min(baseSpeed,3),8,-1),p("Static",1,5,2)];}
  else if(/new year.?s eve/.test(name))out=[p("Streamlight",4,7),p("Twinkle",5,6,1),p("Cycle",3,7,2),p("Flow2",3,7,-1),p("Static",1,4,3)];
  else if(/new year.?s day/.test(name))out=[p("Flow1",3,7),p("Twinkle",3,6,1),p("Breathe",1,7),p("Flow2",3,7,-1)];
  else if(/halloween/.test(name))out=[p("Streamlight",3,7),p("Twinkle",3,6,1),p("Breathe",2,6,2),p("Flow2",3,7,-1),p("Static",1,4)];
  else if(/christmas day/.test(name))out=[p("Flow1",2,7),p("Breathe",1,6,1),p("Twinkle",2,6,2),p("Flow2",2,7,-1),p("Static",1,4,1)];
  else if(/christmas eve/.test(name))out=[p("Breathe",1,7),p("Flow1",2,7,1),p("Twinkle",1,5,2),p("Flow2",2,7,-1),p("Static",1,4)];
  else if(/independence day/.test(name))out=[p("Flow1",3,7),p("Cycle",3,6,1),p("Twinkle",4,6,2),p("Flow2",3,7,-1),p("Static",1,4)];
  else if(/mardi gras/.test(name))out=[p("Flow1",3,6),p("Twinkle",3,6,1),p("Streamlight",3,6,2),p("Flow2",3,7,-1),p("Breathe",1,5)];
  else if(/diwali/.test(name))out=[p("Breathe",1,6),p("Twinkle",3,6,1),p("Streamlight",3,6,2),p("Flow1",2,7,-1),p("Static",1,5)];
  else if(/lunar new year/.test(name))out=[p("Streamlight",3,7),p("Flow1",3,6,1),p("Twinkle",2,6),p("Flow2",3,7,-1),p("Static",1,4,2)];
  else if(/valentine/.test(name))out=[p("Breathe",1,7),p("Flow1",2,6,1),p("Twinkle",1,5,2),p("Flow2",2,7,-1),p("Static",1,5)];
  else if(solemn)out=[p("Static",1,10),p("Breathe",1,10,1),p("Static",1,10,-1)];
  else if(patriotic)out=[p("Flow1",2,8),p("Breathe",1,7,1),p("Twinkle",2,6,2),p("Flow2",2,8,-1)];
  else if(rainbow)out=[p("Flow1",3,7),p("Flow2",3,7,1),p("Breathe",1,6,2),p("Streamlight",2,6,-1),p("Twinkle",2,4,3)];
  else if(winter)out=[p(base,Math.min(baseSpeed,2),8),p("Twinkle",1,7,1),p("Breathe",1,8,-1),p("Flow2",2,7,2)];
  else if(carnival)out=[p(base,Math.min(baseSpeed,3),7),p("Twinkle",2,6,1),p("Flow2",2,6,-1),p("Breathe",1,6,2),p("Streamlight",2,5)];
  else if(family)out=[p("Breathe",1,8),p("Flow1",2,7,1),p("Twinkle",1,6,-1),p("Static",1,5,2)];
  else if(e?.rule==="Month")out=colors.length>=3?[p(base,Math.min(baseSpeed,2),8),p("Breathe",1,7,1),p("Flow2",2,8,-1),p("Twinkle",1,7,2)]:[p("Breathe",1,10),p(base,Math.min(baseSpeed,2),10,1),p("Static",1,10,-1)];
  else if(e?.kind==="Seasonal")out=[p(base,Math.min(baseSpeed,2),8),p("Streamlight",2,7,1),p("Breathe",1,8,-1),p("Twinkle",1,7,2)];
  else if(e?.kind==="Holiday"&&colors.length>=2)out=[p(base,Math.min(baseSpeed,3),8),p("Twinkle",1,6,1),p("Flow2",2,8,-1),p("Breathe",1,8,2)];
  else if(colors.length>=2)out=[p(base,Math.min(baseSpeed,2),9),p("Breathe",1,8,1),p("Flow2",2,7,-1),p("Static",1,6,2)];
  else {const alt=base==="Breathe"?"Flow1":base==="Flow1"?"Breathe":"Flow1";out=[p(base,Math.min(baseSpeed,2),15),p(alt,1,15,1)];}
  return patterned(e,out);
}
function creativeLayerCount(e){return creativeProgram(e).length;}

normalizeEffects(catalog);
const legacySpeed=v=>[1,3,5,8,10][Math.max(1,Math.min(5,Math.round(Number(v)||3)))-1];
function migrateSpeeds(value){
  if(Array.isArray(value)){value.forEach(migrateSpeeds);return value;}
  if(value&&typeof value==="object")for(const [key,item] of Object.entries(value)){
    if(["speed","expandedSpeed"].includes(key))value[key]=legacySpeed(item);else migrateSpeeds(item);
  }
  return value;
}
migrateSpeeds(catalog);


const port=Number(process.env.JH2_PORT||8081);
const upstreamUrl=process.env.JH2_UPSTREAM_URL||"http://127.0.0.1:8080";
const upstreamToken=process.env.JH2_UPSTREAM_TOKEN||"";
const resolverSha=process.env.JH2_RESOLVER_SHA||"";
if(!upstreamToken)throw new Error("JH2_UPSTREAM_TOKEN must be configured");
mkdirSync(dataDir,{recursive:true});
const db=new DatabaseSync(join(dataDir,"jason-home-2.sqlite"));
db.exec("CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
const meta=(key,fallback=null)=>{const row=db.prepare("SELECT value FROM meta WHERE key=?").get(key);return row?JSON.parse(row.value):fallback;};
const put=(key,value)=>db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key,JSON.stringify(value));
for(const key of ["event_overrides","custom_schedules","presets"]){const value=meta(key);if(value)put(key,normalizeEffects(value));}
if(!meta("speed_scale_10")){
  db.exec("BEGIN");
  try{for(const key of ["event_overrides","custom_schedules","presets"]){const value=meta(key);if(value){put("speed_scale_10_backup_"+key,value);put(key,migrateSpeeds(value));}}
    put("speed_scale_10",true);db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
}
let secret=meta("session_secret");
if(!secret){secret=randomBytes(32).toString("hex");put("session_secret",secret);}
const aiCipherKey=createHash("sha256").update("jason-home-ai:"+secret).digest();
function sealAiKey(value){
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",aiCipherKey,iv);
  const encrypted=Buffer.concat([cipher.update(String(value),"utf8"),cipher.final()]),tag=cipher.getAuthTag();
  return {iv:iv.toString("base64"),tag:tag.toString("base64"),data:encrypted.toString("base64")};
}
function openAiKey(){
  const env=String(process.env.OPENAI_API_KEY||"").trim();if(env)return env;
  const box=meta("ai_api_key_cipher");if(!box?.iv||!box?.tag||!box?.data)return "";
  try{const d=createDecipheriv("aes-256-gcm",aiCipherKey,Buffer.from(box.iv,"base64"));d.setAuthTag(Buffer.from(box.tag,"base64"));return Buffer.concat([d.update(Buffer.from(box.data,"base64")),d.final()]).toString("utf8");}
  catch{return "";}
}
function cloudflareAiAccount(){
  return String(process.env.JH2_CF_AI_ACCOUNT_ID||meta("cf_ai_account_id","")||"").trim();
}
function cloudflareAiToken(){
  const env=String(process.env.JH2_CF_AI_TOKEN||"").trim();if(env)return env;
  const box=meta("cf_ai_token_cipher");if(!box?.iv||!box?.tag||!box?.data)return "";
  try{const d=createDecipheriv("aes-256-gcm",aiCipherKey,Buffer.from(box.iv,"base64"));d.setAuthTag(Buffer.from(box.tag,"base64"));return Buffer.concat([d.update(Buffer.from(box.data,"base64")),d.final()]).toString("utf8");}
  catch{return "";}
}
function cloudflareAiConfigured(){return !!(cloudflareAiAccount()&&cloudflareAiToken());}
function aiUsageDay(){return new Date().toISOString().slice(0,10);}
function currentAiUsage(){
  const day=aiUsageDay(),prior=meta("ai_usage",null);
  if(prior?.day===day)return prior;
  const fresh={day,neurons:0,inputTokens:0,outputTokens:0,asrMinutes:0,ttsMinutes:0,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  put("ai_usage",fresh);return fresh;
}
function addAiUsage({inputTokens=0,outputTokens=0,asrMinutes=0,ttsMinutes=0}={}){
  const usage=currentAiUsage();
  const neurons=(Math.max(0,Number(inputTokens)||0)*AI_TEXT_INPUT_NEURONS_PER_MILLION/1e6)
    +(Math.max(0,Number(outputTokens)||0)*AI_TEXT_OUTPUT_NEURONS_PER_MILLION/1e6)
    +(Math.max(0,Number(asrMinutes)||0)*AI_ASR_NEURONS_PER_MINUTE)
    +(Math.max(0,Number(ttsMinutes)||0)*AI_TTS_NEURONS_PER_MINUTE);
  usage.neurons=Math.max(0,Number(usage.neurons)||0)+neurons;
  usage.inputTokens=Math.max(0,Number(usage.inputTokens)||0)+Math.max(0,Number(inputTokens)||0);
  usage.outputTokens=Math.max(0,Number(usage.outputTokens)||0)+Math.max(0,Number(outputTokens)||0);
  usage.asrMinutes=Math.max(0,Number(usage.asrMinutes)||0)+Math.max(0,Number(asrMinutes)||0);
  usage.ttsMinutes=Math.max(0,Number(usage.ttsMinutes)||0)+Math.max(0,Number(ttsMinutes)||0);
  usage.updatedAt=new Date().toISOString();put("ai_usage",usage);return usage;
}
function recordAiChatUsage(payload){
  const usage=payload?.usage||payload?.result?.usage||{};
  const inputTokens=Number(usage.prompt_tokens??usage.input_tokens??0)||0;
  const outputTokens=Number(usage.completion_tokens??usage.output_tokens??0)||0;
  if(inputTokens||outputTokens)addAiUsage({inputTokens,outputTokens});
}
function markAiUsageExhausted(){
  const usage=currentAiUsage();usage.neurons=Math.max(AI_DAILY_NEURON_LIMIT,Number(usage.neurons)||0);usage.updatedAt=new Date().toISOString();put("ai_usage",usage);
}
function aiUsageBaseline(usage){
  const existing=meta("ai_usage_baseline",null);
  if(existing?.day===usage.day)return existing;
  if(usage.day==="2026-09-30"){
    const baseline={day:usage.day,total:70.21,trackedAt:Number(usage.neurons)||0,capturedAt:"2026-09-30T14:13:00Z",source:"Cloudflare Workers AI usage screenshot"};
    put("ai_usage_baseline",baseline);return baseline;
  }
  return null;
}
function aiUsageState(){
  const usage=currentAiUsage(),tracked=Math.max(0,Number(usage.neurons)||0),baseline=aiUsageBaseline(usage);
  const combined=baseline?Math.max(0,Number(baseline.total)||0)+Math.max(0,tracked-Math.max(0,Number(baseline.trackedAt)||0)):tracked;
  const used=Math.min(AI_DAILY_NEURON_LIMIT,combined),remaining=Math.max(0,AI_DAILY_NEURON_LIMIT-used);
  return {limit:AI_DAILY_NEURON_LIMIT,used:Math.round(used*100)/100,remaining:Math.round(remaining*100)/100,percent:Math.min(100,Math.round((used/AI_DAILY_NEURON_LIMIT)*1000)/10),
    day:usage.day,resetAt:"00:00 UTC",source:baseline?"cloudflare-baseline":"estimated",
    baseline:baseline?{total:baseline.total,capturedAt:baseline.capturedAt}:null,
    note:baseline?"Cloudflare actual baseline plus Jason Home usage after that reading.":"Jason Home estimate from this app's Cloudflare AI calls; Cloudflare account usage is authoritative."};
}
async function cloudflareAiRun(model,input,{timeout=45000}={}){
  const account=cloudflareAiAccount(),token=cloudflareAiToken();
  if(!account||!token)throw fail(409,"Free AI is not connected yet. Add your Cloudflare Account ID and Workers AI API token.");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const response=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(account)+"/ai/run/"+model,{
      method:"POST",signal:controller.signal,headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify(input)
    });
    const type=String(response.headers.get("content-type")||"");
    if(type.includes("audio/"))return {ok:response.ok,status:response.status,audio:Buffer.from(await response.arrayBuffer()),type};
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload?.success===false){
      const msg=payload?.errors?.[0]?.message||payload?.error?.message||"Cloudflare Workers AI request failed";
      if(response.status===429&&/10,?000|daily free allocation|neurons/i.test(msg))markAiUsageExhausted();
      throw fail(response.status||502,msg);
    }
    return payload;
  }catch(e){
    if(e?.name==="AbortError")throw fail(504,"Cloudflare Workers AI request timed out");
    throw e;
  }finally{clearTimeout(timer);}
}
async function cloudflareAiChat(body,{timeout=60000}={}){
  const account=cloudflareAiAccount(),token=cloudflareAiToken();
  if(!account||!token)throw fail(409,"Free AI is not connected yet. Add your Cloudflare Account ID and Workers AI API token.");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const response=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(account)+"/ai/v1/chat/completions",{
      method:"POST",signal:controller.signal,
      headers:{authorization:"Bearer "+token,"content-type":"application/json"},
      body:JSON.stringify(body)
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){
      const msg=payload?.error?.message||payload?.errors?.[0]?.message||"Cloudflare Workers AI chat request failed";
      if(response.status===429&&/10,?000|daily free allocation|neurons/i.test(msg))markAiUsageExhausted();
      throw fail(response.status||502,msg);
    }
    recordAiChatUsage(payload);
    return payload;
  }catch(e){
    if(e?.name==="AbortError")throw fail(504,"Cloudflare Workers AI chat request timed out");
    throw e;
  }finally{clearTimeout(timer);}
}
async function verifyCloudflareAi(accountId,token){
  const priorAccount=meta("cf_ai_account_id",""),priorToken=meta("cf_ai_token_cipher",null);
  put("cf_ai_account_id",String(accountId).trim());put("cf_ai_token_cipher",sealAiKey(String(token).trim()));
  try{
    const r=await cloudflareAiChat({
      model:AI_MODEL,
      messages:[{role:"user",content:"Reply with OK only."}],
      max_completion_tokens:64,
      temperature:0
    },{timeout:30000});
    // A successful 2xx response proves the Account ID/token can execute
    // Workers AI. Some reasoning models can legally consume a tiny probe's
    // output budget without placing text in message.content.
    if(!Array.isArray(r?.choices))throw fail(400,"Cloudflare Workers AI connected but returned an unexpected response");
    return true;
  }catch(e){
    put("cf_ai_account_id",priorAccount);put("cf_ai_token_cipher",priorToken);
    throw e;
  }
}
async function verifyAiKey(key){
  const r=await fetch("https://api.openai.com/v1/models",{headers:{authorization:"Bearer "+key,accept:"application/json"}});
  if(!r.ok){const p=await r.json().catch(()=>({}));throw fail(400,p?.error?.message||"OpenAI API key could not be verified");}
  return true;
}
const AI_SCHEMA={
  type:"object",additionalProperties:false,required:["reply","draft"],properties:{
    reply:{type:"string"},
    draft:{anyOf:[
      {type:"null"},
      {type:"object",additionalProperties:false,required:["name","target_event","date","brightness","colors","layers"],properties:{
        name:{type:"string"},target_event:{type:"string"},date:{type:"string"},brightness:{type:"integer"},
        colors:{type:"array",items:{type:"string"}},
        layers:{type:"array",items:{type:"object",additionalProperties:false,required:["effect","speed","minutes","shift","blocks","offset","mirror"],properties:{
          effect:{type:"string",enum:AI_EFFECTS},speed:{type:"integer"},minutes:{type:"integer"},shift:{type:"integer"},
          blocks:{type:"array",items:{type:"integer"}},offset:{type:"integer"},mirror:{type:"boolean"}
        }}}
      }}
    ]}
  }
};
function sanitizeAiDraft(raw){
  if(!raw||typeof raw!=="object")return null;
  const colors=(Array.isArray(raw.colors)?raw.colors:[]).map(hex).filter(x=>/^#[0-9A-F]{6}$/.test(x)).slice(0,8);
  const rawLayers=(Array.isArray(raw.layers)?raw.layers:[]).slice(0,8).map(p=>creativePhase(
    AI_EFFECTS.includes(String(p?.effect))?String(p.effect):"Flow1",
    clamp(p?.speed??2,1,5),clamp(p?.minutes??6,2,30),Math.max(0,Math.min(7,Math.trunc(Number(p?.shift)||0))),
    normalizePattern({blocks:p?.blocks,offset:p?.offset,mirror:p?.mirror},Math.max(1,colors.length))
  ));
  const layers=patterned({id:"ai-"+String(raw.name||"draft"),name:String(raw.name||"AI Light Show"),colors},rawLayers);
  if(!colors.length||!layers.length)return null;
  return {name:String(raw.name||"AI Light Show").trim().slice(0,80)||"AI Light Show",target_event:String(raw.target_event||"").trim().slice(0,100),
    date:String(raw.date||"").trim().slice(0,10),brightness:clamp(raw.brightness??100,1,100),colors,layers};
}
function aiOutputText(payload){
  if(typeof payload?.output_text==="string")return payload.output_text;
  for(const item of payload?.output||[])for(const part of item?.content||[])if(part?.type==="output_text"&&typeof part.text==="string")return part.text;
  return "";
}
function cloudflareAiText(payload){
  const result=payload?.result??payload;
  const value=result?.response??result?.choices?.[0]?.message?.content??payload?.choices?.[0]?.message?.content??"";
  return typeof value==="string"?value:JSON.stringify(value||{});
}
async function callLightingAi(message){
  if(!cloudflareAiConfigured())throw fail(409,"Free AI is not connected yet. Add your Cloudflare Account ID and Workers AI API token in the AI tab.");
  const thread=meta("ai_thread",[]).slice(-24),prior=meta("ai_draft",null);
  const today=localDay(new Date()),instructions=AI_SYSTEM+"\nToday is "+[today.year,String(today.month).padStart(2,"0"),String(today.day).padStart(2,"0")].join("-")+
    ". Scheduled AI layers must use speeds 1-5. If the user refers to the current draft, revise it rather than starting over."+(prior?"\nExisting draft: "+JSON.stringify(prior):"");
  const messages=[{role:"system",content:instructions},...thread.map(m=>({role:m.role,content:m.text+(m.role==="assistant"&&m.draft?"\nCurrent draft: "+JSON.stringify(m.draft):"")})),{role:"user",content:String(message)}];
  const payload=await cloudflareAiChat({
    model:AI_MODEL,messages,max_completion_tokens:1800,temperature:.55,
    response_format:{type:"json_schema",json_schema:AI_SCHEMA}
  },{timeout:60000});
  const content=payload?.choices?.[0]?.message?.content;
  let parsed;try{parsed=typeof content==="string"?JSON.parse(content):content;}catch{throw fail(502,"Free AI returned an unreadable lighting design");}
  if(!parsed||typeof parsed!=="object")throw fail(502,"Free AI returned an empty lighting design");
  const draft=sanitizeAiDraft(parsed.draft),reply=String(parsed.reply||"").trim()||"I have a lighting idea ready.";
  const updated=[...thread,{role:"user",text:String(message).slice(0,2000)},{role:"assistant",text:reply,draft}].slice(-30);
  put("ai_thread",updated);if(draft)put("ai_draft",draft);
  return {reply,draft:draft||meta("ai_draft",null),thread:updated};
}
async function transcribeAiVoice(audioBase64,mime,durationSeconds=0){
  if(!cloudflareAiConfigured())throw fail(409,"Free AI is not connected yet.");
  const raw=String(audioBase64||"");if(!raw)throw fail(400,"No voice audio was received");
  let bytes;try{bytes=Buffer.from(raw,"base64");}catch{throw fail(400,"Voice audio could not be decoded");}
  if(bytes.length<800)throw fail(400,"Voice recording was too short");
  if(bytes.length>5_000_000)throw fail(413,"Voice recording is too large");
  const payload=await cloudflareAiRun(AI_ASR_MODEL,{audio:raw,task:"transcribe",language:"en",vad_filter:true},{timeout:60000});
  const text=String(payload?.result?.text??payload?.text??"").trim();
  if(!text)throw fail(400,"I did not hear any speech in that turn");
  const measured=Math.max(0,Number(durationSeconds)||0)/60,words=text.split(/\s+/).filter(Boolean).length;
  addAiUsage({asrMinutes:measured||Math.max(.02,words/130)});
  return text;
}
async function synthesizeAiVoice(text){
  if(!cloudflareAiConfigured())throw fail(409,"Free AI is not connected yet.");
  const spoken=String(text||"").slice(0,4096),payload=await cloudflareAiRun(AI_TTS_MODEL,{prompt:spoken,lang:"en"},{timeout:60000});
  const words=spoken.trim()?spoken.trim().split(/\s+/).length:0,ttsMinutes=Math.max(.02,words/160);
  if(payload?.audio&&Buffer.isBuffer(payload.audio)){addAiUsage({ttsMinutes});return payload.audio.toString("base64");}
  const audio=payload?.result?.audio??payload?.audio??"";
  if(typeof audio==="string"&&audio){addAiUsage({ttsMinutes});return audio;}
  throw fail(502,"Free AI voice generation did not return audio");
}

function normalizeEventName(v){return String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");}
function dateKey(y,m,d){return y*10000+m*100+d;}
function resolveAiTarget(draft,cfg){
  const today=localDay(new Date()),wanted=normalizeEventName(draft?.target_event),builtins=(cfg.events||[]).filter(e=>!e.aiOneTime&&e.id!=="master");
  let source=wanted?builtins.find(e=>normalizeEventName(e.name)===wanted):null;
  if(!source&&wanted)source=builtins.find(e=>normalizeEventName(e.name).includes(wanted)||wanted.includes(normalizeEventName(e.name)));
  if(/^\d{4}-\d{2}-\d{2}$/.test(String(draft?.date||""))){
    const [year,month,day]=draft.date.split("-").map(Number);if(dateKey(year,month,day)>=dateKey(today.year,today.month,today.day))return {year,month,day,source};
  }
  if(source){
    for(let year=today.year;year<=today.year+3;year++){
      const d=eventDate(source,year,cfg.special||[]);if(!d)continue;
      const y=d.getUTCFullYear(),m=d.getUTCMonth()+1,day=d.getUTCDate();
      if(dateKey(y,m,day)>=dateKey(today.year,today.month,today.day))return {year:y,month:m,day,source};
    }
  }
  // "Apply one time" must always have a usable night. If the AI build did not
  // name a date or a recognizable scheduled event, treat it as tonight.
  return {year:today.year,month:today.month,day:today.day,source:null,defaultedToTonight:true};
}
function decorateAiDraft(draft,cfg){
  if(!draft)return null;const target=resolveAiTarget(draft,cfg);
  return {...draft,resolvedDate:target.year?[target.year,String(target.month).padStart(2,"0"),String(target.day).padStart(2,"0")].join("-"):"",replaceEventId:target.source?.id||"",replaceEventName:target.source?.name||"",defaultedToTonight:target.defaultedToTonight===true};
}
async function aiState(){
  const cfg=await config(),draft=decorateAiDraft(meta("ai_draft",null),cfg);
  const applied=(cfg.events||[]).filter(e=>e.aiOneTime===true).map(e=>{
    const sp=(cfg.special||[]).find(x=>x.id===e.id),layers=Array.isArray(e.creativePhases)&&e.creativePhases.length?e.creativePhases:creativeProgram(e);
    return {id:e.id,name:e.name,date:sp?[sp.year,String(sp.month).padStart(2,"0"),String(sp.day).padStart(2,"0")].join("-"):"",replaceEventId:e.aiReplaceEventId||"",brightness:Number(e.brightness)||100,
      colors:rgb(e.colors),effect:e.effect||layers[0]?.effect||"Static",speed:Number(e.speed||layers[0]?.speed)||1,layers,layerCount:layers.length||1,expiresAt:e.expiresAt||"",aiOneTime:true};
  });
  return {ok:true,configured:cloudflareAiConfigured(),provider:"Cloudflare Workers AI",freeTier:true,model:AI_MODEL,accountId:cloudflareAiConfigured()?cloudflareAiAccount():"",usage:aiUsageState(),thread:meta("ai_thread",[]),draft,applied};
}

const send=(res,status,value,headers={})=>{const body=JSON.stringify(value);res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","content-length":Buffer.byteLength(body),...headers});res.end(body);};
const fail=(status,message)=>Object.assign(new Error(message),{status});
const secureEqual=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);};
const isSession=req=>{
  const raw=(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("jh2="))?.slice(4)||"";
  const [expires,sig]=raw.split(".");
  if(!/^\d{10,14}$/.test(expires||"")||!sig||Date.now()>Number(expires))return false;
  const expected=createHmac("sha256",secret).update(expires).digest("hex");
  return secureEqual(sig,expected);
};
const cookie=()=>{const expires=String(Date.now()+90*86400000),sig=createHmac("sha256",secret).update(expires).digest("hex");return `jh2=${expires}.${sig}; Path=/jason-home-2; Max-Age=7776000; HttpOnly; Secure; SameSite=Strict`;};
async function input(req){
  let text="";
  for await(const chunk of req){text+=chunk;if(text.length>8_000_000)throw fail(413,"Request is too large");}
  if(!text)return {};
  try{return JSON.parse(text);}catch{throw fail(400,"Invalid JSON");}
}
const readCache=new Map();
async function upstream(path,method="GET",value){
  if(method!=="GET")readCache.clear();
  const shared=method==="GET"&&(path==="/api/status"||path==="/api/calendar");
  if(!shared)return fetchUpstream(path,method,value);
  const current=readCache.get(path);
  if(current&&Date.now()<current.until)return current.promise;
  const entry={until:Infinity,promise:fetchUpstream(path,method,value)};
  readCache.set(path,entry);
  entry.promise.then(()=>{entry.until=Date.now()+(path==="/api/status"?60000:10000);},()=>{if(readCache.get(path)===entry)readCache.delete(path);});
  return entry.promise;
}
async function fetchUpstream(path,method,value){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
  try{
    const response=await fetch(new URL(path,upstreamUrl),{
      method,headers:{"authorization":"Bearer "+upstreamToken,"accept":"application/json",...(value===undefined?{}:{"content-type":"application/json"})},
      body:value===undefined?undefined:JSON.stringify(value),signal:controller.signal
    });
    const payload=await response.json().catch(()=>({ok:false,error:"Invalid Oracle response"}));
    if(!response.ok)throw fail(response.status,payload.error||"Oracle request failed");
    return payload;
  }finally{clearTimeout(timer);}
}
const hex=x=>"#"+((typeof x==="string"&&/^#?[0-9a-f]{6}$/i.test(x))?x.replace("#","").toUpperCase():(Number(x)||0).toString(16).padStart(6,"0").slice(-6).toUpperCase());
const rgb=values=>(Array.isArray(values)?values:[]).slice(0,8).map(hex);
const colorInts=values=>rgb(values).map(x=>parseInt(x.slice(1),16));
const clamp=(v,low,high)=>Math.min(high,Math.max(low,Number(v)||low));
const minutes=s=>{const m=/^(\d{1,2}):(\d{2})$/.exec(String(s||""));return m?Math.min(1439,Math.max(0,Number(m[1])*60+Number(m[2]))):null;};
const clock=n=>`${String(Math.floor(Number(n||0)/60)).padStart(2,"0")}:${String(Number(n||0)%60).padStart(2,"0")}`;
const targetNames=["All","Pool","House","Garage","Shed"];
let aiPreviewGeneration=0;
const nightLocation={lat:42.1507,lon:-78.9452,tz:"America/New_York"};
const localDay=now=>{const p=new Intl.DateTimeFormat("en-US",{timeZone:nightLocation.tz,year:"numeric",month:"numeric",day:"numeric"}).formatToParts(now);
  const get=type=>Number(p.find(x=>x.type===type)?.value);return {year:get("year"),month:get("month"),day:get("day")};};
const nightEvents=(cfg,day)=>resolveNightEvents(cfg,day,nightLocation.lat,nightLocation.lon,nightLocation.tz).map(e=>{
  const source=cfg.events.find(item=>item.id===e.id)||cfg.customSchedules.find(item=>item.id===e.id);
  return {...e,colors:rgb(e.colors),effect:source?.effect||"Solid / Static",speed:Number(source?.speed||1),
    type:e.id.includes("::factory:")?"Factory event":cfg.customSchedules.some(item=>item.id===e.id)?"Custom event":"Calendar event"};
});
const monthCache=new Map();
function monthSummary(cfg,year,month){
  if(!Number.isInteger(year)||year<2020||year>2100||!Number.isInteger(month)||month<1||month>12)throw fail(400,"Invalid month");
  const key=JSON.stringify([cfg.revision,year,month,cfg.settings,cfg.events,cfg.customSchedules]);
  if(monthCache.has(key))return monthCache.get(key);
  const days=new Date(Date.UTC(year,month,0)).getUTCDate(),entries=[];
  for(let day=1;day<=days;day++)entries.push({day,events:nightEvents(cfg,{year,month,day})});
  const result={year,month,days:entries};monthCache.clear();monthCache.set(key,result);return result;
}
const eventById=new Map(catalog.events.map(e=>[e.id,e]));
const categoryByIndex=new Map(catalog.categories.map(c=>[c.index,c]));
const theme=mode=>mode===0?"1":mode===1?"3.0.28":"3.0.29";
const themeName=t=>t==="1"?"Major U.S. Holidays — Basic Colors":t==="3.0.28"?"Expanded Holidays — Basic Colors":"Expanded Holidays — Expanded Colors";
async function config(){
  const r=await upstream("/api/calendar");if(!r.calendar)throw fail(503,"Oracle calendar is not initialized");
  if(meta("master_removed_v1")!==true){
    if((r.calendar.events||[]).some(e=>e.id==="master")){
      const cleaned=JSON.parse(JSON.stringify(r.calendar));
      cleaned.events=(cleaned.events||[]).filter(e=>e.id!=="master");
      cleaned.special=(cleaned.special||[]).filter(x=>x.id!=="master");
      cleaned.revision=Number(cleaned.revision||0)+1;
      const saved=await upstream("/api/calendar/sync","POST",cleaned);
      if(!saved.ok)throw fail(409,"Master cleanup was rejected");
      r.calendar=cleaned;
    }
    put("master_removed_v1",true);
  }
  if(meta("special_halloween_2026_seeded_v1")!==true){
    const id="ai-once-special-halloween-2026";
    if(!(r.calendar.events||[]).some(e=>e.id===id)){
      const cleaned=JSON.parse(JSON.stringify(r.calendar));
      const halloween=(cleaned.events||[]).find(e=>e.aiOneTime!==true&&String(e.name||"").trim().toLowerCase()==="halloween");
      const layers=[
        {effect:"Flow1",speed:5,minutes:2,shift:0,pattern:{blocks:[4,3,1],offset:0,mirror:false}},
        {effect:"Flow2",speed:5,minutes:2,shift:0,pattern:{blocks:[2,5,1],offset:3,mirror:false}},
        {effect:"Flow1",speed:4,minutes:2,shift:0,pattern:{blocks:[5,2,1],offset:6,mirror:false}},
        {effect:"Flow2",speed:5,minutes:2,shift:0,pattern:{blocks:[3,3,2],offset:2,mirror:false}},
        {effect:"Flow1",speed:5,minutes:2,shift:0,pattern:{blocks:[4,2,2],offset:5,mirror:false}},
        {effect:"Flow2",speed:4,minutes:2,shift:0,pattern:{blocks:[3,4,1],offset:1,mirror:false}},
        {effect:"Flow1",speed:5,minutes:2,shift:0,pattern:{blocks:[2,4,2],offset:7,mirror:false}},
        {effect:"Flow2",speed:5,minutes:2,shift:0,pattern:{blocks:[5,1,2],offset:4,mirror:false}}
      ];
      cleaned.events.push({
        id,name:"Special Halloween",kind:"AI One-Time",rule:"YearTable",month:10,day:31,weekday:0,nth:0,offsetDays:0,durationDays:1,
        effect:"Flow1",speed:5,brightness:100,colors:colorInts(["#FF0D00","#5B00E6","#000000"]),
        enabled:true,favorite:false,categoryIndex:Number(halloween?.categoryIndex||0),major:true,dateRuleSourceId:id,
        creativePhases:layers,aiOneTime:true,expiresAt:"2026-11-01T14:00:00.000Z",aiReplaceEventId:halloween?.id||""
      });
      cleaned.special=(cleaned.special||[]).filter(x=>x.id!==id);
      cleaned.special.push({id,year:2026,month:10,day:31});
      cleaned.revision=Number(cleaned.revision||0)+1;
      const saved=await upstream("/api/calendar/sync","POST",cleaned);
      if(!saved.ok)throw fail(409,"Special Halloween event creation was rejected");
      r.calendar=cleaned;
    }
    put("special_halloween_2026_seeded_v1",true);
  }
  if(meta("test_halloween_2026_seeded_v2")!==true){
    const id="ai-once-test-halloween-2026";
    const cleaned=JSON.parse(JSON.stringify(r.calendar));
    const halloween=(cleaned.events||[]).find(e=>e.aiOneTime!==true&&String(e.name||"").trim().toLowerCase()==="halloween");
    const existing=(cleaned.events||[]).find(e=>e.id===id);
    // Purple is the continuous/base color. Orange occupies one-third of the
    // lamp assignment (20 of 60 lamps) and Twinkle provides the random flash.
    // The second layer shifts the candidate set while keeping the same 2:1 density.
    const layers=[
      {effect:"Twinkle",speed:5,minutes:30,shift:0,pattern:{blocks:[2,1],offset:0,mirror:false}},
      {effect:"Twinkle",speed:5,minutes:30,shift:0,pattern:{blocks:[2,1],offset:1,mirror:false}}
    ];
    const recipe={
      name:"Test Halloween",kind:"AI One-Time",rule:"YearTable",month:10,day:31,weekday:0,nth:0,offsetDays:0,durationDays:1,
      effect:"Twinkle",speed:5,brightness:100,colors:colorInts(["#5B00E6","#FF0D00"]),
      favorite:false,categoryIndex:Number(halloween?.categoryIndex||0),major:true,dateRuleSourceId:id,
      creativePhases:layers,aiOneTime:true,expiresAt:"2026-11-01T14:00:00.000Z",aiReplaceEventId:""
    };
    if(existing)Object.assign(existing,recipe);
    else cleaned.events.push({id,...recipe,enabled:false});
    cleaned.special=(cleaned.special||[]).filter(x=>x.id!==id);
    cleaned.special.push({id,year:2026,month:10,day:31});
    cleaned.revision=Number(cleaned.revision||0)+1;
    const saved=await upstream("/api/calendar/sync","POST",cleaned);
    if(!saved.ok)throw fail(409,"Test Halloween event update was rejected");
    r.calendar=cleaned;
    put("test_halloween_2026_seeded_v2",true);
  }
  if(meta("initialized")!==true){
    const schedules=(r.calendar.customSchedules||[]).map(x=>({...x,colors:rgb(x.colors)}));
    const presets=[...new Map(schedules.filter(x=>x.presetId).map(x=>[x.presetId,
      {id:x.presetId,name:x.name,effect:x.effect,speed:x.speed,brightness:x.brightness,colors:x.colors,enabled:x.enabled!==false,favorite:false}])).values()];
    put("custom_schedules",schedules);put("presets",presets);
    const mode=Number(r.calendar.settings.mode||0),overrides={};
    for(const e of r.calendar.events){
      const original=eventById.get(e.id);if(!original)continue;
      const p=original.profiles,o={};
      if(e.effect!==(mode===2?p.expandedEffect:original.effect))o.effect=e.effect;
      if(e.speed!==(mode===2?p.expandedSpeed:original.speed))o.speed=e.speed;
      if(JSON.stringify(e.colors)!==JSON.stringify(mode===0?p.major:mode===1?p.basic:p.expanded))o.colors=e.colors;
      if(e.enabled===false)o.enabled=false;
      if(e.favorite)o.favorite=true;
      if(Array.isArray(e.creativePhases)&&e.creativePhases.length)o.creativePhases=creativeProgram(e);
      if(e.scheduleOverride)o.scheduleOverride=e.scheduleOverride;
      if(Object.keys(o).length)overrides[e.id]=o;
    }
    put("event_overrides",overrides);put("initialized",true);
  }
  return r.calendar;
}
async function mutateCalendar(change){
  // Always start from the newest Oracle revision; stale edits must fail instead of overwriting an intervening update.
  const cfg=await config();
  change(cfg);
  const result=await upstream("/api/calendar/sync","POST",{...cfg,revision:Number(cfg.revision||0)+1});
  if(!result.ok)throw fail(409,"Calendar update was rejected");
  return cfg;
}

async function effectiveNightConfig(){
  const cfg=await config(),out=JSON.parse(JSON.stringify(cfg));
  let promotions=[];
  try{promotions=(await upstream("/api/eufy/factory-promotions")).promotions||[];}catch{}
  out.events=(out.events||[]).filter(e=>!String(e.id||"").includes("::factory:"));
  for(const p of promotions){
    const event=p?.event||{},scene=p?.scene||{},lightId=Number(p?.lightId);
    if(!event.id||!Number.isInteger(lightId)||p.enabled===false)continue;
    out.events.push({...event,id:String(event.id)+"::factory:"+lightId,dateRuleSourceId:String(event.id),
      name:String(p.name||event.name||("Factory "+lightId)),effect:String(scene.effect||event.effect||"Static"),
      speed:Number(scene.speed||event.speed||1),colors:Array.isArray(scene.colors)?scene.colors:[...(event.colors||[])],
      enabled:true,favorite:false});
  }
  return out;
}
async function tonightCandidateBundle(){
  const cfg=await effectiveNightConfig(),now=new Date(),night=lightingNightDate(cfg,now,nightLocation.lat,nightLocation.lon,nightLocation.tz);
  const candidates=resolveNightCandidates(cfg,night,nightLocation.lat,nightLocation.lon,nightLocation.tz).map(item=>{
    const source=(cfg.events||[]).find(x=>x.id===item.id)||(cfg.customSchedules||[]).find(x=>x.id===item.id)||{};
    return {id:String(item.id||source.id||""),name:String(item.name||source.name||"Scheduled event"),source};
  });
  return {cfg,now,night,candidates};
}
function daysInMonth(year,month){return new Date(Date.UTC(year,month,0)).getUTCDate();}
function validMonthDay(year,month,day){return Number.isInteger(month)&&month>=1&&month<=12&&Number.isInteger(day)&&day>=1&&day<=daysInMonth(year,month);}
function baseEventDate(e,year,special){
  const utc=(y,m,d)=>new Date(Date.UTC(y,m-1,d));
  let d=null;
  if(e.rule==="Month")return utc(year,e.month,1);
  if(e.rule==="Fixed")d=utc(year,e.month,e.day);
  if(e.rule==="NthWeekday"){
    d=utc(year,e.month,1);
    d.setUTCDate(1+((e.weekday-d.getUTCDay()+7)%7)+(Math.max(1,e.nth)-1)*7);
    if(d.getUTCMonth()+1!==e.month)return null;
  }
  if(e.rule==="LastWeekday"){
    d=utc(year,e.month+1,0);
    d.setUTCDate(d.getUTCDate()-((d.getUTCDay()-e.weekday+7)%7));
  }
  if(e.rule==="MonthEnd")d=utc(year,e.month+1,0);
  if(e.rule==="EasterOffset"){
    const x=year%19,b=Math.floor(year/100),c=year%100,h=(19*x+b-Math.floor(b/4)-Math.floor((b-Math.floor((b+8)/25)+1)/3)+15)%30;
    const l=(32+2*(b%4)+2*Math.floor(c/4)-h-(c%4))%7,m=Math.floor((x+11*h+22*l)/451),n=h+l-7*m+114;
    d=utc(year,Math.floor(n/31),n%31+1);
  }
  if(e.rule==="YearTable"||e.rule==="Hanukkah"){
    const hit=special.find(x=>x.id===(e.dateRuleSourceId||e.id)&&x.year===year);
    if(hit)d=utc(hit.year,hit.month,hit.day);
  }
  if(d&&e.offsetDays)d.setUTCDate(d.getUTCDate()+e.offsetDays);
  return d;
}
function scheduleOverride(e){return e?.scheduleOverride&&typeof e.scheduleOverride==="object"?e.scheduleOverride:null;}
function eventDate(e,year,special){
  const o=scheduleOverride(e);
  if(!o||o.mode==="default")return baseEventDate(e,year,special);
  if(o.annual===false&&Number(o.year)!==year)return null;
  const y=o.annual===false?Number(o.year):year,month=Number(o.startMonth),day=o.mode==="month"?1:Number(o.startDay);
  return validMonthDay(y,month,day)?new Date(Date.UTC(y,month-1,day)):null;
}
function eventDurationDays(e,year){
  const o=scheduleOverride(e);
  if(!o||o.mode==="default")return Math.max(1,Number(e.durationDays)||1);
  if(o.mode==="date")return 1;
  if(o.mode==="month")return daysInMonth(year,Number(o.startMonth));
  const sm=Number(o.startMonth),sd=Number(o.startDay),em=Number(o.endMonth),ed=Number(o.endDay);
  if(!validMonthDay(year,sm,sd))return 1;
  let endYear=year;if(em<sm||(em===sm&&ed<sd))endYear++;
  if(!validMonthDay(endYear,em,ed))return 1;
  return Math.max(1,Math.round((Date.UTC(endYear,em-1,ed)-Date.UTC(year,sm-1,sd))/86400000)+1);
}
function eventActiveOnDisplay(e,year,month,day,special){
  const o=scheduleOverride(e);
  if(o?.mode==="month"){
    if(o.annual===false&&Number(o.year)!==year)return false;
    return Number(o.startMonth)===month;
  }
  const target=Date.UTC(year,month-1,day);
  for(let y=year-1;y<=year;y++){
    const start=eventDate(e,y,special);if(!start)continue;
    const startMs=Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),start.getUTCDate());
    const endMs=startMs+(eventDurationDays(e,start.getUTCFullYear())-1)*86400000;
    if(target>=startMs&&target<=endMs)return true;
  }
  return false;
}
function eventOccursInMonth(e,year,month,special){
  for(let day=1;day<=daysInMonth(year,month);day++)if(eventActiveOnDisplay(e,year,month,day,special))return true;
  return false;
}
function scheduleClock(n){
  n=((Number(n)||0)%1440+1440)%1440;const h=Math.floor(n/60),m=n%60,ampm=h>=12?"PM":"AM";
  return (h%12||12)+":"+String(m).padStart(2,"0")+" "+ampm;
}
function baseWhen(e,year,special){
  if(e.rule==="Month"){
    const d=baseEventDate(e,year,special);return d?new Intl.DateTimeFormat("en-US",{month:"long",timeZone:"UTC"}).format(d)+" — all month":"No scheduled date in "+year;
  }
  const d=baseEventDate(e,year,special);
  if(!d)return "No scheduled date in "+year;
  const format=x=>new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",timeZone:"UTC"}).format(x);
  if(Number(e.durationDays||1)>1){const end=new Date(d);end.setUTCDate(end.getUTCDate()+Number(e.durationDays)-1);return format(d)+" – "+format(end);}
  return format(d);
}
function when(e,year,special){
  const o=scheduleOverride(e);let label;
  if(!o||o.mode==="default")label=baseWhen(e,year,special);
  else{
    const months=["","January","February","March","April","May","June","July","August","September","October","November","December"];
    const annual=o.annual!==false;
    if(!annual&&Number(o.year)!==year)return "No scheduled date in "+year;
    if(o.mode==="month")label=months[Number(o.startMonth)]+" — all month"+(annual?" • every year":" • "+o.year);
    else if(o.mode==="date")label=months[Number(o.startMonth)]+" "+Number(o.startDay)+(annual?" • every year":" • "+o.year);
    else label=months[Number(o.startMonth)]+" "+Number(o.startDay)+" – "+months[Number(o.endMonth)]+" "+Number(o.endDay)+(annual?" • every year":" • "+o.year);
  }
  if(o?.customTime)label+=" • "+scheduleClock(o.start)+"–"+scheduleClock(o.end);
  return label;
}
function scheduleView(e,original,year,special){
  const o=scheduleOverride(e),builtIn=baseWhen(original||e,year,catalog.special||special||[]);
  const base=baseEventDate(original||e,year,catalog.special||special||[]);
  const startMonth=Number(o?.startMonth)||(base?base.getUTCMonth()+1:1),startDay=Number(o?.startDay)||(base?base.getUTCDate():1);
  return {
    customized:!!o,
    mode:o?.mode||"default",
    annual:o?.annual!==false,
    year:Number(o?.year)||year,
    startMonth,startDay,
    endMonth:Number(o?.endMonth)||startMonth,
    endDay:Number(o?.endDay)||startDay,
    customTime:!!o?.customTime,
    start:clock(o?.start??0),
    end:clock(o?.end??0),
    builtIn
  };
}
function displayEvents(cfg,url){
  const year=Number(url.searchParams.get("year"))||new Date().getFullYear(),month=Number(url.searchParams.get("month"))||0;
  const search=(url.searchParams.get("q")||"").toLowerCase().trim(),mode=Number(cfg.settings.mode||0),mask=Number(cfg.settings.categoryMask??32767);
  let rows=[];
  for(const e of cfg.events){
    if(mode===0&&!e.major)continue;
    if((mask&(1<<e.categoryIndex))===0)continue;
    if(month&&!eventOccursInMonth(e,year,month,cfg.special||[]))continue;
    const category=categoryByIndex.get(e.categoryIndex)||catalog.categories[0],label=when(e,year,cfg.special||[]);
    if(search&&!(e.name+" "+label+" "+e.kind+" "+category.name).toLowerCase().includes(search))continue;
    const original=eventById.get(e.id),defaults=original?.profiles;
    const nativeFactoryEffect=String(e.factoryEffectName||"").trim(),layers=nativeFactoryEffect?[]:creativeProgram(e),layersCustomized=Array.isArray(e.creativePhases)&&e.creativePhases.length>0,scheduleCustomized=!!scheduleOverride(e);
    rows.push({id:e.id,name:e.name,kind:e.kind,categoryId:category.id,categoryName:category.name,categoryColor:category.color,
      when:label,effect:nativeFactoryEffect||e.effect,speed:e.speed,colors:rgb(e.colors),layerCount:nativeFactoryEffect?1:layers.length,layers,layersCustomized,nativeFactoryEffect:nativeFactoryEffect||null,enabled:e.enabled!==false,favorite:!!e.favorite,
      schedule:scheduleView(e,original,year,cfg.special||[]),
      customized:scheduleCustomized||layersCustomized||!!defaults&&(e.effect!==(mode===2?defaults.expandedEffect:original.effect)||e.speed!==(mode===2?defaults.expandedSpeed:original.speed)
       ||JSON.stringify(e.colors)!==JSON.stringify(mode===0?defaults.major:mode===1?defaults.basic:defaults.expanded))});
    if(!month&&rows.length>=96)break;
  }
  return {events:rows,truncated:!month&&rows.length>=96,overlap:"Universal overlap rules apply whenever two or more scheduled items share the same night."};
}
async function state(){
  const [s,cfg]=await Promise.all([upstream("/api/status"),config()]);
  const a=cfg.settings,first=s.override?.scene||s.calendar?.current?.scene||(()=>{try{return JSON.parse(s.desired?.[0]?.scene||"null");}catch{return null;}})();
  const selected=meta("target",0),names=["Pool","House","Garage","Shed"],ready=new Set(s.eufy?.readyNames||[]);
  const scene=first||{power:false,brightness:75,effect:"Solid / Static",colors:[0xffffff],speed:3};
  const scheduled=s.calendar?.current||null;
  const overrideEventId=String(meta("running_event_id","")||"");
  const runningNow=s.override?.active
    ? {id:overrideEventId||"manual-override",name:String(meta("running_name","Manual override")||"Manual override"),effect:scene.factoryEffectName||scene.effect||"Solid / Static",brightness:Number(scene.brightness)||75,phase:overrideEventId?"Tonight override":"Manual override",schedule2:false}
    : scheduled
      ? {id:scheduled.id||"",name:scheduled.name||"Scheduled scene",effect:scheduled.scene?.factoryEffectName||scheduled.scene?.effect||scene.factoryEffectName||scene.effect||"Solid / Static",
          brightness:Number(scheduled.scene?.brightness??scene.brightness)||75,
          phase:String(scheduled.id||"").startsWith("white-override")?"White override":scheduled.schedule2?"Schedule 2":"Schedule 1",schedule2:!!scheduled.schedule2}
      : {id:"",name:"No scheduled scene running",effect:scene.factoryEffectName||scene.effect||"Solid / Static",brightness:Number(scene.brightness)||75,phase:"Idle",schedule2:false};
  const nextChange=s.nextEvent?{name:s.nextEvent.name||"Next change",at:s.nextEvent.at||null,phase:s.nextEvent.phase||"",source:s.nextEvent.source||""}:null;
  const today=localDay(new Date()),night=lightingNightDate(cfg,new Date(),nightLocation.lat,nightLocation.lon,nightLocation.tz);
  const tonight=nightEvents(cfg,night),single=tonight.length===1?tonight[0]:null,id=single?.id||"";
  const scheduledEvent={name:tonight.length?tonight.map(e=>e.name).join("\n"):"Nothing scheduled for tonight",id,
    events:tonight,night,enabled:a.enabled!==false,toggleable:!!single,upcoming:false,type:id.includes("::factory:")?"factoryPromotion":id.startsWith("schedule-")?"customSchedule":id?"builtin":"none",
    custom:id.startsWith("schedule-"),factoryLightId:id.includes("::factory:")?Number(id.split("::factory:")[1]):undefined};
  return {firmwareVersion:"Jason Home 2 • Oracle Web",power:!!scene.power,brightness:scene.brightness,speed:scene.speed,
    running:{name:runningNow.name,effect:scene.factoryEffectName||scene.effect,colors:rgb(scene.colors)},runningNow,nextChange,
    resolverAuthority:{oracleBuild:s.build?.sha||"",resolverBuild:resolverSha,inSync:!!resolverSha&&resolverSha===s.build?.sha},
    settings:{on:clock(a.on),off:clock(a.off),lead:a.lead,trail:a.trail,overlap:Number(a.overlap)||0,
      tz:"America/New_York",scheduler:a.enabled,scheduler2:a.schedule2Enabled,
      whiteOverride1:a.whiteOverride1Enabled!==false,whiteOverride2:a.whiteOverride2Enabled!==false,schedule1StartAtDusk:a.startAtDusk,
      schedule2End:clock(a.schedule2End),schedule2EndAtDawn:a.schedule2EndAtDawn,schedule2Brightness:a.schedule2Brightness,
      dawn:s.astronomy?.dawn||"",dusk:s.astronomy?.dusk||""},
    scheduleWindow:`Schedule 1 ${a.startAtDusk?"dusk ("+(s.astronomy?.dusk||"")+")":clock(a.on)} - ${clock(a.off)} • Schedule 2 ${clock(a.off)} - ${a.schedule2EndAtDawn?"dawn ("+(s.astronomy?.dawn||"")+")":clock(a.schedule2End)} at ${a.schedule2Brightness}% • White 1 ${a.whiteOverride1Enabled===false?"OFF":"9:00–10:00 PM"} • White 2 ${a.whiteOverride2Enabled===false?"OFF":"6:00 AM–dawn/7:30 AM"}`,
    nextEvent:s.nextEvent?.name||"No upcoming event",scheduledEvent,localToday:today,manualOverride:!!s.override?.active,stateAuthority:"oracle",
    ble:{ready:!!s.eufy?.ready,busy:false,connected:!!s.eufy?.ready,connectedCount:ready.size,knownCount:4,seenCount:ready.size,
      name:"Saved Eufy lights",address:"",protocol:"Oracle + Eufy MQTT",connectionMode:"Oracle / Internet",target:selected,
      controllers:names.map((name,slot)=>({slot,name,model:slot<2?"E120":"E22",protocol:"Oracle",seen:ready.has(name),connected:ready.has(name),saved:true})),
      status:s.eufy?.status||"Oracle unavailable",transportStatus:"Oracle Linux → Eufy MQTT"}};
}
function authenticatedRead(req,res,path){
  const name=path==="/"?"anderson_home.html":path.slice(1);
  const allowed=new Set(["anderson_home.html","v3_mockup.css","v3_mockup.js","night_calendar.js","event_categories.css","event_categories.js","android_eufy_ui.css","android_eufy_ui.js"]);
  if(!allowed.has(name))return send(res,404,{ok:false,error:"Not found"});
  const file=join(root,name);
  if(!existsSync(file))return send(res,404,{ok:false,error:"Missing web asset"});
  const type=extname(file)===".js"?"text/javascript":extname(file)===".css"?"text/css":"text/html";
  const data=readFileSync(file);res.writeHead(200,{"content-type":type+"; charset=utf-8","content-length":data.length,
    "cache-control":"no-store","content-security-policy":"default-src 'self' 'unsafe-inline' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    "x-content-type-options":"nosniff"});res.end(data);
}
const loginPage=`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jason Home 2</title>
<style>body{background:#06111d;color:#eef6ff;font:16px system-ui;margin:0;display:grid;min-height:100vh;place-items:center}main{width:min(90vw,420px);padding:28px;background:#172436;border:1px solid #38506a;border-radius:20px}input,button{box-sizing:border-box;width:100%;padding:14px;margin-top:14px;border-radius:10px;font:inherit}input{background:#fff;border:0}button{color:#051221;background:#50b7ff;border:0;font-weight:700}small{color:#aec7da}#error{color:#ffc5c5}</style>
<main><h1>Jason Home 2</h1><p>Connect this app to your Oracle lighting controller once.</p><form id="login"><label for="token">Oracle API key</label><input id="token" type="password" autocomplete="off" required><button>Connect</button></form><p id="error"></p><small>Your key is checked by Oracle and is never stored in this page or APK.</small></main>
<script>document.getElementById("login").addEventListener("submit",async e=>{e.preventDefault();const token=document.getElementById("token").value;const r=await fetch("/jason-home-2/api/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token})});if(r.ok){document.getElementById("token").value="";location.replace("/jason-home-2/");}else document.getElementById("error").textContent="Could not connect. Check the Oracle API key.";});</script></html>`;
async function route(req,res){
  const url=new URL(req.url||"/","http://127.0.0.1"),path=url.pathname,method=req.method||"GET";
  if(path==="/api/health")return send(res,200,{ok:true,service:"jason-home-2-web",upstream:upstreamUrl,build:process.env.JH2_BUILD_SHA||"local"});
  if(path==="/api/session"&&method==="POST"){
    const value=await input(req),candidate=String(value.token||"");
    if(!candidate||!secureEqual(candidate,upstreamToken))throw fail(401,"Invalid Oracle API key");
    await upstream("/api/status");
    return send(res,200,{ok:true},{"set-cookie":cookie()});
  }
  if(!isSession(req)){
    if(method==="GET"&&!path.startsWith("/api/")){const body=Buffer.from(loginPage);res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-length":body.length});return res.end(body);}
    throw fail(401,"Connect Jason Home 2 to Oracle");
  }
  if(method!=="GET"){
    const origin=req.headers.origin;
    if(origin&&new URL(origin).host!==req.headers.host)throw fail(403,"Invalid request origin");
    if(req.headers["sec-fetch-site"]==="cross-site")throw fail(403,"Cross-site request blocked");
  }
  if(!path.startsWith("/api/"))return authenticatedRead(req,res,path);
  if(method==="GET"&&path==="/api/state")return send(res,200,await state());
  if(method==="GET"&&path==="/api/night-calendar"){
    const today=localDay(new Date()),year=Number(url.searchParams.get("year")||today.year),month=Number(url.searchParams.get("month")||today.month);
    return send(res,200,monthSummary(await config(),year,month));
  }
  if(method==="GET"&&path==="/api/tonight-options"){
    const {cfg,now,night,candidates}=await tonightCandidateBundle();
    const options=candidates.map(({id,name,source})=>{
      const scene=resolveNightCandidateScene(cfg,night,id,now,nightLocation.lat,nightLocation.lon,nightLocation.tz);
      return {id,name,type:id.includes("::factory:")?"Factory event":(cfg.customSchedules||[]).some(x=>x.id===id)?"Custom event":"Calendar event",
        effect:String(scene?.factoryEffectName||scene?.effect||source.factoryEffectName||source.effect||"Static"),speed:Number(scene?.speed||source.speed||1),
        colors:rgb(source.colors||scene?.colors||[]),scene:scene?{...scene,colors:rgb(scene.colors)}:null};
    }).filter(x=>x.scene);
    return send(res,200,{ok:true,night,options});
  }
  if(method==="POST"&&path==="/api/tonight-options"){
    const body=await input(req),wanted=String(body?.id||""),bundle=await tonightCandidateBundle();
    const chosen=bundle.candidates.find(x=>x.id===wanted);
    if(!chosen)throw fail(409,"That event is not an eligible option for this lighting night");
    const scene=resolveNightCandidateScene(bundle.cfg,bundle.night,wanted,bundle.now,nightLocation.lat,nightLocation.lon,nightLocation.tz);
    if(!scene)throw fail(409,"The selected event cannot run in the current lighting window");
    put("running_name",chosen.name);
    put("running_event_id",wanted);
    const accepted=await upstream("/api/control","POST",{...scene,name:chosen.name,target:"All"});
    return send(res,accepted?.queued?202:200,{ok:true,selected:{id:wanted,name:chosen.name,scene:{...scene,colors:rgb(scene.colors)}},temporary:true,...accepted});
  }
  if(method==="GET"&&path==="/api/cloud/config")return send(res,200,{ok:true,endpoint:"https://150.136.245.51",mode:"cloud",configured:true,automationOwner:"oracle",directReady:false,directStatus:"Jason Home 2 web controller"});
  if(method==="POST"&&path==="/api/cloud/config")return send(res,200,{ok:true,endpoint:"https://150.136.245.51",mode:"cloud",configured:true,automationOwner:"oracle"});
  if(method==="GET"&&path==="/api/cloud/test")return send(res,200,await upstream("/api/status?refresh=1"));
  if(method==="GET"&&path==="/api/cloud/health")return send(res,200,await upstream("/api/health"));
  if(method==="POST"&&path==="/api/control"){
    const body=await input(req),target=targetNames[meta("target",0)]||"All";
    if(body.colors)body.colors=colorInts(body.colors);
    put("running_event_id","");
    if(body.name)put("running_name",String(body.name).slice(0,100));
    const accepted=await upstream("/api/control","POST",{...body,target});
    // The browser already applies manual changes optimistically. Do not block
    // the button press on a second full Oracle status/calendar calculation.
    return send(res,accepted?.queued?202:200,{ok:true,...accepted,target});
  }
  if(method==="GET"&&path==="/api/ai")return send(res,200,await aiState());
  if(method==="POST"&&path==="/api/ai/key"){
    const body=await input(req);
    if(body?.remove){
      put("cf_ai_account_id","");put("cf_ai_token_cipher",null);put("ai_api_key_cipher",null);
      return send(res,200,{ok:true,configured:false,provider:"Cloudflare Workers AI",model:AI_MODEL});
    }
    const accountId=String(body?.accountId||"").trim(),token=String(body?.token||body?.key||"").trim();
    if(!/^[A-Za-z0-9_-]{8,64}$/.test(accountId))throw fail(400,"Enter the Cloudflare Account ID from Workers AI");
    if(token.length<20)throw fail(400,"Enter a Cloudflare Workers AI API token");
    await verifyCloudflareAi(accountId,token);
    // Do not retain the old paid OpenAI credential once the free provider is active.
    put("ai_api_key_cipher",null);
    return send(res,200,{ok:true,configured:true,provider:"Cloudflare Workers AI",freeTier:true,model:AI_MODEL});
  }
  if(method==="POST"&&path==="/api/ai/chat"){
    const body=await input(req),message=String(body?.message||"").trim();
    if(!message)throw fail(400,"Tell the AI what you want the lights to do");
    const result=await callLightingAi(message);
    const cfg=await config();
    return send(res,200,{ok:true,reply:result.reply,thread:result.thread,draft:decorateAiDraft(result.draft,cfg),state:await aiState()});
  }
  if(method==="POST"&&path==="/api/ai/voice-turn"){
    const body=await input(req),transcript=await transcribeAiVoice(body?.audio,body?.mime,body?.durationSeconds);
    const result=await callLightingAi(transcript),cfg=await config(),draft=decorateAiDraft(result.draft,cfg);
    let speech="";try{speech=await synthesizeAiVoice(result.reply);}catch(e){console.error("[AI voice speech]",e?.message||e);}
    return send(res,200,{ok:true,transcript,reply:result.reply,draft,state:await aiState(),audioBase64:speech,audioMime:"audio/mpeg"});
  }
  if(method==="POST"&&path==="/api/ai/reset"){
    aiPreviewGeneration++;put("ai_thread",[]);put("ai_draft",null);
    try{await upstream("/api/resume","POST",{});}catch(e){console.error("[AI reset resume]",e?.message||e);}
    return send(res,200,await aiState());
  }
  if(method==="POST"&&path==="/api/ai/preview"){
    const draft=meta("ai_draft",null);if(!draft)throw fail(409,"There is no AI draft to preview");
    const token=++aiPreviewGeneration,colors=rgb(draft.colors),layers=draft.layers||[];
    void (async()=>{
      for(let i=0;i<layers.length;i++){
        if(token!==aiPreviewGeneration)return;
        const p=layers[i],shift=Math.max(0,Math.min(Math.max(0,colors.length-1),Math.trunc(Number(p.shift)||0))),palette=[...colors.slice(shift),...colors.slice(0,shift)];
        await upstream("/api/control","POST",{name:"AI Preview • "+draft.name+" • Layer "+(i+1),target:"All",power:true,brightness:draft.brightness||100,effect:p.effect,colors:colorInts(palette),speed:p.speed,pattern:p.pattern});
        await new Promise(resolve=>setTimeout(resolve,4000));
      }
    })().catch(()=>{});
    return send(res,202,{ok:true,queued:true,layers:layers.length});
  }
  // Edited AI one-time previews accept the unsaved editor payload.
  if(method==="POST"&&path==="/api/ai/preview-edit"){
    const body=await input(req),colors=rgb(body?.colors);
    if(!colors.length)throw fail(400,"Preview needs at least one color");
    const colorCount=Math.max(1,Math.min(8,colors.length)),rawLayers=Array.isArray(body?.layers)?body.layers.slice(0,8):[];
    if(!rawLayers.length)throw fail(400,"Preview needs at least one lighting layer");
    const layers=rawLayers.map(p=>creativePhase(p?.effect,p?.speed,p?.minutes,p?.shift,normalizePattern(p?.pattern,colorCount)));
    const name=String(body?.name||"Edited AI Event").slice(0,80),brightness=Math.round(clamp(body?.brightness??100,1,100)),token=++aiPreviewGeneration;
    void (async()=>{
      for(let i=0;i<layers.length;i++){
        if(token!==aiPreviewGeneration)return;
        const p=layers[i],shift=Math.max(0,Math.min(Math.max(0,colors.length-1),Math.trunc(Number(p.shift)||0))),palette=[...colors.slice(shift),...colors.slice(0,shift)];
        await upstream("/api/control","POST",{name:"AI Edit Preview • "+name+" • Layer "+(i+1),target:"All",power:true,brightness,effect:p.effect,colors:colorInts(palette),speed:p.speed,pattern:p.pattern});
        await new Promise(resolve=>setTimeout(resolve,4000));
      }
    })().catch(e=>console.error("[AI edit preview]",e?.message||e));
    return send(res,202,{ok:true,queued:true,layers:layers.length});
  }
  if(method==="POST"&&path==="/api/ai/apply-once"){
    const draft=meta("ai_draft",null);if(!draft)throw fail(409,"There is no AI draft to apply");
    const cfgNow=await config(),target=resolveAiTarget(draft,cfgNow);
    if(!target.year)throw fail(409,"I need a specific future date or a recognizable scheduled event before I can apply this once");
    const id="ai-once-"+randomUUID().slice(0,12),first=draft.layers[0],expiresAt=new Date(Date.UTC(target.year,target.month-1,target.day+1,14,0,0)).toISOString();
    const item={id,name:String(draft.name||"AI Light Show"),kind:"AI One-Time",rule:"YearTable",month:target.month,day:target.day,weekday:0,nth:0,offsetDays:0,durationDays:1,
      effect:first.effect,speed:first.speed,brightness:Math.round(clamp(draft.brightness??100,1,100)),colors:colorInts(draft.colors),enabled:true,favorite:false,categoryIndex:Number(target.source?.categoryIndex||0),major:true,
      dateRuleSourceId:id,creativePhases:draft.layers.map(p=>({...p})),aiOneTime:true,expiresAt,aiReplaceEventId:target.source?.id||""};
    await mutateCalendar(cfg=>{cfg.events=(cfg.events||[]).filter(e=>e.id!=="master");cfg.special=(cfg.special||[]).filter(x=>x.id!=="master");cfg.events.push(item);cfg.special.push({id,year:target.year,month:target.month,day:target.day});});
    put("ai_thread",[...meta("ai_thread",[]),{role:"assistant",text:"Applied "+item.name+" one time for "+[target.year,String(target.month).padStart(2,"0"),String(target.day).padStart(2,"0")].join("-")+". It will remove itself after that lighting night."}].slice(-30));
    return send(res,200,{ok:true,id,appliedDate:[target.year,String(target.month).padStart(2,"0"),String(target.day).padStart(2,"0")].join("-"),state:await aiState()});
  }
  if(method==="POST"&&path==="/api/ai/remove"){
    const body=await input(req),id=String(body?.id||"");
    if(!id.startsWith("ai-once-"))throw fail(400,"Unknown AI one-time event");
    await mutateCalendar(cfg=>{cfg.events=(cfg.events||[]).filter(e=>e.id!==id);cfg.special=(cfg.special||[]).filter(x=>x.id!==id);});
    return send(res,200,{ok:true,state:await aiState()});
  }
  if(method==="POST"&&path==="/api/resume"){aiPreviewGeneration++;put("running_event_id","");await upstream("/api/resume","POST",{});return send(res,200,await state());}
  if(method==="POST"&&path==="/api/settings"){
    const body=await input(req);
    await mutateCalendar(cfg=>{
      const s=cfg.settings;
      for(const [field,key] of [["scheduler","enabled"],["scheduler2","schedule2Enabled"],["whiteOverride1","whiteOverride1Enabled"],["whiteOverride2","whiteOverride2Enabled"],["schedule1Dusk","startAtDusk"],["schedule2Dawn","schedule2EndAtDawn"],["lead","lead"],["trail","trail"],["schedule2Brightness","schedule2Brightness"]])
        if(Object.hasOwn(body,field))s[key]=body[field];
      for(const [field,key] of [["on","on"],["off","off"],["schedule2End","schedule2End"]])if(Object.hasOwn(body,field)){const n=minutes(body[field]);if(n===null)throw fail(400,"Invalid schedule time");s[key]=n;}
      if(Object.hasOwn(body,"overlap"))s.overlap={rotate:0,split:1,combine:2}[body.overlap]??0;
    });
    return send(res,200,await state());
  }
  if(method==="GET"&&(path==="/api/events"||path==="/api/events/search"))return send(res,200,displayEvents(await config(),url));
  if(method==="POST"&&path==="/api/event"){
    const body=await input(req);
    await mutateCalendar(cfg=>{
      const e=cfg.events.find(x=>x.id===body.id),original=eventById.get(body.id);
      if(!e)throw fail(404,"Unknown event");
      if(e.aiOneTime===true){
        if(Object.hasOwn(body,"enabled"))e.enabled=!!body.enabled;
        if(Object.hasOwn(body,"favorite"))e.favorite=!!body.favorite;
        if(Object.hasOwn(body,"effect"))e.effect=layerEffect(body.effect);
        if(Object.hasOwn(body,"speed"))e.speed=Math.max(1,Math.min(5,Math.round(Number(body.speed)||1)));
        if(Array.isArray(body.colors)){
          const nextColors=colorInts(body.colors);if(!nextColors.length)throw fail(400,"An AI event must keep at least one color");
          e.colors=nextColors;
        }
        if(Array.isArray(body.layers)){
          if(body.layers.length<1)throw fail(400,"An AI event must keep at least one lighting layer");
          const colorCount=Math.max(1,Math.min(8,(Array.isArray(e.colors)?e.colors.length:0)||1));
          e.creativePhases=body.layers.slice(0,8).map(p=>creativePhase(p?.effect,p?.speed,p?.minutes,p?.shift,normalizePattern(p?.pattern,colorCount)));
          if(e.creativePhases.length){e.effect=e.creativePhases[0].effect;e.speed=e.creativePhases[0].speed;}
        }
        return;
      }
      if(!original)throw fail(404,"Unknown event");
      const overrides=meta("event_overrides",{});overrides[e.id]??={};
      if(body.reset||body.resetAll){
        const mode=Number(cfg.settings.mode||0),p=original.profiles;
        e.effect=mode===2?p.expandedEffect:original.effect;e.speed=mode===2?p.expandedSpeed:original.speed;
        e.colors=mode===0?p.major:mode===1?p.basic:p.expanded;delete e.creativePhases;
        if(original.factoryEffectName)e.factoryEffectName=original.factoryEffectName;else delete e.factoryEffectName;
        const keepSchedule=!body.resetAll&&e.scheduleOverride?e.scheduleOverride:null;
        delete overrides[e.id];
        if(keepSchedule)overrides[e.id]={scheduleOverride:keepSchedule};
      }else{
        if(Object.hasOwn(body,"effect")||Object.hasOwn(body,"layers")||Array.isArray(body.colors))delete e.factoryEffectName;
        for(const key of ["enabled","favorite","effect","speed"])if(Object.hasOwn(body,key)){e[key]=body[key];overrides[e.id][key]=body[key];}
        if(Array.isArray(body.colors)){e.colors=colorInts(body.colors);overrides[e.id].colors=e.colors;}
        if(Array.isArray(body.layers)){
          if(body.layers.length<1)throw fail(400,"An event must have at least one lighting layer");
          const colorCount=Math.max(1,Math.min(8,(Array.isArray(e.colors)?e.colors.length:0)||1));
          const layers=body.layers.slice(0,8).map(p=>creativePhase(p?.effect,p?.speed,p?.minutes,p?.shift,normalizePattern(p?.pattern,colorCount)));
          e.creativePhases=layers;overrides[e.id].creativePhases=layers;
        }
      }
      if(body.resetSchedule||body.resetAll){
        delete e.scheduleOverride;
        if(overrides[e.id])delete overrides[e.id].scheduleOverride;
      }else if(body.schedule&&typeof body.schedule==="object"){
        const sc=body.schedule,mode=["default","date","range","month"].includes(String(sc.mode))?String(sc.mode):"default";
        const annual=sc.annual!==false,year=annual?0:Math.trunc(Number(sc.year)||0);
        if(!annual&&(year<2020||year>2100))throw fail(400,"Choose a valid schedule year");
        let startMonth=Math.trunc(Number(sc.startMonth)||0),startDay=Math.trunc(Number(sc.startDay)||0),endMonth=Math.trunc(Number(sc.endMonth)||0),endDay=Math.trunc(Number(sc.endDay)||0);
        if(mode==="default"){
          const d=baseEventDate(original,new Date().getFullYear(),catalog.special||[]);startMonth=d?d.getUTCMonth()+1:1;startDay=d?d.getUTCDate():1;endMonth=startMonth;endDay=startDay;
        }else{
          if(!validMonthDay(year||2028,startMonth,startDay))throw fail(400,"Choose a valid event start date");
          if(mode==="date"){endMonth=startMonth;endDay=startDay;}
          else if(mode==="month"){startDay=1;endMonth=startMonth;endDay=daysInMonth(year||2028,startMonth);}
          else if(!validMonthDay((year||2028)+(endMonth<startMonth||(endMonth===startMonth&&endDay<startDay)?1:0),endMonth,endDay))throw fail(400,"Choose a valid event end date");
        }
        const customTime=!!sc.customTime,start=customTime?minutes(sc.start):0,end=customTime?minutes(sc.end):0;
        if(customTime&&(start===null||end===null))throw fail(400,"Choose valid event start and end times");
        if(mode==="default"&&!customTime){
          delete e.scheduleOverride;if(overrides[e.id])delete overrides[e.id].scheduleOverride;
        }else{
          e.scheduleOverride={mode,annual,year,startMonth,startDay,endMonth,endDay,customTime,start:start??0,end:end??0};
          overrides[e.id].scheduleOverride=e.scheduleOverride;
        }
      }
      if(overrides[e.id]&&Object.keys(overrides[e.id]).length===0)delete overrides[e.id];
      put("event_overrides",overrides);
    });
    return send(res,200,{ok:true});
  }
  if(path==="/api/event-categories"){
    if(method==="POST"){
      const body=await input(req),index=Number(body.index);
      if(!Number.isInteger(index)||index<0||index>=15)throw fail(400,"Unknown category");
      const cfg=await mutateCalendar(c=>{const bit=1<<index;c.settings.categoryMask=body.enabled?(Number(c.settings.categoryMask??32767)|bit):(Number(c.settings.categoryMask??32767)&~bit);});
      const category=catalog.categories[index];
      return send(res,200,{ok:true,...category,enabled:!!(cfg.settings.categoryMask&(1<<index)),mask:cfg.settings.categoryMask});
    }
    const cfg=await config(),mask=Number(cfg.settings.categoryMask??32767);
    return send(res,200,{mask,expanded:Number(cfg.settings.mode||0)!==0,categories:catalog.categories.map(x=>({...x,enabled:!!(mask&(1<<x.index))}))});
  }
  if(path==="/api/event-color-theme"){
    if(method==="POST"){
      const body=await input(req),t=["1","3.0.28","3.0.29"].includes(body.theme)?body.theme:"3.0.29",mode=t==="1"?0:t==="3.0.28"?1:2;
      await mutateCalendar(cfg=>{
        const previous=Number(cfg.settings.mode||0),overrides=meta("event_overrides",{});
        for(const e of cfg.events){
          const original=eventById.get(e.id);if(!original)continue;
          const p=original.profiles,o=overrides[e.id]||{};
          if(previous===mode)continue;
          e.effect=o.effect??(mode===2?p.expandedEffect:original.effect);
          e.speed=o.speed??(mode===2?p.expandedSpeed:original.speed);
          e.colors=o.colors??(mode===0?p.major:mode===1?p.basic:p.expanded);
          if(o.enabled!==undefined)e.enabled=o.enabled;
          if(o.favorite!==undefined)e.favorite=o.favorite;
        }
        cfg.settings.mode=mode;
      });
      return send(res,200,{theme:t,name:themeName(t)});
    }
    const t=theme(Number((await config()).settings.mode||0));return send(res,200,{theme:t,name:themeName(t)});
  }
  if(method==="GET"&&path==="/api/favorites"){
    const c=await config(),presets=meta("presets",[]);
    return send(res,200,{events:[
      ...c.events.filter(x=>x.favorite).map(x=>({id:x.id,name:x.name,effect:x.effect,speed:x.speed,colors:rgb(x.colors),favorite:true,custom:false})),
      ...presets.filter(x=>x.favorite).map(x=>({...x,custom:true}))
    ]});
  }
  if(method==="GET"&&path==="/api/presets")return send(res,200,{presets:meta("presets",[])});
  if(method==="POST"&&path==="/api/preset"){
    const body=await input(req),all=meta("presets",[]),schedules=meta("custom_schedules",[]);
    if(body.deleteId){put("presets",all.filter(x=>x.id!==body.deleteId));return send(res,200,{ok:true});}
    let item=all.find(x=>x.id===body.id),id=body.id||"custom-"+randomUUID().slice(0,8);
    if(item&&(Object.hasOwn(body,"favorite")||Object.hasOwn(body,"enabled"))){
      if(Object.hasOwn(body,"favorite"))item.favorite=!!body.favorite;
      if(Object.hasOwn(body,"enabled")){item.enabled=!!body.enabled;
        for(const s of schedules)if(s.presetId===id)s.enabled=!!body.enabled;
        put("custom_schedules",schedules);await mutateCalendar(c=>{c.customSchedules=schedules;});
      }
    }else{
      if(!String(body.name||"").trim())throw fail(400,"Give this custom light a name");
      if(!item){item={id};all.push(item);}
      Object.assign(item,{name:String(body.name).trim(),effect:String(body.effect||"Jump"),brightness:clamp(body.brightness??100,1,100),
        speed:clamp(body.speed??5,1,10),enabled:body.enabled!==false,favorite:!!body.favorite,colors:rgb(body.colors||["#E08700"])});
    }
    put("presets",all);return send(res,200,{ok:true,id,fileBytes:JSON.stringify(all).length});
  }
  if(method==="GET"&&path==="/api/custom-schedules"){
    const y=Number(url.searchParams.get("year"))||new Date().getFullYear(),m=Number(url.searchParams.get("month"))||new Date().getMonth()+1;
    return send(res,200,{items:meta("custom_schedules",[]).filter(x=>x.month===m&&(x.annual||x.year===y))});
  }
  if(method==="POST"&&path==="/api/custom-schedules/group"){
    const body=await input(req),items=meta("custom_schedules",[]),wanted=!!body.enabled,changed=items.filter(x=>x.enabled!==wanted).length;
    items.forEach(x=>x.enabled=wanted);put("custom_schedules",items);
    await mutateCalendar(c=>{c.customSchedules=items.map(x=>({...x,colors:colorInts(x.colors)}));});
    return send(res,200,{ok:true,enabled:wanted,changed,total:items.length});
  }
  if(method==="POST"&&path==="/api/custom-schedules"){
    const body=await input(req),items=meta("custom_schedules",[]);
    if(body.id&&body.remove){put("custom_schedules",items.filter(x=>x.id!==body.id));}
    else if(body.id&&Object.hasOwn(body,"enabled")){const x=items.find(x=>x.id===body.id);if(!x)throw fail(404,"Unknown custom schedule");x.enabled=!!body.enabled;put("custom_schedules",items);}
    else{
      const preset=meta("presets",[]).find(x=>x.id===body.presetId);if(!preset)throw fail(404,"Custom light not found");
      const id="schedule-"+randomUUID().slice(0,8);
      items.push({...preset,id,presetId:preset.id,year:Number(body.year)||new Date().getFullYear(),month:Number(body.month)||1,
        day:Number(body.day)||1,annual:body.annual!==false,enabled:true});put("custom_schedules",items);
    }
    await mutateCalendar(c=>{c.customSchedules=meta("custom_schedules",[]).map(x=>({...x,colors:colorInts(x.colors)}));});
    return send(res,200,{ok:true});
  }
  if(path==="/api/colors"){
    const all=meta("palette",{});
    if(method==="POST"){
      const body=await input(req),index=Number(body.index);
      if(!Number.isInteger(index)||index<0||index>=catalog.palette.length)throw fail(400,"Select a valid color preset");
      if(body.reset)delete all[index];else if(/^#?[0-9A-F]{6}$/i.test(String(body.color)))all[index]=hex(body.color);
      else throw fail(400,"Enter a valid six-digit color");
      put("palette",all);
    }
    return send(res,200,{presets:catalog.palette.map(x=>({...x,color:all[x.index]||x.default,customized:!!all[x.index]}))});
  }
  if(method==="GET"&&path==="/api/ble/scan"){
    const status=await upstream("/api/status"),ready=new Set(status.eufy?.readyNames||[]);
    return send(res,200,{scanning:false,transport:"oracle",devices:targetNames.slice(1).map((name,i)=>({name,address:"",rssi:0,model:i<2?"E120":"E22",connected:ready.has(name)}))});
  }
  if(method==="POST"&&path==="/api/ble/target"){
    const value=Number((await input(req)).target);
    const selected=Number.isInteger(value)&&value>=0&&value<=4?value:0;
    put("target",selected);
    return send(res,200,{ok:true,target:selected,ble:{target:selected}});
  }
  if(method==="GET"&&path==="/api/backup/status")return send(res,200,{hasBackup:!!meta("backup"),lastBackup:meta("backup_time",0),lastOk:!!meta("backup"),mode:"complete"});
  if(method==="POST"&&path==="/api/backup/manual"){
    const oracle=(await upstream("/api/backup/export")).backup;
    const backup={schema:2,createdAt:Math.floor(Date.now()/1000),app:{},schedule:{},oracle,web2:{presets:meta("presets",[]),
      customSchedules:meta("custom_schedules",[]),palette:meta("palette",{}),eventOverrides:meta("event_overrides",{}),target:meta("target",0)}};
    put("backup",backup);put("backup_time",backup.createdAt);
    return send(res,200,{ok:true,lastBackup:backup.createdAt,mode:"complete-web2",oracleIncluded:true});
  }
  if(method==="GET"&&path==="/api/backup/export-portable"){
    const backup=meta("backup");if(!backup)throw fail(404,"Create a backup first");
    return send(res,200,{ok:true,backup,portable:true,containsCredentials:false});
  }
  if(method==="POST"&&(path==="/api/backup/import-portable"||path==="/api/backup/restore")){
    const backup=path.endsWith("import-portable")?(await input(req)).backup:meta("backup");
    if(!backup||backup.schema!==2||!backup.oracle)throw fail(400,"Invalid full backup");
    // A restore may change the active lights; this is performed only from an explicit user action.
    await upstream("/api/backup/restore","POST",{backup:backup.oracle});
    if(backup.web2){
      put("presets",backup.web2.presets||[]);put("custom_schedules",backup.web2.customSchedules||[]);
      put("palette",backup.web2.palette||{});put("event_overrides",backup.web2.eventOverrides||{});put("target",backup.web2.target||0);
    }else if(backup.app&&typeof backup.app==="object"){
      // Portable backups from Jason Home 1 store typed Android preferences.
      const pref=k=>backup.app[k]?.v;
      const parseList=k=>{try{const v=pref(k);return Array.isArray(v)?v:JSON.parse(v||"[]");}catch{return [];}};
      const presets=parseList("presets"),schedules=parseList("custom_schedules"),palette={},overrides={};
      for(let i=0;i<catalog.palette.length;i++)if(typeof pref("color_"+i)==="string")palette[i]=hex(pref("color_"+i));
      for(const e of catalog.events){const prefix="event_"+e.id+"_",o={};
        for(const key of ["effect","speed","enabled","favorite"])if(pref(prefix+key)!==undefined)o[key]=pref(prefix+key);
        if(pref(prefix+"colors")!==undefined){try{o.colors=colorInts(JSON.parse(pref(prefix+"colors")));}catch{}}
        if(Object.keys(o).length)overrides[e.id]=o;
      }
      put("presets",presets);put("custom_schedules",schedules);put("palette",palette);put("event_overrides",overrides);
      if(Number.isInteger(Number(pref("target"))))put("target",clamp(pref("target"),0,4));
    }
    put("backup",backup);put("backup_time",Math.floor(Date.now()/1000));
    return send(res,200,{ok:true,restoredAt:Math.floor(Date.now()/1000),oracleRestored:true});
  }
  const proxyPaths=new Set(["/api/status","/api/devices","/api/schedules","/api/reconcile","/api/reconnect"]);
  if(proxyPaths.has(path)||path.startsWith("/api/eufy/factory-")){
    const value=method==="GET"?undefined:await input(req);
    return send(res,200,await upstream(path+url.search,method,value));
  }
  throw fail(404,"Unknown API route: "+path);
}
http.createServer((req,res)=>route(req,res).catch(e=>{
  const status=Number(e.status)||(e.name==="AbortError"?504:502);
  if(status>=500)console.error("[Jason Home 2]",req.method,req.url,e.message);
  send(res,status,{ok:false,error:e.message||"Request failed"});
})).listen(port,"0.0.0.0",()=>console.log("Jason Home 2 web on port "+port));

