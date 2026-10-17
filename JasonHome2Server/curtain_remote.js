/* Existing controls use this Oracle transport; native phone BLE is never selected. */
(()=>{'use strict';
 const base=location.pathname.startsWith('/jason-home-2/')?'/jason-home-2':'';
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 async function api(path,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok||d.ok===false)throw Error(d.error||'Oracle request failed');return d;}
 window.JH2_ORACLE_CURTAIN=true;
 window.JH2CurtainApi=api;
 const localNano=(action,payload={})=>new Promise((resolve,reject)=>{
  if(!window.AndroidCurtain?.localControllerAvailable?.())return reject(Error('This installed APK is missing the local Nano setup helper.'));
  const id='nano'+Date.now()+Math.random().toString(16).slice(2),old=window.__curtainNativeResult;
  let finished=false;
  const finish=(result,error)=>{if(finished)return;finished=true;clearTimeout(timer);if(window.__curtainNativeResult===callback)window.__curtainNativeResult=old;error?reject(error):resolve(result);};
  const callback=(n,r)=>{if(n!==id)return old?.(n,r);try{if(typeof r==='string')r=JSON.parse(r);}catch{return finish(null,Error('Nano setup returned an invalid response'));}r?.ok?finish(r):finish(null,Error(r?.error||'Local NanoC6 request failed'));};
  const timer=setTimeout(()=>finish(null,Object.assign(Error('The APK timed out waiting for the local Nano setup response.'),{code:'local_timeout'})),25000);
  window.__curtainNativeResult=callback;
  try{AndroidCurtain.call(id,action,JSON.stringify(payload));}catch(e){finish(null,e);}
 });
 let pairingWork=null,nextPairAttempt=0,lastPairError='',manualSelected=false;
 window.JH2CreateManualKey=async()=>{
  manualSelected=true;
  const pending=pairingWork;if(pending)await pending.catch(()=>{});
  const result=await api('/api/curtain/pair',{manual:true});
  lastPairError='Paste the generated key into Receive key on the Nano.';
  return {endpoint:result.endpoint,bridgeId:result.bridgeId,token:result.token};
 };
 window.JH2InitManualConnection=controls=>{
  if(!controls||document.getElementById('jh2ManualConnection'))return;
  const panel=document.createElement('section');panel.id='jh2ManualConnection';panel.className='panel jh2-manual-connection';
  panel.innerHTML='<strong>Manual Oracle connection</strong><p class="sub">Create a key, copy it, then paste it into Receive key on the Nano. The key stays valid until you create another.</p><button type="button" class="btn jh2ConnectionButton" id="jh2CreateKey">Create Oracle key</button> <button type="button" class="btn jh2ConnectionButton" id="jh2CopyKey" disabled>Copy key</button> <a class="btn" href="http://192.168.68.116/" target="_blank" rel="noopener">Open Nano</a><textarea id="jh2ManualKey" class="field" rows="6" readonly hidden aria-label="Oracle connection key" spellcheck="false" autocomplete="off" style="width:100%;box-sizing:border-box;margin-top:12px"></textarea><p class="sub" id="jh2ManualKeyStatus" role="status"></p>';
  controls.insertBefore(panel,controls.children[1]||null);
  const key=panel.querySelector('#jh2ManualKey'),message=panel.querySelector('#jh2ManualKeyStatus'),create=panel.querySelector('#jh2CreateKey'),copy=panel.querySelector('#jh2CopyKey');
  create.onclick=async()=>{create.disabled=true;copy.disabled=true;message.textContent='Creating manual key...';try{key.value=JSON.stringify(await window.JH2CreateManualKey(),null,2);key.hidden=false;copy.disabled=false;message.textContent='Copy this key, then open Nano → Oracle → Receive key. Automatic setup will not replace it.';}catch(error){message.textContent=error.message;}finally{create.disabled=false;}};
  copy.onclick=async()=>{try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(key.value);else{key.focus();key.select();if(!document.execCommand('copy'))throw Error('Select and copy the key from the box.');}message.textContent='Key copied. Paste it into Oracle → Receive key on the Nano.';}catch(error){key.focus();key.select();message.textContent='Select and copy the key from the box.';}};
 };
 const connectionReport=(stage,code,detail='')=>api('/api/curtain/autopair',{diagnostic:{stage,code,detail,android:/Android/i.test(window.navigator?.userAgent||'')}}).catch(()=>{});
 async function ensureNanoPairing(force=false){
  if(pairingWork)return pairingWork;
  if(manualSelected)return false;
  if(document.hidden||(!force&&Date.now()<nextPairAttempt))return false;
  nextPairAttempt=Date.now()+30000;
  pairingWork=(async()=>{
   let stage='oracle';
   try{
    const state=await api('/api/curtain/status');if(state.online)return true;
    if(state.manualPairing){manualSelected=true;throw Error('Manual key setup is active. Paste the key into Receive key on the Nano.');}
    stage='helper';
    if(!window.AndroidCurtain?.localControllerAvailable?.())throw Object.assign(Error('This installed APK is missing the local Nano setup helper.'),{code:'helper_missing'});
    await connectionReport('helper','ok');stage='oracle';
    const grant=await api('/api/curtain/autopair',{});if(grant.alreadyOnline)return true;
    // The existing trusted APK probes mDNS/private LAN and writes /bridge/pair
    // on home Wi-Fi. It never sends this credential to the public Nano address.
    stage='local';await connectionReport(stage,'ok');await localNano('pairNano',grant);
    stage='channel';await connectionReport(stage,'ok');
    for(let i=0;i<16;i++){await delay(500);const current=await api('/api/curtain/status');if(current.online){lastPairError='';await connectionReport('ready','ok');return true;}}
    throw Object.assign(Error('The Nano accepted setup, but its secure connection to Oracle did not open.'),{code:'channel_timeout'});
   }catch(error){lastPairError=error.message;await connectionReport(stage,error.code||stage+'_error',lastPairError);}
   return false;
  })();
  try{return await pairingWork;}finally{pairingWork=null;}
 }
 window.JH2EnsureNanoPairing=ensureNanoPairing;
 // Manual recovery is explicit. Opening the APK or pressing a curtain
 // command must never reconfigure the Nano in the background.
 window.JH2OracleCurtainCall=async(action,payload={})=>{
  if(action==='saveRawFile'){
   // Native Android file export remains available; it never accesses Bluetooth.
   if(window.AndroidCurtain?.call)return new Promise((resolve,reject)=>{const id='save'+Date.now();const old=window.__curtainNativeResult;window.__curtainNativeResult=(n,r)=>{if(n!==id)return old?.(n,r);window.__curtainNativeResult=old;r.ok?resolve(r):reject(Error(r.error));};AndroidCurtain.call(id,action,JSON.stringify(payload));});
   const bytes=Uint8Array.from(atob(payload.data),c=>c.charCodeAt(0)),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([bytes],{type:payload.mime}));a.download=payload.name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);return {ok:true,message:'Downloaded'};
  }
  if(['asset','effect','nativePlay','sequenceStart'].includes(action))window.JH2CurtainLastSelection={action,payload};
  const queued=await api('/api/curtain/call',{action,payload,idempotencyKey:crypto.randomUUID()});
  if(!queued.commandId)return queued;
  if(queued.bridgeOnline===false)throw Error('Oracle received command '+queued.commandId+'. The Nano Oracle connection is offline. Use Manual Oracle connection below.');
  const status=document.getElementById('jh2CurtainStatus');if(status)status.textContent='Oracle accepted command '+queued.commandId+' · waiting for NanoC6';
  for(let i=0;i<150;i++){
   await delay(i<20?150:400);const {command:c}=await api('/api/curtain/command?id='+queued.commandId);
   if(status&&c.state==='downloaded')status.textContent='NanoC6 received command '+c.id+' · sending over BLE';
   if(c.state==='applied')return {ok:true,...c.result,commandId:c.id,state:c.state,message:c.result?.message||'NanoC6 transmitted over BLE. Check the curtain for physical confirmation.'};
   if(['failed','expired','superseded'].includes(c.state))throw Error(c.result?.error||'Command '+c.state);
  }
  throw Error('Oracle queued the command; NanoC6 has not confirmed BLE delivery. Check Bridge Settings.');
 };
 let since=0,working=false;setInterval(async()=>{if(working||!document.getElementById('jh2CurtainStudioFrame')?.getAttribute('src'))return;working=true;try{const d=await api('/api/curtain/notifications?since='+since);for(const n of d.notifications){since=Math.max(since,n.id);window.__jh2CurtainRawNotify?.(n.uuid,n.data);}}catch{}finally{working=false;}},250);
 function init(){
  window.JH2InitManualConnection(document.getElementById('jh2CurtainOriginalControls'));
  const settings=document.querySelector('.v3SettingsPane[data-settings-pane="controllers"]');if(!settings)return;
  const p=document.createElement('div');p.className='panel';p.innerHTML='<strong>NanoC6 curtain relay</strong><p id="jh2RelayStatus" class="sub">Checking…</p><button class="btn" id="jh2RelayOpen">Open NanoC6 Controller</button> <a class="btn" id="jh2RelayRemote" href="/jason-home-2/nano/">Oracle Nano fallback</a> <button class="btn" id="jh2RelayResume">Return to Oracle</button><p class="sub">Use Manual Oracle connection in Curtain controls to install a key. Files stay on Oracle; the Nano relays through two dynamic RAM buffers, up to 35 KiB each.</p>';settings.append(p);
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
  p.querySelector('#jh2RelayResume').onclick=()=>api('/api/curtain/resume',{}).then(refresh);
  async function refresh(){try{const d=await api('/api/curtain/status');p.querySelector('#jh2RelayStatus').textContent=(d.online?'Connected':'Waiting for NanoC6')+' · BLE '+(d.curtain?.connected?'connected':'disconnected')+' · '+d.queued+' queued'+(d.lastCommand?' · command '+d.lastCommand.id+': '+d.lastCommand.state:'')+(d.error?' · '+d.error:'');
   const r=d.assetRetention;if(r){const b=n=>(n/1024).toFixed(1)+' KB',active=r.active?.name||'None',pending=r.pending?.name||'None';
    retention.querySelector('#jh2RetainedBytes').textContent='Active: '+active+' · Pending: '+pending+' · '+r.phase+' · '+r.retainedFiles+' file(s), '+b(r.retainedBytes)+' retained.';
    confirmButton.hidden=!r.confirmationRequired;
    confirmButton.textContent=r.confirmationAction==='asset'?'Confirm new image is visible':'Confirm new effect / Off is visible';
    confirmButton.dataset.commandId=String(r.confirmationCommandId||'');
   }else retention.querySelector('#jh2RetainedBytes').textContent='Storage details unavailable on this Oracle version';
  }catch(e){p.querySelector('#jh2RelayStatus').textContent=e.message;}}
  setTimeout(()=>{
   const controls=document.getElementById('jh2CurtainOriginalControls');if(!controls)return;
   const box=document.createElement('details');box.className='panel';box.innerHTML='<summary>Oracle curtain schedule</summary><p class="sub">Choose an effect, sequence or Studio animation first. Oracle starts and stops it even when the APK is closed.</p><label>Name <input id="jh2CSName" class="field" value="Curtain scene"></label><label>Start <input id="jh2CSStart" class="field" type="datetime-local"></label><label>End <input id="jh2CSEnd" class="field" type="datetime-local"></label><button class="btn" id="jh2CSSave">Schedule current selection</button><p id="jh2CSMessage" class="sub"></p><div id="jh2CSList"></div>';
   controls.append(box);let editing=null;
   async function list(){const d=await api('/api/curtain/schedules');const area=box.querySelector('#jh2CSList');area.replaceChildren();for(const s of d.schedules){const row=document.createElement('div');const title=document.createElement('p');title.textContent=s.name+' · '+new Date(s.start).toLocaleString()+' – '+new Date(s.end).toLocaleString()+' · '+(s.enabled?'Enabled':'Disabled');const edit=document.createElement('button');edit.className='btn';edit.textContent='Edit';edit.onclick=()=>{editing=s;box.querySelector('#jh2CSName').value=s.name;const local=t=>{const d=new Date(t);return new Date(t-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};box.querySelector('#jh2CSStart').value=local(s.start);box.querySelector('#jh2CSEnd').value=local(s.end);box.querySelector('#jh2CSMessage').textContent='Editing '+s.name+'; existing selection retained unless another is selected.';};const toggle=document.createElement('button');toggle.className='btn';toggle.textContent=s.enabled?'Disable':'Enable';toggle.onclick=async()=>{await api('/api/curtain/schedules',{...s,enabled:!s.enabled});await list();};row.append(title,edit,toggle);area.append(row);}}
   box.querySelector('#jh2CSSave').onclick=async()=>{try{const selection=window.JH2CurtainLastSelection||editing;if(!selection)throw Error('Apply an effect, sequence, or Studio image/GIF first.');const start=new Date(box.querySelector('#jh2CSStart').value).getTime(),end=new Date(box.querySelector('#jh2CSEnd').value).getTime();await api('/api/curtain/schedules',{id:editing?.id||crypto.randomUUID(),name:box.querySelector('#jh2CSName').value,start,end,action:selection.action,payload:selection.payload,enabled:true});editing=null;box.querySelector('#jh2CSMessage').textContent='Saved on Oracle. It will run with the APK closed.';await list();}catch(e){box.querySelector('#jh2CSMessage').textContent=e.message;}};
   list().catch(e=>box.querySelector('#jh2CSMessage').textContent=e.message);
  },0);
  refresh();setInterval(refresh,10000);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
