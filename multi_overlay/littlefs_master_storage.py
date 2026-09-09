from pathlib import Path
import re,sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
web=root/'include/WebUI.h'
types=root/'include/Types.h'
storecpp=root/'src/SettingsStore.cpp'
blecpp=root/'src/BleController.cpp'

# ---------- BLE identity persistence ----------
t=types.read_text()
old='''  String bleAddress;\n  String bleAddress2;\n  uint8_t bleProtocol = 0;\n  uint8_t bleProtocol2 = 0;'''
new='''  String bleAddress;\n  String bleAddress2;\n  String bleName;\n  String bleName2;\n  uint8_t bleProtocol = 0;\n  uint8_t bleProtocol2 = 0;'''
if old not in t: raise SystemExit('Types BLE fields anchor missing')
t=t.replace(old,new,1)
types.write_text(t)

s=storecpp.read_text()
old='''  s.bleAddress=prefs.getString("bleaddr",""); s.bleProtocol=prefs.getUChar("bleproto",0); s.bleAddress2=prefs.getString("bleaddr2",""); s.bleProtocol2=prefs.getUChar("bleproto2",0); s.pixelCount=prefs.getUShort("pixels",100);'''
new='''  s.bleAddress=prefs.getString("bleaddr",""); s.bleProtocol=prefs.getUChar("bleproto",0); s.bleAddress2=prefs.getString("bleaddr2",""); s.bleProtocol2=prefs.getUChar("bleproto2",0); s.bleName=prefs.getString("blename",""); s.bleName2=prefs.getString("blename2",""); s.pixelCount=prefs.getUShort("pixels",100);'''
if old not in s: raise SystemExit('SettingsStore BLE load anchor missing')
s=s.replace(old,new,1)
old='''  prefs.putString("bleaddr",s.bleAddress);prefs.putUChar("bleproto",s.bleProtocol);prefs.putString("bleaddr2",s.bleAddress2);prefs.putUChar("bleproto2",s.bleProtocol2);prefs.putUShort("pixels",s.pixelCount);'''
new='''  prefs.putString("bleaddr",s.bleAddress);prefs.putUChar("bleproto",s.bleProtocol);prefs.putString("bleaddr2",s.bleAddress2);prefs.putUChar("bleproto2",s.bleProtocol2);prefs.putString("blename",s.bleName);prefs.putString("blename2",s.bleName2);prefs.putUShort("pixels",s.pixelCount);'''
if old not in s: raise SystemExit('SettingsStore BLE save anchor missing')
s=s.replace(old,new,1)
storecpp.write_text(s)

s=blecpp.read_text()
s=s.replace('if(cfg->bleAddress.length()) connectSlot(0,cfg->bleAddress,cfg->bleProtocol);','if(cfg->bleAddress.length()) connectSlot(0,cfg->bleAddress,cfg->bleProtocol,cfg->bleName);',1)
s=s.replace('if(cfg->bleAddress2.length()) connectSlot(1,cfg->bleAddress2,cfg->bleProtocol2);','if(cfg->bleAddress2.length()) connectSlot(1,cfg->bleAddress2,cfg->bleProtocol2,cfg->bleName2);',1)
old='''void BleController::saveSlots(){if(!cfg)return;cfg->bleAddress=slots[0].address;cfg->bleProtocol=slots[0].protocol;cfg->bleAddress2=slots[1].address;cfg->bleProtocol2=slots[1].protocol;}'''
new='''void BleController::saveSlots(){if(!cfg)return;cfg->bleAddress=slots[0].address;cfg->bleProtocol=slots[0].protocol;cfg->bleName=slots[0].name;cfg->bleAddress2=slots[1].address;cfg->bleProtocol2=slots[1].protocol;cfg->bleName2=slots[1].name;}'''
if old not in s: raise SystemExit('BLE saveSlots anchor missing')
s=s.replace(old,new,1)
old='''  static uint32_t retry=0;if(millis()-retry<30000)return;retry=millis();\n  if(cfg){if(cfg->bleAddress.length()&&!slotConnected(0))connectSlot(0,cfg->bleAddress,cfg->bleProtocol);if(cfg->bleAddress2.length()&&!slotConnected(1))connectSlot(1,cfg->bleAddress2,cfg->bleProtocol2);}'''
new='''  static uint32_t retry=0;static uint32_t started=millis();uint32_t interval=(millis()-started<60000UL)?5000UL:30000UL;if(millis()-retry<interval)return;retry=millis();\n  if(cfg){if(cfg->bleAddress.length()&&!slotConnected(0))connectSlot(0,cfg->bleAddress,cfg->bleProtocol,cfg->bleName);if(cfg->bleAddress2.length()&&!slotConnected(1))connectSlot(1,cfg->bleAddress2,cfg->bleProtocol2,cfg->bleName2);}'''
if old not in s: raise SystemExit('BLE retry loop anchor missing')
s=s.replace(old,new,1)
blecpp.write_text(s)

