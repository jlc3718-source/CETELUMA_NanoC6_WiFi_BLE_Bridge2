#include "CustomizedBackup.h"
#include "EventCatalog.h"
#include "EventState.h"
#include <ArduinoJson.h>
#include <Preferences.h>
#include <FS.h>
#include <SPIFFS.h>
#include <time.h>

static constexpr uint8_t CUSTOM_BACKUP_SCHEMA=1;
static constexpr uint32_t CUSTOM_BACKUP_INTERVAL_SECONDS=7UL*24UL*60UL*60UL;
static constexpr uint32_t CUSTOM_BACKUP_CHECK_MS=60UL*1000UL;
static constexpr time_t VALID_TIME_EPOCH=1700000000;
static constexpr const char* CUSTOM_BACKUP_PATH="/customized-settings-backup.json";
static constexpr const char* CUSTOM_BACKUP_TMP="/customized-settings-backup.tmp";
static uint32_t lastAutomaticCheckMs=0;
static bool backupFsReady=false;

static uint32_t fnv1a(const String& text){uint32_t h=2166136261u;for(size_t i=0;i<text.length();i++){h^=(uint8_t)text[i];h*=16777619u;}return h;}
static uint32_t backupChecksum(JsonDocument& d){String canonical;serializeJson(d["data"],canonical);return fnv1a(canonical);}
static String readFile(const char* path){File f=SPIFFS.open(path,"r");if(!f)return "";String out=f.readString();f.close();return out;}
static bool validJsonArrayString(const String& raw){JsonDocument d;return !deserializeJson(d,raw)&&d.is<JsonArray>();}
static String prefString(const char* ns,const char* key,const char* fallback=""){Preferences p;if(!p.begin(ns,true))return String(fallback);String v=p.getString(key,fallback);p.end();return v;}
static uint32_t prefUInt(const char* ns,const char* key,uint32_t fallback=0){Preferences p;if(!p.begin(ns,true))return fallback;uint32_t v=p.getUInt(key,fallback);p.end();return v;}

static bool parseBackup(const String& raw,JsonDocument& d,String* error=nullptr){
  if(!raw.length()){if(error)*error="No customized-settings backup exists yet";return false;}
  if(deserializeJson(d,raw)||!d.is<JsonObject>()){if(error)*error="Backup file is not valid JSON";return false;}
  if((d["schema"]|0)!=CUSTOM_BACKUP_SCHEMA){if(error)*error="Backup format is not supported by this firmware";return false;}
  if(!d["data"].is<JsonObject>()){if(error)*error="Backup data section is missing";return false;}
  JsonObject data=d["data"].as<JsonObject>();
  if(!data["settings"].is<JsonObject>()||!data["eventOverrides"].is<JsonObject>()||!data["disabledEvents"].is<JsonArray>()||!data["favoriteEvents"].is<JsonArray>()){
    if(error)*error="Backup is missing required customized-settings sections";return false;
  }
  String lights=data["customLights"]|String(""),schedules=data["customSchedules"]|String("");
  if(!validJsonArrayString(lights)||!validJsonArrayString(schedules)){if(error)*error="Backup custom-light or schedule data is invalid";return false;}
  uint32_t expected=d["checksum"]|0u,actual=backupChecksum(d);if(!expected||expected!=actual){if(error)*error="Backup integrity check failed";return false;}
  return true;
}

