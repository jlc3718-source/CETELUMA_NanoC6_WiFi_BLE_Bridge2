const $=id=>document.getElementById(id);
const state={target:'All',brightness:75,speed:3,effect:'Solid / Static',colors:['#FFFFFF'],mode:'direct',configured:false};
const effects=['Solid / Static','Jump','Breath','Strobe','Chase','Gradient Sweep','Candy Cane','Twinkle / Sparkle','Wipe / Fill','Meteor / Comet','Rainbow Flow','Pulse Wave'];
const palette=['#FFFFFF','#FF0D00','#E08700','#FFD000','#28FF00','#00B4B4','#245BFF','#0D00FF','#5B00E6','#D000FF','#FF1493','#FF6B6B'];

function native(method,path,body){
  const raw=AndroidAnderson.request(method,path,body?JSON.stringify(body):'' ,'');
  const outer=JSON.parse(raw||'{}');let data={};
  try{data=outer.body?JSON.parse(outer.body):{};}catch{data={raw:outer.body};}
  if((outer.status||500)<200||(outer.status||500)>=300)throw new Error(data.error||outer.statusText||'Request failed');
  return data;
}
function setStatus(msg,bad=false){const e=$('statusMsg');e.textContent=msg||'';e.classList.toggle('bad',!!bad);}
function fmtTime(iso){if(!iso)return '—';try{return new Date(iso).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}catch{return '—';}}
function rgbText(hex){return hex.toUpperCase();}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function nav(tab){
  document.querySelectorAll('.screen').forEach(x=>x.classList.toggle('active',x.id===`screen-${tab}`));
  document.querySelectorAll('.navBtn').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));
  if(tab==='schedules')loadSchedules();if(tab==='settings')loadConfig();
}
function bindNav(){document.querySelectorAll('.navBtn').forEach(b=>b.onclick=()=>nav(b.dataset.tab));}
function renderTargets(){document.querySelectorAll('.targetBtn').forEach(b=>b.classList.toggle('active',b.dataset.target===state.target));}
function renderEffects(){for(const id of ['effect','createEffect','scheduleEffect']){const s=$(id);if(!s)continue;s.innerHTML=effects.map(x=>`<option>${esc(x)}</option>`).join('');s.value=state.effect;}}
function renderPalette(){
  const home=$('palette');home.innerHTML=palette.map(c=>`<button class="swatch ${state.colors.includes(c)?'active':''}" data-color="${c}" style="--c:${c}" title="${c}"></button>`).join('');
  home.querySelectorAll('.swatch').forEach(b=>b.onclick=()=>{state.colors=[b.dataset.color];renderPalette();$('colorLabel').textContent=rgbText(state.colors[0]);});
  const create=$('createPalette');create.innerHTML=palette.map(c=>`<button class="swatch ${state.colors.includes(c)?'active':''}" data-color="${c}" style="--c:${c}"></button>`).join('');
  create.querySelectorAll('.swatch').forEach(b=>b.onclick=()=>{const c=b.dataset.color;if(state.colors.includes(c)){if(state.colors.length>1)state.colors=state.colors.filter(x=>x!==c);}else if(state.colors.length<8)state.colors.push(c);renderPalette();});
}
function currentScene(power=true){return {target:state.target,power,brightness:state.brightness,speed:state.speed,effect:state.effect,colors:[...state.colors]};}
async function sendScene(power=true){
  setStatus(`${power?'Applying':'Turning off'} ${state.target}…`);
  try{
    const r=native('POST','/api/control',power?currentScene(true):{target:state.target,power:false});
    setStatus(power?`Scene sent to ${r.updated??state.target}${r.total?`/${r.total}`:''}`:`${state.target} off`);
    setTimeout(loadStatus,800);
  }catch(e){setStatus(e.message,true);}
}
function bindControls(){
  document.querySelectorAll('.targetBtn').forEach(b=>b.onclick=()=>{state.target=b.dataset.target;renderTargets();});
  $('powerOn').onclick=()=>sendScene(true);$('powerOff').onclick=()=>sendScene(false);$('applyScene').onclick=()=>sendScene(true);
  $('resume').onclick=async()=>{try{native('POST','/api/resume',{});setStatus('Schedule resumed');loadStatus();}catch(e){setStatus(e.message,true);}};
  $('brightness').oninput=e=>{state.brightness=+e.target.value;$('brightnessValue').textContent=`${state.brightness}%`;};
  $('speed').oninput=e=>{state.speed=+e.target.value;$('speedValue').textContent=['Very Slow','Slow','Normal','Fast','Very Fast'][state.speed-1];};
  $('effect').onchange=e=>state.effect=e.target.value;
  $('createBrightness').oninput=e=>{state.brightness=+e.target.value;$('createBrightnessValue').textContent=`${state.brightness}%`;};
  $('createSpeed').oninput=e=>{state.speed=+e.target.value;$('createSpeedValue').textContent=['Very Slow','Slow','Normal','Fast','Very Fast'][state.speed-1];};
  $('createEffect').onchange=e=>state.effect=e.target.value;$('previewScene').onclick=()=>sendScene(true);
}
function renderDevices(devices=[]){
  $('devices').innerHTML=(devices.length?devices:[{name:'Pool',model:'E120'},{name:'House',model:'E120'},{name:'Garage',model:'E22'},{name:'Shed',model:'E22'}]).map(d=>`<div class="deviceCard"><div><strong>${esc(d.name)}</strong><span>${esc(d.model||'')}</span></div><div class="deviceState ${d.ready?'ok':'idle'}">${d.ready?'Ready':(d.last_error?'Error':'Known')}</div>${d.last_error?`<small>${esc(d.last_error)}</small>`:''}</div>`).join('');
}
async function loadStatus(){
  try{
    const r=native('GET','/api/status','');
    $('controllerStatus').textContent=r.controller||'Online';$('architecture').textContent=r.architecture||'';
    $('eufyStatus').textContent=r.eufy?.status||'—';$('dusk').textContent=r.astronomy?.dusk||'—';$('dawn').textContent=r.astronomy?.dawn||'—';
    $('nextEvent').textContent=r.nextEvent?.name?`${r.nextEvent.name} • ${fmtTime(r.nextEvent.at)}`:(r.nextEvent?.label||'No upcoming event');
    $('override').textContent=r.override?.active?'Manual override active':'Schedule control';
    renderDevices(r.devices||[]);setStatus('Ready');
  }catch(e){setStatus(e.message,true);$('controllerStatus').textContent='Unavailable';}
}
async function loadConfig(){
  try{
    const r=native('GET','/api/cloud/config','');state.mode=r.mode||'direct';state.configured=!!r.configured;
    $('cloudMode').checked=state.mode==='cloud';$('directMode').checked=state.mode!=='cloud';$('endpoint').textContent=r.endpoint||'';
    $('tokenConfigured').textContent=r.configured?'Token saved securely':'Token not configured';
    $('directFallback').textContent=r.directReady?`Direct fallback ready • ${r.directStatus}`:`Direct fallback • ${r.directStatus||'not connected'}`;
  }catch(e){setStatus(e.message,true);}
}
async function saveCloudConfig(){
  const token=$('apiToken').value.trim(),mode=$('cloudMode').checked?'cloud':'direct';
  try{native('POST','/api/cloud/config',{mode,...(token?{token}:{})});$('apiToken').value='';await loadConfig();setStatus(`Mode changed to ${mode==='cloud'?'Cloudflare':'Direct Eufy'}`);loadStatus();}catch(e){setStatus(e.message,true);}
}
async function testCloud(){try{const r=native('GET','/api/cloud/test','');setStatus(`Cloud test: ${r.eufy?.status||r.controller||'OK'}`);}catch(e){setStatus(e.message,true);}}
function bindSettings(){
  $('saveCloud').onclick=saveCloudConfig;$('testCloud').onclick=testCloud;
  $('reconnectCloud').onclick=async()=>{try{native('POST','/api/reconnect',{});setStatus('Cloud reconnect requested');}catch(e){setStatus(e.message,true);}};
  $('reconcileCloud').onclick=async()=>{try{native('POST','/api/reconcile',{});setStatus('Cloud reconciliation requested');}catch(e){setStatus(e.message,true);}};
}
function scheduleFormPayload(){return {id:$('scheduleId').value||undefined,name:$('scheduleName').value||'Schedule',enabled:$('scheduleEnabled').checked,days:$('scheduleDays').value||'*',startKind:$('scheduleStartKind').value,startValue:$('scheduleStartValue').value,endKind:$('scheduleEndKind').value,endValue:$('scheduleEndValue').value,target:$('scheduleTarget').value,effect:$('scheduleEffect').value,colors:[$('scheduleColor').value],brightness:+$('scheduleBrightness').value,speed:+$('scheduleSpeed').value};}
async function saveSchedule(){try{native('POST','/api/schedules',scheduleFormPayload());setStatus('Schedule saved');clearScheduleForm();loadSchedules();}catch(e){setStatus(e.message,true);}}
function clearScheduleForm(){$('scheduleId').value='';$('scheduleName').value='';$('scheduleEnabled').checked=true;$('scheduleDays').value='*';$('scheduleStartKind').value='dusk';$('scheduleStartValue').value='0';$('scheduleEndKind').value='clock';$('scheduleEndValue').value='23:00';}
async function loadSchedules(){
  try{
    const r=native('GET','/api/schedules',''),rows=r.schedules||[];
    $('scheduleList').innerHTML=rows.length?rows.map(s=>`<div class="scheduleCard"><div><strong>${esc(s.name)}</strong><span>${esc(s.target)} • ${esc(s.start_kind)} ${esc(s.start_value)} → ${esc(s.end_kind)} ${esc(s.end_value)}</span><small>${esc(s.effect)} • ${s.brightness}% • speed ${s.speed}</small></div><button class="smallDanger" data-delete="${esc(s.id)}">Delete</button></div>`).join(''):'<div class="empty">No cloud schedules yet.</div>';
    $('scheduleList').querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{try{native('DELETE',`/api/schedules?id=${encodeURIComponent(b.dataset.delete)}`,'');loadSchedules();}catch(e){setStatus(e.message,true);}});
  }catch(e){$('scheduleList').innerHTML=`<div class="empty">${esc(e.message)}</div>`;}
}
function bindSchedules(){$('saveSchedule').onclick=saveSchedule;$('newSchedule').onclick=()=>{$('scheduleEditor').classList.toggle('open');};}
function init(){bindNav();renderEffects();renderPalette();renderTargets();bindControls();bindSettings();bindSchedules();clearScheduleForm();loadConfig().then(loadStatus);setInterval(()=>{if(document.visibilityState==='visible')loadStatus();},15000);}
window.addEventListener('DOMContentLoaded',init);
