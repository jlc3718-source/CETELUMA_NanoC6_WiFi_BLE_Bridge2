from pathlib import Path
import sys,re

root=Path(sys.argv[1])
main=root/'src/main.cpp'
web=root/'include/WebUI.h'

s=main.read_text()
# Expose the actual persisted scheduler settings in /api/state so the Settings tab
# reloads from NVS instead of falling back to hard-coded HTML defaults.
anchor='d["scheduleWindow"]="Scheduled "+fmtTime(s.onMinutes)+" – "+fmtTime(s.offMinutes);'
if 'd["settings"]' not in s:
    if anchor not in s: raise SystemExit('scheduleWindow state anchor missing')
    add=anchor+'JsonObject cfg=d["settings"].to<JsonObject>();cfg["on"]=fmtTime(s.onMinutes);cfg["off"]=fmtTime(s.offMinutes);cfg["lead"]=s.leadDays;cfg["trail"]=s.trailDays;cfg["overlap"]=s.overlap;cfg["tz"]=s.tz;cfg["scheduler"]=s.schedulerEnabled;'
    s=s.replace(anchor,add,1)

# Make the settings POST also refresh the master config backup after NVS is saved.
start=s.find('server.on("/api/settings",HTTP_POST')
if start<0: raise SystemExit('/api/settings route missing')
end=s.find('server.on(',start+10)
if end<0: end=len(s)
block=s[start:end]
if 'writeMasterConfig()' not in block:
    block2=block.replace('store.saveAll();sendJson(stateJson());','store.saveAll();writeMasterConfig();sendJson(stateJson());',1)
    if block2==block: raise SystemExit('settings save anchor missing')
    s=s[:start]+block2+s[end:]
main.write_text(s)

w=web.read_text()
# The Settings form had static 17:00/23:00 values. Update every Settings-tab time
# input from the values returned by /api/state whenever state is loaded/refreshed.
marker='ANDERSON_SETTINGS_TIME_SYNC'
if marker not in w:
    needle='function applyState(s){if(!s)return;'
    if needle not in w: raise SystemExit('applyState anchor missing')
    inject="""function applyState(s){if(!s)return;/* ANDERSON_SETTINGS_TIME_SYNC */if(s.settings){const ts=document.querySelectorAll('input[type=\"time\"]');let onEl=document.getElementById('onTime')||document.getElementById('lightsOn')||document.getElementById('scheduleOn');let offEl=document.getElementById('offTime')||document.getElementById('lightsOff')||document.getElementById('scheduleOff');if(!onEl&&ts.length>0)onEl=ts[0];if(!offEl&&ts.length>1)offEl=ts[1];if(onEl&&s.settings.on)onEl.value=s.settings.on;if(offEl&&s.settings.off)offEl.value=s.settings.off;}"""
    w=w.replace(needle,inject,1)
web.write_text(w)
print('Fixed Settings lights on/off persistence and refresh display')
