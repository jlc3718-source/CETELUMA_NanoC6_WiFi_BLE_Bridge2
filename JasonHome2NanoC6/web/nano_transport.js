/* Local transport for the complete, locally served Jason Home 2 interface. */
(()=>{'use strict';
window.JH2_NANO=true;
window.JH2NanoSpeak=text=>new Promise(resolve=>{
 let done=false;const finish=()=>{if(done)return;done=true;resolve();};window.__jh2NanoSpoken=finish;
 if(window.AndroidVoice?.speak){AndroidVoice.speak(text);setTimeout(finish,45000);}
 else if(window.speechSynthesis){const u=new SpeechSynthesisUtterance(text);u.onend=finish;u.onerror=finish;speechSynthesis.speak(u);}else finish();
});
let since=0,polling=false,saveHooked=false;
const nativeSaves=new Map();
function saveNative(payload){return new Promise((resolve,reject)=>{
 if(!saveHooked){const previous=window.__curtainNativeResult;window.__curtainNativeResult=(id,result)=>{const save=nativeSaves.get(id);if(!save){previous?.(id,result);return;}nativeSaves.delete(id);try{const d=typeof result==='string'?JSON.parse(result):result;d.ok?save.resolve(d):save.reject(Error(d.error||d.message||'Save failed'));}catch(e){save.reject(e);}};saveHooked=true;}
 const id='nano-file-'+Math.random().toString(16).slice(2);nativeSaves.set(id,{resolve,reject});AndroidCurtain.call(id,'saveRawFile',JSON.stringify(payload));setTimeout(()=>{if(nativeSaves.delete(id))reject(Error('File save timed out'));},30000);
});}
function text64(text){let binary='';for(const b of new TextEncoder().encode(text))binary+=String.fromCharCode(b);return btoa(binary);}
async function call(action,payload={}){
 if(action==='saveRawFile'){
  if(window.AndroidCurtain?.call)return saveNative(payload);
  const bytes=Uint8Array.from(atob(payload.data),c=>c.charCodeAt(0));
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([bytes],{type:payload.mime}));a.download=payload.name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);return {ok:true};
 }
 const r=await fetch('/api/curtain/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,payload}),credentials:'same-origin'});
 const d=await r.json();if(!r.ok||d.ok===false)throw Error(d.error||'NanoC6 Bluetooth request failed');return d;
}
window.JH2NanoCurtainCall=call;
async function poll(){
 if(polling)return;polling=true;
 try{const r=await fetch('/api/curtain/notifications?since='+since,{cache:'no-store'});if(!r.ok)return;const d=await r.json();
 for(const n of d.notifications||[]){since=Math.max(since,n.id);window.__jh2CurtainRawNotify?.(n.uuid,n.data);}}
 catch{}finally{polling=false;}
}
setInterval(poll,120);
function init(){
 const settings=document.querySelector('.page[data-page="settings"]');if(!settings)return;
 const panel=document.createElement('div');panel.className='panel';panel.id='jh2NanoPanel';
 panel.innerHTML=`<strong>Jason Home 2 · NanoC6</strong><p class="sub" id="nanoState">Checking local controller…</p>
 <div class="row wraprow"><button class="btn" id="nanoConnect">Connect Eufy account</button><button class="btn" id="nanoImport">Import migration file</button><button class="btn" id="nanoExport">Export settings</button><button class="btn" id="nanoAddress">Controller address</button></div>
 <input id="nanoFile" type="file" accept="application/json" hidden>
 <p><label><input id="nanoOraclePaused" type="checkbox"> I have paused the Oracle scheduler</label></p>
 <div class="row wraprow"><button class="btn primary" id="nanoActivate">Activate NanoC6</button><button class="btn" id="nanoPause">Pause NanoC6</button></div>
 <p><label><input id="nanoAutoUpdate" type="checkbox"> Install signed remote updates automatically</label></p>
 <div class="row wraprow"><button class="btn" id="nanoCheck">Check for firmware update</button><button class="btn" id="nanoInstall">Install verified update</button><a class="btn" href="/firmware">Upload firmware file</a></div>
 <p><b>Remote address:</b> <a href="http://craumejl.tplinkdns.com">http://craumejl.tplinkdns.com</a> · TCP port 80</p>
 <p><label><input id="nanoUpnp" type="checkbox"> Automatically map TCP port 80 using UPnP when active</label></p>
 <p class="sub" id="nanoNetworkState">Checking router mapping…</p><button class="btn" id="nanoRetryUpnp">Retry port mapping</button>
 <p class="sub" id="nanoUpdateState">One running app; updates replace it. USB reflash is the fallback.</p>`;
 settings.prepend(panel);
 const $=id=>document.getElementById(id);
 const api=async(path,body)=>{const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d;};
 const run=fn=>async()=>{try{await fn();await refresh();}catch(e){$('nanoState').textContent=e.message;}};
 async function refresh(){const d=await api('/api/nano/status');$('nanoState').textContent=(d.activated?'Active':'Paused')+' · '+d.version+' · '+(d.timeValid?'Clock synchronized':'Waiting for time')+' · '+d.eufyStatus;const f=await api('/api/firmware');$('nanoAutoUpdate').checked=f.autoUpdate;const n=await api('/api/network/upnp');$('nanoUpnp').checked=n.enabled;$('nanoNetworkState').textContent=n.status;}
 $('nanoConnect').onclick=run(async()=>{const email=prompt('Eufy account email');if(!email)return;const password=await new Promise(resolve=>{const dialog=document.createElement('dialog');dialog.innerHTML='<form method=dialog><label>Eufy password <input type=password autocomplete=current-password required></label><p><button value=cancel>Cancel</button> <button value=connect>Connect</button></p></form>';document.body.append(dialog);dialog.addEventListener('close',()=>{const value=dialog.returnValue==='connect'?dialog.querySelector('input').value:'';dialog.remove();resolve(value);});dialog.showModal();});if(!password)return;await api('/api/eufy/login',{email,password});});
 $('nanoAddress').onclick=()=>{if(window.AndroidControllerAddress)AndroidControllerAddress.configure();else $('nanoState').textContent='This controller is at '+location.origin;};
 $('nanoImport').onclick=()=>{$('nanoFile').click();};
 $('nanoFile').onchange=run(async()=>{const f=$('nanoFile').files?.[0];if(!f)return;const data=JSON.parse(await f.text());await api(data.product==='jason-home-2-nanoc6-private'?'/api/nano/private':'/api/nano/import',data);});
 $('nanoExport').onclick=run(async()=>{const d=await api('/api/nano/export');await call('saveRawFile',{name:'Jason-Home-2-NanoC6-settings.json',mime:'application/json',data:text64(JSON.stringify(d.backup,null,2))});});
 $('nanoActivate').onclick=run(()=>api('/api/nano/activate',{enabled:true,oraclePaused:$('nanoOraclePaused').checked}));
 $('nanoPause').onclick=run(()=>api('/api/nano/activate',{enabled:false,oraclePaused:$('nanoOraclePaused').checked}));
 $('nanoUpnp').onchange=run(()=>api('/api/network/upnp',{enabled:$('nanoUpnp').checked}));
 $('nanoRetryUpnp').onclick=run(()=>api('/api/network/upnp',{}));
 $('nanoAutoUpdate').onchange=run(()=>api('/api/nano/config',{autoUpdate:$('nanoAutoUpdate').checked}));
 $('nanoCheck').onclick=run(async()=>{const d=await api('/api/firmware/check',{});$('nanoUpdateState').textContent=d.newer?'Verified update '+d.version+' is available.':'You have the current version.';});
 $('nanoInstall').onclick=run(async()=>{await api('/api/firmware/install',{});$('nanoUpdateState').textContent='Installing. Reopen this page when the controller restarts.';});
 refresh().catch(e=>$('nanoState').textContent=e.message);
}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init):init();
})();