# ---------- LittleFS persistent custom storage + master configuration ----------
s=main.read_text()
inc='#include <ArduinoJson.h>\n'
if inc not in s: raise SystemExit('ArduinoJson include anchor missing')
if '#include <LittleFS.h>' not in s:
    s=s.replace(inc,inc+'#include <LittleFS.h>\n#include <Preferences.h>\n',1)

anchor='static bool timeValid(){return time(nullptr)>1700000000;}\n'
if anchor not in s: raise SystemExit('timeValid anchor missing')
if 'static bool writeMasterConfig();' not in s:
    s=s.replace(anchor,anchor+'static bool writeMasterConfig();\n',1)

old='''static String presetStoreRaw(){Preferences p;p.begin("anderson-preset",true);String r=p.getString("custom","[]");p.end();return r;}\nstatic String scheduleStoreRaw(){Preferences p;p.begin("anderson-csched",true);String r=p.getString("items","[]");p.end();return r;}'''
new=r'''static bool customFsReady=false;
static String customFileRead(const char* path){
  if(!customFsReady||!LittleFS.exists(path))return "[]";File f=LittleFS.open(path,FILE_READ);if(!f)return "[]";String r=f.readString();f.close();r.trim();return r.length()?r:"[]";
}
static bool customFileWrite(const char* path,const String& data){
  if(!customFsReady)return false;String tmp=String(path)+".tmp";LittleFS.remove(tmp);File f=LittleFS.open(tmp,FILE_WRITE);if(!f)return false;size_t wrote=f.print(data);f.flush();f.close();if(wrote!=data.length()){LittleFS.remove(tmp);return false;}File v=LittleFS.open(tmp,FILE_READ);if(!v){LittleFS.remove(tmp);return false;}String check=v.readString();v.close();if(check!=data){LittleFS.remove(tmp);return false;}if(LittleFS.exists(path))LittleFS.remove(path);if(!LittleFS.rename(tmp,path)){LittleFS.remove(tmp);return false;}File q=LittleFS.open(path,FILE_READ);if(!q)return false;String finalCheck=q.readString();q.close();return finalCheck==data;
}
static String presetStoreRaw(){return customFileRead("/custom_lights.json");}
static String scheduleStoreRaw(){return customFileRead("/custom_schedules.json");}
static uint32_t nextStoredId(JsonArray arr,const char prefix){uint32_t maxId=0;for(JsonObject o:arr){String id=o["id"].as<String>();if(id.length()>1&&id[0]==prefix){uint32_t n=id.substring(1).toInt();if(n>maxId)maxId=n;}}return maxId+1;}
static bool jsonArrayValid(const String& raw){JsonDocument d;return !deserializeJson(d,raw)&&d.is<JsonArray>();}
static void migrateLegacyCustomStorage(){
  if(!customFsReady)return;
  if(!LittleFS.exists("/custom_lights.json")){Preferences p;if(p.begin("anderson-preset",true)){String raw=p.getString("custom","");p.end();if(raw.length()&&jsonArrayValid(raw))customFileWrite("/custom_lights.json",raw);}if(!LittleFS.exists("/custom_lights.json"))customFileWrite("/custom_lights.json","[]");}
  if(!LittleFS.exists("/custom_schedules.json")){Preferences p;if(p.begin("anderson-csched",true)){String raw=p.getString("items","");p.end();if(raw.length()&&jsonArrayValid(raw))customFileWrite("/custom_schedules.json",raw);}if(!LittleFS.exists("/custom_schedules.json"))customFileWrite("/custom_schedules.json","[]");}
}
static bool restoreMasterConfig(){
  if(!customFsReady||!LittleFS.exists("/anderson_config.json"))return false;File f=LittleFS.open("/anderson_config.json",FILE_READ);if(!f)return false;String raw=f.readString();f.close();JsonDocument d;if(deserializeJson(d,raw)||!d.is<JsonObject>())return false;
  if((!LittleFS.exists("/custom_lights.json")||!jsonArrayValid(presetStoreRaw()))&&d["customLights"].is<JsonArray>()){String x;serializeJson(d["customLights"],x);customFileWrite("/custom_lights.json",x);}
  if((!LittleFS.exists("/custom_schedules.json")||!jsonArrayValid(scheduleStoreRaw()))&&d["customSchedules"].is<JsonArray>()){String x;serializeJson(d["customSchedules"],x);customFileWrite("/custom_schedules.json",x);}
  Preferences p;if(p.begin("anderson",false)){JsonObject st=d["settings"].as<JsonObject>();auto &a=store.get();if(st){if(!p.isKey("ssid")&&!st["ssid"].isNull()){a.ssid=st["ssid"].as<String>();a.password=st["password"].as<String>();p.putString("ssid",a.ssid);p.putString("pass",a.password);}if(!p.isKey("tz")&&!st["tz"].isNull()){a.tz=st["tz"].as<String>();p.putString("tz",a.tz);}if(!p.isKey("on")&&!st["on"].isNull()){a.onMinutes=st["on"].as<uint16_t>();p.putUShort("on",a.onMinutes);}if(!p.isKey("off")&&!st["off"].isNull()){a.offMinutes=st["off"].as<uint16_t>();p.putUShort("off",a.offMinutes);}if(!p.isKey("sched")&&!st["scheduler"].isNull()){a.schedulerEnabled=st["scheduler"].as<bool>();p.putBool("sched",a.schedulerEnabled);}if(!p.isKey("pixels")&&!st["pixels"].isNull()){a.pixelCount=st["pixels"].as<uint16_t>();p.putUShort("pixels",a.pixelCount);}}
    JsonArray bl=d["bluetooth"].as<JsonArray>();if(bl){if(bl.size()>0&&!p.isKey("bleaddr")){a.bleAddress=bl[0]["address"].as<String>();a.bleName=bl[0]["name"].as<String>();a.bleProtocol=bl[0]["protocol"]|0;p.putString("bleaddr",a.bleAddress);p.putString("blename",a.bleName);p.putUChar("bleproto",a.bleProtocol);}if(bl.size()>1&&!p.isKey("bleaddr2")){a.bleAddress2=bl[1]["address"].as<String>();a.bleName2=bl[1]["name"].as<String>();a.bleProtocol2=bl[1]["protocol"]|0;p.putString("bleaddr2",a.bleAddress2);p.putString("blename2",a.bleName2);p.putUChar("bleproto2",a.bleProtocol2);}}p.end();}
  if(d["favoriteColors"].is<JsonArray>()){Preferences c;if(c.begin("anderson-colors",false)){if(!c.isKey("saved")){String x;serializeJson(d["favoriteColors"],x);c.putString("saved",x);}c.end();}}
  if(d["eventOverrides"].is<JsonArray>()){Preferences e;if(e.begin("anderson-event",false)){JsonArray a=d["eventOverrides"].as<JsonArray>();for(size_t i=0;i<a.size()&&i<64;i++){String k=String("e")+String((unsigned)i);if(!e.isKey(k.c_str())){String v=a[i].as<String>();if(v.length())e.putString(k.c_str(),v);}}e.end();}}
  return true;
}
static bool writeMasterConfig(){
  if(!customFsReady)return false;JsonDocument d;d["schema"]=2;auto &a=store.get();JsonObject st=d["settings"].to<JsonObject>();st["ssid"]=a.ssid;st["password"]=a.password;st["tz"]=a.tz;st["on"]=a.onMinutes;st["off"]=a.offMinutes;st["lead"]=a.leadDays;st["trail"]=a.trailDays;st["overlap"]=a.overlap;st["scheduler"]=a.schedulerEnabled;st["enabledMask"]=a.enabledMask;st["favoriteMask"]=a.favoriteMask;st["pixels"]=a.pixelCount;
  JsonArray bl=d["bluetooth"].to<JsonArray>();if(a.bleAddress.length()){JsonObject b=bl.add<JsonObject>();b["address"]=a.bleAddress;b["name"]=a.bleName;b["protocol"]=a.bleProtocol;}if(a.bleAddress2.length()){JsonObject b=bl.add<JsonObject>();b["address"]=a.bleAddress2;b["name"]=a.bleName2;b["protocol"]=a.bleProtocol2;}
  JsonDocument lights;if(!deserializeJson(lights,presetStoreRaw())&&lights.is<JsonArray>())d["customLights"].set(lights.as<JsonArray>());else d["customLights"].to<JsonArray>();JsonDocument sch;if(!deserializeJson(sch,scheduleStoreRaw())&&sch.is<JsonArray>())d["customSchedules"].set(sch.as<JsonArray>());else d["customSchedules"].to<JsonArray>();
  Preferences c;c.begin("anderson-colors",true);String cr=c.getString("saved","[]");c.end();JsonDocument cd;if(!deserializeJson(cd,cr)&&cd.is<JsonArray>())d["favoriteColors"].set(cd.as<JsonArray>());else d["favoriteColors"].to<JsonArray>();
  JsonArray eo=d["eventOverrides"].to<JsonArray>();Preferences e;e.begin("anderson-event",true);for(size_t i=0;i<64;i++){String k=String("e")+String((unsigned)i);eo.add(e.getString(k.c_str(),""));}e.end();String out;serializeJson(d,out);if(out.length()>120000)return false;return customFileWrite("/anderson_config.json",out);
}
static bool storageSelfTest(){if(!customFsReady)return false;const String t="ANDERSON_STORAGE_OK";if(!customFileWrite("/storage_test.tmp",t))return false;String r=customFileRead("/storage_test.tmp");LittleFS.remove("/storage_test.tmp");return r==t;}
'''
if old not in s: raise SystemExit('legacy custom store helpers not found')
s=s.replace(old,new,1)

