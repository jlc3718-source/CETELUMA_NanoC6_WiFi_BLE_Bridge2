#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <Update.h>
#include <esp_ota_ops.h>
#include <esp_app_desc.h>
#include <time.h>
#include "WebUIGzip.h"
#include "Types.h"
#include "EventCatalog.h"
#include "SettingsStore.h"
#include "BleController.h"
#include "Scheduler.h"

static constexpr int BLUE_LED=7;
static constexpr int USER_BUTTON=9;

WebServer server(80);
SettingsStore store;
BleController ble;
Scheduler* scheduler=nullptr;

bool manualOverride=false,power=true;
uint8_t brightness=100,speedLevel=1;
Theme runningTheme;
uint32_t buttonDown=0,lastScheduleCheck=0;
bool setupAP=false;
bool otaUploadAllowed=false,otaUploadOk=false;String otaUploadError;
bool otaAutoRebootPending=false;uint32_t otaAutoRebootAt=0;

static String colorHex(uint32_t c){char b[8];snprintf(b,sizeof(b),"#%06lX",(unsigned long)c);return b;}
static uint16_t parseTime(const String& s,uint16_t def){if(s.length()<5)return def;int h=s.substring(0,2).toInt(),m=s.substring(3,5).toInt();if(h<0||h>23||m<0||m>59)return def;return h*60+m;}
static String fmtTime(uint16_t m){char b[6];snprintf(b,sizeof(b),"%02d:%02d",m/60,m%60);return b;}
static bool timeValid(){return time(nullptr)>1700000000;}
static constexpr const char* ANDERSON_FIRMWARE_VERSION="1.1.4";
static bool customScheduleRefreshPending=false;
static uint32_t customScheduleRefreshAt=0;
static bool writeMasterConfig();

static uint8_t requestRole(){return 2;}
static bool requireUser(){return true;}
static bool requireAdmin(){return true;}

// Custom lights and schedules use NVS directly so APP-only OTA updates never touch them.
static bool customFsReady=true;
static bool customStoreLocation(const char* path,const char*& ns,const char*& key){if(!strcmp(path,"/custom_lights.json")){ns="anderson-preset";key="custom";return true;}if(!strcmp(path,"/custom_schedules.json")){ns="anderson-csched";key="items";return true;}return false;}
static String customFileRead(const char* path){const char* ns=nullptr;const char* key=nullptr;if(!customStoreLocation(path,ns,key))return "[]";Preferences p;if(!p.begin(ns,true))return "[]";String r=p.getString(key,"[]");p.end();r.trim();return r.length()?r:"[]";}
static bool customFileWrite(const char* path,const String& data){const char* ns=nullptr;const char* key=nullptr;if(!customStoreLocation(path,ns,key))return false;Preferences p;if(!p.begin(ns,false))return false;size_t wrote=p.putString(key,data);String verify=p.getString(key,"");p.end();return wrote==data.length()&&verify==data;}
static String presetStoreRaw(){return customFileRead("/custom_lights.json");}
static String scheduleStoreRaw(){return customFileRead("/custom_schedules.json");}
static uint32_t nextStoredId(JsonArray arr,const char prefix){uint32_t maxId=0;for(JsonObject o:arr){String id=o["id"].as<String>();if(id.length()>1&&id[0]==prefix){uint32_t n=id.substring(1).toInt();if(n>maxId)maxId=n;}}return maxId+1;}
static bool jsonArrayValid(const String& raw){JsonDocument d;return !deserializeJson(d,raw)&&d.is<JsonArray>();}
static void migrateLegacyCustomStorage(){String lights=presetStoreRaw();if(!jsonArrayValid(lights))customFileWrite("/custom_lights.json","[]");String schedules=scheduleStoreRaw();if(!jsonArrayValid(schedules))customFileWrite("/custom_schedules.json","[]");}
static bool restoreMasterConfig(){return false;}
static bool writeMasterConfig(){return true;}
static bool storageSelfTest(){Preferences p;if(!p.begin("anderson-test",false))return false;const String t="ANDERSON_STORAGE_OK";size_t n=p.putString("rw",t);String r=p.getString("rw","");p.remove("rw");p.end();return n==t.length()&&r==t;}

