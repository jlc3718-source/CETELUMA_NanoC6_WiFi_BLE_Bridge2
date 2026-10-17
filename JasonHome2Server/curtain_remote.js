/* Existing controls use this Oracle transport; native phone BLE is never selected. */
(()=>{'use strict';
 const base=location.pathname.startsWith('/jason-home-2/')?'/jason-home-2':'';
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 async function api(path,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok||d.ok===false)throw Error(d.error||'Oracle request failed');return d;}
 window.JH2_ORACLE_CURTAIN=true;
 window.JH2CurtainApi=api;
 const localNano=(action,payload={})=>new Promise((resolve,reject)=>{if(!window.AndroidCurtain?.localControllerAvailable?.())return reject(Error('Install the signed Jason Home 2 APK for local pairing over home Wi-Fi.'));const id='nano'+Date.now()+Math.random().toString(16).slice(2),old=window.__curtainNativeResult;window.__curtainNativeResult=(n,r)=>{if(n!==id)return old?.(n,r);window.__curtainNativeResult=old;r?.ok?resolve(r):reject(Error(r?.error||'Local NanoC6 request failed'));};AndroidCurtain.call(id,action,JSON.stringify(payload));});
 window.JH2OracleCurtainCall=async(action,payload={})=>{
  if(action==='saveRawFile'){
   // Native Android file export remains available; it never accesses Bluetooth.
   if(window.AndroidCurtain?.call)return new Promise((resolve,reject)=>{const id='save'+Date.now();const old=window.__curtainNativeResult;window.__curtainNativeResult=(n,r)=>{if(n!==id)return old?.(n,r);window.__curtainNativeResult=old;r.ok?resolve(r):reject(Error(r.error));};AndroidCurtain.call(id,action,JSON.stringify(payload));});
   const bytes=Uint8Array.from(atob(payload.data),c=>c.charCodeAt(0)),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([bytes],{type:payload.mime}));a.download=payload.name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);return {ok:true,message:'Downloaded'};
  }
  if(['asset','effect','nativePlay','sequenceStart'].includes(action))window.JH2CurtainLastSelection={action,payload};
  const queued=await api('/api/curtain/call',{action,payload,idempotencyKey:crypto.randomUUID()});
  if(!queued.commandId)return queued;
  const status=document.getElementById('jh2CurtainStatus');if(status)status.textContent='Oracle accepted command '+queued.commandId+' · waiting for NanoC6';
  const deadline=Date.now()+(action==='rawWrite'?165000:(action==='connect'||action==='subscribeRaw')?125000:85000);
  let lastState=queued.state||'queued';
  while(Date.now()<deadline){
   await delay(350);
   const {command:c}=await api('/api/curtain/command?id='+queued.commandId);
   lastState=c.state;
   if(status&&c.state==='downloaded')status.textContent='NanoC6 received command #'+c.id+' · BLE write in progress';
   if(c.state==='applied')return {ok:true,...c.result,commandId:c.id,state:c.state,
     message:c.result?.message||'NanoC6 transmitted over BLE; physical output requires inspection'};
   if(['failed','expired','superseded'].includes(c.state))
    throw Error('Oracle command #'+c.id+' '+c.state+': '+(c.result?.error||c.result?.message||'NanoC6 did not apply the command'));
  }
  const live=await api('/api/curtain/status');
  const stage='Command #'+queued.commandId+' still '+lastState+
   '; NanoC6 '+(live.online?'online':'offline')+
   ', BLE '+(live.curtain?.connected?'connected':'disconnected')+
   ', queued '+(live.queued??'?')+', last Nano ID '+(live.lastCommandId??'?')+
   ', last sync '+(live.lastSync?new Date(live.lastSync).toLocaleTimeString():'none')+'.';
  throw Error(stage+' Do not resend the write before checking its status.');
 };
 let since=0,working=false;setInterval(async()=>{if(working||!document.getElementById('jh2CurtainStudioFrame')?.getAttribute('src'))return;working=true;try{const d=await api('/api/curtain/notifications?since='+since);for(const n of d.notifications){since=Math.max(since,n.id);window.__jh2CurtainRawNotify?.(n.uuid,n.data);}}catch{}finally{working=false;}},250);
 function init(){
  const settings=document.querySelector('.v3SettingsPane[data-settings-pane="controllers"]');if(!settings)return;
  const p=document.createElement('div');p.className='panel';p.innerHTML='<strong>NanoC6 curtain relay</strong><p id="jh2RelayStatus" class="sub">Checking…</p><button class="btn" id="jh2RelayOpen">Open NanoC6 Controller</button> <a class="btn" id="jh2RelayRemote" href="/jason-home-2/nano/">Oracle Nano fallback</a> <button class="btn" id="jh2RelayPair">Pair NanoC6</button> <button class="btn" id="jh2RelayResume">Return to Oracle</button><textarea id="jh2RelayCode" class="field" hidden readonly aria-label="NanoC6 pairing configuration"></textarea><p class="sub">The Android app supports direct pairing over home Wi-Fi. Manual paste remains available if the controller cannot be reached. Local tests last 15 minutes. Files stay on Oracle; NanoC6 relays with a 4 KB RAM buffer.</p>';settings.append(p);
  // Oracle alone retains prepared content. Confirmation is intentionally
  // explicit because the BLE acknowledgement cannot prove physical display.
  const retention=document.createElement('section');retention.className='panel';
  retention.innerHTML='<strong>Current curtain file</strong><p id="jh2RetainedBytes" class="sub">Checking Oracle storage…</p><button class="btn" id="jh2ConfirmCurtain" hidden>Confirm picture is visible on curtain</button><p class="sub">An acknowledged BLE transfer is not proof the curtain displayed the picture. The previous recoverable file is kept until confirmation.</p>';
  p.append(retention);
  const confirmButton=retention.querySelector('#jh2ConfirmCurtain');
  confirmButton.onclick=async()=>{
   const id=Number(confirmButton.dataset.commandId);
   if(!id||!window.confirm('I can see the newly selected picture, effect, or Off state on the curtain. Confirm activation and remove obsolete file data?'))return;
   confirmButton.disabled=true;
   try{await api('/api/curtain/confirm-display',{commandId:id,observed:true});await refresh();}
   catch(error){retention.querySelector('#jh2RetainedBytes').textContent=error.message;}
   finally{confirmButton.disabled=false;}
  };

  p.querySelector('#jh2RelayOpen').onclick=async()=>{try{if(window.AndroidCurtain?.localControllerAvailable?.())await localNano('openNanoController');else window.open('http://craumer.tplinkdns.com/','_blank','noopener');}catch(e){p.querySelector('#jh2RelayStatus').textContent=e.message;}};
  p.querySelector('#jh2RelayPair').onclick=async()=>{try{const d=await api('/api/curtain/pair',{}),t=p.querySelector('textarea');try{await localNano('pairNano',d);t.value='';t.hidden=true;p.querySelector('#jh2RelayStatus').textContent='Pairing saved directly to NanoC6. Waiting for authenticated sync…';setTimeout(refresh,1200);}catch(localError){t.value=JSON.stringify(d);t.hidden=false;t.select();p.querySelector('#jh2RelayStatus').textContent=localError.message+' Paste the private pairing code into NanoC6 → Bridge Settings.';}}catch(e){p.querySelector('#jh2RelayStatus').textContent=e.message;}};
  p.querySelector('#jh2RelayResume').onclick=()=>api('/api/curtain/resume',{}).then(refresh);
  async function refresh(){try{const d=await api('/api/curtain/status');p.querySelector('#jh2RelayStatus').textContent=(d.online?'Connected':'Waiting for NanoC6')+' · BLE '+(d.curtain?.connected?'connected':'disconnected')+' · '+d.queued+' queued'+(d.lastCommand?' · command '+d.lastCommand.id+': '+d.lastCommand.state:'')+(d.error?' · '+d.error:'');
   const r=d.assetRetention;if(r){const b=n=>(n/1024).toFixed(1)+' KB',active=r.active?.name||'None',pending=r.pending?.name||'None';
    retention.querySelector('#jh2RetainedBytes').textContent='Active: '+active+' · Pending: '+pending+' · '+r.phase+' · '+r.retainedFiles+' file(s), '+b(r.retainedBytes)+' retained.';
    confirmButton.hidden=!r.confirmationRequired;
    confirmButton.textContent=r.confirmationAction==='asset'?'Confirm new image is visible':'Confirm new effect / Off is visible';
    confirmButton.dataset.commandId=String(r.confirmationCommandId||'');
   }else retention.querySelector('#jh2RetainedBytes').textContent='Storage details unavailable on this Oracle version';
  }catch(e){p.querySelector('#jh2RelayStatus').textContent=e.message;}}
  refresh();setInterval(refresh,10000);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