old_remove='''static void removeSchedulesForPreset(const String& presetId){\n  Preferences p;p.begin("anderson-csched",false);String raw=p.getString("items","[]");JsonDocument list;if(deserializeJson(list,raw))list.to<JsonArray>();JsonArray a=list.as<JsonArray>();for(int i=(int)a.size()-1;i>=0;i--)if(a[i]["presetId"].as<String>()==presetId)a.remove(i);String out;serializeJson(list,out);p.putString("items",out);p.end();\n}'''
new_remove='''static bool removeSchedulesForPreset(const String& presetId){\n  String raw=scheduleStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonArray a=list.as<JsonArray>();for(int i=(int)a.size()-1;i>=0;i--)if(a[i]["presetId"].as<String>()==presetId)a.remove(i);String out;serializeJson(list,out);bool ok=customFileWrite("/custom_schedules.json",out);if(ok)writeMasterConfig();return ok;\n}'''
if old_remove not in s: raise SystemExit('removeSchedulesForPreset anchor missing')
s=s.replace(old_remove,new_remove,1)

start=s.find('  server.on("/api/presets",HTTP_GET,[]{')
end=s.find('  server.on("/api/wifi/scan",HTTP_GET,[]{',start)
if start<0 or end<0: raise SystemExit('custom route block missing')
routes=r'''  server.on("/api/presets",HTTP_GET,[]{
    if(!requireAdmin())return;if(!customFsReady){server.send(500,"text/plain","Persistent storage unavailable");return;}String raw=presetStoreRaw();JsonDocument check;if(deserializeJson(check,raw)||!check.is<JsonArray>())raw="[]";String json;json.reserve(raw.length()+20);json="{\"presets\":";json+=raw;json+="}";sendJson(json);
  });
  server.on("/api/preset",HTTP_POST,[]{
    if(!requireAdmin())return;if(!customFsReady){server.send(500,"text/plain","Persistent storage unavailable");return;}JsonDocument d;if(!body(d))return;String deleteId=d["deleteId"].as<String>();String name=d["name"].as<String>();name.trim();String raw=presetStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonArray arr=list.as<JsonArray>();
    if(deleteId.length()){for(int i=(int)arr.size()-1;i>=0;i--)if(arr[i]["id"].as<String>()==deleteId)arr.remove(i);String out;serializeJson(list,out);if(!customFileWrite("/custom_lights.json",out)){server.send(500,"text/plain","Custom light file write failed");return;}removeSchedulesForPreset(deleteId);if(!writeMasterConfig()){server.send(500,"text/plain","Custom light saved but configuration backup failed");return;}sendJson("{\"ok\":true}");return;}
    if(!name.length()){server.send(400,"text/plain","Give this custom light a name");return;}for(JsonObject x:arr){String n=x["name"].as<String>();if(n.equalsIgnoreCase(name)){server.send(409,"text/plain","That custom light name is already in use");return;}}
    if(arr.size()>=12)arr.remove(0);uint32_t seq=nextStoredId(arr,'p');String newId=String("p")+String(seq);JsonObject o=arr.add<JsonObject>();o["id"]=newId;o["name"]=name;o["effect"]=d["effect"]|String("Jump");o["brightness"]=constrain(d["brightness"]|100,1,100);o["speed"]=constrain(d["speed"]|1,1,5);JsonArray c=o["colors"].to<JsonArray>();if(d["colors"].is<JsonArray>())for(JsonVariant v:d["colors"].as<JsonArray>()){if(c.size()>=8)break;String color=v.as<String>();if(color.length())c.add(color);}if(!c.size())c.add("#FFF1C7");
    String out;serializeJson(list,out);if(out.length()>60000){server.send(507,"text/plain","Custom-light storage is full");return;}if(!customFileWrite("/custom_lights.json",out)){server.send(500,"text/plain","Custom light file write failed");return;}if(!writeMasterConfig()){server.send(500,"text/plain","Custom light saved but configuration backup failed");return;}JsonDocument r;r["ok"]=true;r["id"]=newId;r["count"]=(uint32_t)arr.size();String json;serializeJson(r,json);sendJson(json);
  });
  server.on("/api/custom-schedules",HTTP_GET,[]{
    if(!requireUser())return;if(!customFsReady){server.send(500,"text/plain","Persistent storage unavailable");return;}int year=server.arg("year").toInt(),month=server.arg("month").toInt();String raw=scheduleStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonDocument d;JsonArray out=d["items"].to<JsonArray>();for(JsonObject o:list.as<JsonArray>()){bool annual=o["annual"]|true;int oy=o["year"]|0,om=o["month"]|0;if(month>=1&&month<=12&&om!=month)continue;if(!annual&&year>=2020&&oy!=year)continue;JsonObject z=out.add<JsonObject>();z["id"]=o["id"];z["presetId"]=o["presetId"];z["year"]=oy;z["month"]=om;z["day"]=o["day"]|0;z["annual"]=annual;z["enabled"]=o["enabled"]|true;Theme t;uint8_t br=100,sp=1;String n;if(loadPresetTheme(o["presetId"].as<String>(),t,br,sp,&n)){z["name"]=n;z["effect"]=effectName(t.effect);z["brightness"]=br;z["speed"]=sp;JsonArray c=z["colors"].to<JsonArray>();for(uint8_t i=0;i<t.colorCount;i++)c.add(colorHex(t.colors[i]));}}String json;serializeJson(d,json);sendJson(json);
  });
  server.on("/api/custom-schedules",HTTP_POST,[]{
    if(!requireAdmin())return;if(!customFsReady){server.send(500,"text/plain","Persistent storage unavailable");return;}JsonDocument d;if(!body(d))return;String id=d["id"].as<String>();String savedId=id;bool removing=(d["remove"]|false)&&id.length();bool toggling=id.length()&&!d["enabled"].isNull();String presetId=d["presetId"].as<String>();
    if(!removing&&!toggling){Theme t;uint8_t br=100,sp=1;if(!loadPresetTheme(presetId,t,br,sp)){server.send(404,"text/plain","Custom light not found");return;}int month=d["month"]|0,day=d["day"]|0,year=d["year"]|0;if(month<1||month>12||day<1||day>31){server.send(400,"text/plain","Choose a valid schedule date");return;}}
    String raw=scheduleStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonArray arr=list.as<JsonArray>();if(removing){for(int i=(int)arr.size()-1;i>=0;i--)if(arr[i]["id"].as<String>()==id)arr.remove(i);}else if(toggling){bool found=false;for(JsonObject o:arr)if(o["id"].as<String>()==id){o["enabled"]=d["enabled"].as<bool>();found=true;break;}if(!found){server.send(404,"text/plain","Schedule entry not found");return;}}else{int month=d["month"]|0,day=d["day"]|0,year=d["year"]|0;uint32_t seq=nextStoredId(arr,'s');savedId=String("s")+String(seq);JsonObject o=arr.add<JsonObject>();o["id"]=savedId;o["presetId"]=presetId;o["month"]=month;o["day"]=day;o["year"]=year;o["annual"]=d["annual"]|true;o["enabled"]=true;}
    while(arr.size()>32)arr.remove(0);String out;serializeJson(list,out);if(out.length()>60000){server.send(507,"text/plain","Schedule storage is full");return;}if(!customFileWrite("/custom_schedules.json",out)){server.send(500,"text/plain","Schedule file write failed");return;}if(!writeMasterConfig()){server.send(500,"text/plain","Schedule saved but configuration backup failed");return;}JsonDocument ack;ack["ok"]=true;ack["id"]=savedId;ack["count"]=(uint32_t)arr.size();String ackJson;serializeJson(ack,ackJson);sendJson(ackJson);customScheduleRefreshPending=true;customScheduleRefreshAt=millis()+350;
  });
  server.on("/api/storage",HTTP_GET,[]{JsonDocument d;d["ready"]=customFsReady;if(customFsReady){d["totalBytes"]=(uint32_t)LittleFS.totalBytes();d["usedBytes"]=(uint32_t)LittleFS.usedBytes();d["customLightsBytes"]=LittleFS.exists("/custom_lights.json")?(uint32_t)LittleFS.open("/custom_lights.json",FILE_READ).size():0;d["scheduleBytes"]=LittleFS.exists("/custom_schedules.json")?(uint32_t)LittleFS.open("/custom_schedules.json",FILE_READ).size():0;d["configBytes"]=LittleFS.exists("/anderson_config.json")?(uint32_t)LittleFS.open("/anderson_config.json",FILE_READ).size():0;}String out;serializeJson(d,out);sendJson(out);});
  server.on("/api/config",HTTP_GET,[]{if(!customFsReady||!LittleFS.exists("/anderson_config.json")){server.send(404,"text/plain","Configuration backup not available");return;}File f=LittleFS.open("/anderson_config.json",FILE_READ);server.streamFile(f,"application/json");f.close();});

'''
s=s[:start]+routes+s[end:]