static bool loadPresetTheme(const String& id,Theme& t,uint8_t& br,uint8_t& sp,String* outName=nullptr){
  JsonDocument list;if(deserializeJson(list,presetStoreRaw()))return false;
  for(JsonObject o:list.as<JsonArray>()){
    if(o["id"].as<String>()!=id)continue;t.name=o["name"].as<String>();if(outName)*outName=t.name;t.effect=effectFromString(o["effect"].as<String>());t.colorCount=0;
    for(JsonVariant v:o["colors"].as<JsonArray>()){if(t.colorCount>=8)break;String cs=v.as<String>();if(cs.startsWith("#"))cs.remove(0,1);if(cs.length())t.colors[t.colorCount++]=strtoul(cs.c_str(),nullptr,16);}
    if(!t.colorCount){t.colors[0]=0xFFF1C7;t.colorCount=1;}br=constrain(o["brightness"]|100,1,100);sp=constrain(o["speed"]|1,1,5);return true;
  }return false;
}
static bool resolveCustomSchedule(const tm& l,Theme& t,uint8_t& br,uint8_t& sp){
  JsonDocument list;if(deserializeJson(list,scheduleStoreRaw()))return false;bool found=false;
  for(JsonObject o:list.as<JsonArray>()){
    if(!(o["enabled"]|true))continue;int m=o["month"]|0,d=o["day"]|0,y=o["year"]|0;bool annual=o["annual"]|true;
    if(m!=l.tm_mon+1||d!=l.tm_mday)continue;if(!annual&&y!=l.tm_year+1900)continue;Theme q;uint8_t qb=100,qs=1;if(loadPresetTheme(o["presetId"].as<String>(),q,qb,qs)){t=q;br=qb;sp=qs;found=true;}
  }return found;
}
static bool removeSchedulesForPreset(const String& presetId){
  String raw=scheduleStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonArray a=list.as<JsonArray>();for(int i=(int)a.size()-1;i>=0;i--)if(a[i]["presetId"].as<String>()==presetId)a.remove(i);String out;serializeJson(list,out);bool ok=customFileWrite("/custom_schedules.json",out);if(ok)writeMasterConfig();return ok;
}

static bool localFirmwareClient(){
  IPAddress ip=server.client().remoteIP();
  return ip[0]==10 || (ip[0]==172 && ip[1]>=16 && ip[1]<=31) || (ip[0]==192 && ip[1]==168) || (ip[0]==169 && ip[1]==254) || ip[0]==127;
}
static bool otaPartitionValid(const esp_partition_t* p){
  if(!p)return false;esp_app_desc_t desc{};return esp_ota_get_partition_description(p,&desc)==ESP_OK;
}
static String firmwareJson(){
  JsonDocument d;const esp_partition_t* running=esp_ota_get_running_partition();const esp_partition_t* next=esp_ota_get_next_update_partition(running);
  d["version"]=ANDERSON_FIRMWARE_VERSION;d["runningPartition"]=running?running->label:"";d["nextPartition"]=next?next->label:"";d["slotSize"]=next?(uint32_t)next->size:0;d["localOnly"]=false;d["previousAvailable"]=otaPartitionValid(next);
  esp_app_desc_t desc{};if(running&&esp_ota_get_partition_description(running,&desc)==ESP_OK){d["appVersion"]=desc.version;d["project"]=desc.project_name;d["buildDate"]=desc.date;d["buildTime"]=desc.time;}
  String out;serializeJson(d,out);return out;
}


struct EventOverrideCfg {
  bool valid=false;
  Effect effect=Effect::Jump;
  uint32_t colors[8]={0};
  uint8_t colorCount=0;
  uint8_t speed=1;
};
static EventOverrideCfg eventOverrides[64];

static String eventOverrideKey(size_t i){return String("e")+String((unsigned)i);}
static Theme baseEventTheme(size_t i){
  Theme t;t.name=EVENTS[i].name;t.effect=EVENTS[i].effect;t.colorCount=min((uint8_t)8,EVENTS[i].colorCount);
  for(uint8_t c=0;c<t.colorCount;c++)t.colors[c]=EVENTS[i].colors[c];
  return t;
}
static uint8_t scheduledEventSpeedHint=1;
Theme applyEventOverrideByIndex(size_t i,const Theme& base){
  Theme t=base;if(i>=64||!eventOverrides[i].valid){scheduledEventSpeedHint=1;return t;}
  scheduledEventSpeedHint=constrain(eventOverrides[i].speed,1,5);t.effect=eventOverrides[i].effect;t.colorCount=eventOverrides[i].colorCount;
  for(uint8_t c=0;c<t.colorCount;c++)t.colors[c]=eventOverrides[i].colors[c];
  return t;
}
static Theme effectiveEventTheme(size_t i){return applyEventOverrideByIndex(i,baseEventTheme(i));}
static void loadEventOverrides(){
  Preferences p;p.begin("anderson-event",true);
  for(size_t i=0;i<EVENT_COUNT&&i<64;i++){
    String raw=p.getString(eventOverrideKey(i).c_str(),"");if(!raw.length())continue;
    int sep=raw.indexOf(';');if(sep<1)continue;
    String head=raw.substring(0,sep);int bar=head.indexOf('|');EventOverrideCfg o;o.valid=true;
    if(bar>0){o.effect=effectFromString(head.substring(0,bar));o.speed=constrain(head.substring(bar+1).toInt(),1,5);}else{o.effect=effectFromString(head);o.speed=1;}
    String list=raw.substring(sep+1);int start=0;
    while(start<(int)list.length()&&o.colorCount<8){int comma=list.indexOf(',',start);String v=comma<0?list.substring(start):list.substring(start,comma);v.trim();if(v.startsWith("#"))v.remove(0,1);if(v.length())o.colors[o.colorCount++]=strtoul(v.c_str(),nullptr,16);if(comma<0)break;start=comma+1;}
    if(o.colorCount)eventOverrides[i]=o;
  }
  p.end();
}
static void saveEventOverride(size_t i,const Theme& t,uint8_t sp=1){
  if(i>=64)return;EventOverrideCfg&o=eventOverrides[i];o.valid=true;o.effect=t.effect;o.speed=constrain(sp,1,5);o.colorCount=min((uint8_t)8,t.colorCount);for(uint8_t c=0;c<o.colorCount;c++)o.colors[c]=t.colors[c];
  String raw=String(effectName(o.effect))+"|"+String(o.speed)+";";for(uint8_t c=0;c<o.colorCount;c++){if(c)raw+=",";raw+=colorHex(o.colors[c]);}
  Preferences p;p.begin("anderson-event",false);p.putString(eventOverrideKey(i).c_str(),raw);p.end();writeMasterConfig();
}
static void clearEventOverride(size_t i){if(i>=64)return;eventOverrides[i]=EventOverrideCfg();Preferences p;p.begin("anderson-event",false);p.remove(eventOverrideKey(i).c_str());p.end();writeMasterConfig();}

