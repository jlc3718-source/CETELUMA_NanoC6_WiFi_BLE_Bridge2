#include "PaletteMigration.h"
#include "ColorCorrection.h"
#include <ArduinoJson.h>
#include <Preferences.h>
#include <FS.h>
#include <SPIFFS.h>

static constexpr uint8_t BACKUP_FORMAT_VERSION=1;
static constexpr uint8_t PALETTE_MIGRATION_REVISION=3;
static constexpr uint8_t STATE_PENDING=0;
static constexpr uint8_t STATE_APPLIED=1;
static constexpr uint8_t STATE_RESTORED=2;
static constexpr uint8_t STATE_RESTORE_PENDING=3;
static constexpr uint8_t STATE_APPLY_PENDING=4;
static constexpr const char* MIGRATION_NS="anderson-mig";
static constexpr const char* BACKUP_PATH="/palette-v1-backup.json";
static constexpr const char* BACKUP_TMP="/palette-v1-backup.tmp";

static String readPrefString(const char* ns,const char* key,const char* fallback=""){
  Preferences p;if(!p.begin(ns,true))return String(fallback);String value=p.getString(key,fallback);p.end();return value;
}
static bool writePrefStringVerified(const char* ns,const char* key,const String& value){
  Preferences p;if(!p.begin(ns,false))return false;size_t wrote=p.putString(key,value);String verify=p.getString(key,"");p.end();return wrote==value.length()&&verify==value;
}
static uint8_t migrationState(){Preferences p;if(!p.begin(MIGRATION_NS,true))return STATE_PENDING;uint8_t s=p.getUChar("colorstate",STATE_PENDING);p.end();return s;}
static uint8_t migrationRevision(){Preferences p;if(!p.begin(MIGRATION_NS,true))return 0;uint8_t r=p.getUChar("colorrev",0);p.end();return r;}
static bool setMigrationState(uint8_t state,bool completed=false){
  Preferences p;if(!p.begin(MIGRATION_NS,false))return false;p.putUChar("colorstate",state);if(completed)p.putUChar("colorrev",PALETTE_MIGRATION_REVISION);bool ok=p.getUChar("colorstate",255)==state&&(!completed||p.getUChar("colorrev",0)==PALETTE_MIGRATION_REVISION);p.end();return ok;
}
static String eventKey(size_t i){return String("e")+String((unsigned)i);}

static uint32_t fnvAdd(uint32_t h,const String& s){for(size_t i=0;i<s.length();i++){h^=(uint8_t)s[i];h*=16777619u;}h^=0xFF;h*=16777619u;return h;}
static uint32_t backupChecksum(JsonDocument& d){
  uint32_t h=2166136261u;h=fnvAdd(h,d["presets"]|String("[]"));h=fnvAdd(h,d["favoriteColors"]|String("[]"));
  JsonObject events=d["events"].as<JsonObject>();for(size_t i=0;i<64;i++){String key=eventKey(i);if(events[key].isNull())continue;h=fnvAdd(h,key);h=fnvAdd(h,events[key].as<String>());}return h;
}
static String readFile(const char* path){File f=SPIFFS.open(path,"r");if(!f)return "";String s=f.readString();f.close();return s;}
static bool parseBackup(const String& raw,JsonDocument& d){
  if(!raw.length()||deserializeJson(d,raw)||!d.is<JsonObject>())return false;if((d["version"]|0)!=BACKUP_FORMAT_VERSION)return false;if(!d["presets"].is<String>()||!d["favoriteColors"].is<String>()||!d["events"].is<JsonObject>())return false;return (d["checksum"]|0u)==backupChecksum(d);
}
static bool loadBackup(JsonDocument& d){if(!SPIFFS.begin(false))return false;return parseBackup(readFile(BACKUP_PATH),d);}

static bool createBackup(){
  if(!SPIFFS.begin(true))return false;
  JsonDocument existing;if(SPIFFS.exists(BACKUP_PATH))return parseBackup(readFile(BACKUP_PATH),existing);
  if(SPIFFS.exists(BACKUP_TMP)){
    String tmp=readFile(BACKUP_TMP);JsonDocument recovered;if(parseBackup(tmp,recovered)){if(SPIFFS.rename(BACKUP_TMP,BACKUP_PATH)){JsonDocument verify;return parseBackup(readFile(BACKUP_PATH),verify);}}SPIFFS.remove(BACKUP_TMP);
  }
  JsonDocument d;d["version"]=BACKUP_FORMAT_VERSION;d["sourceFirmware"]="2.0.0a";d["provisionalCorrection"]=true;
  d["presets"]=readPrefString("anderson-preset","custom","[]");d["favoriteColors"]=readPrefString("anderson-colors","saved","[]");JsonObject events=d["events"].to<JsonObject>();
  for(size_t i=0;i<64;i++){String key=eventKey(i),raw=readPrefString("anderson-event",key.c_str(),"");if(raw.length())events[key]=raw;}
  d["checksum"]=backupChecksum(d);String payload;serializeJson(d,payload);
  size_t freeBytes=SPIFFS.totalBytes()>SPIFFS.usedBytes()?SPIFFS.totalBytes()-SPIFFS.usedBytes():0;if(freeBytes<payload.length()+2048)return false;
  File f=SPIFFS.open(BACKUP_TMP,"w");if(!f)return false;size_t wrote=f.print(payload);f.flush();f.close();if(wrote!=payload.length()||readFile(BACKUP_TMP)!=payload){SPIFFS.remove(BACKUP_TMP);return false;}
  JsonDocument verifyTmp;if(!parseBackup(payload,verifyTmp)){SPIFFS.remove(BACKUP_TMP);return false;}if(!SPIFFS.rename(BACKUP_TMP,BACKUP_PATH))return false;JsonDocument verifyFinal;return parseBackup(readFile(BACKUP_PATH),verifyFinal);
}

