(()=>{"use strict";
if(typeof renderEvents!=="function"||!document.getElementById("eventSearch"))return;

const fallback=[
["holiday","Holiday","#FFD166"],["patriotic","Patriotic / Federal","#FF6B6B"],["religious","Religious","#C084FC"],["military","Military / Veterans","#60A5FA"],["firstresponders","First Responders / Public Safety","#FB923C"],["family","Family / Personal","#F472B6"],["cultural","Cultural / Heritage","#34D399"],["civic","Community / Civic","#22D3EE"],["sports","Sports / Game Days","#A3E635"],["health","Health / Medical Awareness","#FB7185"],["memorial","Memorial / Remembrance","#CBD5E1"],["lgbtq","LGBTQ+ / Pride","#E879F9"],["environment","Environmental","#2DD4BF"],["seasonal","Seasonal","#F59E0B"],["social","Awareness — General / Social","#A78BFA"]
].map((x,index)=>({index,id:x[0],name:x[1],color:x[2],enabled:true}));
const custom={id:"custom",name:"Custom Events",color:"#38BDF8",enabled:true,custom:true};
let categories=fallback.map(x=>({...x}));
const toggleById=new Map(),customEnabled=new Map();
let categoryBusy=false,customBusy=false,themeTimer=0;

function expandedSelected(){return document.getElementById("eventColors3028")?.getAttribute("aria-pressed")==="true"||document.getElementById("eventColors3029")?.getAttribute("aria-pressed")==="true";}
function shortName(cat){return cat.id==="firstresponders"?"First Responders":cat.id==="health"?"Health / Medical":cat.id==="social"?"General / Social":cat.name;}
function allCategories(){return[...categories,custom];}
function customState(){const values=[...customEnabled.values()];return{count:values.length,on:values.filter(Boolean).length};}
function syncOne(cat){const input=toggleById.get(cat.id)?.querySelector("input");if(!input)return;if(cat.custom){const s=customState();input.checked=s.count>0&&s.on===s.count;input.indeterminate=s.on>0&&s.on<s.count;input.disabled=categoryBusy||customBusy||s.count===0;}else{input.checked=!!cat.enabled;input.indeterminate=false;input.disabled=categoryBusy||!expandedSelected();}}
function syncAll(){allCategories().forEach(syncOne);document.getElementById("eventCategoryBar")?.classList.toggle("majorMode",!expandedSelected());}

function buildBar(){
 const search=document.getElementById("eventSearch"),row=search?.closest(".row");if(!row)return;
 let bar=document.getElementById("eventCategoryBar");if(bar)bar.remove();toggleById.clear();bar=document.createElement("div");bar.id="eventCategoryBar";bar.className="andersonCategoryBar";bar.setAttribute("aria-label","Event categories");
 allCategories().forEach(cat=>{const label=document.createElement("label");label.className="andersonCategoryToggle";label.style.setProperty("--category-color",cat.color);label.title=cat.custom?"Enable or disable all saved custom events":`Enable or disable the ${cat.name} category in Expanded schedules`;const input=document.createElement("input");input.type="checkbox";input.checked=!!cat.enabled;input.setAttribute("aria-label",`Enable ${cat.name} category`);const pill=document.createElement("span");pill.className="andersonCategoryPill";pill.textContent=shortName(cat);label.append(input,pill);bar.appendChild(label);toggleById.set(cat.id,label);input.addEventListener("change",()=>setCategory(cat,input.checked));});
 row.parentNode.insertBefore(bar,row);syncAll();
}

function decorateEvent(card,event){
 if(!card)return;const id=event.categoryId||"",cat=categories.find(x=>x.id===id)||fallback.find(x=>x.id===id);if(!cat)return;card.dataset.eventCategory=cat.id;card.style.setProperty("--event-category-color",event.categoryColor||cat.color);const tag=card.querySelector(".tags .tag");if(tag){tag.className="tag andersonCategoryEventTag";tag.textContent=event.categoryName||cat.name;tag.title=`Category: ${event.categoryName||cat.name}`;tag.style.setProperty("--category-color",event.categoryColor||cat.color);}}
const originalRenderEvents=renderEvents;
renderEvents=function(events){originalRenderEvents(events);const cards=[...document.querySelectorAll("#eventList > .event")];events.forEach((event,i)=>decorateEvent(cards[i],event));syncAll();};

function addCustomTag(card){if(!card||card.querySelector(".andersonCustomCategoryEventTag"))return;const host=card.querySelector(".small")||card.firstElementChild;if(!host)return;const tag=document.createElement("span");tag.className="tag andersonCategoryEventTag andersonCustomCategoryEventTag";tag.textContent=custom.name;tag.style.setProperty("--category-color",custom.color);tag.title="Category: Custom Events";tag.style.marginLeft="5px";host.appendChild(tag);card.style.setProperty("--event-category-color",custom.color);}
function decorateCustomLists(){["customScheduleList","homeCustomLightList","customPresetList"].forEach(id=>{const root=document.getElementById(id);if(root)root.querySelectorAll(":scope > .card").forEach(addCustomTag);});}
function watchCustomLists(){["customScheduleList","homeCustomLightList","customPresetList"].forEach(id=>{const root=document.getElementById(id);if(root)new MutationObserver(decorateCustomLists).observe(root,{childList:true,subtree:true});});decorateCustomLists();}

async function loadBuiltInCategories(){try{const data=await api(`/api/event-categories?ts=${Date.now()}`,{cache:"no-store"});if(Array.isArray(data.categories)&&data.categories.length===15)categories=data.categories.map(x=>({index:+x.index,id:x.id,name:x.name,color:x.color,enabled:x.enabled!==false,count:+x.count||0}));}catch(e){console.warn("Event categories unavailable",e);}buildBar();syncAll();}
async function loadCustomCategory(){if(customBusy||typeof API_MODE!=="undefined"&&!API_MODE)return;customBusy=true;try{const data=await api(`/api/presets?categoryState=${Date.now()}`);customEnabled.clear();(data.presets||[]).forEach(x=>customEnabled.set(x.id,x.enabled!==false));}catch(e){console.warn("Custom category unavailable",e);}finally{customBusy=false;syncAll();}}

async function setBuiltInCategory(cat,wanted){if(!expandedSelected()){syncAll();status("Category switches apply to Expanded Basic and Expanded Advanced schedules.");return;}status(`${wanted?"Enabling":"Disabling"} ${cat.name}…`);try{const out=await post("/api/event-categories",{index:cat.index,enabled:wanted});cat.enabled=out.enabled!==false;const generation=typeof invalidateEventRequest==="function"?invalidateEventRequest():undefined,jobs=[];if(typeof loadEvents==="function")jobs.push(loadEvents(generation));if(typeof loadFavorites==="function")jobs.push(loadFavorites());await Promise.allSettled(jobs);status(`${cat.name} category ${cat.enabled?"enabled":"disabled"}. Individual event choices were preserved.`);}catch(e){await loadBuiltInCategories();status(`${cat.name} category change failed: ${e.message}`);}}
async function setCustomCategory(wanted){if(!customEnabled.size)await loadCustomCategory();const targets=[...customEnabled].filter(([,on])=>on!==wanted).map(([id])=>id);let done=0;for(const id of targets){try{await post("/api/preset",{id,enabled:wanted});customEnabled.set(id,wanted);done++;}catch(e){await loadCustomCategory();status(`Custom Events category change stopped after ${done}: ${e.message}`);return;}}const jobs=[];if(typeof loadHomeCustomLights==="function")jobs.push(loadHomeCustomLights());if(typeof loadFavorites==="function")jobs.push(loadFavorites());if(typeof loadCustomSchedules==="function")jobs.push(loadCustomSchedules());if(typeof currentRole!=="undefined"&&currentRole==="admin"&&typeof loadCustomPresets==="function")jobs.push(loadCustomPresets());await Promise.allSettled(jobs);decorateCustomLists();status(`Custom Events ${wanted?"enabled":"disabled"}.`);}
async function setCategory(cat,wanted){if(categoryBusy)return;categoryBusy=true;syncAll();try{cat.custom?await setCustomCategory(wanted):await setBuiltInCategory(cat,wanted);}finally{categoryBusy=false;syncAll();}}

function watchTheme(){["eventColors1","eventColors3028","eventColors3029"].forEach(id=>{const node=document.getElementById(id);if(node)new MutationObserver(()=>{clearTimeout(themeTimer);themeTimer=setTimeout(()=>{syncAll();loadBuiltInCategories();},180);}).observe(node,{attributes:true,attributeFilter:["aria-pressed"]});});}

buildBar();watchCustomLists();watchTheme();
window.addEventListener("anderson-profile-selected",()=>setTimeout(()=>{loadBuiltInCategories();loadCustomCategory();const generation=typeof invalidateEventRequest==="function"?invalidateEventRequest():undefined;typeof loadEvents==="function"&&loadEvents(generation);},100));
window.addEventListener("anderson-profile-cleared",()=>{customEnabled.clear();syncAll();});
setTimeout(()=>{loadBuiltInCategories();loadCustomCategory();const generation=typeof invalidateEventRequest==="function"?invalidateEventRequest():undefined;typeof loadEvents==="function"&&loadEvents(generation);},250);
})();