void addTheme(JsonObject o,const Theme&t){o["name"]=t.name;o["effect"]=effectName(t.effect);JsonArray a=o["colors"].to<JsonArray>();for(int i=0;i<t.colorCount;i++)a.add(colorHex(t.colors[i]));}
String stateJson(){
  JsonDocument d;d["firmwareVersion"]=ANDERSON_FIRMWARE_VERSION;d["power"]=power;d["brightness"]=brightness;d["speed"]=speedLevel;JsonObject r=d["running"].to<JsonObject>();addTheme(r,runningTheme);
  auto&s=store.get();d["scheduleWindow"]="Scheduled "+fmtTime(s.onMinutes)+" – "+fmtTime(s.offMinutes);JsonObject cfg=d["settings"].to<JsonObject>();cfg["on"]=fmtTime(s.onMinutes);cfg["off"]=fmtTime(s.offMinutes);cfg["lead"]=s.leadDays;cfg["trail"]=s.trailDays;cfg["overlap"]=s.overlap;cfg["tz"]=s.tz;cfg["scheduler"]=s.schedulerEnabled;
  tm l{};if(timeValid()){time_t n=time(nullptr);localtime_r(&n,&l);d["nextEvent"]=scheduler->nextEventLabel(l);}else d["nextEvent"]="Waiting for time sync";
  JsonObject w=d["wifi"].to<JsonObject>();w["ssid"]=WiFi.status()==WL_CONNECTED?WiFi.SSID():"";w["rssi"]=WiFi.status()==WL_CONNECTED?WiFi.RSSI():0;w["ip"]=WiFi.status()==WL_CONNECTED?WiFi.localIP().toString():WiFi.softAPIP().toString();
  JsonObject b=d["ble"].to<JsonObject>();b["connected"]=ble.connected();b["connectedCount"]=ble.connectedCount();b["name"]=ble.name();b["address"]=ble.address();b["protocol"]=ble.protocolName();b["target"]=ble.getTarget();JsonArray ca=b["controllers"].to<JsonArray>();for(uint8_t i=0;i<2;i++){auto si=ble.slotInfo(i);if(!si.address.length())continue;JsonObject c=ca.add<JsonObject>();c["slot"]=i;c["name"]=si.name;c["address"]=si.address;c["protocol"]=si.protocol;c["connected"]=si.connected;}
  d["manualOverride"]=manualOverride;String out;serializeJson(d,out);return out;
}
void sendJson(const String&s,int code=200){server.sendHeader("Cache-Control","no-store");server.send(code,"application/json",s);}
bool body(JsonDocument&d){DeserializationError e=deserializeJson(d,server.arg("plain"));if(e){server.send(400,"text/plain","Invalid JSON");return false;}return true;}

