/* Jason Home 2 NanoC6: explicit opt-in only; no on-page scheduler or BLE side effects. */
(()=>{'use strict';
const base=location.pathname.startsWith('/jason-home-2/')?'/jason-home-2':'';
function init(){
 const settings=document.querySelector('.v3SettingsPane[data-settings-pane="schedules"]');
 if(!settings||document.getElementById('jh2NanoSyncPanel'))return;
 const panel=document.createElement('div');
 panel.className='panel';panel.id='jh2NanoSyncPanel';
 panel.innerHTML='<strong>NanoC6 · Follow Eufy power and brightness</strong>'+
 '<div class="sub">When enabled, the curtain turns ON and OFF with the active Eufy schedule or manual override and follows its brightness. Disabled by default until you opt in; uses only the authenticated Oracle curtain relay.</div>'+
 '<label style="display:flex;align-items:center;gap:10px;margin-top:12px">'+
 '<input id="jh2NanoSyncEnabled" type="checkbox" aria-label="Follow Eufy schedule: on/off + brightnesshronization">'+
 '<span>Enable NanoC6 brightness sync</span></label>'+
 '<div class="sub" id="jh2NanoSyncStatus" role="status" style="margin-top:9px">Loading NanoC6 status…</div>'+
 '<button class="btn" id="jh2NanoSyncRefresh" type="button" style="margin-top:9px">Refresh status</button>';
 settings.append(panel);
 const checkbox=document.getElementById('jh2NanoSyncEnabled'),status=document.getElementById('jh2NanoSyncStatus');
 const refresh=document.getElementById('jh2NanoSyncRefresh');
 let working=false,configured=false;
 const show=(data)=>{
   configured=data.configured===true;
   checkbox.checked=data.enabled===true;
   checkbox.disabled=!data.configured||working;
   status.textContent=data.configured
     ?(data.enabled?'Enabled':'Disabled')+' · '+(data.online?'Connected':'Waiting for NanoC6')+
       (data.lastQueuedPower!==null&&data.lastQueuedPower!==undefined?' · Power '+(data.lastQueuedPower?'ON':'OFF')+' queued':'')+(data.lastApplied!=null?' · Brightness '+data.lastApplied+'% queued':'')+
       (data.error?' · '+data.error:'')
     :data.note||'NanoC6 is not configured on Oracle; sync is disabled.';
 };
 async function callApi(method,body){
   const r=await fetch(base+'/api/nanoc6/sync',{
     method,credentials:'same-origin',cache:'no-store',
     headers:body?{'content-type':'application/json'}:{},
     body:body?JSON.stringify(body):undefined
   });
   const d=await r.json();
   if(!r.ok)throw Error(d.error||'NanoC6 setting could not be saved');
   return d;
 }
 async function fetchStatus(){
   if(working)return;working=true;checkbox.disabled=true;
   try{show(await callApi('GET'));}catch(e){status.textContent=e.message}
   finally{working=false;checkbox.disabled=!configured}
 }
 checkbox.addEventListener('change',async()=>{
   if(working)return;
   const enabled=checkbox.checked;
   working=true;checkbox.disabled=true;
   try{const next=await callApi('POST',{enabled});working=false;show(next);}
   catch(e){working=false;checkbox.checked=!enabled;status.textContent=e.message;checkbox.disabled=false;}
 });
 refresh.addEventListener('click',fetchStatus);
 fetchStatus();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
else init();
})();
