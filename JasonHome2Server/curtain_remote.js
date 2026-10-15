/* Existing controls use this Oracle transport; native phone BLE is never selected. */
(()=>{'use strict';
 const base=location.pathname.startsWith('/jason-home-2/')?'/jason-home-2':'';
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 async function api(path,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok||d.ok===false)throw Error(d.error||'Oracle request failed');return d;}
 window.JH2_ORACLE_CURTAIN=true;
 window.JH2CurtainApi=api;
 window.JH2OracleCurtainCall=async(action,payload={})=>{
  if(action==='saveRawFile'){
   // Native Android file export remains available; it never accesses Bluetooth.
   if(window.AndroidCurtain?.call)return new Promise((resolve,reject)=>{const id='save'+Date.now();const old=window.__curtainNativeResult;window.__curtainNativeResult=(n,r)=>{if(n!==id)return old?.(n,r);window.__curtainNativeResult=old;r.ok?resolve(r):reject(Error(r.error));};AndroidCurtain.call(id,action,JSON.stringify(payload));});
   const bytes=Uint8Array.from(atob(payload.data),c=>c.charCodeAt(0)),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([bytes],{type:payload.mime}));a.download=payload.name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);return {ok:true,message:'Downloaded'};
  }
  const queued=await api('/api/curtain/call',{action,payload,idempotencyKey:crypto.randomUUID()});
  if(!queued.commandId)return queued;
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
  const settings=document.querySelector('.page[data-page="settings"]');if(!settings)return;
  const p=document.createElement('div');p.className='panel';p.innerHTML='<strong>NanoC6 curtain relay</strong><p id="jh2RelayStatus" class="sub">Checking…</p><button class="btn" id="jh2RelayPair">Pair NanoC6</button> <button class="btn" id="jh2RelayResume">Return to Oracle</button><textarea id="jh2RelayCode" class="field" hidden readonly aria-label="NanoC6 pairing configuration"></textarea><p class="sub">Pair once in NanoC6 Bridge Settings. Local tests last 15 minutes. Files stay on Oracle; NanoC6 relays with a 4 KB RAM buffer.</p>';settings.append(p);
  p.querySelector('#jh2RelayPair').onclick=async()=>{try{const d=await api('/api/curtain/pair',{});const t=p.querySelector('textarea');t.value=JSON.stringify(d);t.hidden=false;t.select();p.querySelector('#jh2RelayStatus').textContent='Paste this private pairing code into NanoC6 → Bridge Settings. Pairing replaces the previous bridge credential.';}catch(e){p.querySelector('#jh2RelayStatus').textContent=e.message;}};
  p.querySelector('#jh2RelayResume').onclick=()=>api('/api/curtain/resume',{}).then(refresh);
  async function refresh(){try{const d=await api('/api/curtain/status');p.querySelector('#jh2RelayStatus').textContent=(d.online?'Connected':'Waiting for NanoC6')+' · BLE '+(d.curtain?.connected?'connected':'disconnected')+' · '+d.queued+' queued'+(d.lastCommand?' · command '+d.lastCommand.id+': '+d.lastCommand.state:'')+(d.error?' · '+d.error:'');}catch(e){p.querySelector('#jh2RelayStatus').textContent=e.message;}}
  refresh();setInterval(refresh,10000);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
