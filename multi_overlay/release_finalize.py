from pathlib import Path
import re
import subprocess
import sys

root = Path(sys.argv[1])
main = root / 'src/main.cpp'
web = root / 'include/WebUI.h'
here = Path(__file__).resolve().parent
version = Path('FIRMWARE_VERSION.txt').read_text().strip()
if not version:
    raise SystemExit('firmware version missing')

# Open full-control compatibility. There is intentionally no authentication.
s = main.read_text()
anchor = 'static bool timeValid(){return time(nullptr)>1700000000;}\n'
shim = '''\nstatic uint8_t requestRole(){return 2;}\nstatic bool requireUser(){return true;}\nstatic bool requireAdmin(){return true;}\n'''
if 'static uint8_t requestRole()' not in s:
    if anchor not in s:
        raise SystemExit('timeValid anchor missing for no-auth shim')
    s = s.replace(anchor, anchor + shim, 1)
main.write_text(s)

w = web.read_text()
if "let currentRole='admin'" not in w:
    pos = w.find('<script>')
    if pos < 0:
        raise SystemExit('script tag missing for no-auth UI shim')
    pos += len('<script>')
    w = w[:pos] + "\nlet currentRole='admin',currentUser='Jason';\n" + w[pos:]
web.write_text(w)

# Persistent storage + BLE identity restoration.
subprocess.check_call([sys.executable, str(here / 'littlefs_master_storage.py'), str(root)])

# Custom schedule refresh state required by the generated schedule routes.
s = main.read_text()
if 'static bool customScheduleRefreshPending' not in s:
    if anchor not in s:
        raise SystemExit('timeValid anchor missing for schedule refresh state')
    s = s.replace(anchor, anchor + 'static bool customScheduleRefreshPending=false;\nstatic uint32_t customScheduleRefreshAt=0;\n', 1)
main.write_text(s)

# OTA updater with automatic reboot and reconnect.
subprocess.check_call([sys.executable, str(here / 'auto_ota_reboot.py'), str(root)])

# Persisted scheduler settings must be returned by /api/state and backed up to master config.
s = main.read_text()
state_anchor = 'd["scheduleWindow"]="Scheduled "+fmtTime(s.onMinutes)+" – "+fmtTime(s.offMinutes);'
if 'd["settings"]' not in s:
    if state_anchor not in s:
        raise SystemExit('scheduleWindow state anchor missing')
    add = state_anchor + 'JsonObject cfg=d["settings"].to<JsonObject>();cfg["on"]=fmtTime(s.onMinutes);cfg["off"]=fmtTime(s.offMinutes);cfg["lead"]=s.leadDays;cfg["trail"]=s.trailDays;cfg["overlap"]=s.overlap;cfg["tz"]=s.tz;cfg["scheduler"]=s.schedulerEnabled;'
    s = s.replace(state_anchor, add, 1)

start = s.find('server.on("/api/settings",HTTP_POST')
if start < 0:
    raise SystemExit('/api/settings route missing')
end = s.find('server.on(', start + 10)
if end < 0:
    end = len(s)
block = s[start:end]
if 'writeMasterConfig()' not in block:
    block2 = block.replace('store.saveAll();sendJson(stateJson());', 'store.saveAll();writeMasterConfig();sendJson(stateJson());', 1)
    if block2 == block:
        raise SystemExit('settings save anchor missing')
    s = s[:start] + block2 + s[end:]
main.write_text(s)

# Verified custom-light/schedule storage + NVS mirror fallback.
subprocess.check_call([sys.executable, str(here / 'storage_hard_fix.py'), str(root)])

# Keep the Settings form synchronized with the values actually stored on the controller.
w = web.read_text()
if 'ANDERSON_SETTINGS_TIME_SYNC' not in w:
    needle = 'function applyState(s){if(!s)return;'
    if needle not in w:
        raise SystemExit('applyState anchor missing')
    inject = '''function applyState(s){if(!s)return;/* ANDERSON_SETTINGS_TIME_SYNC */if(s.settings){const ts=document.querySelectorAll('input[type="time"]');let onEl=document.getElementById('onTime')||document.getElementById('lightsOn')||document.getElementById('scheduleOn');let offEl=document.getElementById('offTime')||document.getElementById('lightsOff')||document.getElementById('scheduleOff');if(!onEl&&ts.length>0)onEl=ts[0];if(!offEl&&ts.length>1)offEl=ts[1];if(onEl&&s.settings.on)onEl.value=s.settings.on;if(offEl&&s.settings.off)offEl.value=s.settings.off;}'''
    w = w.replace(needle, inject, 1)