static bool transformPresetJson(const String& original,String& corrected){
  JsonDocument d;if(deserializeJson(d,original)||!d.is<JsonArray>())return false;for(JsonObject preset:d.as<JsonArray>())if(preset["colors"].is<JsonArray>())for(JsonVariant color:preset["colors"].as<JsonArray>())color.set(andersonCorrectHex(color.as<String>()));serializeJson(d,corrected);return corrected.length()<=3800;
}
static bool transformFavoriteJson(const String& original,String& corrected){
  JsonDocument d;if(deserializeJson(d,original)||!d.is<JsonArray>())return false;for(JsonVariant color:d.as<JsonArray>())color.set(andersonCorrectHex(color.as<String>()));serializeJson(d,corrected);return true;
}
static String transformEventRaw(const String& original){
  int sep=original.indexOf(';');if(sep<0)return original;String out=original.substring(0,sep+1),list=original.substring(sep+1);int start=0;bool first=true;
  while(start<=(int)list.length()){int comma=list.indexOf(',',start);String token=comma<0?list.substring(start):list.substring(start,comma);token.trim();if(!first)out+=',';first=false;out+=andersonCorrectHex(token);if(comma<0)break;start=comma+1;}return out;
}
static bool writeEvents(JsonObject events,bool corrected){
  Preferences p;if(!p.begin("anderson-event",false))return false;
  for(size_t i=0;i<64;i++){
    String key=eventKey(i);if(events[key].isNull()){p.remove(key.c_str());if(p.isKey(key.c_str())){p.end();return false;}continue;}
    String value=events[key].as<String>();if(corrected)value=transformEventRaw(value);size_t wrote=p.putString(key.c_str(),value);if(wrote!=value.length()||p.getString(key.c_str(),"")!=value){p.end();return false;}
  }
  p.end();return true;
}
static bool canonicalizeCurrentStoredPalette(){
  String originalPresets=readPrefString("anderson-preset","custom","[]"),correctedPresets;
  if(!transformPresetJson(originalPresets,correctedPresets))return false;
  if(!writePrefStringVerified("anderson-preset","custom",correctedPresets))return false;
  JsonDocument current;JsonObject events=current["events"].to<JsonObject>();
  for(size_t i=0;i<64;i++){String key=eventKey(i),raw=readPrefString("anderson-event",key.c_str(),"");if(raw.length())events[key]=raw;}
  if(!writeEvents(events,true))return false;
  return setMigrationState(STATE_APPLIED,true);
}
static bool applyFromBackup(){
  JsonDocument backup;if(!loadBackup(backup))return false;String presets,colors;if(!transformPresetJson(backup["presets"].as<String>(),presets)||!transformFavoriteJson(backup["favoriteColors"].as<String>(),colors))return false;
  if(!writePrefStringVerified("anderson-preset","custom",presets))return false;if(!writePrefStringVerified("anderson-colors","saved",colors))return false;if(!writeEvents(backup["events"].as<JsonObject>(),true))return false;return setMigrationState(STATE_APPLIED,true);
}
static bool restoreFromBackup(){
  JsonDocument backup;if(!loadBackup(backup))return false;String presets=backup["presets"].as<String>(),colors=backup["favoriteColors"].as<String>();if(!writePrefStringVerified("anderson-preset","custom",presets))return false;if(!writePrefStringVerified("anderson-colors","saved",colors))return false;if(!writeEvents(backup["events"].as<JsonObject>(),false))return false;return setMigrationState(STATE_RESTORED,true);
}

bool runPaletteColorMigration(){
  uint8_t state=migrationState(),revision=migrationRevision();
  if(revision>=PALETTE_MIGRATION_REVISION&&(state==STATE_APPLIED||state==STATE_RESTORED))return true;
  // v3+ canonicalizes the device's CURRENT custom/scheduled palette in place.
  // Favorite Colors are deliberately excluded from this migration.
  if(revision>=2){if(!setMigrationState(STATE_APPLY_PENDING,false))return false;return canonicalizeCurrentStoredPalette();}
  if(state==STATE_RESTORE_PENDING)return restoreFromBackup();if(state==STATE_APPLY_PENDING)return applyFromBackup();
  if(revision>0&&state==STATE_RESTORED)return setMigrationState(STATE_RESTORED,true);
  if(revision>0&&state==STATE_APPLIED){JsonDocument backup;if(!loadBackup(backup))return false;if(!setMigrationState(STATE_APPLY_PENDING,false))return false;return applyFromBackup();}
  if(!createBackup())return false;if(!setMigrationState(STATE_APPLY_PENDING,false))return false;return applyFromBackup();
}
bool restoreOriginalPaletteColors(){if(!createBackup())return false;if(!setMigrationState(STATE_RESTORE_PENDING,false))return false;return restoreFromBackup();}
bool reapplyCorrectedPaletteColors(){if(!createBackup())return false;if(!setMigrationState(STATE_APPLY_PENDING,false))return false;return applyFromBackup();}
String paletteColorMigrationStatusJson(){
  bool mounted=SPIFFS.begin(false),backup=false;if(mounted){JsonDocument d;backup=parseBackup(readFile(BACKUP_PATH),d);}uint8_t state=migrationState();JsonDocument out;out["revision"]=migrationRevision();out["state"]=state;out["migrated"]=state==STATE_APPLIED;out["restored"]=state==STATE_RESTORED;out["backupAvailable"]=backup;out["backupPath"]=BACKUP_PATH;out["provisionalCorrection"]=false;out["physicallyCalibrated"]=true;String json;serializeJson(out,json);return json;
}