# Mount LittleFS immediately after NVS settings are loaded, restore any missing data,
# then let event overrides / Wi-Fi / BLE initialize from the repaired state.
setup='  store.begin();'
if setup not in s: raise SystemExit('store.begin setup anchor missing')
mount='  store.begin();customFsReady=LittleFS.begin(true,"/anderson",10,"spiffs");if(customFsReady){migrateLegacyCustomStorage();restoreMasterConfig();if(!storageSelfTest()){Serial.println("Anderson persistent storage self-test failed");customFsReady=false;}else if(!LittleFS.exists("/anderson_config.json"))writeMasterConfig();}else Serial.println("Anderson LittleFS mount failed");'
s=s.replace(setup,mount,1)

# Keep the master configuration in sync with all existing NVS-backed changes.
s=s.replace('store.saveAll();','store.saveAll();writeMasterConfig();')
s=s.replace('store.saveWiFi(ssid,pass);','store.saveWiFi(ssid,pass);writeMasterConfig();',1)
# Favorite Colors POST is the only route that writes its own NVS namespace.
color_tail='p.putString("saved",saved);p.end();JsonDocument out;'
if color_tail in s:s=s.replace(color_tail,'p.putString("saved",saved);p.end();writeMasterConfig();JsonDocument out;',1)
# Event override NVS updates should also update the master backup.
s=s.replace('p.putString(eventOverrideKey(i).c_str(),raw);p.end();','p.putString(eventOverrideKey(i).c_str(),raw);p.end();writeMasterConfig();',1)
s=s.replace('p.remove(eventOverrideKey(i).c_str());p.end();','p.remove(eventOverrideKey(i).c_str());p.end();writeMasterConfig();',1)

