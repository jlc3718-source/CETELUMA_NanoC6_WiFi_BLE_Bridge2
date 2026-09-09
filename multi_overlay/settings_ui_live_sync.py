from pathlib import Path
import sys

p=Path(sys.argv[1])
s=p.read_text()
marker='ANDERSON_SETTINGS_UI_LIVE_SYNC'
if marker in s:
    print('Settings UI live sync already present')
    raise SystemExit(0)

patch=r'''
<script>
/* ANDERSON_SETTINGS_UI_LIVE_SYNC */
(function(){
  function settingsRoot(){
    return document.querySelector('#settings,section[data-page="settings"],.page[data-page="settings"]')||document;
  }
  function syncScheduleFields(st){
    if(!st||!st.settings)return;
    const root=settingsRoot();
    const times=[...root.querySelectorAll('input[type="time"]')];
    let onEl=root.querySelector('#onTime,#lightsOn,#scheduleOn,[name="onTime"],[name="on"]');
    let offEl=root.querySelector('#offTime,#lightsOff,#scheduleOff,[name="offTime"],[name="off"]');
    if(!onEl&&times.length>0)onEl=times[0];
    if(!offEl&&times.length>1)offEl=times[1];
    if(onEl&&st.settings.on)onEl.value=st.settings.on;
    if(offEl&&st.settings.off)offEl.value=st.settings.off;
    const win=document.getElementById('scheduleWindow');
    if(win&&st.scheduleWindow)win.textContent=st.scheduleWindow;
  }
  async function refreshSettingsUI(){
    try{
      const st=await api('/api/state?ts='+Date.now());
      syncScheduleFields(st);
      if(typeof applyState==='function')applyState(st);
    }catch(e){}
  }
  document.addEventListener('click',function(ev){
    const el=ev.target&&ev.target.closest?ev.target.closest('button,a,[role="tab"]'):null;
    if(!el)return;
    const txt=(el.textContent||'').trim().toLowerCase();
    const tab=(el.getAttribute('data-tab')||'').toLowerCase();
    if(tab==='settings'||txt==='settings')setTimeout(refreshSettingsUI,80);
    const root=settingsRoot();
    if(root.contains(el)&&txt.includes('save')){
      setTimeout(refreshSettingsUI,250);
      setTimeout(refreshSettingsUI,900);
    }
  },true);
  window.addEventListener('pageshow',()=>setTimeout(refreshSettingsUI,100));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(refreshSettingsUI,100)});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(refreshSettingsUI,150));
  else setTimeout(refreshSettingsUI,150);
})();
</script>
'''
if '</body>' in s:
    s=s.replace('</body>',patch+'\n</body>',1)
else:
    s+=patch
p.write_text(s)
print('Added live scheduler settings UI synchronization')