static bool writeBackupPayload(const String& payload,String& error){
  if(!backupFsReady)backupFsReady=SPIFFS.begin(false);if(!backupFsReady){error="Backup storage is unavailable";return false;}
  if(SPIFFS.exists(CUSTOM_BACKUP_TMP))SPIFFS.remove(CUSTOM_BACKUP_TMP);
  const size_t freeBytes=SPIFFS.totalBytes()>SPIFFS.usedBytes()?SPIFFS.totalBytes()-SPIFFS.usedBytes():0;
  if(freeBytes<payload.length()+2048){error="Not enough controller storage is free to safely replace the backup";return false;}
  File f=SPIFFS.open(CUSTOM_BACKUP_TMP,"w");if(!f){error="Could not open temporary backup file";return false;}
  size_t wrote=f.print(payload);f.flush();f.close();if(wrote!=payload.length()||readFile(CUSTOM_BACKUP_TMP)!=payload){SPIFFS.remove(CUSTOM_BACKUP_TMP);error="Backup write verification failed";return false;}
  JsonDocument verify;String verifyError;if(!parseBackup(payload,verify,&verifyError)){SPIFFS.remove(CUSTOM_BACKUP_TMP);error=verifyError;return false;}
  if(SPIFFS.exists(CUSTOM_BACKUP_PATH)&&!SPIFFS.remove(CUSTOM_BACKUP_PATH)){SPIFFS.remove(CUSTOM_BACKUP_TMP);error="Previous backup could not be replaced";return false;}
  if(!SPIFFS.rename(CUSTOM_BACKUP_TMP,CUSTOM_BACKUP_PATH)){error="Verified backup could not be promoted";return false;}
  JsonDocument finalCheck;if(!parseBackup(readFile(CUSTOM_BACKUP_PATH),finalCheck,&verifyError)){error=verifyError;return false;}
  return true;
}

void customizedSettingsBackupBegin(){
  backupFsReady=SPIFFS.begin(false);if(!backupFsReady)return;
  if(!SPIFFS.exists(CUSTOM_BACKUP_TMP))return;
  if(SPIFFS.exists(CUSTOM_BACKUP_PATH)){SPIFFS.remove(CUSTOM_BACKUP_TMP);return;}
  String raw=readFile(CUSTOM_BACKUP_TMP);JsonDocument d;if(parseBackup(raw,d,nullptr))SPIFFS.rename(CUSTOM_BACKUP_TMP,CUSTOM_BACKUP_PATH);else SPIFFS.remove(CUSTOM_BACKUP_TMP);
}

bool customizedSettingsBackupCreate(const AppSettings& settings,const char* firmwareVersion,bool automatic,String& error){
  JsonDocument d;d["schema"]=CUSTOM_BACKUP_SCHEMA;d["sourceFirmware"]=firmwareVersion?firmwareVersion:"";time_t now=time(nullptr);d["createdEpoch"]=(int64_t)(now>=VALID_TIME_EPOCH?now:0);d["reason"]=automatic?"automatic":"manual";
  JsonObject data=d["data"].to<JsonObject>();JsonObject s=data["settings"].to<JsonObject>();
  s["tz"]=settings.tz;s["onMinutes"]=settings.onMinutes;s["offMinutes"]=settings.offMinutes;s["leadDays"]=settings.leadDays;s["trailDays"]=settings.trailDays;s["overlap"]=settings.overlap;s["schedulerEnabled"]=settings.schedulerEnabled;s["schedule2Enabled"]=settings.schedule2Enabled;
  s["bleAddress"]=settings.bleAddress;s["bleAddress2"]=settings.bleAddress2;s["bleName"]=settings.bleName;s["bleName2"]=settings.bleName2;s["bleProtocol"]=settings.bleProtocol;s["bleProtocol2"]=settings.bleProtocol2;s["pixelCount"]=settings.pixelCount;
  String lights=prefString("anderson-preset","custom","[]"),schedules=prefString("anderson-csched","items","[]");if(!validJsonArrayString(lights)||!validJsonArrayString(schedules)){error="Current custom-light or schedule storage is invalid; backup was not changed";return false;}
  data["customLights"]=lights;data["customSchedules"]=schedules;JsonObject ids=data["ids"].to<JsonObject>();ids["preset"]=prefUInt("anderson-ids","preset",0);ids["sched"]=prefUInt("anderson-ids","sched",0);
  JsonArray disabled=data["disabledEvents"].to<JsonArray>(),favorites=data["favoriteEvents"].to<JsonArray>();for(size_t i=0;i<EVENT_COUNT&&i<MAX_BUILTIN_EVENTS;i++){if(!eventStateEnabled(i))disabled.add(EVENTS[i].id);if(eventStateFavorite(i))favorites.add(EVENTS[i].id);}
  JsonObject overrides=data["eventOverrides"].to<JsonObject>();Preferences ev;if(ev.begin("anderson-event",true)){for(size_t i=0;i<EVENT_COUNT&&i<MAX_BUILTIN_EVENTS;i++){String key=String("e")+String((unsigned)i),raw=ev.getString(key.c_str(),"");if(raw.length())overrides[EVENTS[i].id]=raw;}ev.end();}
  d["checksum"]=backupChecksum(d);String payload;serializeJson(d,payload);if(payload.length()>120000){error="Customized settings are too large for the protected backup file";return false;}
  return writeBackupPayload(payload,error);
}

