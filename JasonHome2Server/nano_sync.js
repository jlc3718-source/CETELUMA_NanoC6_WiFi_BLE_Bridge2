/* Jason Home 2 NanoC6: explicit opt-in only; no on-page scheduler or BLE side effects. */
(()=>{'use strict';
function init(){
 const settings=document.querySelector('.page[data-page="settings"]');
 if(!settings||document.getElementById('jh2NanoSyncPanel'))return;
 const panel=document.createElement('div');
 panel.className='panel';panel.id='jh2NanoSyncPanel';
 panel.innerHTML='<strong>NanoC6 · Follow Eufy brightness</strong>'+
 '<div class="sub">When NanoC6 is connected and ready, use the Eufy schedule’s current brightness. Disabled by default; no Nano commands are sent unless enabled. A reachable private Oracle-to-NanoC6 connection is required.</div>'+
 '<label style="display:flex;align-items:center;gap:10px;margin-top:12px">'+
 '<input id="jh2NanoSyncEnabled" type="checkbox" aria-label="Enable NanoC6 brightness synchronization">'+
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
       (data.lastApplied!=null?' · Last synced '+data.lastApplied+'%':'')+
       (data.error?' · '+data.error:'')
     :data.note||'NanoC6 is not configured on Oracle; sync is disabled.';
 };
 async function callApi(method,body){
   const r=await fetch('/api/nanoc6/sync',{
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