(()=>{"use strict";
if(typeof renderEvents!=="function"||!document.getElementById("eventSearch"))return;

const padEvent=n=>`evt${String(n).padStart(3,"0")}`;
const builtInIds=Array.from({length:210},(_,i)=>padEvent(i+1));
const defs=[
  {key:"holiday",name:"Holiday",short:"Holiday",color:"#FFD166",ids:[6,25,46,61,197,210]},
  {key:"patriotic",name:"Patriotic / Federal",short:"Patriotic / Federal",color:"#FF6B6B",ids:[11,19,26,105,106,118,144]},
  {key:"religious",name:"Religious",short:"Religious",color:"#C084FC",ids:[8,9,27,29,30,47,63,64,65,96,148,153,177,189,190,192,202,207,208]},
  {key:"military",name:"Military / Veterans",short:"Military / Veterans",color:"#60A5FA",ids:[52,78,91,95,103,121,128,152,157,193]},
  {key:"firstresponders",name:"First Responders / Public Safety",short:"First Responders",color:"#FB923C",ids:[90,94,102,167,199]},
  {key:"family",name:"Family / Personal",short:"Family / Personal",color:"#F472B6",ids:[87,109,120,149,186]},
  {key:"cultural",name:"Cultural / Heritage",short:"Cultural / Heritage",color:"#34D399",ids:[15,28,32,34,44,76,77,85,101,150,169,173,180,198,209]},
  {key:"civic",name:"Community / Civic",short:"Community / Civic",color:"#22D3EE",ids:[12,14,31,84,129,130,131,132,151,155,191,204,205]},
  {key:"sports",name:"Sports / Game Days",short:"Sports / Game Days",color:"#A3E635",ids:[23,74]},
  {key:"memorial",name:"Memorial / Remembrance",short:"Memorial / Remembrance",color:"#CBD5E1",ids:[13,69,147,175,203]},
  {key:"lgbtq",name:"LGBTQ+ / Pride",short:"LGBTQ+ / Pride",color:"#E879F9",ids:[53,92,98,156,168,172,176,196]},
  {key:"environment",name:"Environmental",short:"Environmental",color:"#2DD4BF",ids:[49,70,72]},
  {key:"seasonal",name:"Seasonal",short:"Seasonal",color:"#F59E0B",ids:[20,110,179,206]},
  {key:"social",name:"Awareness — General / Social",short:"General / Social",color:"#A78BFA",ids:[10,18,55,56,75,104,108,113,160,162,188]}
].map(x=>({...x,ids:x.ids.map(padEvent)}));
const alreadyAssigned=new Set(defs.flatMap(x=>x.ids));
const health={key:"health",name:"Health / Medical Awareness",short:"Health / Medical",color:"#FB7185",ids:builtInIds.filter(id=>!alreadyAssigned.has(id))};
const healthInsert=defs.findIndex(x=>x.key==="memorial");
defs.splice(healthInsert,0,health);
const custom={key:"custom",name:"Custom Events",short:"Custom Events",color:"#38BDF8",ids:[],custom:true};
const categories=[...defs,custom];
const categoryById=new Map();
defs.forEach(cat=>cat.ids.forEach(id=>categoryById.set(id,cat)));
if(categoryById.size!==210)console.warn("Anderson category map does not cover exactly 210 built-in events",categoryById.size);

const eventEnabled=new Map();
const customEnabled=new Map();
const toggleByKey=new Map();
let categoryBusy=false,scanBusy=false,scanQueued=false,customScanBusy=false,themeRefreshTimer=0;

function expandedSelected(){
  return document.getElementById("eventColors3028")?.getAttribute("aria-pressed")==="true"||document.getElementById("eventColors3029")?.getAttribute("aria-pressed")==="true";
}
function categoryInput(cat){return toggleByKey.get(cat.key)?.querySelector("input")||null;}
function knownStateFor(cat){
  const source=cat.custom?customEnabled:eventEnabled,ids=cat.custom?[...customEnabled.keys()]:cat.ids;
  let known=0,on=0;
  ids.forEach(id=>{if(source.has(id)){known++;if(source.get(id))on++;}});
  return{known,on,total:ids.length};
}
function syncOne(cat){
  const input=categoryInput(cat);if(!input)return;
  const state=knownStateFor(cat);
  if(cat.custom&&state.total===0){input.checked=false;input.indeterminate=false;input.disabled=true;return;}
  if(state.known===0){input.checked=true;input.indeterminate=false;}
  else{input.checked=state.on===state.known;input.indeterminate=state.on>0&&state.on<state.known;}
  input.disabled=categoryBusy||(!cat.custom&&!expandedSelected());
}
function syncAll(){categories.forEach(syncOne);document.getElementById("eventCategoryBar")?.classList.toggle("majorMode",!expandedSelected());}

function buildBar(){
  if(document.getElementById("eventCategoryBar"))return;
  const search=document.getElementById("eventSearch"),row=search?.closest(".row");if(!row)return;
  const wrap=document.createElement("div");wrap.id="eventCategoryBar";wrap.className="andersonCategoryBar";wrap.setAttribute("aria-label","Event categories");
  categories.forEach(cat=>{
    const label=document.createElement("label");label.className="andersonCategoryToggle";label.style.setProperty("--category-color",cat.color);label.title=cat.custom?"Enable or disable all saved custom events":`Enable or disable all ${cat.name} events in both Expanded schedules`;
    const input=document.createElement("input");input.type="checkbox";input.checked=true;input.setAttribute("aria-label",`Enable ${cat.name} category`);
    const pill=document.createElement("span");pill.className="andersonCategoryPill";pill.textContent=cat.short;
    label.append(input,pill);wrap.appendChild(label);toggleByKey.set(cat.key,label);
    input.addEventListener("change",()=>setCategoryEnabled(cat,input.checked));
  });
  row.parentNode.insertBefore(wrap,row);syncAll();
}

function decorateEventCard(card,event){
  const cat=categoryById.get(event.id);if(!card||!cat)return;
  eventEnabled.set(event.id,!!event.enabled);card.dataset.eventId=event.id;card.dataset.eventCategory=cat.key;card.style.setProperty("--event-category-color",cat.color);
  const tag=card.querySelector(".tags .tag");if(tag){tag.className="tag andersonCategoryEventTag";tag.textContent=cat.name;tag.title=`Category: ${cat.name}`;tag.style.setProperty("--category-color",cat.color);}
}
const originalRenderEvents=renderEvents;
renderEvents=function(events){
  originalRenderEvents(events);const cards=[...document.querySelectorAll("#eventList > .event")];
  events.forEach((event,i)=>decorateEventCard(cards[i],event));syncAll();
};

function addCustomTag(card){
  if(!card||card.querySelector(".andersonCustomCategoryEventTag"))return;
  const host=card.querySelector(".small")||card.firstElementChild;if(!host)return;
  const tag=document.createElement("span");tag.className="tag andersonCategoryEventTag andersonCustomCategoryEventTag";tag.textContent=custom.name;tag.style.setProperty("--category-color",custom.color);tag.title="Category: Custom Events";tag.style.marginLeft="5px";host.appendChild(tag);card.style.setProperty("--event-category-color",custom.color);
}
function decorateCustomLists(){
  ["customScheduleList","homeCustomLightList","customPresetList"].forEach(id=>{const root=document.getElementById(id);if(root)root.querySelectorAll(":scope > .card").forEach(addCustomTag);});
}
function watchCustomLists(){
  ["customScheduleList","homeCustomLightList","customPresetList"].forEach(id=>{const root=document.getElementById(id);if(root)new MutationObserver(decorateCustomLists).observe(root,{childList:true,subtree:true});});decorateCustomLists();
}

async function refreshBuiltInStates(){
  if(scanBusy){scanQueued=true;return;}if(!expandedSelected()||typeof API_MODE!=="undefined"&&!API_MODE)return;
  scanBusy=true;scanQueued=false;const year=Number(document.getElementById("yearSelect")?.value)||new Date().getFullYear();const next=new Map();
  try{
    for(let month=1;month<=12;month++){
      const response=await api(`/api/events?year=${year}&month=${month}&categoryState=${Date.now()}`);
      (response.events||[]).forEach(event=>next.set(event.id,!!event.enabled));
    }
    if(next.size){eventEnabled.clear();next.forEach((v,k)=>eventEnabled.set(k,v));}
  }catch(err){console.warn("Unable to refresh Anderson category states",err);}
  finally{scanBusy=false;syncAll();if(scanQueued)setTimeout(refreshBuiltInStates,80);}
}
async function refreshCustomStates(){
  if(customScanBusy||typeof API_MODE!=="undefined"&&!API_MODE)return;customScanBusy=true;
  try{const response=await api(`/api/presets?categoryState=${Date.now()}`);customEnabled.clear();(response.presets||[]).forEach(item=>customEnabled.set(item.id,item.enabled!==false));}
  catch(err){console.warn("Unable to refresh custom category state",err);}
  finally{customScanBusy=false;syncAll();}
}
async function refreshCategoryStates(){await refreshBuiltInStates();await refreshCustomStates();}

async function setBuiltInCategory(cat,wanted){
  if(!expandedSelected()){syncAll();status("Category controls apply to Expanded Basic and Expanded Advanced schedules.");return;}
  const targets=cat.ids.filter(id=>!eventEnabled.has(id)||eventEnabled.get(id)!==wanted);let done=0,failed=0;
  for(const id of targets){
    try{await post("/api/event",{id,enabled:wanted});eventEnabled.set(id,wanted);done++;if(done===targets.length||done%8===0)status(`${wanted?"Enabling":"Disabling"} ${cat.name}… ${done}/${targets.length}`);}
    catch(err){failed++;console.warn(`Category update failed for ${id}`,err);break;}
  }
  if(failed)await refreshBuiltInStates();
  const generation=typeof invalidateEventRequest==="function"?invalidateEventRequest():undefined;
  const jobs=[];if(typeof loadEvents==="function")jobs.push(loadEvents(generation));if(typeof loadFavorites==="function")jobs.push(loadFavorites());await Promise.allSettled(jobs);
  status(failed?`${cat.name} category was only partially changed. Reconnect and try again.`:`${cat.name} category ${wanted?"enabled":"disabled"}.`);
}
async function setCustomCategory(cat,wanted){
  if(!customEnabled.size)await refreshCustomStates();const targets=[...customEnabled].filter(([,enabled])=>enabled!==wanted).map(([id])=>id);let done=0,failed=0;
  for(const id of targets){
    try{await post("/api/preset",{id,enabled:wanted});customEnabled.set(id,wanted);done++;if(done===targets.length||done%4===0)status(`${wanted?"Enabling":"Disabling"} Custom Events… ${done}/${targets.length}`);}
    catch(err){failed++;console.warn(`Custom category update failed for ${id}`,err);break;}
  }
  if(failed)await refreshCustomStates();
  const jobs=[];if(typeof loadHomeCustomLights==="function")jobs.push(loadHomeCustomLights());if(typeof loadFavorites==="function")jobs.push(loadFavorites());if(typeof loadCustomSchedules==="function")jobs.push(loadCustomSchedules());if(typeof currentRole!=="undefined"&&currentRole==="admin"&&typeof loadCustomPresets==="function")jobs.push(loadCustomPresets());await Promise.allSettled(jobs);decorateCustomLists();
  status(failed?"Custom Events were only partially changed. Reconnect and try again.":`Custom Events ${wanted?"enabled":"disabled"}.`);
}
async function setCategoryEnabled(cat,wanted){
  if(categoryBusy)return;categoryBusy=true;syncAll();
  try{cat.custom?await setCustomCategory(cat,wanted):await setBuiltInCategory(cat,wanted);}
  finally{categoryBusy=false;syncAll();}
}

function scheduleThemeRefresh(){clearTimeout(themeRefreshTimer);themeRefreshTimer=setTimeout(()=>{syncAll();if(expandedSelected())refreshBuiltInStates();},220);}
function watchTheme(){
  ["eventColors1","eventColors3028","eventColors3029"].forEach(id=>{const node=document.getElementById(id);if(node)new MutationObserver(scheduleThemeRefresh).observe(node,{attributes:true,attributeFilter:["aria-pressed"]});});
}
function watchYear(){document.getElementById("yearSelect")?.addEventListener("change",()=>setTimeout(refreshBuiltInStates,80));}

buildBar();watchCustomLists();watchTheme();watchYear();syncAll();
window.addEventListener("anderson-profile-selected",()=>setTimeout(refreshCategoryStates,120));
window.addEventListener("anderson-profile-cleared",()=>{eventEnabled.clear();customEnabled.clear();syncAll();});
setTimeout(refreshCategoryStates,350);
})();