static bool putStringChecked(Preferences& p,const char* key,const String& value){size_t wrote=p.putString(key,value);return wrote==value.length()&&p.getString(key,"")==value;}
static bool putUShortChecked(Preferences& p,const char* key,uint16_t value){p.putUShort(key,value);return p.getUShort(key,(uint16_t)(value^0xFFFF))==value;}
static bool putUCharChecked(Preferences& p,const char* key,uint8_t value){p.putUChar(key,value);return p.getUChar(key,(uint8_t)(value^0xFF))==value;}
static bool putBoolChecked(Preferences& p,const char* key,bool value){p.putBool(key,value);return p.getBool(key,!value)==value;}
static bool putUIntChecked(Preferences& p,const char* key,uint32_t value){p.putUInt(key,value);return p.getUInt(key,value^0xFFFFFFFFu)==value;}

bool customizedSettingsBackupRestore(String& error){
  if(!backupFsReady)backupFsReady=SPIFFS.begin(false);if(!backupFsReady){error="Backup storage is unavailable";return false;}
  JsonDocument d;if(!parseBackup(readFile(CUSTOM_BACKUP_PATH),d,&error))return false;JsonObject data=d["data"].as<JsonObject>();JsonObject s=data["settings"].as<JsonObject>();
  String lights=data["customLights"].as<String>(),schedules=data["customSchedules"].as<String>();if(lights.length()>3800||schedules.length()>3800){error="Backup exceeds current custom-light or schedule storage limits";return false;}

  Preferences main;if(!main.begin("anderson",false)){error="Controller settings storage could not be opened";return false;}bool ok=true;
  ok=ok&&putStringChecked(main,"tz",s["tz"]|String("EST5EDT,M3.2.0,M11.1.0"));ok=ok&&putUShortChecked(main,"on",s["onMinutes"]|1020);ok=ok&&putUShortChecked(main,"off",s["offMinutes"]|1380);ok=ok&&putUCharChecked(main,"lead",s["leadDays"]|2);ok=ok&&putUCharChecked(main,"trail",s["trailDays"]|0);ok=ok&&putUCharChecked(main,"overlap",s["overlap"]|0);ok=ok&&putBoolChecked(main,"sched",s["schedulerEnabled"]|true);ok=ok&&putBoolChecked(main,"sched2",s["schedule2Enabled"]|true);
  ok=ok&&putStringChecked(main,"bleaddr",s["bleAddress"]|String(""));ok=ok&&putStringChecked(main,"bleaddr2",s["bleAddress2"]|String(""));ok=ok&&putStringChecked(main,"blename",s["bleName"]|String(""));ok=ok&&putStringChecked(main,"blename2",s["bleName2"]|String(""));ok=ok&&putUCharChecked(main,"bleproto",s["bleProtocol"]|0);ok=ok&&putUCharChecked(main,"bleproto2",s["bleProtocol2"]|0);ok=ok&&putUShortChecked(main,"pixels",s["pixelCount"]|100);main.end();if(!ok){error="Controller settings could not be fully restored";return false;}

  Preferences presets;if(!presets.begin("anderson-preset",false)){error="Custom-light storage could not be opened";return false;}ok=putStringChecked(presets,"custom",lights);presets.end();if(!ok){error="Custom lights could not be restored";return false;}
  Preferences sched;if(!sched.begin("anderson-csched",false)){error="Custom-schedule storage could not be opened";return false;}ok=putStringChecked(sched,"items",schedules);sched.end();if(!ok){error="Custom schedules could not be restored";return false;}
  Preferences ids;if(!ids.begin("anderson-ids",false)){error="Custom ID storage could not be opened";return false;}JsonObject idData=data["ids"].as<JsonObject>();ok=putUIntChecked(ids,"preset",idData["preset"]|0u)&&putUIntChecked(ids,"sched",idData["sched"]|0u);ids.end();if(!ok){error="Custom IDs could not be restored";return false;}

  Preferences ev;if(!ev.begin("anderson-event",false)){error="Event customization storage could not be opened";return false;}for(size_t i=0;i<MAX_BUILTIN_EVENTS;i++){String key=String("e")+String((unsigned)i);ev.remove(key.c_str());}for(JsonPair kv:data["eventOverrides"].as<JsonObject>()){String id=kv.key().c_str();int index=eventIndexById(id);if(index<0||index>=(int)MAX_BUILTIN_EVENTS)continue;String raw=kv.value().as<String>(),key=String("e")+String((unsigned)index);if(raw.length()&&(!putStringChecked(ev,key.c_str(),raw))){ev.end();error="An event color/effect customization could not be restored";return false;}}ev.end();

  if(!eventStateResetAll()){error="Event enabled/favorite state could not be reset for restore";return false;}for(JsonVariant v:data["disabledEvents"].as<JsonArray>()){int index=eventIndexById(v.as<String>());if(index>=0&&!eventStateSetEnabled((size_t)index,false)){error="An event enabled setting could not be restored";return false;}}for(JsonVariant v:data["favoriteEvents"].as<JsonArray>()){int index=eventIndexById(v.as<String>());if(index>=0&&!eventStateSetFavorite((size_t)index,true)){error="An event favorite could not be restored";return false;}}
  return true;
}