if 'ANDERSON_SETTINGS_UI_LIVE_SYNC' not in w:
    live_sync = r'''
<script>
/* ANDERSON_SETTINGS_UI_LIVE_SYNC */
(function(){
  function settingsRoot(){return document.querySelector('#settings,section[data-page="settings"],.page[data-page="settings"]')||document;}
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
    try{const st=await api('/api/state?ts='+Date.now());syncScheduleFields(st);if(typeof applyState==='function')applyState(st);}catch(e){}
  }
  document.addEventListener('click',function(ev){
    const el=ev.target&&ev.target.closest?ev.target.closest('button,a,[role="tab"]'):null;
    if(!el)return;
    const txt=(el.textContent||'').trim().toLowerCase();
    const tab=(el.getAttribute('data-tab')||'').toLowerCase();
    if(tab==='settings'||txt==='settings')setTimeout(refreshSettingsUI,80);
    const root=settingsRoot();
    if(root.contains(el)&&txt.includes('save')){setTimeout(refreshSettingsUI,250);setTimeout(refreshSettingsUI,900);}
  },true);
  window.addEventListener('pageshow',()=>setTimeout(refreshSettingsUI,100));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(refreshSettingsUI,100)});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(refreshSettingsUI,150));
  else setTimeout(refreshSettingsUI,150);
})();
</script>
'''
    if '</body>' in w:
        w = w.replace('</body>', live_sync + '\n</body>', 1)
    else:
        w += live_sync

# Current Anderson Home UI theme: blue.
w = re.sub(r'\n<style>\n/\* ANDERSON_(?:RED|BLUE)_BACKGROUND \*/.*?</style>\n', '\n', w, flags=re.S)
blue_css = '''\n<style>\n/* ANDERSON_BLUE_BACKGROUND */\nhtml,body{background:#0a3f88!important;background-image:linear-gradient(160deg,#0f5fc4 0%,#0a3f88 48%,#03142b 100%)!important;background-attachment:fixed!important;}\n</style>\n'''
if '</head>' in w:
    w = w.replace('</head>', blue_css + '</head>', 1)
else:
    w += blue_css

# Hide the obsolete Lights navigation tab while retaining the underlying controls/data APIs.
if 'ANDERSON_REMOVE_LIGHTS_TAB' not in w:
    lights_patch = r'''
<style>
/* ANDERSON_REMOVE_LIGHTS_TAB */
[data-tab="lights"],[data-page="lights"],[href="#lights"],#tabLights,#lightsTab{display:none!important;}
</style>
<script>
/* ANDERSON_REMOVE_LIGHTS_TAB */
(function(){
  function removeLightsTab(){
    document.querySelectorAll('button,a,[role="tab"]').forEach(function(el){
      var txt=(el.textContent||'').trim().toLowerCase();
      var cls=(typeof el.className==='string'?el.className:'').toLowerCase();
      var tab=(el.getAttribute('data-tab')||'').toLowerCase();
      var href=(el.getAttribute('href')||'').toLowerCase();
      var inNav=!!el.closest('nav,.tabs,.tabbar,.nav,.bottom-nav,.top-nav');
      if(tab==='lights'||href==='#lights'||(txt==='lights'&&(inNav||cls.indexOf('tab')>=0))){el.remove();}
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',removeLightsTab);else removeLightsTab();
  setTimeout(removeLightsTab,250);
})();
</script>
'''
    if '</body>' in w:
        w = w.replace('</body>', lights_patch + '\n</body>', 1)
    else:
        w += lights_patch
web.write_text(w)

# Embed firmware revision in the API and Settings page.
s = main.read_text()
if anchor not in s:
    raise SystemExit('timeValid anchor missing for firmware version')
if 'ANDERSON_FIRMWARE_VERSION' not in s:
    s = s.replace(anchor, anchor + f'static constexpr const char* ANDERSON_FIRMWARE_VERSION="{version}";\n', 1)
state = 'JsonDocument d;d["power"]=power;'
if state in s:
    s = s.replace(state, 'JsonDocument d;d["firmwareVersion"]=ANDERSON_FIRMWARE_VERSION;d["power"]=power;', 1)
elif 'd["firmwareVersion"]' not in s:
    raise SystemExit('stateJson anchor missing for firmware version')
main.write_text(s)

w = web.read_text()
panel = f'''    <div class="panel"><strong>Firmware Revision</strong><div class="sub">Current NanoC6 firmware</div><div class="card small" style="margin-top:10px"><strong>v{version}</strong></div></div>\n\n'''
panel_anchor = '<div class="panel"><strong>Persistent Configuration</strong>'
if 'Firmware Revision' not in w:
    if panel_anchor not in w:
        raise SystemExit('Persistent Configuration panel missing for version display')
    w = w.replace(panel_anchor, panel + panel_anchor, 1)
web.write_text(w)

print(f'Finalized Anderson Home firmware v{version}: storage, OTA, schedule UI sync, blue theme, Lights tab removal, and revision display')
