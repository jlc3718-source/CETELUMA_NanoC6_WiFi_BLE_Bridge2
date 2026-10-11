/* Jason Home 2 SmartDawn DN5E58. Standalone tab: does not change Eufy, AI, Factory or schedules. */
(()=>{'use strict';
const catalog=Array.from({length:88},(_,id)=>({id,name:`E-${id}`,group:id<55?15924:15193+(id-55),index:id<55?id:id-55,type:id<55?3:1}));
const $=id=>document.getElementById(id);
const create=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e};
let selected=null,connected=false,busy=false;
let serial=0;const requests=new Map();
window.__curtainNativeResult=(id,result)=>{const p=requests.get(id);if(!p)return;requests.delete(id);let data=result;try{if(typeof data==='string')data=JSON.parse(data)}catch{data={ok:false,error:'Malformed native Bluetooth response'}};data?.ok?p.resolve(data):p.reject(new Error(data?.error||`Bluetooth request failed${data?.status?' ('+data.status+')':''}`));};
function call(action,data={}){return new Promise((resolve,reject)=>{if(!window.AndroidCurtain||typeof AndroidCurtain.call!=='function')return reject(new Error('Updated Jason Home 2 APK required for direct Bluetooth.'));const id=String(++serial);requests.set(id,{resolve,reject});try{AndroidCurtain.call(id,action,JSON.stringify(data));}catch(e){requests.delete(id);reject(e)}setTimeout(()=>{if(requests.has(id)){requests.delete(id);reject(new Error('Bluetooth '+action+' timed out. Try disconnecting SmartDawn and reconnecting.'))}},action==='connect'?65000:30000);});}
function init(){if($('jh2CurtainTab'))return;const nav=document.querySelector('.v3BottomNav')||document.querySelector('.nav');const container=document.querySelector('.wrap');if(!nav||!container)return;
  const tab=create('button','tab');tab.id='jh2CurtainTab';tab.type='button';tab.dataset.tab='curtain';tab.innerHTML='<svg class="v3Icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 4h18M5 4v17m14-17v17M8 5v15m4-15v15m4-15v15"/></svg><span>Curtain</span>';
  const settings=nav.querySelector('.tab[data-tab="settings"]');nav.insertBefore(tab,settings||null);nav.style.gridTemplateColumns='repeat('+nav.querySelectorAll('.tab').length+',minmax(0,1fr))';
  const page=create('section','page jh2-curtain-page');page.dataset.page='curtain';page.hidden=true;
  page.innerHTML='<div class="v3PageTitle"><span>SMARTDAWN DN5E58</span><h2>Curtain Lights</h2></div>'+
    '<div class="panel"><strong>Bluetooth controller</strong><div class="sub">Connect directly to the SmartDawn curtain from this phone. Close the SmartDawn app before connecting here.</div><div class="jh2-curtain-row" style="margin-top:12px"><button class="btn primary" id="jh2CurtainConnect" type="button">Connect</button><button class="btn" id="jh2CurtainDisconnect" type="button">Disconnect</button><button class="btn" id="jh2CurtainRefresh" type="button">Refresh</button></div><div id="jh2CurtainStatus" class="jh2-curtain-status" role="status">Disconnected</div></div>'+
    '<div class="panel"><strong>Power and speed</strong><div class="jh2-curtain-row" style="margin-top:12px"><button id="jh2CurtainOn" class="btn primary" type="button">On</button><button id="jh2CurtainOff" class="btn" type="button">Off</button></div><label class="jh2-curtain-label" for="jh2CurtainBrightness">Brightness <output id="jh2CurtainBrightnessOutput">100%</output></label><input id="jh2CurtainBrightness" type="range" min="1" max="100" value="100"><label class="jh2-curtain-label" for="jh2CurtainSpeed">Speed <output id="jh2CurtainSpeedOutput">100%</output></label><input id="jh2CurtainSpeed" type="range" min="1" max="100" value="100"></div>'+
    '<div class="panel"><strong>Layout correction</strong><div class="sub">SmartDawn layout codes verified in your Bluetooth capture.</div><div class="jh2-curtain-layout" style="margin-top:10px"><button class="btn" data-jh2-layout="0">Reset</button><button class="btn" data-jh2-layout="4">Rotate 180°</button><button class="btn" data-jh2-layout="5">Flip Top/Bottom</button><button class="btn" data-jh2-layout="6">Flip Left/Right</button></div></div>'+
    '<div class="panel"><strong>88 SmartDawn effects</strong><div class="sub">Choose E-0 through E-87. The first 55 are scenes; the rest are patterns.</div><input id="jh2CurtainSearch" class="field" placeholder="Find effect (e.g. E-55)" style="margin-top:10px" aria-label="Search curtain effects"><div id="jh2CurtainEffects" class="jh2-curtain-effect-grid"></div></div>';
  container.appendChild(page);
  const status=(message,level='')=>{const n=$('jh2CurtainStatus');n.textContent=message;n.className='jh2-curtain-status '+level};
  const setBusy=b=>{busy=b;page.querySelectorAll('button').forEach(x=>x.disabled=b)};
  const perform=async (action,data,label)=>{if(busy)return;setBusy(true);status(`${label}…`);try{const r=await call(action,data);connected=!!r.connected;status(`${label}: ${r.message||'Command delivered. Check the curtain lights.'}`,'success');return r;}catch(e){status(e.message,'error')}finally{setBusy(false)}};
  $('jh2CurtainConnect').addEventListener('click',async()=>{const r=await perform('connect',{},'Bluetooth connection');if(r)connected=!!r.connected});
  $('jh2CurtainDisconnect').addEventListener('click',async()=>{const r=await perform('disconnect',{},'Disconnect');if(r)connected=false});
  $('jh2CurtainRefresh').addEventListener('click',()=>perform('status',{},'Bluetooth status'));
  $('jh2CurtainOn').addEventListener('click',()=>perform('power',{value:true},'Power on'));
  $('jh2CurtainOff').addEventListener('click',()=>perform('power',{value:false},'Power off'));
  for(const k of ['Brightness','Speed']){
    const field=$('jh2Curtain'+k),out=$('jh2Curtain'+k+'Output');field.addEventListener('input',()=>out.textContent=field.value+'%');field.addEventListener('change',()=>perform(k.toLowerCase(),{value:Number(field.value)},k));
  }
  page.querySelectorAll('[data-jh2-layout]').forEach(b=>b.addEventListener('click',()=>perform('layout',{value:Number(b.dataset.jh2Layout)},b.textContent.trim())));
  const list=$('jh2CurtainEffects');function render(){const needle=$('jh2CurtainSearch').value.trim().toLowerCase();list.replaceChildren();catalog.filter(x=>!needle||x.name.toLowerCase().includes(needle)||String(x.id).includes(needle)).forEach(e=>{const b=create('button','jh2-curtain-effect'+(selected===e.id?' active':''));b.type='button';b.dataset.effect=String(e.id);b.setAttribute('aria-label',`${e.name} ${e.type===3?'scene':'pattern'}`);b.append(create('strong','',e.name),create('small','',e.type===3?'Scene':'Pattern'));b.addEventListener('click',async()=>{selected=e.id;render();await perform('effect',{id:e.id,group:e.group,index:e.index},e.name)});list.append(b)});}
  $('jh2CurtainSearch').addEventListener('input',render);render();
  // Switch with the existing .page.active router. Do not set [hidden] on the
  // Home, AI, Schedules or Factory pages: those contain independently animated
  // previews, and [hidden] can keep them invisible after a later navigation.
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p===page));
    page.hidden=false;
    nav.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b===tab));
    document.body.dataset.page='curtain';
    window.scrollTo({top:0,behavior:'smooth'});
  });
  nav.querySelectorAll('.tab:not([data-tab="curtain"])').forEach(b=>b.addEventListener('click',()=>{
    page.classList.remove('active');page.hidden=true;
    // Avoid touching the visibility of any original preview-containing page.
    if(typeof window.kickAnimation==='function')window.kickAnimation();
  }));
  if(!window.AndroidCurtain)status('Install the Jason Home 2 curtain-enabled APK to connect directly over Bluetooth.');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0));else setTimeout(init,0);
})();