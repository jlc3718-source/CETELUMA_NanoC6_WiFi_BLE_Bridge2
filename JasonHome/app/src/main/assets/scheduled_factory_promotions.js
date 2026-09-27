(()=>{"use strict";
const PREFIX="factory:";
const $=id=>document.getElementById(id);
const deep=x=>JSON.parse(JSON.stringify(x));
let promotedIds=new Set();
let syncBusy=false;
let syncTimer=0;
let lastFactoryPresets=[];

const STOP=new Set(["the","a","an","and","or","of","for","to","day","days","night","lights","light","scene","theme","party","holiday","festival","celebration","special","classic","color","colors","effect"]);
const GENERIC=new Set(["spring","summer","autumn","fall","winter","season","seasonal","sports","sport","game","games","football","basketball","baseball","hockey","soccer","team","teams","school","birthday","party"]);
const FAMILIES=[
 ["christmas",["christmas","xmas","noel","yuletide","santa"]],
 ["halloween",["halloween","spooky","pumpkin"]],
 ["thanksgiving",["thanksgiving","turkey"]],
 ["easter",["easter"]],
 ["valentine",["valentine","valentines"]],
 ["stpatrick",["st patrick","saint patrick","stpatricks","shamrock"]],
 ["independence",["independence","july 4","4th of july","fourth of july"]],
 ["memorial",["memorial"]],
 ["veterans",["veteran","veterans"]],
 ["newyear",["new year","new years","new year's"]],
 ["hanukkah",["hanukkah","chanukah"]],
 ["kwanzaa",["kwanzaa"]],
 ["pride",["pride","lgbtq"]],
 ["diwali",["diwali"]],
 ["ramadan",["ramadan"]],
 ["eid",["eid"]],
 ["juneteenth",["juneteenth"]],
 ["mothers",["mother's day","mothers day"]],
 ["fathers",["father's day","fathers day"]],
 ["earth",["earth day"]]
];

function normalized(s){return String(s||"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function tokens(s){return normalized(s).split(" ").filter(x=>x&&x.length>1&&!STOP.has(x));}
function familyOf(s){const n=normalized(s);for(const [id,aliases] of FAMILIES)if(aliases.some(a=>n.includes(normalized(a))))return id;return "";}
function isGenericPreset(name){const t=tokens(name);return t.some(x=>GENERIC.has(x))&&!familyOf(name);}
function eventScore(presetName,eventName){
 const pf=familyOf(presetName),ef=familyOf(eventName);
 if(pf&&ef&&pf!==ef)return -1;
 const a=new Set(tokens(presetName)),b=new Set(tokens(eventName));
 const shared=[...a].filter(x=>b.has(x));
 const union=new Set([...a,...b]);
 const overlap=union.size?shared.length/union.size:0;
 let score=overlap*45+shared.filter(x=>x.length>=5).length*6;
 if(pf&&pf===ef)score+=100;
 const pn=normalized(presetName),en=normalized(eventName);
 if(pn===en)score+=50;
 if(pn.includes(en)||en.includes(pn))score+=20;
 return score;
}
function parseFactoryId(id){const m=String(id||"").match(/^factory:(\d+):(.+)$/);return m?{lightId:Number(m[1]),baseId:m[2]}:null;}
function factoryColors(p){
 const out=[];const add=v=>{const s=String(v??"").replace(/^#/,"");if(/^[0-9a-fA-F]{6}$/.test(s)){const n=parseInt(s,16)&0xffffff;if(!out.includes(n))out.push(n);}};
 for(const l of Array.isArray(p?.layers)?p.layers:[])for(const x of String(l?.colors||"").split("|"))add(x);
 for(const x of String(p?.colors||"").split("|"))add(x);
 return out.slice(0,8);
}
function dominantLayer(p){const l=Array.isArray(p?.layers)?p.layers:[];return l.map((x,i)=>({x,i,p:Number(x?.layer_priority)||0})).sort((a,b)=>b.p-a.p||a.i-b.i)[0]?.x||null;}
function speed5(p){const l=Array.isArray(p?.layers)?p.layers:[],r=Number(p?.speed??l[0]?.layer_speed??25);if(!Number.isFinite(r))return 3;if(r<=5)return 1;if(r<=20)return 2;if(r<=40)return 3;if(r<=70)return 4;return 5;}
function compatibleScene(p){
 const l=dominantLayer(p),type=Number(l?.current_layer_type);let effect="Breath";
 if(type===0){const gradient=Number(l?.gradient_value)||0,meteor=Number(l?.length_range)||0;effect=meteor>0?"Meteor / Comet":gradient>0?"Gradient Sweep":"Chase";}
 else if(type===2)effect="Twinkle / Sparkle";
 else if(type===1){const transition=Number(l?.transition_mode)||0;effect=transition===0?"Breath":transition===2?"Gradient Sweep":"Jump";}
 const colors=factoryColors(p);
 return {effect,colors:colors.length?colors:[0xffffff],speed:speed5(p)};
}
function assignments(events,presets){
 const base=events.filter(e=>!parseFactoryId(e?.id)),byBase=new Map(),used=new Set();
 for(const p of presets){
   if(isGenericPreset(p?.name))continue;
   let best=null,bestScore=0;
   for(const e of base){const s=eventScore(p?.name,e?.name);if(s>bestScore){bestScore=s;best=e;}}
   if(!best||bestScore<55)continue;
   if(!byBase.has(best.id))byBase.set(best.id,[]);
   byBase.get(best.id).push({preset:p,score:bestScore});used.add(Number(p.lightId));
 }
 for(const list of byBase.values())list.sort((a,b)=>b.score-a.score||String(a.preset.name).localeCompare(String(b.preset.name)));
 return {base,byBase,used};
}
function eventSignature(events){return JSON.stringify(events.map(e=>({id:e.id,name:e.name,effect:e.effect,speed:e.speed,colors:e.colors,enabled:e.enabled,favorite:e.favorite})));}

async function syncPromotions(force=false){
 if(syncBusy||typeof api!=="function"||typeof post!=="function")return;
 syncBusy=true;
 try{
   const stamp=Date.now();
   const [cr,fr]=await Promise.all([api("/api/calendar?factoryPromotions="+stamp,{},15000),api("/api/eufy/factory-presets?ts="+stamp,{},15000)]);
   const cfg=cr?.calendar;
   if(!cfg||!Array.isArray(cfg.events)||!Array.isArray(fr?.presets))return;
   lastFactoryPresets=fr.presets;
   const oldFactory=new Map(cfg.events.filter(e=>parseFactoryId(e?.id)).map(e=>[e.id,e]));
   const {base,byBase,used}=assignments(cfg.events,fr.presets);
   const next=[];
   for(const e of base){
     next.push(e);
     for(const item of byBase.get(e.id)||[]){
       const p=item.preset,scene=compatibleScene(p),id=`${PREFIX}${Number(p.lightId)}:${e.id}`,old=oldFactory.get(id);
       next.push({...e,id,name:`${e.name} — ${p.name}`,effect:scene.effect,speed:scene.speed,colors:scene.colors,enabled:old?old.enabled!==false:true,favorite:old?!!old.favorite:!!e.favorite});
     }
   }
   promotedIds=used;
   if(force||eventSignature(next)!==eventSignature(cfg.events)){
     cfg.events=next;
     await post("/api/calendar/sync",cfg,20000);
   }
   updateFactoryGrid();
   if(typeof loadEvents==="function"){
     const generation=typeof invalidateEventRequest==="function"?invalidateEventRequest():undefined;
     await Promise.resolve(loadEvents(generation)).catch(()=>{});
   }
 }catch(e){console.warn("Factory schedule promotion skipped",e);}
 finally{syncBusy=false;}
}

function scheduleSync(){clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncPromotions(false),350);}

function injectStyles(){
 if($("scheduledFactoryPromotionStyle"))return;
 const s=document.createElement("style");s.id="scheduledFactoryPromotionStyle";s.textContent=`
 #factoryPresetList{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:8px!important;align-items:stretch}
 #factoryPresetList .factoryPresetCard{display:flex!important;flex-direction:column!important;gap:7px!important;margin:0!important;padding:9px!important;min-width:0;align-items:stretch!important}
 #factoryPresetList .factoryPresetName{font-size:12px;line-height:1.2}
 #factoryPresetList .factoryPresetMeta{font-size:9px;margin-top:2px}
 #factoryPresetList .factoryPattern{font-size:10px;line-height:1.25;margin-top:3px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
 #factoryPresetList .factorySwatches{gap:3px;margin-top:3px}
 #factoryPresetList .factorySwatch{width:13px;height:13px}
 #factoryPresetList .factoryFlags{gap:3px;margin-top:3px}
 #factoryPresetList .factoryFlag{font-size:8px;padding:1px 4px}
 #factoryPresetList .factoryButtons{margin-top:auto;display:grid!important;grid-template-columns:1fr 1fr;gap:5px!important}
 #factoryPresetList .factoryButtons .btn{font-size:10px;padding:7px 4px;min-width:0}
 #factoryPresetList .factoryTestResult{font-size:9px;min-height:0;line-height:1.25}
 .scheduledFactoryTools{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid rgba(130,175,235,.18)}
 .scheduledFactoryTools .btn{font-size:10px;padding:6px 9px}
 .scheduledFactoryBadge{font-size:9px;border:1px solid rgba(49,216,155,.5);color:#7ef2c4;border-radius:999px;padding:2px 7px;align-self:center}
 .scheduledFactoryStatus{font-size:10px;color:#9fb4d2;flex:1 1 100%;min-height:14px}
 .scheduledFactoryOverlay{position:fixed;inset:0;z-index:23000;background:rgba(0,0,0,.8);display:none;align-items:flex-start;justify-content:center;padding:calc(16px + env(safe-area-inset-top)) 10px calc(16px + env(safe-area-inset-bottom));overflow:auto}
 .scheduledFactoryOverlay.open{display:flex}
 .scheduledFactoryCard{width:min(720px,100%);background:#081526;border:1px solid rgba(92,177,235,.42);border-radius:17px;padding:14px;box-sizing:border-box}
 .scheduledFactoryGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:12px}
 .scheduledFactoryLayer{border:1px solid rgba(102,155,214,.25);border-radius:12px;padding:10px;margin-top:10px;background:#091327}
 .scheduledFactoryLayerGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:8px}
 .scheduledFactoryActions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end;margin-top:12px}
 @media(max-width:520px){#factoryPresetList{grid-template-columns:repeat(2,minmax(0,1fr))}.scheduledFactoryGrid,.scheduledFactoryLayerGrid{grid-template-columns:1fr}.scheduledFactoryActions .btn{flex:1 1 45%}}
 @media(min-width:760px){#factoryPresetList{grid-template-columns:repeat(auto-fit,minmax(165px,1fr))}}
 `;document.head.appendChild(s);
}

function updateFactoryGrid(){
 injectStyles();
 const root=$("factoryPresetList");if(!root)return;
 for(const card of root.querySelectorAll(".factoryPresetCard")){
   const text=card.querySelector(".factoryPresetMeta")?.textContent||"",m=text.match(/ID\s+(\d+)/i),id=m?Number(m[1]):0;
   if(id&&promotedIds.has(id))card.remove();
 }
 const badge=$("factoryCatalogBadge");
 if(badge&&lastFactoryPresets.length)badge.textContent=Math.max(0,lastFactoryPresets.length-promotedIds.size)+" unused";
}

function ensureFactoryObserver(){
 const root=$("factoryPresetList");if(!root||root.dataset.promotionObserved)return false;
 root.dataset.promotionObserved="1";new MutationObserver(()=>updateFactoryGrid()).observe(root,{childList:true,subtree:true});updateFactoryGrid();return true;
}

async function pollFactoryJob(jobId,statusEl){
 for(let i=0;i<75;i++){
   await new Promise(r=>setTimeout(r,800));
   const j=await api("/api/eufy/factory-test?job="+encodeURIComponent(jobId)+"&ts="+Date.now(),{},12000);
   if(j.state==="failed")throw new Error(j.error||"Preview failed");
   if(j.state==="complete")return j.result||{};
 }
 throw new Error("Preview did not finish in time");
}
async function previewPreset(lightId,statusEl,button){
 button.disabled=true;if(statusEl)statusEl.textContent="Previewing on all four strings…";
 try{
   const q=await post("/api/eufy/factory-test",{lightId,target:"All",mode:"compatible"},12000);
   const r=await pollFactoryJob(q.jobId,statusEl),parts=(r.results||[]).map(x=>x.name+" "+(x.ok?"✓":"✕"));
   if(statusEl)statusEl.textContent=(parts.join(" • ")||"Preview applied")+" • use Resume Schedule when finished viewing.";
 }catch(e){if(statusEl)statusEl.textContent="Preview failed: "+e.message;}
 finally{button.disabled=false;}
}
async function resumeSchedule(statusEl,button){button.disabled=true;try{await post("/api/resume",{});if(statusEl)statusEl.textContent="Normal schedule resumed.";}catch(e){if(statusEl)statusEl.textContent="Resume failed: "+e.message;}finally{button.disabled=false;}}

function field(label,node){const x=document.createElement("label"),l=document.createElement("div");l.className="label";l.textContent=label;x.append(l,node);return x;}
function numberInput(v,min,max){const x=document.createElement("input");x.className="field";x.type="number";x.min=String(min);x.max=String(max);x.value=String(v??0);return x;}
function colorList(layer){return String(layer?.colors||"").split("|").map(x=>x.trim()).filter(Boolean);}
function layerLabel(type){return Number(type)===0?"Flow / Movement":Number(type)===1?"Color Transition / Sequence":Number(type)===2?"Blink / Twinkle":"Unknown";}

function ensureEditor(){
 let overlay=$("scheduledFactoryEditorOverlay");if(overlay)return overlay;
 overlay=document.createElement("div");overlay.id="scheduledFactoryEditorOverlay";overlay.className="scheduledFactoryOverlay";
 overlay.innerHTML='<div class="scheduledFactoryCard"><div class="row between"><div><strong id="scheduledFactoryTitle">Scheduled factory preset</strong><div class="sub">Changes here also update the scheduled event variant.</div></div><button id="scheduledFactoryClose" class="btn" type="button">Done</button></div><div id="scheduledFactoryBody"></div><div id="scheduledFactoryEditorStatus" class="status"></div><div class="scheduledFactoryActions"><button id="scheduledFactoryReset" class="btn danger" type="button">Restore Eufy Original</button><button id="scheduledFactoryPreview" class="btn" type="button">Preview All 4</button><button id="scheduledFactorySave" class="btn primary" type="button">Save to Schedule</button></div></div>';
 document.body.appendChild(overlay);
 $("scheduledFactoryClose").onclick=()=>{overlay.classList.remove("open");document.body.style.overflow="";};
 overlay.addEventListener("click",e=>{if(e.target===overlay){overlay.classList.remove("open");document.body.style.overflow="";}});
 return overlay;
}

async function openScheduledEditor(lightId){
 const overlay=ensureEditor(),body=$("scheduledFactoryBody"),status=$("scheduledFactoryEditorStatus");
 overlay.classList.add("open");document.body.style.overflow="hidden";body.innerHTML="";status.textContent="Loading saved factory recipe…";
 try{
   const r=await api("/api/eufy/factory-presets?id="+encodeURIComponent(lightId)+"&raw=1&ts="+Date.now(),{},15000),p=deep(r.presets?.[0]);
   if(!p)throw new Error("Factory preset not found");
   $("scheduledFactoryTitle").textContent=(p.name||("Factory "+lightId))+" • scheduled variant";
   const grid=document.createElement("div");grid.className="scheduledFactoryGrid";
   const name=document.createElement("input");name.className="field";name.value=p.name||"";
   const brightness=numberInput(p.brightness??75,1,100),speed=numberInput(p.speed??0,0,255),exec=numberInput(p.layerExecutionMode??0,0,255);
   grid.append(field("Preset name",name),field("Preview brightness %",brightness),field("Factory speed byte",speed),field("Layer execution mode",exec));body.appendChild(grid);
   const note=document.createElement("div");note.className="note";note.style.marginTop="10px";note.textContent="The scheduled variant uses this recipe's compatible effect, colors, and speed. Schedule 1 / Schedule 2 still control their normal scheduled brightness levels.";body.appendChild(note);
   (p.layers||[]).forEach((layer,index)=>{
     const card=document.createElement("div");card.className="scheduledFactoryLayer";const title=document.createElement("strong");title.textContent="Layer "+(index+1)+" — "+layerLabel(layer.current_layer_type);card.appendChild(title);
     const lg=document.createElement("div");lg.className="scheduledFactoryLayerGrid";
     const family=document.createElement("select");family.className="field";[[0,"Flow / Movement"],[1,"Color Transition / Sequence"],[2,"Blink / Twinkle"]].forEach(([v,n])=>{const o=document.createElement("option");o.value=v;o.textContent=n;o.selected=Number(layer.current_layer_type)===v;family.appendChild(o);});
     const colors=document.createElement("input");colors.className="field";colors.value=colorList(layer).map(x=>"#"+x.replace(/^#/,"")).join(", ");
     const pri=numberInput(layer.layer_priority??0,0,255),ls=numberInput(layer.layer_speed??0,0,255);
     lg.append(field("Pattern",family),field("Colors",colors),field("Priority",pri),field("Layer speed",ls));card.appendChild(lg);body.appendChild(card);
     const sync=()=>{layer.current_layer_type=Number(family.value);layer.layer_priority=Number(pri.value);layer.layer_speed=Number(ls.value);const parsed=colors.value.split(/[|,\s]+/).map(x=>x.trim().replace(/^#/,"")).filter(Boolean);if(parsed.some(x=>!/^[0-9a-fA-F]{6}$/.test(x)))colors.setCustomValidity("Use six-digit RGB colors");else{colors.setCustomValidity("");layer.colors=parsed.join("|");}title.textContent="Layer "+(index+1)+" — "+layerLabel(layer.current_layer_type);};
     [family,colors,pri,ls].forEach(x=>x.addEventListener("change",sync));
   });
   const collect=()=>{p.name=name.value.trim()||p.name;p.brightness=Number(brightness.value);p.speed=Number(speed.value);p.layerExecutionMode=Number(exec.value);return p;};
   $("scheduledFactorySave").onclick=async()=>{const b=$("scheduledFactorySave");b.disabled=true;status.textContent="Saving recipe and refreshing scheduled variants…";try{await post("/api/eufy/factory-presets/save",{lightId,preset:collect()},15000);await syncPromotions(true);status.textContent="Saved. The scheduled variant now uses the updated pattern.";}catch(e){status.textContent="Save failed: "+e.message;}finally{b.disabled=false;}};
   $("scheduledFactoryPreview").onclick=async()=>previewPreset(lightId,status,$("scheduledFactoryPreview"));
   $("scheduledFactoryReset").onclick=async()=>{if(!confirm("Restore this preset to the original Eufy recipe?"))return;const b=$("scheduledFactoryReset");b.disabled=true;try{await post("/api/eufy/factory-presets/reset",{lightId});await syncPromotions(true);status.textContent="Original Eufy recipe restored and schedule refreshed.";}catch(e){status.textContent="Restore failed: "+e.message;}finally{b.disabled=false;}};
   status.textContent="Edit the preset here, preview it, then save it back into the scheduler.";
 }catch(e){status.textContent="Could not open scheduled factory preset: "+e.message;}
}

function decorateEvents(events){
 const cards=[...document.querySelectorAll("#eventList > .event")];
 events.forEach((e,i)=>{
   const parsed=parseFactoryId(e?.id),card=cards[i];if(!parsed||!card||card.querySelector(".scheduledFactoryTools"))return;
   const tools=document.createElement("div");tools.className="scheduledFactoryTools";
   const badge=document.createElement("span");badge.className="scheduledFactoryBadge";badge.textContent="Factory preset";
   const preview=document.createElement("button");preview.className="btn";preview.type="button";preview.textContent="Preview";
   const edit=document.createElement("button");edit.className="btn";edit.type="button";edit.textContent="Edit Pattern";
   const resume=document.createElement("button");resume.className="btn";resume.type="button";resume.textContent="Resume Schedule";
   const status=document.createElement("div");status.className="scheduledFactoryStatus";
   preview.onclick=()=>previewPreset(parsed.lightId,status,preview);edit.onclick=()=>openScheduledEditor(parsed.lightId);resume.onclick=()=>resumeSchedule(status,resume);
   tools.append(badge,preview,edit,resume,status);card.appendChild(tools);
 });
}
function hookRenderEvents(){
 if(typeof window.renderEvents!=="function"||window.renderEvents.__scheduledFactoryWrapped)return;
 const prior=window.renderEvents;
 const wrapped=function(events){const r=prior.apply(this,arguments);try{decorateEvents(events||[]);}catch(e){console.warn(e);}return r;};
 wrapped.__scheduledFactoryWrapped=true;window.renderEvents=wrapped;
}

function boot(){
 injectStyles();hookRenderEvents();ensureFactoryObserver();
 const eventList=$("eventList");if(eventList&&!eventList.dataset.factoryPromotionObserved){eventList.dataset.factoryPromotionObserved="1";new MutationObserver(()=>{ensureFactoryObserver();}).observe(eventList,{childList:true,subtree:true});}
 window.addEventListener("anderson-profile-selected",e=>{hookRenderEvents();if(e.detail?.id==="jason")scheduleSync();});
 window.addEventListener("anderson-profile-cleared",()=>{});
 document.addEventListener("visibilitychange",()=>{if(!document.hidden){ensureFactoryObserver();hookRenderEvents();}});
 setTimeout(()=>{hookRenderEvents();ensureFactoryObserver();syncPromotions(false);},1200);
 setInterval(()=>{ensureFactoryObserver();hookRenderEvents();},3000);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
