from pathlib import Path
import re, sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
web=root/'include/WebUI.h'

s=main.read_text()

# The OTA partition table defines the persistent data partition as SPIFFS.
# Use the matching filesystem implementation rather than mounting it as LittleFS.
s=s.replace('#include <LittleFS.h>','#include <SPIFFS.h>')
s=s.replace('LittleFS.','SPIFFS.')
s=s.replace('customFsReady=SPIFFS.begin(true,"/anderson",10,"spiffs")','customFsReady=SPIFFS.begin(true,"/spiffs",10,"spiffs")')
s=s.replace('Anderson LittleFS mount failed','Anderson SPIFFS mount failed')

pattern=r'''static String customFileRead\(const char\* path\)\{.*?\n\}\nstatic bool customFileWrite\(const char\* path,const String& data\)\{.*?\n\}\n'''
replacement=r'''static const char* customMirrorKey(const char* path){
  if(!strcmp(path,"/custom_lights.json"))return "lights";
  if(!strcmp(path,"/custom_schedules.json"))return "schedules";
  return nullptr;
}
static String customFileRead(const char* path){
  if(customFsReady&&SPIFFS.exists(path)){
    File f=SPIFFS.open(path,FILE_READ);
    if(f){String r=f.readString();f.close();r.trim();if(r.length())return r;}
  }
  const char* key=customMirrorKey(path);
  if(key){Preferences p;if(p.begin("anderson-file",true)){String r=p.getString(key,"");p.end();r.trim();if(r.length())return r;}}
  return "[]";
}
static bool customFileWrite(const char* path,const String& data){
  if(!customFsReady)return false;
  File f=SPIFFS.open(path,FILE_WRITE);
  if(!f)return false;
  size_t wrote=f.print(data);f.flush();f.close();
  if(wrote!=data.length())return false;
  File v=SPIFFS.open(path,FILE_READ);
  if(!v)return false;
  String check=v.readString();size_t bytes=v.size();v.close();
  if(check!=data||bytes!=data.length())return false;
  const char* key=customMirrorKey(path);
  if(key){Preferences p;if(p.begin("anderson-file",false)){size_t n=p.putString(key,data);p.end();if(n!=data.length())Serial.printf("Mirror write short for %s: %u/%u\\n",path,(unsigned)n,(unsigned)data.length());}}
  return true;
}
'''
s,n=re.subn(pattern,replacement,s,count=1,flags=re.S)
if n!=1: raise SystemExit('custom storage function block not found')

# Make the storage endpoint report both the real SPIFFS file and NVS mirror sizes.
old='d["customLightsBytes"]=SPIFFS.exists("/custom_lights.json")?(uint32_t)SPIFFS.open("/custom_lights.json",FILE_READ).size():0;d["scheduleBytes"]=SPIFFS.exists("/custom_schedules.json")?(uint32_t)SPIFFS.open("/custom_schedules.json",FILE_READ).size():0;'
new='d["customLightsBytes"]=SPIFFS.exists("/custom_lights.json")?(uint32_t)SPIFFS.open("/custom_lights.json",FILE_READ).size():0;d["scheduleBytes"]=SPIFFS.exists("/custom_schedules.json")?(uint32_t)SPIFFS.open("/custom_schedules.json",FILE_READ).size():0;Preferences mp;if(mp.begin("anderson-file",true)){d["customLightsMirrorBytes"]=(uint32_t)mp.getString("lights","").length();d["scheduleMirrorBytes"]=(uint32_t)mp.getString("schedules","").length();mp.end();}'
if old not in s: raise SystemExit('storage byte-count anchor missing')
s=s.replace(old,new,1)

# Return persisted byte counts in save acknowledgements so the UI can prove the write immediately.
old='r["count"]=(uint32_t)arr.size();String json;serializeJson(r,json);sendJson(json);'
new='r["count"]=(uint32_t)arr.size();r["fileBytes"]=SPIFFS.exists("/custom_lights.json")?(uint32_t)SPIFFS.open("/custom_lights.json",FILE_READ).size():0;String json;serializeJson(r,json);sendJson(json);'
if old not in s: raise SystemExit('custom-light ack anchor missing')
s=s.replace(old,new,1)
old='ack["count"]=(uint32_t)arr.size();String ackJson;serializeJson(ack,ackJson);sendJson(ackJson);'
new='ack["count"]=(uint32_t)arr.size();ack["fileBytes"]=SPIFFS.exists("/custom_schedules.json")?(uint32_t)SPIFFS.open("/custom_schedules.json",FILE_READ).size():0;String ackJson;serializeJson(ack,ackJson);sendJson(ackJson);'
if old not in s: raise SystemExit('schedule ack anchor missing')
s=s.replace(old,new,1)

main.write_text(s)

w=web.read_text()
w=w.replace("Custom lights: ${d.customLightsBytes||0} B • Schedules: ${d.scheduleBytes||0} B • Master backup: ${d.configBytes||0} B","Custom lights: ${d.customLightsBytes||0} B (mirror ${d.customLightsMirrorBytes||0} B) • Schedules: ${d.scheduleBytes||0} B (mirror ${d.scheduleMirrorBytes||0} B) • Master backup: ${d.configBytes||0} B")

# Refresh the storage panel immediately after successful saves, and show the verified file size.
w=w.replace("await post('/api/preset',preset);$('customPresetName').value='';await loadCustomPresets();status(name+' saved as a custom light.')","const saved=await post('/api/preset',preset);$('customPresetName').value='';await Promise.all([loadCustomPresets(),loadStorageInfo()]);status(name+' saved • '+(saved.fileBytes||0)+' bytes')")
w=w.replace("await post('/api/custom-schedules',{presetId:schedulePresetId,year:y,month:m,day:d,annual:$('customScheduleAnnual').checked});$('scheduleOverlay').classList.remove('open');$('monthSelect').value=m;$('yearSelect').value=y;await loadCustomSchedules();status('Custom light added to the automatic schedule.')","const saved=await post('/api/custom-schedules',{presetId:schedulePresetId,year:y,month:m,day:d,annual:$('customScheduleAnnual').checked});$('scheduleOverlay').classList.remove('open');$('monthSelect').value=m;$('yearSelect').value=y;await Promise.all([loadCustomSchedules(),loadStorageInfo()]);status('Schedule saved • '+(saved.fileBytes||0)+' bytes')")
web.write_text(w)
print('Applied SPIFFS persistence hard fix with verified writes, NVS mirrors, and live size refresh')