main.write_text(s)

# ---------- Blue background + storage status in Settings ----------
s=web.read_text()
blue='''\nbody{background:linear-gradient(155deg,#041a38 0%,#0a3f88 48%,#03142b 100%)!important;background-attachment:fixed!important;}\n'''
if '</style>' not in s: raise SystemExit('WebUI style close missing')
s=s.replace('</style>',blue+'</style>',1)

# Add a compact persistent-storage status panel ahead of Priority.
settings_anchor='    <div class="panel"><strong>Priority</strong>'
storage_panel='''    <div class="panel"><strong>Persistent Configuration</strong><div class="sub">Custom lights, schedules, controller identities and a master settings backup are stored outside the firmware slots and automatically reloaded after updates/reboots.</div><div id="storageMeta" class="card small" style="margin-top:10px">Checking persistent storage…</div></div>\n\n'''
if settings_anchor in s and 'id="storageMeta"' not in s:s=s.replace(settings_anchor,storage_panel+settings_anchor,1)

js='''\nasync function loadStorageInfo(){const e=$('storageMeta');if(!e)return;try{const d=await api('/api/storage');if(!d.ready){e.textContent='Persistent storage unavailable';return}const used=((d.usedBytes||0)/1024).toFixed(1),total=((d.totalBytes||0)/1024).toFixed(0);e.innerHTML=`<strong>Ready</strong> • ${used} KB of ${total} KB used<br><span class="sub">Custom lights: ${d.customLightsBytes||0} B • Schedules: ${d.scheduleBytes||0} B • Master backup: ${d.configBytes||0} B</span>`}catch(err){e.textContent='Persistent storage status unavailable'}}\nsetTimeout(loadStorageInfo,250);\n'''
if '</script>' not in s: raise SystemExit('WebUI script close missing')
s=s.replace('</script>',js+'\n</script>',1)
web.write_text(s)
print('Added LittleFS master persistence, robust custom saves, BLE identity restore, and blue background')
