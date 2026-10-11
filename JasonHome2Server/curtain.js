/* Jason Home 2 SmartDawn DN5E58. Standalone tab: does not change Eufy, AI, Factory or schedules. */
(()=>{'use strict';
const patternGroups=[15193,15194,15195,15196,15197,15198,15199,15200,15201,15202,15203,15204,15205,15206,15207,15208,15209,15210,15211,15212,15213,15214,15215,15216,15217,15218,15219,15220,15221,15222,15224,15225,83494];
const patternIndexes=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,33];
const catalog=Array.from({length:88},(_,id)=>({id,name:`E-${id}`,group:id<55?15924:patternGroups[id-55],index:id<55?id:patternIndexes[id-55],type:id<55?3:1,verified:true}));
catalog.push({id:88,name:'E-88',group:null,index:null,type:0,verified:false});
const $=id=>document.getElementById(id);
const create=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e};
let selected=null,connected=false,busy=false;
let serial=0;const requests=new Map();
window.__curtainNativeResult=(id,result)=>{const p=requests.get(id);if(!p)return;requests.delete(id);let data=result;try{if(typeof data==='string')data=JSON.parse(data)}catch{data={ok:false,error:'Malformed native Bluetooth response'}};if(data?.ok)p.resolve(data);else{const err=new Error(data?.error||`Bluetooth request failed${data?.status?' ('+data.status+')':''}`);err.devices=Array.isArray(data?.devices)?data.devices:[];p.reject(err);}};
function call(action,data={}){return new Promise((resolve,reject)=>{if(!window.AndroidCurtain||typeof AndroidCurtain.call!=='function')return reject(new Error('Updated Jason Home 2 APK required for direct Bluetooth.'));const id=String(++serial);requests.set(id,{resolve,reject});try{AndroidCurtain.call(id,action,JSON.stringify(data));}catch(e){requests.delete(id);reject(e)}setTimeout(()=>{if(requests.has(id)){requests.delete(id);reject(new Error('Bluetooth '+action+' timed out. Try disconnecting SmartDawn and reconnecting.'))}},action==='connect'?65000:30000);});}
function init(){if($('jh2CurtainTab'))return;const nav=document.querySelector('.v3BottomNav')||document.querySelector('.nav');const container=document.querySelector('.wrap');if(!nav||!container)return;
  const tab=create('button','tab');tab.id='jh2CurtainTab';tab.type='button';tab.dataset.tab='curtain';tab.innerHTML='<svg class="v3Icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 4h18M5 4v17m14-17v17M8 5v15m4-15v15m4-15v15"/></svg><span>Curtain</span>';
  const settings=nav.querySelector('.tab[data-tab="settings"]');nav.insertBefore(tab,settings||null);nav.style.gridTemplateColumns='repeat('+nav.querySelectorAll('.tab').length+',minmax(0,1fr))';
  const page=create('section','page jh2-curtain-page');page.dataset.page='curtain';page.hidden=true;
  page.innerHTML='<div class="v3PageTitle"><span>SMARTDAWN DN5E58</span><h2>Curtain Lights</h2></div>'+
    '<div class="panel"><strong>Bluetooth controller</strong><div class="sub">Connect directly to the SmartDawn curtain from this phone. Close the SmartDawn app before connecting here.</div><div class="jh2-curtain-row" style="margin-top:12px"><button class="btn primary" id="jh2CurtainConnect" type="button">Connect</button><button class="btn" id="jh2CurtainScan" type="button">Scan devices</button><button class="btn" id="jh2CurtainDisconnect" type="button">Disconnect</button><button class="btn" id="jh2CurtainRefresh" type="button">Refresh</button></div><div id="jh2CurtainStatus" class="jh2-curtain-status" role="status">Disconnected</div><div id="jh2CurtainDevices" class="jh2-curtain-devices" aria-label="Nearby Bluetooth devices"></div></div>'+
    '<div class="panel"><strong>Power and speed</strong><div class="jh2-curtain-row" style="margin-top:12px"><button id="jh2CurtainOn" class="btn primary" type="button">On</button><button id="jh2CurtainOff" class="btn" type="button">Off</button></div><label class="jh2-curtain-label" for="jh2CurtainBrightness">Brightness <output id="jh2CurtainBrightnessOutput">100%</output></label><input id="jh2CurtainBrightness" type="range" min="1" max="100" value="100"><label class="jh2-curtain-label" for="jh2CurtainSpeed">Speed <output id="jh2CurtainSpeedOutput">100%</output></label><input id="jh2CurtainSpeed" type="range" min="1" max="100" value="100"></div>'+
    '<div class="panel"><strong>Layout correction</strong><div class="sub">Layout writes are experimental: the original capture did not verify these opcodes. The matrix below shows the requested orientation locally. Check the physical curtain after connecting.</div><div class="jh2-curtain-matrix-wrap"><div id="jh2CurtainMatrixPreview" class="jh2-curtain-matrix" aria-label="40 by 40 curtain orientation illustration"><span>TOP</span><b>↖</b><b>↗</b><span>LEFT</span><strong>CURTAIN</strong><span>RIGHT</span><b>↙</b><b>↘</b><span>BOTTOM</span></div></div><div class="jh2-curtain-layout" style="margin-top:10px"><button class="btn" data-jh2-layout="0">Reset</button><button class="btn" data-jh2-layout="4">Rotate 180°</button><button class="btn" data-jh2-layout="5">Flip Top/Bottom</button><button class="btn" data-jh2-layout="6">Flip Left/Right</button></div></div>'+
    '<div class="panel"><strong>88 SmartDawn effects</strong><div class="sub">Captured catalog: E-0 through E-87 (88 effects). The requested E-88 has no verified code yet and is shown separately. Thumbnail animations are illustrative, not exact SmartDawn recordings.</div><input id="jh2CurtainSearch" class="field" placeholder="Find effect (e.g. E-55)" style="margin-top:10px" aria-label="Search curtain effects"><div id="jh2CurtainEffects" class="jh2-curtain-effect-grid"></div></div>';
  container.appendChild(page);
  const status=(message,level='')=>{const n=$('jh2CurtainStatus');n.textContent=message;n.className='jh2-curtain-status '+level};
  const setBusy=b=>{busy=b;page.querySelectorAll('button').forEach(x=>x.disabled=b)};
  function renderDevices(devices){
    const area=$('jh2CurtainDevices');if(!area)return;
    area.replaceChildren();
    const listed=Array.isArray(devices)?devices:[];
    if(!listed.length)return;
    const label=create('div','jh2-curtain-device-hint','Nearby BLE devices detected. Tap the matching curtain. Android may list it under a cached name.');
    area.append(label);
    const sorted=listed.slice().sort((a,b)=>Number(/DN5E58|SMARTDAWN|DNX/i.test(b.name||''))-Number(/DN5E58|SMARTDAWN|DNX/i.test(a.name||''))||Number(b.rssi||-127)-Number(a.rssi||-127));
    for(const device of sorted){
      if(!device||typeof device.address!=='string')continue;
      const address=device.address;
      const button=create('button','btn jh2-curtain-device');
      button.type='button';
      const name=String(device.name||'Unnamed BLE device');
      button.textContent=name+' · '+address.slice(-8)+(Number.isFinite(Number(device.rssi))&&Number(device.rssi)>-127?' · '+device.rssi+' dBm':'');
      button.addEventListener('click',()=>perform('connect',{address},'Connect '+name));
      area.append(button);
    }
  }
  const perform=async (action,data,label)=>{
    if(busy)return;
    setBusy(true);status(`${label}…`);
    try{
      const r=await call(action,data);
      connected=!!r.connected;
      if(action==='scan'||Array.isArray(r.devices)&&r.devices.length)renderDevices(r.devices);
      status(`${label}: ${r.message||'Command delivered. Check the curtain lights.'}`,'success');
      return r;
    }catch(e){
      if(Array.isArray(e.devices)&&e.devices.length)renderDevices(e.devices);
      status(e.message,'error');
    }finally{setBusy(false)}
  };
  $('jh2CurtainConnect').addEventListener('click',async()=>{const r=await perform('connect',{},'Bluetooth connection');if(r)connected=!!r.connected});
  $('jh2CurtainScan').addEventListener('click',()=>perform('scan',{},'Searching nearby BLE devices'));
  $('jh2CurtainDisconnect').addEventListener('click',async()=>{const r=await perform('disconnect',{},'Disconnect');if(r)connected=false});
  $('jh2CurtainRefresh').addEventListener('click',()=>perform('status',{},'Bluetooth status'));
  $('jh2CurtainOn').addEventListener('click',()=>perform('power',{value:true},'Power on'));
  $('jh2CurtainOff').addEventListener('click',()=>perform('power',{value:false},'Power off'));
  for(const k of ['Brightness','Speed']){
    const field=$('jh2Curtain'+k),out=$('jh2Curtain'+k+'Output');field.addEventListener('input',()=>out.textContent=field.value+'%');field.addEventListener('change',()=>perform(k.toLowerCase(),{value:Number(field.value)},k));
  }
  page.querySelectorAll('[data-jh2-layout]').forEach(b=>b.addEventListener('click',async()=>{
    const value=Number(b.dataset.jh2Layout),matrix=$('jh2CurtainMatrixPreview');
    if(matrix)matrix.dataset.orientation=String(value);
    const sent=await perform('layout',{value},b.textContent.trim());
    if(sent)status('Bluetooth write acknowledged; physical rotation/flip remains unverified. The graphic above is only a local orientation preview.','error');
    else status('No curtain Bluetooth connection. Only the local orientation illustration changed; connect before testing physical flip/rotation.','error');
  }));
  function previewIcon(effect){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 98 48');
    svg.setAttribute('role','img');
    svg.setAttribute('aria-label',effect.verified?'Illustrative animated curtain preview for '+effect.name:'Unknown effect preview — uncaptured');
    svg.classList.add('jh2-effect-preview');
    if(!effect.verified){
      const label=document.createElementNS('http://www.w3.org/2000/svg','text');
      label.setAttribute('x','49');label.setAttribute('y','32');label.setAttribute('text-anchor','middle');
      label.setAttribute('fill','#a9bed3');label.setAttribute('font-size','30');label.textContent='?';svg.append(label);return svg;
    }
    const seed=effect.id,base=(seed*41+185)%360,mode=seed%6;
    const background=document.createElementNS('http://www.w3.org/2000/svg','rect');
    background.setAttribute('width','98');background.setAttribute('height','48');background.setAttribute('rx','5');background.setAttribute('fill','#061122');svg.append(background);
    for(let i=0;i<48;i++){
      const row=Math.floor(i/12),col=i%12,spot=document.createElementNS('http://www.w3.org/2000/svg','circle');
      spot.setAttribute('cx',String(7+col*7.7));spot.setAttribute('cy',String(7+row*11.3));spot.setAttribute('r',String(2.4+(seed%3)*.15));
      const phase=mode===0?col:mode===1?row:mode===2?(row+col):mode===3?Math.abs(col-5.5):mode===4?(col*3+row*7+seed)%12:(i*13+seed)%12;
      const hue=(base+phase*(mode===5?31:13))%360;
      spot.setAttribute('fill',`hsl(${hue},95%,${(i+seed)%7===0?80:54}%)`);
      spot.style.animationDelay=`-${((phase+seed%9)*.13).toFixed(2)}s`;
      spot.classList.add('jh2-preview-light');
      svg.append(spot);
    }
    return svg;
  }
  const list=$('jh2CurtainEffects');
  function render(){
    const needle=$('jh2CurtainSearch').value.trim().toLowerCase();list.replaceChildren();
    catalog.filter(x=>!needle||x.name.toLowerCase().includes(needle)||String(x.id).includes(needle)).forEach(e=>{
      const b=create('button','jh2-curtain-effect'+(selected===e.id?' active':'')+(!e.verified?' unverified':''));
      b.type='button';b.dataset.effect=String(e.id);
      b.setAttribute('aria-label',e.verified?`${e.name} illustrative effect preview`:`${e.name} is not in the captured device catalog`);
      b.append(previewIcon(e),create('strong','',e.name),create('small','',!e.verified?'Not captured':e.type===3?'Scene':'Pattern'));
      b.addEventListener('click',async()=>{
        if(!e.verified){status('E-88 is not in the captured 88-effect catalog. Please capture its real group/index before use.','error');return;}
        selected=e.id;render();await perform('effect',{id:e.id,group:e.group,index:e.index},e.name);
      });
      list.append(b);
    });
  }
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