String customizedSettingsBackupStatusJson(){
  if(!backupFsReady)backupFsReady=SPIFFS.begin(false);JsonDocument out;out["path"]=CUSTOM_BACKUP_PATH;out["oneCopy"]=true;out["automaticEveryDays"]=7;out["available"]=false;out["valid"]=false;
  if(!backupFsReady){out["error"]="Backup storage unavailable";String json;serializeJson(out,json);return json;}
  String raw=readFile(CUSTOM_BACKUP_PATH);if(!raw.length()){String json;serializeJson(out,json);return json;}JsonDocument backup;String error;if(!parseBackup(raw,backup,&error)){out["error"]=error;out["bytes"]=(uint32_t)raw.length();String json;serializeJson(out,json);return json;}
  out["available"]=true;out["valid"]=true;out["bytes"]=(uint32_t)raw.length();out["sourceFirmware"]=backup["sourceFirmware"]|String("");out["createdEpoch"]=backup["createdEpoch"]|0LL;out["reason"]=backup["reason"]|String("");time_t now=time(nullptr);int64_t created=backup["createdEpoch"]|0LL;if(now>=VALID_TIME_EPOCH&&created>0){uint32_t age=now>created?(uint32_t)(now-created):0;out["ageSeconds"]=age;out["nextAutomaticEpoch"]=(int64_t)(created+CUSTOM_BACKUP_INTERVAL_SECONDS);}String json;serializeJson(out,json);return json;
}

void customizedSettingsBackupAutoLoop(const AppSettings& settings,const char* firmwareVersion){
  uint32_t nowMs=millis();if(lastAutomaticCheckMs&&((uint32_t)(nowMs-lastAutomaticCheckMs)<CUSTOM_BACKUP_CHECK_MS))return;lastAutomaticCheckMs=nowMs;time_t now=time(nullptr);if(now<VALID_TIME_EPOCH)return;
  if(!backupFsReady)backupFsReady=SPIFFS.begin(false);if(!backupFsReady)return;bool due=true;String raw=readFile(CUSTOM_BACKUP_PATH);if(raw.length()){JsonDocument existing;if(parseBackup(raw,existing,nullptr)){int64_t created=existing["createdEpoch"]|0LL;if(created>0&&created<=now&&(uint64_t)(now-created)<CUSTOM_BACKUP_INTERVAL_SECONDS)due=false;}}
  if(due){String ignored;customizedSettingsBackupCreate(settings,firmwareVersion,true,ignored);}
}