void applyRunning(bool force=false){
  if(!power){ble.setPower(false);return;}
  ble.applyTheme(runningTheme,brightness,speedLevel,millis(),force);
}
void evaluateSchedule(bool force=false){
  if(manualOverride||!timeValid())return;tm l{};time_t n=time(nullptr);localtime_r(&n,&l);
  ble.setTarget(0);brightness=100;speedLevel=1;bool should=scheduler->inRunWindow(l)&&store.get().schedulerEnabled;if(!should){if(power){power=false;ble.setPower(false);}return;}
  Theme t;uint8_t cb=100,cs=1;if(resolveCustomSchedule(l,t,cb,cs)){brightness=cb;speedLevel=cs;}else{scheduledEventSpeedHint=1;t=scheduler->resolve(l);speedLevel=scheduledEventSpeedHint;}bool changed=!power||runningTheme.name!=t.name||runningTheme.effect!=t.effect;power=true;runningTheme=t;if(changed||force)applyRunning(true);
}
void startAP(){
  WiFi.mode(WIFI_AP_STA);WiFi.softAP("AndersonHome-Setup","andersonhome");setupAP=true;Serial.printf("Setup AP: http://%s\n",WiFi.softAPIP().toString().c_str());
}
void connectWiFi(){
  auto&s=store.get();WiFi.mode(WIFI_STA);WiFi.setSleep(false);
  if(!s.ssid.length()){startAP();return;}WiFi.begin(s.ssid.c_str(),s.password.c_str());Serial.printf("Connecting to %s",s.ssid.c_str());
  uint32_t start=millis();while(WiFi.status()!=WL_CONNECTED && millis()-start<18000){delay(250);Serial.print(".");}
  if(WiFi.status()==WL_CONNECTED){Serial.printf("\nWi-Fi: %s\n",WiFi.localIP().toString().c_str());setupAP=false;configTzTime(s.tz.c_str(),"pool.ntp.org","time.nist.gov");}
  else{Serial.println("\nWi-Fi failed; starting recovery AP");startAP();}
}
void setupMdns(){
  if(MDNS.begin("anderson-home")){MDNS.setInstanceName("Anderson Home");MDNS.addService("http","tcp",80);}
}
void setupRoutes(){
  server.on("/",HTTP_GET,[]{server.sendHeader("Cache-Control","no-store, no-cache, must-revalidate");server.sendHeader("Content-Encoding","gzip");server.send_P(200,"text/html",(PGM_P)WEB_UI_GZ,WEB_UI_GZ_LEN);});
  server.on("/api/state",HTTP_GET,[]{sendJson(stateJson());});
  server.on("/api/resume",HTTP_POST,[]{manualOverride=false;power=true;brightness=100;speedLevel=1;evaluateSchedule(true);sendJson(stateJson());});

  server.on("/api/control",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;manualOverride=true;
    if(!d["power"].isNull())power=d["power"].as<bool>();
    if(!d["brightness"].isNull())brightness=constrain(d["brightness"].as<int>(),1,100);
    if(!d["speed"].isNull())speedLevel=constrain(d["speed"].as<int>(),1,5);
    if(!d["name"].isNull())runningTheme.name=d["name"].as<String>();
    if(!d["effect"].isNull())runningTheme.effect=effectFromString(d["effect"].as<String>());
    if(d["colors"].is<JsonArray>()){JsonArray a=d["colors"].as<JsonArray>();runningTheme.colorCount=0;for(JsonVariant v:a){if(runningTheme.colorCount>=8)break;String s=v.as<String>();if(s.startsWith("#"))s.remove(0,1);runningTheme.colors[runningTheme.colorCount++]=strtoul(s.c_str(),nullptr,16);}if(runningTheme.colorCount==0){runningTheme.colors[0]=0xFFF1C7;runningTheme.colorCount=1;}}
    applyRunning(true);sendJson(stateJson());
  });

  server.on("/api/events",HTTP_GET,[]{
    int year=server.arg("year").toInt(),month=server.arg("month").toInt();if(year<2020)year=2026;if(month<1||month>12)month=1;
    JsonDocument d;JsonArray arr=d["events"].to<JsonArray>();auto&s=store.get();int monthly=0;
    for(size_t i=0;i<EVENT_COUNT;i++){if(!eventOccursInMonth(i,year,month))continue;Theme et=effectiveEventTheme(i);JsonObject e=arr.add<JsonObject>();e["id"]=EVENTS[i].id;e["name"]=EVENTS[i].name;e["kind"]=kindName(EVENTS[i].kind);e["when"]=eventWhen(i,year);e["effect"]=effectName(et.effect);e["customized"]=i<64?eventOverrides[i].valid:false;e["speed"]=(i<64&&eventOverrides[i].valid)?eventOverrides[i].speed:1;e["enabled"]=i<64?((s.enabledMask>>i)&1ULL):true;e["favorite"]=i<64?((s.favoriteMask>>i)&1ULL):false;JsonArray c=e["colors"].to<JsonArray>();for(int j=0;j<et.colorCount;j++)c.add(colorHex(et.colors[j]));if(EVENTS[i].rule==RuleType::Month&&EVENTS[i].kind==EventKind::Awareness&&e["enabled"].as<bool>())monthly++;}
    d["overlap"]=monthly>1?String(monthly)+" month-long events enabled — overlap rule applies.":(monthly==1?"1 month-long event enabled.":"No month-long awareness themes enabled.");
    String out;serializeJson(d,out);sendJson(out);
  });
  server.on("/api/favorites",HTTP_GET,[]{
    JsonDocument d;JsonArray arr=d["events"].to<JsonArray>();auto&s=store.get();
    for(size_t i=0;i<EVENT_COUNT&&i<64;i++){if(!((s.favoriteMask>>i)&1ULL))continue;Theme et=effectiveEventTheme(i);JsonObject e=arr.add<JsonObject>();e["id"]=EVENTS[i].id;e["name"]=EVENTS[i].name;e["effect"]=effectName(et.effect);e["speed"]=eventOverrides[i].valid?eventOverrides[i].speed:1;JsonArray c=e["colors"].to<JsonArray>();for(int j=0;j<et.colorCount;j++)c.add(colorHex(et.colors[j]));}
    String out;serializeJson(d,out);sendJson(out);
  });
  server.on("/api/event",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;String id=d["id"].as<String>();int i=eventIndexById(id);if(i<0||i>=64){server.send(404,"text/plain","Unknown event");return;}auto&s=store.get();
    if(!d["enabled"].isNull()){if(d["enabled"].as<bool>())s.enabledMask|=(1ULL<<i);else s.enabledMask&=~(1ULL<<i);}
    if(!d["favorite"].isNull()){if(d["favorite"].as<bool>())s.favoriteMask|=(1ULL<<i);else s.favoriteMask&=~(1ULL<<i);}
    if(d["reset"]|false){clearEventOverride(i);}
    else if(!d["effect"].isNull()||!d["speed"].isNull()||d["colors"].is<JsonArray>()){Theme et=effectiveEventTheme(i);uint8_t esp=eventOverrides[i].valid?eventOverrides[i].speed:1;if(!d["effect"].isNull())et.effect=effectFromString(d["effect"].as<String>());if(!d["speed"].isNull())esp=constrain(d["speed"].as<int>(),1,5);if(d["colors"].is<JsonArray>()){et.colorCount=0;for(JsonVariant v:d["colors"].as<JsonArray>()){if(et.colorCount>=8)break;String cs=v.as<String>();if(cs.startsWith("#"))cs.remove(0,1);if(cs.length())et.colors[et.colorCount++]=strtoul(cs.c_str(),nullptr,16);}if(!et.colorCount){et.colors[0]=0xFFF1C7;et.colorCount=1;}}saveEventOverride(i,et,esp);}
    store.saveAll();writeMasterConfig();evaluateSchedule(true);sendJson(stateJson());
  });
  server.on("/api/events/bulk",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;int y=d["year"]|2026,m=d["month"]|1;bool en=d["enabled"]|false;auto&s=store.get();for(size_t i=0;i<EVENT_COUNT&&i<64;i++)if(eventOccursInMonth(i,y,m)){if(en)s.enabledMask|=(1ULL<<i);else s.enabledMask&=~(1ULL<<i);}store.saveAll();writeMasterConfig();server.send(204);
  });

  server.on("/api/settings",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;auto&s=store.get();
    if(!d["overlap"].isNull()){String v=d["overlap"].as<String>();s.overlap=v=="split"?1:(v=="combine"?2:0);}
    if(!d["on"].isNull())s.onMinutes=parseTime(d["on"].as<String>(),s.onMinutes);if(!d["off"].isNull())s.offMinutes=parseTime(d["off"].as<String>(),s.offMinutes);
    if(!d["lead"].isNull())s.leadDays=constrain(d["lead"].as<int>(),0,14);if(!d["trail"].isNull())s.trailDays=constrain(d["trail"].as<int>(),0,7);
    if(!d["tz"].isNull()){s.tz=d["tz"].as<String>();configTzTime(s.tz.c_str(),"pool.ntp.org","time.nist.gov");}
    if(!d["bleProtocol"].isNull())s.bleProtocol=constrain(d["bleProtocol"].as<int>(),0,4);if(!d["scheduler"].isNull())s.schedulerEnabled=d["scheduler"].as<bool>();
    store.saveAll();writeMasterConfig();sendJson(stateJson());
  });

  server.on("/api/colors",HTTP_GET,[]{
    Preferences p;p.begin("anderson-colors",true);String raw=p.getString("saved","[]");p.end();
    JsonDocument list;if(deserializeJson(list,raw))list.to<JsonArray>();JsonDocument d;JsonArray out=d["colors"].to<JsonArray>();
    for(JsonVariant v:list.as<JsonArray>())out.add(v.as<String>());String json;serializeJson(d,json);sendJson(json);
  });
  server.on("/api/colors",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;String col=d["color"].as<String>();col.trim();if(!col.startsWith("#"))col="#"+col;col.toUpperCase();
    if(col.length()!=7){server.send(400,"text/plain","Color must be #RRGGBB");return;}bool remove=d["remove"]|false;
    Preferences p;p.begin("anderson-colors",false);String raw=p.getString("saved","[]");JsonDocument list;if(deserializeJson(list,raw))list.to<JsonArray>();JsonArray arr=list.as<JsonArray>();
    int found=-1;for(int i=0;i<(int)arr.size();i++){String x=arr[i].as<String>();x.toUpperCase();if(x==col){found=i;break;}}
    if(remove){if(found>=0)arr.remove(found);}else if(found<0&&arr.size()<32)arr.add(col);
    String saved;serializeJson(list,saved);p.putString("saved",saved);p.end();writeMasterConfig();JsonDocument out;JsonArray oa=out["colors"].to<JsonArray>();for(JsonVariant v:arr)oa.add(v.as<String>());String json;serializeJson(out,json);sendJson(json);
  });

  server.on("/api/presets",HTTP_GET,[]{
    if(!requireAdmin())return;if(!customFsReady){server.send(500,"text/plain","Persistent storage unavailable");return;}String raw=presetStoreRaw();JsonDocument check;if(deserializeJson(check,raw)||!check.is<JsonArray>())raw="[]";String json;json.reserve(raw.length()+20);json="{\"presets\":";json+=raw;json+="}";sendJson(json);
  });
  server.on("/api/preset",HTTP_POST,[]{
    if(!requireAdmin())return;if(!customFsReady){server.send(500,"text/plain","Persistent storage unavailable");return;}JsonDocument d;if(!body(d))return;String deleteId=d["deleteId"] | "";String name=d["name"] | "";name.trim();String raw=presetStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonArray arr=list.as<JsonArray>();
    if(deleteId.length()){for(int i=(int)arr.size()-1;i>=0;i--)if(arr[i]["id"].as<String>()==deleteId)arr.remove(i);String out;serializeJson(list,out);if(!customFileWrite("/custom_lights.json",out)){server.send(500,"text/plain","Custom light file write failed");return;}removeSchedulesForPreset(deleteId);if(!writeMasterConfig()){server.send(500,"text/plain","Custom light saved but configuration backup failed");return;}sendJson("{\"ok\":true}");return;}
    if(!name.length()){server.send(400,"text/plain","Give this custom light a name");return;}for(JsonObject x:arr){String n=x["name"].as<String>();if(n.equalsIgnoreCase(name)){server.send(409,"text/plain","That custom light name is already in use");return;}}
    if(arr.size()>=12)arr.remove(0);uint32_t seq=nextStoredId(arr,'p');String newId=String("p")+String(seq);JsonObject o=arr.add<JsonObject>();o["id"]=newId;o["name"]=name;o["effect"]=d["effect"]|String("Jump");o["brightness"]=constrain(d["brightness"]|100,1,100);o["speed"]=constrain(d["speed"]|1,1,5);JsonArray c=o["colors"].to<JsonArray>();if(d["colors"].is<JsonArray>())for(JsonVariant v:d["colors"].as<JsonArray>()){if(c.size()>=8)break;String color=v.as<String>();if(color.length())c.add(color);}if(!c.size())c.add("#FFF1C7");
    String out;serializeJson(list,out);if(out.length()>3800){server.send(507,"text/plain","Custom-light storage is full");return;}if(!customFileWrite("/custom_lights.json",out)){server.send(500,"text/plain","Custom light file write failed");return;}if(!writeMasterConfig()){server.send(500,"text/plain","Custom light saved but configuration backup failed");return;}JsonDocument r;r["ok"]=true;r["id"]=newId;r["count"]=(uint32_t)arr.size();r["fileBytes"]=(uint32_t)presetStoreRaw().length();r["backend"]="NVS";String json;serializeJson(r,json);sendJson(json);
  });
  server.on("/api/custom-schedules",HTTP_GET,[]{
    if(!requireUser())return;if(!customFsReady){server.send(500,"text/plain","Persistent storage unavailable");return;}int year=server.arg("year").toInt(),month=server.arg("month").toInt();String raw=scheduleStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonDocument d;JsonArray out=d["items"].to<JsonArray>();for(JsonObject o:list.as<JsonArray>()){bool annual=o["annual"]|true;int oy=o["year"]|0,om=o["month"]|0;if(month>=1&&month<=12&&om!=month)continue;if(!annual&&year>=2020&&oy!=year)continue;JsonObject z=out.add<JsonObject>();z["id"]=o["id"];z["presetId"]=o["presetId"];z["year"]=oy;z["month"]=om;z["day"]=o["day"]|0;z["annual"]=annual;z["enabled"]=o["enabled"]|true;Theme t;uint8_t br=100,sp=1;String n;if(loadPresetTheme(o["presetId"].as<String>(),t,br,sp,&n)){z["name"]=n;z["effect"]=effectName(t.effect);z["brightness"]=br;z["speed"]=sp;JsonArray c=z["colors"].to<JsonArray>();for(uint8_t i=0;i<t.colorCount;i++)c.add(colorHex(t.colors[i]));}}String json;serializeJson(d,json);sendJson(json);
  });
  server.on("/api/custom-schedules",HTTP_POST,[]{
    if(!requireAdmin())return;if(!customFsReady){server.send(500,"text/plain","Persistent storage unavailable");return;}JsonDocument d;if(!body(d))return;String id=d["id"].as<String>();String savedId=id;bool removing=(d["remove"]|false)&&id.length();bool toggling=id.length()&&!d["enabled"].isNull();String presetId=d["presetId"].as<String>();
    if(!removing&&!toggling){Theme t;uint8_t br=100,sp=1;if(!loadPresetTheme(presetId,t,br,sp)){server.send(404,"text/plain","Custom light not found");return;}int month=d["month"]|0,day=d["day"]|0,year=d["year"]|0;if(month<1||month>12||day<1||day>31){server.send(400,"text/plain","Choose a valid schedule date");return;}}
    String raw=scheduleStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonArray arr=list.as<JsonArray>();if(removing){for(int i=(int)arr.size()-1;i>=0;i--)if(arr[i]["id"].as<String>()==id)arr.remove(i);}else if(toggling){bool found=false;for(JsonObject o:arr)if(o["id"].as<String>()==id){o["enabled"]=d["enabled"].as<bool>();found=true;break;}if(!found){server.send(404,"text/plain","Schedule entry not found");return;}}else{int month=d["month"]|0,day=d["day"]|0,year=d["year"]|0;uint32_t seq=nextStoredId(arr,'s');savedId=String("s")+String(seq);JsonObject o=arr.add<JsonObject>();o["id"]=savedId;o["presetId"]=presetId;o["month"]=month;o["day"]=day;o["year"]=year;o["annual"]=d["annual"]|true;o["enabled"]=true;}
    while(arr.size()>32)arr.remove(0);String out;serializeJson(list,out);if(out.length()>3800){server.send(507,"text/plain","Schedule storage is full");return;}if(!customFileWrite("/custom_schedules.json",out)){server.send(500,"text/plain","Schedule file write failed");return;}if(!writeMasterConfig()){server.send(500,"text/plain","Schedule saved but configuration backup failed");return;}JsonDocument ack;ack["ok"]=true;ack["id"]=savedId;ack["count"]=(uint32_t)arr.size();ack["fileBytes"]=(uint32_t)scheduleStoreRaw().length();ack["backend"]="NVS";String ackJson;serializeJson(ack,ackJson);sendJson(ackJson);customScheduleRefreshPending=true;customScheduleRefreshAt=millis()+350;
  });
  server.on("/api/storage",HTTP_GET,[]{JsonDocument d;String lights=presetStoreRaw(),schedules=scheduleStoreRaw();d["ready"]=customFsReady;d["backend"]="NVS";d["customLightsBytes"]=(uint32_t)lights.length();d["scheduleBytes"]=(uint32_t)schedules.length();String out;serializeJson(d,out);sendJson(out);});
  server.on("/api/config",HTTP_GET,[]{JsonDocument d;d["backend"]="NVS";JsonDocument l;if(!deserializeJson(l,presetStoreRaw())&&l.is<JsonArray>())d["customLights"].set(l.as<JsonArray>());else d["customLights"].to<JsonArray>();JsonDocument c;if(!deserializeJson(c,scheduleStoreRaw())&&c.is<JsonArray>())d["customSchedules"].set(c.as<JsonArray>());else d["customSchedules"].to<JsonArray>();String out;serializeJson(d,out);sendJson(out);});

  server.on("/api/firmware",HTTP_GET,[]{sendJson(firmwareJson());});
  server.on("/api/update",HTTP_POST,[]{
    if(!otaUploadAllowed){server.send(403,"text/plain",otaUploadError.length()?otaUploadError:"Firmware upload was not accepted");return;}
    if(!otaUploadOk){server.send(500,"text/plain",otaUploadError.length()?otaUploadError:"Firmware update failed");return;}
    JsonDocument d;d["ok"]=true;d["message"]="Firmware verified. NanoC6 will reboot automatically into the new firmware.";String out;serializeJson(d,out);sendJson(out);otaAutoRebootPending=true;otaAutoRebootAt=millis()+1400;
  },[]{
    HTTPUpload& u=server.upload();
    if(u.status==UPLOAD_FILE_START){
      otaUploadAllowed=true;otaUploadOk=false;otaUploadError="";String fn=u.filename;fn.toLowerCase();
      if(!fn.endsWith(".bin")){otaUploadAllowed=false;otaUploadError="Select an app-only .bin firmware file";return;}
      if(!Update.begin(UPDATE_SIZE_UNKNOWN,U_FLASH)){otaUploadAllowed=false;otaUploadError=String("Unable to open OTA slot. Error ")+String(Update.getError());return;}
    }else if(u.status==UPLOAD_FILE_WRITE){
      if(otaUploadAllowed&&!otaUploadError.length()&&Update.write(u.buf,u.currentSize)!=u.currentSize){otaUploadError=String("Firmware write failed. Error ")+String(Update.getError());Update.abort();}
    }else if(u.status==UPLOAD_FILE_END){
      if(otaUploadAllowed&&!otaUploadError.length()){otaUploadOk=Update.end(true);if(!otaUploadOk)otaUploadError=String("Firmware validation failed. Error ")+String(Update.getError());}
    }else if(u.status==UPLOAD_FILE_ABORTED){Update.abort();otaUploadOk=false;otaUploadError="Firmware upload aborted";}
  });
  server.on("/api/reboot",HTTP_POST,[]{sendJson("{\"ok\":true,\"message\":\"Rebooting NanoC6\"}");otaAutoRebootPending=true;otaAutoRebootAt=millis()+700;});
  server.on("/api/rollback",HTTP_POST,[]{
    const esp_partition_t* running=esp_ota_get_running_partition();const esp_partition_t* other=esp_ota_get_next_update_partition(running);
    if(!otaPartitionValid(other)){server.send(404,"text/plain","No valid previous firmware is available in the other OTA slot");return;}
    if(esp_ota_set_boot_partition(other)!=ESP_OK){server.send(500,"text/plain","Could not select the previous firmware slot");return;}
    sendJson("{\"ok\":true,\"message\":\"Previous firmware selected. Press Reboot NanoC6.\"}");
  });

  server.on("/api/wifi/scan",HTTP_GET,[]{
    if(setupAP) WiFi.mode(WIFI_AP_STA); else WiFi.mode(WIFI_STA);WiFi.setSleep(false);WiFi.scanDelete();delay(150);int n=WiFi.scanNetworks(false,true,false,500);JsonDocument d;JsonArray a=d["networks"].to<JsonArray>();if(n>0){for(int i=0;i<n;i++){String ssid=WiFi.SSID(i);if(!ssid.length())continue;bool duplicate=false;for(JsonObject x:a){if(x["ssid"].as<String>()==ssid){duplicate=true;break;}}if(duplicate)continue;JsonObject x=a.add<JsonObject>();x["ssid"]=ssid;x["rssi"]=WiFi.RSSI(i);}}WiFi.scanDelete();String out;serializeJson(d,out);sendJson(out);
  });
  server.on("/api/wifi",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;String ssid=d["ssid"].as<String>(),pass=d["password"].as<String>();if(!ssid.length()){server.send(400,"text/plain","SSID required");return;}store.saveWiFi(ssid,pass);writeMasterConfig();sendJson("{\"ok\":true}");delay(300);ESP.restart();
  });

  server.on("/api/ble/scan",HTTP_GET,[]{
    auto found=ble.scan();JsonDocument d;JsonArray a=d["devices"].to<JsonArray>();for(auto&f:found){JsonObject x=a.add<JsonObject>();x["name"]=f.name;x["address"]=f.address;x["rssi"]=f.rssi;}String out;serializeJson(d,out);sendJson(out);
  });
  server.on("/api/ble/select",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;String addr=d["address"].as<String>();uint8_t p=d["protocol"]|0;bool ok=ble.selectAndConnect(addr,p);if(ok){store.saveAll();writeMasterConfig();ble.setTarget(0);applyRunning(true);}sendJson(stateJson(),ok?200:500);
  });
  server.on("/api/ble/remove",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;int slot=d["slot"]|-1;if(slot<0||slot>1){server.send(400,"text/plain","Invalid slot");return;}ble.removeController(slot);store.saveAll();writeMasterConfig();ble.setTarget(0);sendJson(stateJson());
  });
  server.on("/api/ble/target",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;int t=d["target"]|0;if(t<0||t>2)t=0;ble.setTarget(t);applyRunning(true);sendJson(stateJson());
  });
  server.onNotFound([](){server.send(404,"text/plain","Not found");});
}

