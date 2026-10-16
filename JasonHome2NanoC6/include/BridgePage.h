#pragma once
static const char BRIDGE_PAGE[] PROGMEM=R"HTML(<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jason Home 2 · NanoC6</title><style>
*{box-sizing:border-box}html{color-scheme:dark}body{margin:0;background:radial-gradient(circle at top left,#16334a 0%,#081321 55%);color:#eaf6ff;font:15px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:860px;margin:0 auto;padding:clamp(12px,3vw,28px)}
h1{font-size:clamp(23px,4vw,31px);letter-spacing:-.03em;margin:0 0 4px}h2{font-size:18px;margin:0 0 10px}h3{font-size:16px;margin:0 0 10px}
.panel{background:#14263aeF;border:1px solid #35536a;border-radius:18px;padding:clamp(15px,3vw,24px);margin:14px 0;box-shadow:0 8px 25px #0002}
button{background:#1d4659;color:#f3fcff;border:1px solid #437b8b;border-radius:11px;padding:11px 16px;margin:5px 5px 5px 0;cursor:pointer;font:600 14px system-ui;touch-action:manipulation;transition:background .12s}
button:hover{background:#245c6e}button:active{transform:translateY(1px)}button:disabled{opacity:.45;cursor:wait}
button#curtainTab,button#settingsTab{min-width:125px}button#on,button#apply{background:#116b70;border-color:#2fc5bd}
a{color:#94e8df;display:inline-block;padding:6px}label{display:block;margin:14px 0 8px;color:#d3e6f5;font-weight:500}
input,select,textarea{font:inherit;max-width:100%;box-sizing:border-box;background:#091b2b;color:#fff;border:1px solid #456b7d;border-radius:9px;padding:10px}
textarea{width:100%;height:100px}input[type=range]{width:100%;accent-color:#57e0cb}input[type=checkbox]{accent-color:#45c9b7}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 ui-monospace,Consolas,monospace;margin:8px 0}
.sub{color:#a6bed2;font-size:13px}nav{display:flex;gap:8px;padding:8px 0 10px;border-bottom:1px solid #395268}
[hidden]{display:none!important}
@media(min-width:600px){#curtain>.panel{display:grid;grid-template-columns:1fr 1fr;column-gap:20px}#curtain>.panel>h2,#curtain>.panel>p,#curtain>.panel>pre{grid-column:1/-1}}
</style></head><body><main><h1>Jason Home 2</h1><p class="sub">NanoC6 relay · Oracle owns schedules and files.</p><nav><button id="curtainTab">Curtain</button><button id="settingsTab">Bridge Settings</button></nav><section id="curtain"><div class="panel"><h2>Curtain</h2><pre id="ble">Checking…</pre><button id="connect">Connect</button><button id="disconnect">Disconnect Curtain</button><button id="on">Power On</button><button id="off">Power Off</button><label>Brightness <output id="brightnessValue">100%</output><input id="brightness" type="range" min="0" max="100" value="100"></label><label>Solid color <input id="color" type="color" value="#ffffff"></label><button id="solid">Apply solid color</button><label>Captured native effect <select id="effect"></select></label><label>Speed <input id="speed" type="range" min="1" max="100" value="50"></label><button id="apply">Apply / Test</button><button id="resume">Return to Oracle</button><p class="sub">Disconnect closes BLE and disables automatic reconnect until Connect or a new explicit Oracle connection command. Direct local BLE tests pause scheduled Oracle delivery for 15 minutes. Manual APK commands take priority immediately. Brightness 0 turns power off. Solid colors use the Studio's captured RGB drawing protocol.</p><pre id="result" role="status"></pre></div></section><section id="settings" hidden><div class="panel"><h2>Bridge Settings</h2><pre id="health">Loading…</pre><button id="refresh">Refresh</button><button id="sync">Sync now</button><a href="/setup">Wi-Fi setup</a></div><div class="panel"><h3>Firmware</h3><div id="firmwarePinPanel"><label for="firmwarePin">Remote firmware PIN</label><input id="firmwarePin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" placeholder="4-digit PIN" aria-label="Firmware PIN"><button id="firmwareUnlock">Unlock firmware</button><p class="sub" id="firmwarePinStatus">Unlock signed updates for 15 minutes. Wi-Fi, bridge credentials, and raw firmware upload stay protected.</p></div><button id="check" disabled>Check signed update</button><button id="install" disabled>Install verified update</button><a href="/firmware">Upload runtime BIN</a><label><input type="checkbox" id="auto"> Automatically install signed updates</label><pre id="update"></pre><button id="reboot">Restart bridge</button></div></section></main><script>
const el=id=>document.getElementById(id);async function req(path,body){const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok||d.ok===false)throw Error(d.error||'Request failed');return d;}
async function call(action,payload={}){try{const d=await req('/api/curtain/call',{action,payload});el('result').textContent=JSON.stringify(d,null,2);return d;}catch(e){el('result').textContent=e.message;throw e;}}
function select(settings){el('settings').hidden=!settings;el('curtain').hidden=settings;}el('settingsTab').onclick=()=>select(true);el('curtainTab').onclick=()=>select(false);
let updateTracking=false;
async function firmwareAccess(){
 try{
  const r=await req('/api/firmware/access');
  el('firmwarePinPanel').hidden=!!r.unlocked;
  el('check').disabled=!r.unlocked||updateTracking;
  if(!r.unlocked){el('install').disabled=true;el('auto').disabled=true;}
  return !!r.unlocked;
 }catch(e){el('firmwarePinPanel').hidden=false;el('check').disabled=true;return false;}
}
el('firmwareUnlock').onclick=async()=>{
 const pin=el('firmwarePin').value;
 if(!/^[0-9]{4}$/.test(pin)){el('firmwarePinStatus').textContent='Enter four digits';return;}
 el('firmwareUnlock').disabled=true;
 try{
  const d=await req('/api/firmware/unlock',{pin});
  el('firmwarePin').value='';
  el('firmwarePinStatus').textContent='Firmware controls unlocked';
  el('update').textContent='Firmware controls unlocked. Check for a newer signed release.';
  await firmwareAccess();await health();
 }catch(e){el('firmwarePin').value='';el('firmwarePinStatus').textContent=e.message;}
 finally{el('firmwareUnlock').disabled=false;}
};
async function health(){try{const d=await req('/api/health'),o=d.oracle||{};el('ble').textContent=(d.curtain.connected?'Connected':'Disconnected')+' · '+(d.curtain.name||'DN5E58')+' '+(d.curtain.address||'');el('health').textContent=`Firmware ${d.version}\nWi-Fi ${d.wifi?'connected':'offline'} · ${d.ip}\nUptime ${d.uptimeSeconds}s · Free RAM ${d.freeHeap} bytes\nPhysical flash ${o.flashBytes} · Firmware ${o.firmwareBytes} bytes\nOracle ${o.configured?(o.online?'connected':o.error==='Oracle rejected bridge credentials'?'authentication rejected':'waiting'):'pairing required'}\nLast sync ${o.lastSuccessfulSyncAgoSeconds>=0?o.lastSuccessfulSyncAgoSeconds+'s ago':'never'} · next full poll ${o.nextPollSeconds}s\nCommand ${o.lastCommandId} · ${o.lastDelivery}\nStreaming ${o.streaming?'active':'idle'} · 10 KB RAM buffer (4 KB fallback)\nFiles stored on Oracle · no NanoC6 asset cache\nLocal override ${o.manualOverrideSeconds}s\n${o.error||''}`;const unlocked=await firmwareAccess();const f=unlocked?await req('/api/firmware').catch(()=>null):null;
 if(f){el('auto').checked=!!f.autoUpdate;el('auto').disabled=false;
   if(!updateTracking&&f.phase==='failed')el('update').textContent='Last update failed: '+(f.reason||'Unknown error')+'\nCurrent firmware '+f.version;
 }else{el('auto').disabled=true;el('install').disabled=true;
   if(!updateTracking)el('update').textContent='Enter the firmware PIN above to check and install signed updates remotely.';}}catch(e){el('health').textContent=e.message;}}
for(let n=0;n<88;n++)el('effect').add(new Option('E-'+n,n));el('brightness').oninput=()=>el('brightnessValue').value=el('brightness').value+'%';
el('connect').onclick=()=>call('connect').then(health);el('disconnect').onclick=()=>call('disconnect').then(health);el('on').onclick=()=>call('power',{on:true});el('off').onclick=()=>call('power',{on:false});el('apply').onclick=async()=>{await call('effect',{id:+el('effect').value});await call('brightness',{value:+el('brightness').value});await call('speed',{value:+el('speed').value});};
el('solid').onclick=()=>call('solid',{color:el('color').value,brightness:+el('brightness').value});el('resume').onclick=async()=>{await req('/api/bridge/resume',{});el('result').textContent='Local override ended; Oracle resumes at next delivery.';};el('sync').onclick=()=>req('/api/bridge/sync',{}).then(health);el('refresh').onclick=health;
el('check').onclick=async()=>{try{el('update').textContent='Checking signed firmware channel…';const d=await req('/api/firmware/check',{});el('update').dataset.version=d.newer?d.version:'';el('update').textContent=d.newer?'Version '+d.version+' available — ready for verified install':'Current version; no newer signed release';el('install').disabled=!d.newer;}catch(e){el('update').textContent='Update check failed: '+e.message;}};async function watchInstall(target){
 if(updateTracking)return;updateTracking=true;
 el('install').disabled=true;el('check').disabled=true;
 const started=Date.now();let offline=false;
 while(Date.now()-started<300000){
   await new Promise(r=>setTimeout(r,2500));
   try{
     const f=await req('/api/firmware');
     if(f.version===target){
       el('update').textContent='Firmware '+target+' installed and NanoC6 is responding again.';
       updateTracking=false;el('check').disabled=false;await health();return;
     }
     if(f.phase==='failed'){
       el('update').textContent='Firmware update failed: '+(f.reason||'Unknown updater error')+
         '\\nRunning '+f.version+'. Existing settings were preserved.';
       updateTracking=false;el('check').disabled=false;await health();return;
     }
     el('update').textContent='Updating to '+target+' · '+(f.phase||'rebooting')+
       (f.reason?' · '+f.reason:'')+'\\nPlease keep NanoC6 powered.';
   }catch(e){offline=true;el('update').textContent='NanoC6 rebooting / downloading signed firmware…'
       +'\\nWaiting for controller to return ('+Math.round((Date.now()-started)/1000)+'s).';}
 }
 el('update').textContent='Update was requested but not confirmed after five minutes. Check firmware version; do not interrupt recovery.';
 updateTracking=false;el('check').disabled=false;
}
el('install').onclick=async()=>{
 const target=el('update').dataset.version;
 if(!target){el('update').textContent='Check for a signed update first.';return;}
 el('update').textContent='Sending signed update request to NanoC6…';
 try{await req('/api/firmware/install',{});}
 catch(e){el('update').textContent='Controller may already be rebooting; checking installation status…';}
 await watchInstall(target);
};el('auto').onchange=()=>req('/api/firmware/auto',{enabled:el('auto').checked}).catch(e=>el('update').textContent=e.message);el('reboot').onclick=()=>req('/api/bridge/reboot',{});health();setInterval(health,10000);
</script></body></html>)HTML";
