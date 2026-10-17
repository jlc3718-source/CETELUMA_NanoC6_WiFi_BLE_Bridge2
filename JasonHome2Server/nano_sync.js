/* Jason Home 2 curtain follows Eufy: informational status only.
   Eufy calendar controls the start/stop times; no separate checkbox. */
(()=>{'use strict';
const base=location.pathname.startsWith('/jason-home-2/')?'/jason-home-2':'';
function init(){
 const settings=document.querySelector('.v3SettingsPane[data-settings-pane="schedules"]');
 if(!settings||document.getElementById('jh2NanoSyncPanel'))return;
 const panel=document.createElement('div');panel.className='panel';panel.id='jh2NanoSyncPanel';
 panel.innerHTML='<strong>Curtain follows Eufy schedule</strong>'+
  '<p class="sub">Curtain ON/OFF and brightness use the existing Eufy timing. Edit the Eufy schedule and the curtain updates automatically. Curtain effects stay independent.</p>'+
  '<div class="sub" role="status" id="jh2NanoSyncStatus">Checking sync…</div>'+
  '<button class="btn" type="button" id="jh2NanoSyncRefresh">Refresh status</button>';
 settings.append(panel);
 const status=panel.querySelector('#jh2NanoSyncStatus');
 async function refresh(){
  try{
   const response=await fetch(base+'/api/nanoc6/sync',{credentials:'same-origin',cache:'no-store'});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'Cannot read synchronization status');
   status.textContent=(data.eufyMasterSchedule&&data.enabled?'Automatically linked':'Waiting for Eufy schedule link')+
    ' · '+(data.online?'NanoC6 connected':'NanoC6 unavailable')+
    (data.lastQueuedPower!=null?' · Last power '+(data.lastQueuedPower?'ON':'OFF'):'')+
    (data.error?' · '+data.error:'');
  }catch(e){status.textContent='Status unavailable: '+e.message}
 }
 panel.querySelector('#jh2NanoSyncRefresh').addEventListener('click',refresh);refresh();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