void setup(){
  Serial.begin(115200);delay(500);pinMode(BLUE_LED,OUTPUT);pinMode(USER_BUTTON,INPUT_PULLUP);digitalWrite(BLUE_LED,HIGH);
  store.begin();customFsReady=storageSelfTest();if(customFsReady)migrateLegacyCustomStorage();else Serial.println("Anderson NVS persistent storage self-test failed");loadEventOverrides();scheduler=new Scheduler(&store.get());connectWiFi();setupMdns();ble.begin(&store.get());
  runningTheme.name="Warm White";runningTheme.effect=Effect::Jump;runningTheme.colors[0]=0xFFF1C7;runningTheme.colorCount=1;
  setupRoutes();server.begin();evaluateSchedule(true);digitalWrite(BLUE_LED,LOW);
}
void loop(){
  server.handleClient();ble.loop();
  if(otaAutoRebootPending&&(int32_t)(millis()-otaAutoRebootAt)>=0){otaAutoRebootPending=false;delay(40);ESP.restart();}
  if(millis()-lastScheduleCheck>15000){lastScheduleCheck=millis();evaluateSchedule();}
  if(power)applyRunning(false);
  bool pressed=digitalRead(USER_BUTTON)==LOW;if(pressed && !buttonDown)buttonDown=millis();if(!pressed)buttonDown=0;
  if(buttonDown && millis()-buttonDown>5000){buttonDown=0;store.clearWiFi();digitalWrite(BLUE_LED,HIGH);delay(500);ESP.restart();}
  delay(2);
}
