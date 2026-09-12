#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <Update.h>
#include <esp_ota_ops.h>
#include <esp_app_desc.h>
#include <esp_random.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <nvs_flash.h>
#include <mbedtls/sha256.h>
#include <time.h>
#include <atomic>
#include "WebUIGzip.h"
#include "Types.h"
#include "EventCatalog.h"
#include "EventColorThemes.h"
#include "EventState.h"
#include "SettingsStore.h"
#include "BleController.h"
#include "Scheduler.h"
#include "PaletteMigration.h"
#include "ColorCorrection.h"
#include "RemoteUpdate.h"
#include "LoopWatchdog.h"

static constexpr int BLUE_LED=7;
static constexpr int USER_BUTTON=9;

WebServer server(80);
SettingsStore store;
BleController ble;
Scheduler scheduler(&store.get());

bool manualOverride=false,power=true;
uint8_t brightness=100,speedLevel=1;
Theme runningTheme;
uint32_t buttonDown=0,lastScheduleCheck=0;
static uint64_t cpuWindowStartUs=0,cpuBusyUs=0;
static uint8_t cpuLoadPct=0;
bool setupAP=false,wifiWasConnected=false;
static bool networkServerStarted=false,loopWatchdogActive=false;
static uint32_t lastStationIp=0,networkServiceRestarts=0;
static std::atomic<bool> networkServiceRefreshPending{false};
static std::atomic<uint32_t> wifiDisconnectCount{0},wifiLastDisconnectReason{0};
static uint32_t lastWiFiRetry=0,wifiOfflineSince=0;
static bool wifiOfflineTimerStarted=false;
static constexpr uint32_t WIFI_RETRY_INTERVAL_MS=30UL*1000UL;
static constexpr uint32_t WIFI_OFFLINE_REBOOT_MS=10UL*60UL*1000UL;
static constexpr uint16_t MAINTENANCE_REBOOT_MINUTES[]={0U,6U*60U,12U*60U,18U*60U};
static constexpr uint8_t MAINTENANCE_REBOOT_COUNT=sizeof(MAINTENANCE_REBOOT_MINUTES)/sizeof(MAINTENANCE_REBOOT_MINUTES[0]);
static bool maintenanceRebootClockInitialized=false;
static int32_t maintenanceRebootHandledSlot=-1;
bool otaUploadAllowed=false,otaUploadOk=false,otaRecoveryRequest=false;int otaUploadResponseCode=403;String otaUploadError;
bool otaAutoRebootPending=false;uint32_t otaAutoRebootAt=0;

static String colorHex(uint32_t c){char b[8];snprintf(b,sizeof(b),"#%06lX",(unsigned long)c);return b;}
static uint16_t parseTime(const String& s,uint16_t def){if(s.length()<5)return def;int h=s.substring(0,2).toInt(),m=s.substring(3,5).toInt();if(h<0||h>23||m<0||m>59)return def;return h*60+m;}
static String fmtTime(uint16_t m){char b[6];snprintf(b,sizeof(b),"%02d:%02d",m/60,m%60);return b;}
static bool timeValid(){return time(nullptr)>1700000000;}
static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.1.9";
static bool customScheduleRefreshPending=false;
static uint32_t customScheduleRefreshAt=0;

// ANDERSON_FOUR_DIGIT_PIN_AUTH: PIN hashes live in NVS; browser sessions live only in RAM.
static constexpr uint8_t ROLE_NONE=0,ROLE_USER=1,ROLE_ADMIN=2;
static constexpr const char* AUTH_HEADER="X-Anderson-Session";
static constexpr const char* RECOVERY_PIN_HEADER="X-Anderson-Recovery-PIN";
static constexpr uint32_t AUTH_SESSION_TTL_MS=8UL*60UL*60UL*1000UL;
struct AuthSession{String token;String profile;uint8_t role=ROLE_NONE;uint32_t lastSeen=0;};
static AuthSession authSessions[4];
static bool pinProtectionEnabled=false;
static String shirleyPinSalt,shirleyPinHash,jasonPinSalt,jasonPinHash;
struct PinAttemptState{IPAddress ip;bool used=false;uint8_t failures=0;uint32_t blockedUntil=0;uint32_t lastSeen=0;};
static PinAttemptState pinAttempts[6];

static bool fourDigitPin(const String& pin){if(pin.length()!=4)return false;for(size_t i=0;i<4;i++)if(pin[i]<'0'||pin[i]>'9')return false;return true;}
static String hexBytes(const uint8_t* data,size_t len){static const char h[]="0123456789abcdef";String out;out.reserve(len*2);for(size_t i=0;i<len;i++){out+=h[data[i]>>4];out+=h[data[i]&15];}return out;}
static String randomHex(size_t bytes){uint8_t data[32];if(bytes>sizeof(data))bytes=sizeof(data);esp_fill_random(data,bytes);return hexBytes(data,bytes);}
static String pinDigest(const String& profile,const String& pin,const String& salt){String material=String("anderson-pin-v1|")+profile+"|"+salt+"|"+pin;uint8_t digest[32];if(mbedtls_sha256((const uint8_t*)material.c_str(),material.length(),digest,0)!=0)return "";return hexBytes(digest,sizeof(digest));}
static bool constantTimeEqual(const String& a,const String& b){if(a.length()!=b.length())return false;uint8_t diff=0;for(size_t i=0;i<a.length();i++)diff|=(uint8_t)(a[i]^b[i]);return diff==0;}
static bool pinRecordConfigured(const String& salt,const String& hash){return salt.length()==32&&hash.length()==64;}
static bool basePinAuthConfigured(){return pinRecordConfigured(shirleyPinSalt,shirleyPinHash)&&pinRecordConfigured(jasonPinSalt,jasonPinHash);}
static uint8_t profileRole(const String& profile){return profile=="jason"?ROLE_ADMIN:(profile=="shirley"?ROLE_USER:ROLE_NONE);}
static const char* profileDisplayName(const String& profile){if(profile=="shirley")return "Shirley";if(profile=="jason")return "Jason";return "";}
static void clearAuthSessions(){for(auto&s:authSessions){s.token="";s.profile="";s.role=ROLE_NONE;s.lastSeen=0;}}
static bool storePinAuthConfig(bool enabled,const String& ss,const String& sh,const String& js,const String& jh){JsonDocument d;d["version"]=3;d["enabled"]=enabled;d["shirleySalt"]=ss;d["shirleyHash"]=sh;d["jasonSalt"]=js;d["jasonHash"]=jh;String raw;serializeJson(d,raw);Preferences p;if(!p.begin("anderson-auth",false))return false;size_t wrote=p.putString("config",raw);String verify=p.getString("config","");p.end();return wrote==raw.length()&&verify==raw;}
static void loadPinAuthConfig(){Preferences p;if(!p.begin("anderson-auth",true))return;String raw=p.getString("config","");p.end();JsonDocument d;if(!raw.length()||deserializeJson(d,raw))return;int schema=d["version"]|0;shirleyPinSalt=d["shirleySalt"]|String("");shirleyPinHash=d["shirleyHash"]|String("");jasonPinSalt=d["jasonSalt"]|String("");jasonPinHash=d["jasonHash"]|String("");pinProtectionEnabled=(d["enabled"]|false)&&basePinAuthConfigured();if(schema<3)storePinAuthConfig(pinProtectionEnabled,shirleyPinSalt,shirleyPinHash,jasonPinSalt,jasonPinHash);}
static bool configureProfilePins(const String& shirleyPin,const String& jasonPin){if(!fourDigitPin(shirleyPin)||!fourDigitPin(jasonPin)||shirleyPin==jasonPin)return false;String ss=randomHex(16),js=randomHex(16),sh=pinDigest("shirley",shirleyPin,ss),jh=pinDigest("jason",jasonPin,js);if(sh.length()!=64||jh.length()!=64||!storePinAuthConfig(true,ss,sh,js,jh))return false;shirleyPinSalt=ss;shirleyPinHash=sh;jasonPinSalt=js;jasonPinHash=jh;pinProtectionEnabled=true;clearAuthSessions();return true;}
static bool disablePinProtection(){if(!basePinAuthConfigured())return false;if(!storePinAuthConfig(false,shirleyPinSalt,shirleyPinHash,jasonPinSalt,jasonPinHash))return false;pinProtectionEnabled=false;clearAuthSessions();return true;}
static uint8_t sessionRoleForToken(const String& token,bool touch=true){if(token.length()!=64)return ROLE_NONE;uint32_t now=millis();for(auto&s:authSessions){if(!s.token.length())continue;if((uint32_t)(now-s.lastSeen)>AUTH_SESSION_TTL_MS){s.token="";s.profile="";s.role=ROLE_NONE;continue;}if(constantTimeEqual(s.token,token)){if(touch)s.lastSeen=now;return s.role;}}return ROLE_NONE;}
static String issueAuthSession(uint8_t role,const String& profile){uint32_t now=millis();size_t slot=0;uint32_t oldestAge=0;for(size_t i=0;i<4;i++){uint32_t age=(uint32_t)(now-authSessions[i].lastSeen);if(!authSessions[i].token.length()||age>AUTH_SESSION_TTL_MS){slot=i;break;}if(i==0||age>oldestAge){oldestAge=age;slot=i;}}authSessions[slot].token=randomHex(32);authSessions[slot].profile=profile;authSessions[slot].role=role;authSessions[slot].lastSeen=now;return authSessions[slot].token;}
static String sessionProfileForToken(const String& token){if(token.length()!=64)return "";for(auto&s:authSessions)if(s.token.length()&&constantTimeEqual(s.token,token))return s.profile;return "";}
static void revokeAuthSession(const String& token){for(auto&s:authSessions)if(token.length()&&constantTimeEqual(s.token,token)){s.token="";s.profile="";s.role=ROLE_NONE;s.lastSeen=0;}}
static uint8_t requestRole(){if(!pinProtectionEnabled)return ROLE_ADMIN;return sessionRoleForToken(server.header(AUTH_HEADER));}
static bool requireRole(uint8_t needed){uint8_t role=requestRole();if(role>=needed)return true;server.sendHeader("Cache-Control","no-store");if(role==ROLE_NONE)server.send(401,"application/json","{\"ok\":false,\"error\":\"A valid profile PIN is required\"}");else server.send(403,"application/json","{\"ok\":false,\"error\":\"This profile cannot use that control\"}");return false;}
static bool requireUser(){return requireRole(ROLE_USER);}
static bool requireAdmin(){return requireRole(ROLE_ADMIN);}
static PinAttemptState& currentPinAttempt(){IPAddress ip=server.client().remoteIP();uint32_t now=millis();size_t slot=0;uint32_t oldestAge=0;for(size_t i=0;i<6;i++){if(pinAttempts[i].used&&pinAttempts[i].ip==ip){pinAttempts[i].lastSeen=now;return pinAttempts[i];}if(!pinAttempts[i].used){slot=i;oldestAge=UINT32_MAX;break;}uint32_t age=(uint32_t)(now-pinAttempts[i].lastSeen);if(i==0||age>oldestAge){oldestAge=age;slot=i;}}PinAttemptState& a=pinAttempts[slot];a=PinAttemptState();a.used=true;a.ip=ip;a.lastSeen=now;return a;}
static uint32_t pinRetryAfter(){auto&a=currentPinAttempt();int32_t remaining=(int32_t)(a.blockedUntil-millis());return remaining>0?(uint32_t)(remaining+999)/1000:0;}
static void notePinFailure(){auto&a=currentPinAttempt();if(++a.failures>=5){a.failures=0;a.blockedUntil=millis()+60000UL;}}
static void clearPinFailures(){auto&a=currentPinAttempt();a.failures=0;a.blockedUntil=0;}
static bool verifyProfilePin(const String& profile,const String& pin,uint8_t& role){role=profileRole(profile);if(role==ROLE_NONE||!fourDigitPin(pin))return false;const String& salt=profile=="jason"?jasonPinSalt:shirleyPinSalt;const String& expected=profile=="jason"?jasonPinHash:shirleyPinHash;return constantTimeEqual(pinDigest(profile,pin,salt),expected);}
static String pinAuthStatusJson(){JsonDocument d;String token=server.header(AUTH_HEADER);uint8_t role=pinProtectionEnabled?sessionRoleForToken(token,false):ROLE_NONE;String profile=role!=ROLE_NONE?sessionProfileForToken(token):String("");d["pinEnabled"]=pinProtectionEnabled;d["configured"]=basePinAuthConfigured();d["pinLength"]=4;d["authenticated"]=role!=ROLE_NONE;if(role!=ROLE_NONE){d["role"]=role==ROLE_ADMIN?"admin":"user";d["name"]=profileDisplayName(profile);}String out;serializeJson(d,out);return out;}

// Custom lights and schedules use NVS directly so APP-only OTA updates never touch them.
static bool customFsReady=true;
static bool customStoreLocation(const char* path,const char*& ns,const char*& key){if(!strcmp(path,"/custom_lights.json")){ns="anderson-preset";key="custom";return true;}if(!strcmp(path,"/custom_schedules.json")){ns="anderson-csched";key="items";return true;}return false;}
static String customFileRead(const char* path){const char* ns=nullptr;const char* key=nullptr;if(!customStoreLocation(path,ns,key))return "[]";Preferences p;if(!p.begin(ns,true))return "[]";String r=p.getString(key,"[]");p.end();r.trim();return r.length()?r:"[]";}
static bool customFileWrite(const char* path,const String& data){const char* ns=nullptr;const char* key=nullptr;if(!customStoreLocation(path,ns,key))return false;Preferences p;if(!p.begin(ns,false))return false;size_t wrote=p.putString(key,data);String verify=p.getString(key,"");p.end();return wrote==data.length()&&verify==data;}
static String presetStoreRaw(){return customFileRead("/custom_lights.json");}
static String scheduleStoreRaw(){return customFileRead("/custom_schedules.json");}
static uint32_t nextStoredId(JsonArray arr,const char prefix){uint32_t maxId=0;for(JsonObject o:arr){String id=o["id"].as<String>();if(id.length()>1&&id[0]==prefix){uint32_t n=id.substring(1).toInt();if(n>maxId)maxId=n;}}Preferences p;if(!p.begin("anderson-ids",false))return 0;const char* key=prefix=='p'?"preset":"sched";uint32_t stored=p.getUInt(key,0),next=max(maxId,stored)+1;size_t wrote=p.putUInt(key,next);bool ok=wrote>0&&p.getUInt(key,0)==next;p.end();return ok?next:0;}
static bool jsonArrayValid(const String& raw){JsonDocument d;return !deserializeJson(d,raw)&&d.is<JsonArray>();}
static void migrateLegacyCustomStorage(){String lights=presetStoreRaw();if(!jsonArrayValid(lights))customFileWrite("/custom_lights.json","[]");String schedules=scheduleStoreRaw();if(!jsonArrayValid(schedules))customFileWrite("/custom_schedules.json","[]");}

// Complete the legacy calendar marker without resetting user data.
// The compiled catalog, eventStateBegin(), and seedMasterSceneFavoritesV4() provide defaults.
static bool writeMasterFavoriteColors(){JsonDocument d;JsonArray a=d.to<JsonArray>();for(size_t i=0;i<ANDERSON_COLOR_PALETTE_COUNT;i++)a.add(colorHex(ANDERSON_COLOR_PALETTE[i].output));String raw;serializeJson(d,raw);Preferences p;if(!p.begin("anderson-colors",false))return false;size_t wrote=p.putString("saved",raw);bool ok=wrote==raw.length()&&p.getString("saved","")==raw;p.end();return ok;}
static bool migrateMasterCalendarV1(){
  Preferences marker;if(!marker.begin("anderson",true))return false;uint8_t rev=marker.getUChar("calendarrev",0);marker.end();if(rev>=1)return true;
  // eventStateBegin() initializes the corrected event-state store before this call.
  // A failed legacy migration must not erase subsequent event edits or custom favorites.
  if(!writeMasterFavoriteColors())return false;
  if(!marker.begin("anderson",false))return false;marker.putUChar("calendarrev",1);bool ok=marker.getUChar("calendarrev",0)==1;marker.end();return ok;
}

struct MasterSceneFavorite{const char* id;const char* label;};
static constexpr MasterSceneFavorite MASTER_SCENE_FAVORITES[]={
  {"evt006","New Year's Day"},
  {"evt011","Martin Luther King Jr. Day"},
  {"evt026","Presidents' Day"},
  {"evt025","Valentine's Day"},
  {"evt027","Mardi Gras"},
  {"evt046","St. Patrick's Day"},
  {"evt061","April Fools' Day"},
  {"evt065","Easter"},
  {"evt087","Mother's Day"},
  {"evt095","Memorial Day"},
  {"evt105","Flag Day"},
  {"evt109","Father's Day"},
  {"evt106","Juneteenth"},
  {"evt118","Independence Day"},
  {"evt144","Labor Day"},
  {"evt135","Childhood Cancer Awareness Month"},
  {"evt134","Suicide Prevention Awareness Month"},
  {"evt145","988 Day"},
  {"evt146","World Suicide Prevention Day"},
  {"evt147","Patriot Day / 9-11 Remembrance"},
  {"evt173","Indigenous Peoples' / Columbus Day"},
  {"evt179","Halloween"},
  {"evt193","Veterans Day"},
  {"evt197","Thanksgiving"},
  {"evt202","Hanukkah"},
  {"evt208","Christmas Day"},
  {"evt209","Kwanzaa"},
  {"evt210","New Year's Eve"},
};
static constexpr size_t MASTER_SCENE_FAVORITE_COUNT=sizeof(MASTER_SCENE_FAVORITES)/sizeof(MASTER_SCENE_FAVORITES[0]);
static_assert(MASTER_SCENE_FAVORITE_COUNT==28,"Scene Favorites must match the approved 28-scene list");

static bool seedMasterSceneFavoritesV4(){
  Preferences marker;if(!marker.begin("anderson",true))return false;uint8_t rev=marker.getUChar("calendarrev",0);marker.end();if(rev>=4)return true;
  size_t indices[MASTER_SCENE_FAVORITE_COUNT];
  for(size_t n=0;n<MASTER_SCENE_FAVORITE_COUNT;n++){int idx=eventIndexById(MASTER_SCENE_FAVORITES[n].id);if(idx<0||idx>=(int)MAX_BUILTIN_EVENTS)return false;indices[n]=(size_t)idx;}
  if(!eventStateReplaceFavorites(indices,MASTER_SCENE_FAVORITE_COUNT))return false;
  auto& settings=store.get();settings.favoriteMask=0;if(!store.saveAll())return false;
  if(!marker.begin("anderson",false))return false;marker.putUChar("calendarrev",4);bool ok=marker.getUChar("calendarrev",0)==4;marker.end();return ok;
}

static bool storageReadOnlyHealthCheck(){
  Preferences p;if(!p.begin("anderson",true))return false;(void)p.getString("tz","");p.end();
  return jsonArrayValid(presetStoreRaw())&&jsonArrayValid(scheduleStoreRaw());
}
static bool storageWriteSelfTest(){Preferences p;if(!p.begin("anderson-test",false))return false;const String t="ANDERSON_STORAGE_OK";size_t n=p.putString("rw",t);String r=p.getString("rw","");p.remove("rw");p.end();return n==t.length()&&r==t;}
static bool storageHealthCheck(){
  const bool readOk=storageReadOnlyHealthCheck();String lastTested;Preferences marker;
  if(marker.begin("anderson",true)){lastTested=marker.getString("storver","");marker.end();}
  if(readOk&&lastTested==ANDERSON_FIRMWARE_VERSION)return true;
  if(!storageWriteSelfTest())return false;
  if(!marker.begin("anderson",false))return false;const String version=ANDERSON_FIRMWARE_VERSION;size_t wrote=marker.putString("storver",version);String verify=marker.getString("storver","");marker.end();
  return wrote==version.length()&&verify==version;
}

static bool loadPresetThemeFromArray(JsonArray presets,const String& id,Theme& t,uint8_t& br,uint8_t& sp,String* outName=nullptr,bool activeOnly=false){for(JsonObject o:presets){if(o["id"].as<String>()!=id)continue;if(activeOnly&&!(o["enabled"]|true))return false;t.name=o["name"].as<String>();if(outName)*outName=t.name;t.effect=effectFromString(o["effect"].as<String>());t.colorCount=0;for(JsonVariant v:o["colors"].as<JsonArray>()){if(t.colorCount>=8)break;String cs=v.as<String>();if(cs.startsWith("#"))cs.remove(0,1);if(cs.length())t.colors[t.colorCount++]=strtoul(cs.c_str(),nullptr,16);}if(!t.colorCount){t.colors[0]=0xFFFF44;t.colorCount=1;}br=constrain(o["brightness"]|100,1,100);sp=constrain(o["speed"]|1,1,5);return true;}return false;}
static bool loadPresetTheme(const String& id,Theme& t,uint8_t& br,uint8_t& sp,String* outName=nullptr,bool activeOnly=false){JsonDocument list;if(deserializeJson(list,presetStoreRaw())||!list.is<JsonArray>())return false;return loadPresetThemeFromArray(list.as<JsonArray>(),id,t,br,sp,outName,activeOnly);}
static bool resolveCustomSchedule(const tm& l,Theme& t,uint8_t& br,uint8_t& sp){JsonDocument schedules,presets;if(deserializeJson(schedules,scheduleStoreRaw())||!schedules.is<JsonArray>()||deserializeJson(presets,presetStoreRaw())||!presets.is<JsonArray>())return false;bool found=false;for(JsonObject o:schedules.as<JsonArray>()){if(!(o["enabled"]|true))continue;int m=o["month"]|0,d=o["day"]|0,y=o["year"]|0;bool annual=o["annual"]|true;if(m!=l.tm_mon+1||d!=l.tm_mday||(!annual&&y!=l.tm_year+1900))continue;Theme q;uint8_t qb=100,qs=1;if(loadPresetThemeFromArray(presets.as<JsonArray>(),o["presetId"].as<String>(),q,qb,qs,nullptr,true)){t=q;br=qb;sp=qs;found=true;}}return found;}

static bool otaPartitionValid(const esp_partition_t* p){
  if(!p)return false;esp_app_desc_t desc{};return esp_ota_get_partition_description(p,&desc)==ESP_OK;
}
static const char* resetReasonName(){
  switch(esp_reset_reason()){
    case ESP_RST_POWERON:return "Power on";
    case ESP_RST_SW:return "Software reboot";
    case ESP_RST_TASK_WDT:return "Application watchdog";
    case ESP_RST_INT_WDT:return "Interrupt watchdog";
    case ESP_RST_WDT:return "System watchdog";
    case ESP_RST_PANIC:return "Software exception";
    case ESP_RST_BROWNOUT:return "Low supply voltage";
    case ESP_RST_DEEPSLEEP:return "Deep sleep wake";
    default:return "Other reset";
  }
}
static String firmwareJson(){
  JsonDocument d;const esp_partition_t* running=esp_ota_get_running_partition();const esp_partition_t* next=esp_ota_get_next_update_partition(running);
  d["version"]=ANDERSON_FIRMWARE_VERSION;d["runningPartition"]=running?running->label:"";d["nextPartition"]=next?next->label:"";d["slotSize"]=next?(uint32_t)next->size:0;d["previousAvailable"]=otaPartitionValid(next);
  d["uptimeMs"]=(uint32_t)millis();d["resetReason"]=resetReasonName();d["loopWatchdog"]=loopWatchdogActive;
  esp_app_desc_t desc{};if(running&&esp_ota_get_partition_description(running,&desc)==ESP_OK){d["appVersion"]=desc.version;d["project"]=desc.project_name;d["buildDate"]=desc.date;d["buildTime"]=desc.time;}
  String out;serializeJson(d,out);return out;
}

static uint8_t maintenanceRebootSlotForMinute(uint16_t minute){
  uint8_t slot=0;for(uint8_t i=1;i<MAINTENANCE_REBOOT_COUNT;i++){if(minute<MAINTENANCE_REBOOT_MINUTES[i])break;slot=i;}return slot;
}
static int32_t maintenanceRebootDayKey(const tm& local){return (int32_t)(local.tm_year+1900)*366+(int32_t)local.tm_yday;}
static String maintenanceRebootLabel(uint16_t minute){
  uint8_t h=(uint8_t)(minute/60U),m=(uint8_t)(minute%60U);const bool pm=h>=12;uint8_t h12=(uint8_t)(h%12U);if(!h12)h12=12;char b[12];snprintf(b,sizeof(b),"%u:%02u %s",h12,m,pm?"PM":"AM");return String(b);
}
static bool nextMaintenanceReboot(time_t now,time_t& nextAt,uint32_t& secondsRemaining,uint16_t& nextMinute){
  tm base{};if(!localtime_r(&now,&base))return false;
  for(uint8_t dayOffset=0;dayOffset<2;dayOffset++)for(uint8_t i=0;i<MAINTENANCE_REBOOT_COUNT;i++){
    tm candidate=base;candidate.tm_mday+=dayOffset;candidate.tm_hour=MAINTENANCE_REBOOT_MINUTES[i]/60U;candidate.tm_min=MAINTENANCE_REBOOT_MINUTES[i]%60U;candidate.tm_sec=0;candidate.tm_isdst=-1;
    time_t when=mktime(&candidate);if(when<now)continue;
    tm normalized{};if(!localtime_r(&when,&normalized))continue;int32_t key=maintenanceRebootDayKey(normalized)*MAINTENANCE_REBOOT_COUNT+i;
    if(maintenanceRebootClockInitialized&&key<=maintenanceRebootHandledSlot)continue;
    nextAt=when;secondsRemaining=when>now?(uint32_t)(when-now):0U;nextMinute=MAINTENANCE_REBOOT_MINUTES[i];return true;
  }
  return false;
}
static String systemJson(){
  JsonDocument d;const bool wifiConnected=WiFi.status()==WL_CONNECTED;const esp_partition_t* running=esp_ota_get_running_partition();const uint32_t slotBytes=running?(uint32_t)running->size:0;const uint32_t appBytes=(uint32_t)ESP.getSketchSize();
  d["version"]=ANDERSON_FIRMWARE_VERSION;d["cpuLoad"]=cpuLoadPct;d["cpuMhz"]=(uint32_t)getCpuFrequencyMhz();d["uptimeMs"]=(uint32_t)millis();
  d["resetReason"]=resetReasonName();d["loopWatchdog"]=loopWatchdogActive;d["wifiDisconnects"]=wifiDisconnectCount.load();d["wifiLastReason"]=wifiLastDisconnectReason.load();d["networkRestarts"]=networkServiceRestarts;
  d["heapTotal"]=(uint32_t)ESP.getHeapSize();d["heapFree"]=(uint32_t)ESP.getFreeHeap();d["heapMin"]=(uint32_t)ESP.getMinFreeHeap();d["heapLargest"]=(uint32_t)ESP.getMaxAllocHeap();
  d["wifiConnected"]=wifiConnected;d["rssi"]=wifiConnected?WiFi.RSSI():0;d["ssid"]=wifiConnected?WiFi.SSID():String("");d["ip"]=wifiConnected?WiFi.localIP().toString():WiFi.softAPIP().toString();
  d["bleConnected"]=ble.connected();d["bleCount"]=ble.connectedCount();d["appBytes"]=appBytes;d["slotBytes"]=slotBytes;d["appFreeBytes"]=slotBytes>appBytes?slotBytes-appBytes:0;
  nvs_stats_t nvsStats{};if(nvs_get_stats(nullptr,&nvsStats)==ESP_OK){d["nvsUsedEntries"]=(uint32_t)nvsStats.used_entries;d["nvsFreeEntries"]=(uint32_t)nvsStats.free_entries;d["nvsTotalEntries"]=(uint32_t)nvsStats.total_entries;}
  d["storageHealth"]=customFsReady?"OK":"Failed";d["storageWriteTestPolicy"]="Firmware upgrade or read failure";
  d["rebootSchedule"]="12:00 AM • 6:00 AM • 12:00 PM • 6:00 PM";
  if(timeValid()){time_t now=time(nullptr),nextAt=0;uint32_t remaining=0;uint16_t nextMinute=0;if(nextMaintenanceReboot(now,nextAt,remaining,nextMinute)){d["nextReboot"]=maintenanceRebootLabel(nextMinute);d["nextRebootEpoch"]=(int64_t)nextAt;d["nextRebootSeconds"]=remaining;}}
  else d["nextReboot"]="Waiting for time sync";
  String out;serializeJson(d,out);return out;
}

// The independent recovery page is compressed separately by tools/release.py.


static EventColorTheme activeEventColorTheme=EventColorTheme::Modern;
static uint32_t eventColorThemeGeneration=1;
static bool loadEventColorTheme(){Preferences p;if(!p.begin("anderson-evpal",true))return false;uint8_t t=p.getUChar("theme",1);uint32_t g=p.getUInt("gen",1);p.end();activeEventColorTheme=t==0?EventColorTheme::Original:EventColorTheme::Modern;eventColorThemeGeneration=max((uint32_t)1,g);return true;}
static bool setEventColorTheme(EventColorTheme next){if(next==activeEventColorTheme)return true;uint32_t nextGen=eventColorThemeGeneration+1;if(nextGen==0)nextGen=1;Preferences p;if(!p.begin("anderson-evpal",false))return false;size_t wt=p.putUChar("theme",next==EventColorTheme::Original?0:1),wg=p.putUInt("gen",nextGen);bool ok=wt>0&&wg>0&&p.getUChar("theme",255)==(next==EventColorTheme::Original?0:1)&&p.getUInt("gen",0)==nextGen;p.end();if(!ok)return false;activeEventColorTheme=next;eventColorThemeGeneration=nextGen;return true;}

struct EventOverrideCfg{bool valid=false;Effect effect=Effect::Jump;uint32_t colors[8]={0};uint8_t colorCount=0;uint8_t speed=1;uint32_t colorGeneration=1;};
static EventOverrideCfg eventOverrides[MAX_BUILTIN_EVENTS];
static String eventOverrideKey(size_t i,EventColorTheme theme){return String(theme==EventColorTheme::Original?"o":"m")+String((unsigned)i);}
static String legacyEventOverrideKey(size_t i){return String("e")+String((unsigned)i);}
static EventColorTheme legacyOverrideTheme(const String& raw){
  int sep=raw.indexOf(';');if(sep>0){String head=raw.substring(0,sep);if(head.startsWith("v2|")){int b1=head.indexOf('|',3),b2=b1<0?-1:head.indexOf('|',b1+1);if(b2>=0){uint32_t g=max((uint32_t)1,(uint32_t)head.substring(b2+1).toInt());return (g&1U)?EventColorTheme::Modern:EventColorTheme::Original;}}}
  return EventColorTheme::Modern;
}
static bool migrateLegacyEventOverrides(){
  Preferences p;if(!p.begin("anderson-event",false))return false;bool ok=true;
  for(size_t i=0;i<EVENT_COUNT&&i<MAX_BUILTIN_EVENTS;i++){
    String oldKey=legacyEventOverrideKey(i),raw=p.getString(oldKey.c_str(),"");if(!raw.length())continue;String newKey=eventOverrideKey(i,legacyOverrideTheme(raw));
    if(!p.isKey(newKey.c_str())){size_t wrote=p.putString(newKey.c_str(),raw);if(wrote!=raw.length()||p.getString(newKey.c_str(),"")!=raw){ok=false;continue;}}
    if(p.isKey(newKey.c_str())&&!p.remove(oldKey.c_str())&&p.isKey(oldKey.c_str()))ok=false;
  }
  p.end();return ok;
}
static uint8_t scheduledEventSpeedHint=1;
Theme applyEventOverrideByIndex(size_t i,const Theme& base){Theme t=base;if(i<EVENT_COUNT&&activeEventColorTheme==EventColorTheme::Original)applyOriginalEventColors(i,t);scheduledEventSpeedHint=eventSpeed(i);if(i>=EVENT_COUNT||i>=MAX_BUILTIN_EVENTS||!eventOverrides[i].valid)return t;const auto&o=eventOverrides[i];scheduledEventSpeedHint=constrain(o.speed,1,5);t.effect=o.effect;if(o.colorCount){t.colorCount=o.colorCount;for(uint8_t c=0;c<t.colorCount;c++)t.colors[c]=o.colors[c];}return t;}
static Theme effectiveEventTheme(size_t i){return applyEventOverrideByIndex(i,themeFromEvent(i));}
static void loadEventOverrides(){
  for(size_t i=0;i<MAX_BUILTIN_EVENTS;i++)eventOverrides[i]=EventOverrideCfg();
  Preferences p;if(!p.begin("anderson-event",true))return;
  for(size_t i=0;i<EVENT_COUNT&&i<MAX_BUILTIN_EVENTS;i++){
    String raw=p.getString(eventOverrideKey(i,activeEventColorTheme).c_str(),"");
    if(!raw.length()){String legacy=p.getString(legacyEventOverrideKey(i).c_str(),"");if(legacy.length()&&legacyOverrideTheme(legacy)==activeEventColorTheme)raw=legacy;}
    if(!raw.length())continue;int sep=raw.indexOf(';');if(sep<1)continue;String head=raw.substring(0,sep);EventOverrideCfg o;o.valid=true;o.colorGeneration=eventColorThemeGeneration;if(head.startsWith("v2|")){int b1=head.indexOf('|',3),b2=b1<0?-1:head.indexOf('|',b1+1);if(b1<0||b2<0)continue;o.effect=effectFromString(head.substring(3,b1));o.speed=constrain(head.substring(b1+1,b2).toInt(),1,5);o.colorGeneration=max((uint32_t)1,(uint32_t)head.substring(b2+1).toInt());}else{int bar=head.indexOf('|');if(bar>0){o.effect=effectFromString(head.substring(0,bar));o.speed=constrain(head.substring(bar+1).toInt(),1,5);}else{o.effect=effectFromString(head);o.speed=1;}}String list=raw.substring(sep+1);int pos=0;while(pos<(int)list.length()&&o.colorCount<8){int comma=list.indexOf(',',pos);String v=comma<0?list.substring(pos):list.substring(pos,comma);v.trim();if(v.startsWith("#"))v.remove(0,1);if(v.length())o.colors[o.colorCount++]=strtoul(v.c_str(),nullptr,16);if(comma<0)break;pos=comma+1;}eventOverrides[i]=o;
  }
  p.end();
}
static bool saveEventOverride(size_t i,const Theme& t,uint8_t sp=1){if(i>=EVENT_COUNT||i>=MAX_BUILTIN_EVENTS)return false;EventOverrideCfg next;next.valid=true;next.effect=t.effect;next.speed=constrain(sp,1,5);next.colorGeneration=eventColorThemeGeneration;next.colorCount=min((uint8_t)8,t.colorCount);for(uint8_t c=0;c<next.colorCount;c++)next.colors[c]=andersonCorrectColor(t.colors[c]);String raw=String("v2|")+effectName(next.effect)+"|"+String(next.speed)+"|"+String(next.colorGeneration)+";";for(uint8_t c=0;c<next.colorCount;c++){if(c)raw+=",";raw+=colorHex(next.colors[c]);}Preferences p;if(!p.begin("anderson-event",false))return false;String key=eventOverrideKey(i,activeEventColorTheme);size_t wrote=p.putString(key.c_str(),raw);String verify=p.getString(key.c_str(),"");p.end();if(wrote!=raw.length()||verify!=raw)return false;eventOverrides[i]=next;return true;}
static bool clearEventOverride(size_t i){if(i>=EVENT_COUNT||i>=MAX_BUILTIN_EVENTS)return false;String key=eventOverrideKey(i,activeEventColorTheme);Preferences p;if(!p.begin("anderson-event",false))return false;String old=p.getString(key.c_str(),"");bool ok=!old.length()||p.remove(key.c_str());bool gone=!p.getString(key.c_str(),"").length();p.end();if(!ok||!gone)return false;eventOverrides[i]=EventOverrideCfg();return true;}

void addTheme(JsonObject o,const Theme&t){o["name"]=t.name;o["effect"]=effectName(t.effect);JsonArray a=o["colors"].to<JsonArray>();for(int i=0;i<t.colorCount;i++)a.add(colorHex(t.colors[i]));}
String stateJson(){
  JsonDocument d;d["firmwareVersion"]=ANDERSON_FIRMWARE_VERSION;d["power"]=power;d["brightness"]=brightness;d["speed"]=speedLevel;JsonObject r=d["running"].to<JsonObject>();addTheme(r,runningTheme);
  auto&s=store.get();JsonObject cfg=d["settings"].to<JsonObject>();cfg["on"]=fmtTime(s.onMinutes);cfg["off"]=fmtTime(s.offMinutes);cfg["lead"]=s.leadDays;cfg["trail"]=s.trailDays;cfg["overlap"]=s.overlap;cfg["tz"]=s.tz;cfg["scheduler"]=s.schedulerEnabled;cfg["scheduler2"]=s.schedule2Enabled;cfg["schedule2Brightness"]=30;
  tm l{};if(timeValid()){time_t n=time(nullptr);localtime_r(&n,&l);uint16_t dawn=scheduler.civilDawnMinutes(l);cfg["dawn"]=fmtTime(dawn);d["scheduleWindow"]=String("Schedule 1 ")+fmtTime(s.onMinutes)+" - "+fmtTime(s.offMinutes)+" • Schedule 2 "+fmtTime(s.offMinutes)+" - dawn ("+fmtTime(dawn)+") at 30%";d["nextEvent"]=scheduler.nextEventLabel(l);}else{d["scheduleWindow"]=String("Schedule 1 ")+fmtTime(s.onMinutes)+" - "+fmtTime(s.offMinutes)+" • Schedule 2 "+fmtTime(s.offMinutes)+" - dawn at 30%";d["nextEvent"]="Waiting for time sync";}
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
  if(manualOverride||!timeValid())return;tm l{};time_t n=time(nullptr);localtime_r(&n,&l);auto&s=store.get();uint8_t previousBrightness=brightness,previousSpeed=speedLevel;
  ble.setTarget(0);brightness=100;speedLevel=1;bool schedule1Active=s.schedulerEnabled&&scheduler.inRunWindow(l);bool schedule2Active=s.schedule2Enabled&&scheduler.inSchedule2Window(l);if(!schedule1Active&&!schedule2Active){if(power){power=false;ble.setPower(false);}return;}
  tm themeLocal=l;if(schedule2Active&&!schedule1Active){uint16_t dawn=scheduler.civilDawnMinutes(l);int mins=l.tm_hour*60+l.tm_min;if(mins<dawn){themeLocal.tm_mday-=1;themeLocal.tm_isdst=-1;mktime(&themeLocal);}}
  Theme t;uint8_t cb=100,cs=1;if(resolveCustomSchedule(themeLocal,t,cb,cs)){brightness=cb;speedLevel=cs;}else{scheduledEventSpeedHint=1;t=scheduler.resolve(themeLocal);speedLevel=scheduledEventSpeedHint;}if(schedule2Active&&!schedule1Active)brightness=30;bool changed=!power||runningTheme.name!=t.name||runningTheme.effect!=t.effect||previousBrightness!=brightness||previousSpeed!=speedLevel;power=true;runningTheme=t;if(changed||force)applyRunning(true);
}
void startAP(){
  WiFi.mode(WIFI_AP_STA);WiFi.softAP("AndersonHome-Setup","andersonhome");setupAP=true;
}
void connectWiFi(){
  auto&s=store.get();WiFi.mode(WIFI_STA);WiFi.setSleep(false);WiFi.setAutoReconnect(true);
  if(!s.ssid.length()){startAP();return;}WiFi.begin(s.ssid.c_str(),s.password.c_str());
  uint32_t start=millis();while(WiFi.status()!=WL_CONNECTED && millis()-start<18000){delay(250);}
  if(WiFi.status()==WL_CONNECTED){wifiWasConnected=true;setupAP=false;configTzTime(s.tz.c_str(),"pool.ntp.org","time.nist.gov");}
  else{startAP();}
  lastWiFiRetry=millis();
}
void setupMdns(){
  if(MDNS.begin("anderson-home")){MDNS.setInstanceName("Anderson Home");MDNS.addService("http","tcp",80);}
}
static void onWiFiEvent(arduino_event_id_t event,arduino_event_info_t info){
  // Event callbacks run on another task. Only publish flags here; service and
  // socket changes stay on the application task, outside request/upload handling.
  if(event==ARDUINO_EVENT_WIFI_STA_DISCONNECTED){
    wifiLastDisconnectReason.store(info.wifi_sta_disconnected.reason);
    wifiDisconnectCount.fetch_add(1);networkServiceRefreshPending.store(true);
  }else if(event==ARDUINO_EVENT_WIFI_STA_GOT_IP||event==ARDUINO_EVENT_WIFI_STA_LOST_IP){
    networkServiceRefreshPending.store(true);
  }
}
// Recover the saved network after router downtime, including startup fallback AP mode.
static void maintainWiFiConnection(){
  if(Update.isRunning()||otaAutoRebootPending)return;
  uint32_t now=millis();
  uint32_t currentIp=(uint32_t)WiFi.localIP();
  if(WiFi.status()==WL_CONNECTED&&currentIp!=0){
    wifiOfflineTimerStarted=false;
    if(setupAP&&WiFi.mode(WIFI_STA))setupAP=false;
    const bool refresh=networkServiceRefreshPending.exchange(false);
    if(!wifiWasConnected||refresh||currentIp!=lastStationIp){
      if(networkServerStarted){server.client().stop();server.stop();server.begin();++networkServiceRestarts;}
      configTzTime(store.get().tz.c_str(),"pool.ntp.org","time.nist.gov");
      MDNS.end();setupMdns();
    }
    lastStationIp=currentIp;wifiWasConnected=true;return;
  }
  wifiWasConnected=false;
  if(!store.get().ssid.length()){wifiOfflineTimerStarted=false;return;}
  if(!wifiOfflineTimerStarted){wifiOfflineTimerStarted=true;wifiOfflineSince=now;}
  if(WiFi.scanComplete()!=WIFI_SCAN_RUNNING&&(uint32_t)(now-lastWiFiRetry)>=WIFI_RETRY_INTERVAL_MS){
    lastWiFiRetry=now;WiFi.reconnect();
  }
  if((uint32_t)(now-wifiOfflineSince)>=WIFI_OFFLINE_REBOOT_MS){
    delay(40);ESP.restart();
  }
}
void setupRoutes(){
  const char* collectedHeaders[]={AUTH_HEADER,RECOVERY_PIN_HEADER};server.collectHeaders(collectedHeaders,2);
  server.on("/",HTTP_GET,[]{server.sendHeader("Cache-Control","no-store, no-cache, must-revalidate");server.sendHeader("Content-Encoding","gzip");server.send_P(200,"text/html",(PGM_P)WEB_UI_GZ,WEB_UI_GZ_LEN);});
  server.on("/recovery",HTTP_GET,[]{server.sendHeader("Cache-Control","no-store, no-cache, must-revalidate");server.sendHeader("X-Content-Type-Options","nosniff");server.sendHeader("Content-Encoding","gzip");server.send_P(200,"text/html",(PGM_P)RECOVERY_UI_GZ,RECOVERY_UI_GZ_LEN);});
  server.on("/api/auth/status",HTTP_GET,[]{sendJson(pinAuthStatusJson());});
  server.on("/api/auth/unlock",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;String profile=d["profile"]|String("");profile.toLowerCase();String pin=d["pin"]|String("");uint8_t role=profileRole(profile);
    if(role==ROLE_NONE){server.send(400,"application/json","{\"ok\":false,\"error\":\"Choose Shirley or Jason\"}");return;}
    if(!pinProtectionEnabled){JsonDocument out;out["ok"]=true;out["pinEnabled"]=false;out["role"]=role==ROLE_ADMIN?"admin":"user";out["name"]=profileDisplayName(profile);String json;serializeJson(out,json);sendJson(json);return;}
    uint32_t retry=pinRetryAfter();if(retry){JsonDocument out;out["ok"]=false;out["error"]=String("Too many incorrect PIN attempts. Try again in ")+String(retry)+" seconds.";out["retryAfter"]=retry;String json;serializeJson(out,json);sendJson(json,429);return;}
    if(!verifyProfilePin(profile,pin,role)){notePinFailure();server.sendHeader("Cache-Control","no-store");server.send(401,"application/json","{\"ok\":false,\"error\":\"Incorrect four-digit PIN\"}");return;}
    clearPinFailures();JsonDocument out;out["ok"]=true;out["pinEnabled"]=true;out["token"]=issueAuthSession(role,profile);out["role"]=role==ROLE_ADMIN?"admin":"user";out["name"]=profileDisplayName(profile);out["expiresIn"]=AUTH_SESSION_TTL_MS/1000;String json;serializeJson(out,json);sendJson(json);
  });
  server.on("/api/auth/logout",HTTP_POST,[]{revokeAuthSession(server.header(AUTH_HEADER));server.sendHeader("Cache-Control","no-store");server.send(204);});
  server.on("/api/auth/config",HTTP_POST,[]{
    if(pinProtectionEnabled&&!requireAdmin())return;JsonDocument d;if(!body(d))return;bool enable=d["enabled"]|true;
    if(!enable){if(!basePinAuthConfigured()){server.send(409,"application/json","{\"ok\":false,\"error\":\"No profile PINs have been configured\"}");return;}if(!disablePinProtection()){server.send(500,"application/json","{\"ok\":false,\"error\":\"PIN protection could not be disabled\"}");return;}sendJson("{\"ok\":true,\"pinEnabled\":false}");return;}
    String shirleyPin=d["shirleyPin"]|String(""),jasonPin=d["jasonPin"]|String("");if(!fourDigitPin(shirleyPin)||!fourDigitPin(jasonPin)){server.send(400,"application/json","{\"ok\":false,\"error\":\"Both PINs must contain exactly four digits\"}");return;}if(shirleyPin==jasonPin){server.send(400,"application/json","{\"ok\":false,\"error\":\"Shirley and Jason must use different PINs\"}");return;}if(!configureProfilePins(shirleyPin,jasonPin)){server.send(500,"application/json","{\"ok\":false,\"error\":\"PINs could not be saved and verified\"}");return;}JsonDocument out;out["ok"]=true;out["pinEnabled"]=true;out["token"]=issueAuthSession(ROLE_ADMIN,"jason");String json;serializeJson(out,json);sendJson(json);
  });
  server.on("/api/state",HTTP_GET,[]{if(!requireUser())return;sendJson(stateJson());});
  server.on("/api/resume",HTTP_POST,[]{if(!requireUser())return;manualOverride=false;power=true;brightness=100;speedLevel=1;evaluateSchedule(true);sendJson(stateJson());});

  server.on("/api/control",HTTP_POST,[]{
    if(!requireUser())return;JsonDocument d;if(!body(d))return;manualOverride=true;
    if(!d["power"].isNull())power=d["power"].as<bool>();
    if(!d["brightness"].isNull())brightness=constrain(d["brightness"].as<int>(),1,100);
    if(!d["speed"].isNull())speedLevel=constrain(d["speed"].as<int>(),1,5);
    if(!d["name"].isNull())runningTheme.name=d["name"].as<String>();
    if(!d["effect"].isNull())runningTheme.effect=effectFromString(d["effect"].as<String>());
    if(d["colors"].is<JsonArray>()){JsonArray a=d["colors"].as<JsonArray>();runningTheme.colorCount=0;for(JsonVariant v:a){if(runningTheme.colorCount>=8)break;String s=v.as<String>();if(s.startsWith("#"))s.remove(0,1);runningTheme.colors[runningTheme.colorCount++]=strtoul(s.c_str(),nullptr,16);}if(runningTheme.colorCount==0){runningTheme.colors[0]=0xFFFF44;runningTheme.colorCount=1;}}
    applyRunning(true);sendJson(stateJson());
  });

  server.on("/api/events",HTTP_GET,[]{
    if(!requireUser())return;int year=server.arg("year").toInt(),month=server.arg("month").toInt();if(year<2020)year=2026;if(year>2037){server.send(400,"text/plain","Built-in variable-date calendar is supported through 2037");return;}if(month<1||month>12)month=1;
    JsonDocument d;JsonArray arr=d["events"].to<JsonArray>();auto&s=store.get();int monthly=0;
    for(size_t i=0;i<EVENT_COUNT;i++){if(!eventOccursInMonth(i,year,month))continue;Theme et=effectiveEventTheme(i);JsonObject e=arr.add<JsonObject>();e["id"]=EVENTS[i].id;e["name"]=EVENTS[i].name;e["kind"]=kindName(EVENTS[i].kind);e["when"]=eventWhen(i,year);e["effect"]=effectName(et.effect);e["customized"]=i<MAX_BUILTIN_EVENTS?eventOverrides[i].valid:false;e["speed"]=(i<MAX_BUILTIN_EVENTS&&eventOverrides[i].valid)?eventOverrides[i].speed:eventSpeed(i);e["enabled"]=eventStateEnabled(i);e["favorite"]=eventStateFavorite(i);JsonArray c=e["colors"].to<JsonArray>();for(int j=0;j<et.colorCount;j++)c.add(colorHex(et.colors[j]));if(EVENTS[i].rule==RuleType::Month&&EVENTS[i].kind==EventKind::Awareness&&e["enabled"].as<bool>())monthly++;}
    d["overlap"]=monthly>1?String(monthly)+" month-long events enabled — overlap rule applies.":(monthly==1?"1 month-long event enabled.":"No month-long awareness themes enabled.");
    String out;serializeJson(d,out);sendJson(out);
  });
  server.on("/api/favorites",HTTP_GET,[]{
    if(!requireUser())return;JsonDocument d;JsonArray arr=d["events"].to<JsonArray>();bool added[MAX_BUILTIN_EVENTS]={false};
    auto appendFavorite=[&](size_t i,const char* label){if(i>=EVENT_COUNT||i>=MAX_BUILTIN_EVENTS)return;Theme et=effectiveEventTheme(i);JsonObject e=arr.add<JsonObject>();e["id"]=EVENTS[i].id;e["name"]=label?label:EVENTS[i].name;e["effect"]=effectName(et.effect);e["speed"]=eventOverrides[i].valid?eventOverrides[i].speed:eventSpeed(i);e["favorite"]=true;e["custom"]=false;JsonArray c=e["colors"].to<JsonArray>();for(int j=0;j<et.colorCount;j++)c.add(colorHex(et.colors[j]));added[i]=true;};
    for(const auto& fav:MASTER_SCENE_FAVORITES){int idx=eventIndexById(fav.id);if(idx>=0&&eventStateFavorite((size_t)idx))appendFavorite((size_t)idx,fav.label);}
    for(size_t i=0;i<EVENT_COUNT&&i<MAX_BUILTIN_EVENTS;i++)if(eventStateFavorite(i)&&!added[i])appendFavorite(i,EVENTS[i].name);
    JsonDocument presets;if(!deserializeJson(presets,presetStoreRaw())&&presets.is<JsonArray>())for(JsonObject p:presets.as<JsonArray>()){if(!(p["favorite"]|false))continue;JsonObject e=arr.add<JsonObject>();e["id"]=p["id"];e["name"]=p["name"];e["effect"]=p["effect"]|String("Jump");e["brightness"]=constrain(p["brightness"]|100,1,100);e["speed"]=constrain(p["speed"]|1,1,5);e["enabled"]=p["enabled"]|true;e["custom"]=true;JsonArray c=e["colors"].to<JsonArray>();for(JsonVariant v:p["colors"].as<JsonArray>())c.add(v.as<String>());}
    String out;serializeJson(d,out);sendJson(out);
  });
  server.on("/api/events/search",HTTP_GET,[]{if(!requireUser())return;int year=server.arg("year").toInt();String query=server.arg("q");query.trim();query.toLowerCase();if(year<2020||year>2037||!query.length()){server.send(400,"text/plain","Choose a supported year and search term");return;}JsonDocument d;JsonArray arr=d["events"].to<JsonArray>();bool truncated=false;for(size_t i=0;i<EVENT_COUNT&&i<MAX_BUILTIN_EVENTS;i++){String when=eventWhen(i,year);if(when.startsWith("No scheduled"))continue;String hay=String(EVENTS[i].name)+" "+when+" "+kindName(EVENTS[i].kind);hay.toLowerCase();if(hay.indexOf(query)<0)continue;if(arr.size()>=96){truncated=true;break;}Theme et=effectiveEventTheme(i);JsonObject e=arr.add<JsonObject>();e["id"]=EVENTS[i].id;e["name"]=EVENTS[i].name;e["when"]=when;e["kind"]=kindName(EVENTS[i].kind);e["effect"]=effectName(et.effect);e["speed"]=eventOverrides[i].valid?eventOverrides[i].speed:eventSpeed(i);e["enabled"]=eventStateEnabled(i);e["favorite"]=eventStateFavorite(i);e["customized"]=eventOverrides[i].valid;JsonArray c=e["colors"].to<JsonArray>();for(uint8_t k=0;k<et.colorCount;k++)c.add(colorHex(et.colors[k]));}d["truncated"]=truncated;String out;serializeJson(d,out);sendJson(out);});
  server.on("/api/event",HTTP_POST,[]{
    if(!requireUser())return;JsonDocument d;if(!body(d))return;String id=d["id"].as<String>();int i=eventIndexById(id);if(i<0||i>=(int)EVENT_COUNT||i>=(int)MAX_BUILTIN_EVENTS){server.send(404,"text/plain","Unknown event");return;}
    if(!d["enabled"].isNull()&&!eventStateSetEnabled(i,d["enabled"].as<bool>())){
      server.send(500,"text/plain","Event enabled preference write failed");return;
    }
    if(!d["favorite"].isNull()&&!eventStateSetFavorite(i,d["favorite"].as<bool>())){
      server.send(500,"text/plain","Event favorite preference write failed");return;
    }
    if(d["reset"]|false){if(!clearEventOverride(i)){server.send(500,"text/plain","Event override reset failed");return;}}
    else if(!d["effect"].isNull()||!d["speed"].isNull()||d["colors"].is<JsonArray>()){Theme et=effectiveEventTheme(i);uint8_t esp=eventOverrides[i].valid?eventOverrides[i].speed:eventSpeed(i);if(!d["effect"].isNull())et.effect=effectFromString(d["effect"].as<String>());if(!d["speed"].isNull())esp=constrain(d["speed"].as<int>(),1,5);if(d["colors"].is<JsonArray>()){et.colorCount=0;for(JsonVariant v:d["colors"].as<JsonArray>()){if(et.colorCount>=8)break;String cs=v.as<String>();if(cs.startsWith("#"))cs.remove(0,1);if(cs.length()==6)et.colors[et.colorCount++]=strtoul(cs.c_str(),nullptr,16);}if(!et.colorCount){server.send(400,"text/plain","Event must contain at least one valid color");return;}}if(!saveEventOverride(i,et,esp)){server.send(500,"text/plain","Event override write failed");return;}}
    evaluateSchedule(true);sendJson(stateJson());
  });

  server.on("/api/settings",HTTP_POST,[]{
    if(!requireUser())return;uint8_t role=requestRole();JsonDocument d;if(!body(d))return;bool adminChange=!d["overlap"].isNull()||!d["on"].isNull()||!d["off"].isNull()||!d["lead"].isNull()||!d["trail"].isNull()||!d["tz"].isNull();if(role<ROLE_ADMIN&&adminChange){server.send(403,"application/json","{\"ok\":false,\"error\":\"Only Jason can change controller settings\"}");return;}AppSettings next=store.get();
    if(!d["overlap"].isNull()){String v=d["overlap"].as<String>();next.overlap=v=="split"?1:(v=="combine"?2:0);}if(!d["on"].isNull())next.onMinutes=parseTime(d["on"].as<String>(),next.onMinutes);if(!d["off"].isNull())next.offMinutes=parseTime(d["off"].as<String>(),next.offMinutes);if(!d["lead"].isNull())next.leadDays=constrain(d["lead"].as<int>(),0,14);if(!d["trail"].isNull())next.trailDays=constrain(d["trail"].as<int>(),0,7);if(!d["tz"].isNull())next.tz=d["tz"].as<String>();if(!d["scheduler"].isNull())next.schedulerEnabled=d["scheduler"].as<bool>();if(!d["scheduler2"].isNull())next.schedule2Enabled=d["scheduler2"].as<bool>();
    if(!store.saveSettings(next)){server.send(500,"application/json","{\"ok\":false,\"error\":\"Schedule settings write failed; previous settings were retained\"}");return;}if(!d["tz"].isNull())configTzTime(store.get().tz.c_str(),"pool.ntp.org","time.nist.gov");evaluateSchedule(true);sendJson(stateJson());
  });

  server.on("/api/colors",HTTP_GET,[]{
    if(!requireUser())return;JsonDocument d;d["locked"]=true;d["requiresFirmware"]=true;JsonArray out=d["colors"].to<JsonArray>();for(size_t i=0;i<ANDERSON_COLOR_PALETTE_COUNT;i++)out.add(colorHex(ANDERSON_COLOR_PALETTE[i].output));String json;serializeJson(d,json);sendJson(json);
  });
  server.on("/api/colors",HTTP_POST,[]{
    if(!requireUser())return;server.sendHeader("Cache-Control","no-store");
    server.send(423,"application/json","{\"ok\":false,\"locked\":true,\"error\":\"Master Favorite Colors are firmware-locked. Install a new firmware build to change them.\"}");
  });

  server.on("/api/event-color-theme",HTTP_GET,[]{if(!requireUser())return;JsonDocument d;d["theme"]=activeEventColorTheme==EventColorTheme::Original?"original":"modern";d["name"]=eventColorThemeName(activeEventColorTheme);d["generation"]=eventColorThemeGeneration;String out;serializeJson(d,out);sendJson(out);});
  server.on("/api/event-color-theme",HTTP_POST,[]{if(!requireUser())return;JsonDocument d;if(!body(d))return;String name=d["theme"]|String("");EventColorTheme next=name=="original"?EventColorTheme::Original:(name=="modern"?EventColorTheme::Modern:activeEventColorTheme);if(name!="original"&&name!="modern"){server.send(400,"text/plain","Choose original or modern colors");return;}if(!setEventColorTheme(next)){server.send(500,"text/plain","Event color theme write failed");return;}loadEventOverrides();evaluateSchedule(true);JsonDocument out;out["ok"]=true;out["theme"]=name;out["name"]=eventColorThemeName(activeEventColorTheme);out["generation"]=eventColorThemeGeneration;String json;serializeJson(out,json);sendJson(json);});

  // ANDERSON_HOME_CUSTOM_LIGHTS: all profiles may preview and change Enabled/Favorite; only Jason may create or delete.
  server.on("/api/presets",HTTP_GET,[]{
    if(!requireUser())return;if(!customFsReady){server.send(500,"text/plain","Persistent storage unavailable");return;}String raw=presetStoreRaw();JsonDocument check;if(deserializeJson(check,raw)||!check.is<JsonArray>())raw="[]";String json;json.reserve(raw.length()+20);json="{\"presets\":";json+=raw;json+="}";sendJson(json);
  });
  server.on("/api/preset",HTTP_POST,[]{
    if(!requireUser())return;uint8_t role=requestRole();if(!customFsReady){server.send(500,"text/plain","Persistent storage unavailable");return;}JsonDocument d;if(!body(d))return;String id=d["id"] | "";String deleteId=d["deleteId"] | "";String name=d["name"] | "";name.trim();String raw=presetStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonArray arr=list.as<JsonArray>();bool preferenceUpdate=id.length()&&!deleteId.length()&&!name.length()&&(!d["enabled"].isNull()||!d["favorite"].isNull());
    if(preferenceUpdate){bool found=false;bool enabled=true,favorite=false;for(JsonObject o:arr)if(o["id"].as<String>()==id){if(!d["enabled"].isNull())o["enabled"]=d["enabled"].as<bool>();if(!d["favorite"].isNull())o["favorite"]=d["favorite"].as<bool>();enabled=o["enabled"]|true;favorite=o["favorite"]|false;found=true;break;}if(!found){server.send(404,"text/plain","Custom light not found");return;}String out;serializeJson(list,out);if(out.length()>3800){server.send(507,"text/plain","Custom-light storage is full");return;}if(!customFileWrite("/custom_lights.json",out)){server.send(500,"text/plain","Custom light preference write failed");return;}JsonDocument ack;ack["ok"]=true;ack["id"]=id;ack["enabled"]=enabled;ack["favorite"]=favorite;String json;serializeJson(ack,json);sendJson(json);customScheduleRefreshPending=true;customScheduleRefreshAt=millis()+350;return;}
    if(role<ROLE_ADMIN){server.send(403,"application/json","{\"ok\":false,\"error\":\"Only Jason can create or delete custom lights\"}");return;}
    if(deleteId.length()){String oldPresets=raw,oldSchedules=scheduleStoreRaw();JsonDocument sched;if(deserializeJson(sched,oldSchedules)||!sched.is<JsonArray>())sched.to<JsonArray>();JsonArray sa=sched.as<JsonArray>();bool found=false;for(int i=(int)arr.size()-1;i>=0;i--)if(arr[i]["id"].as<String>()==deleteId){arr.remove(i);found=true;}if(!found){server.send(404,"text/plain","Custom light not found");return;}for(int i=(int)sa.size()-1;i>=0;i--)if(sa[i]["presetId"].as<String>()==deleteId)sa.remove(i);String newPresets,newSchedules;serializeJson(list,newPresets);serializeJson(sched,newSchedules);if(!customFileWrite("/custom_schedules.json",newSchedules)){server.send(500,"text/plain","Dependent schedule update failed; custom light was not deleted");return;}if(!customFileWrite("/custom_lights.json",newPresets)){bool rolledBack=customFileWrite("/custom_schedules.json",oldSchedules);server.send(500,"text/plain",rolledBack?"Custom light delete failed; previous schedules were restored":"Custom light delete failed and schedule rollback needs review");return;}sendJson("{\"ok\":true}");customScheduleRefreshPending=true;customScheduleRefreshAt=millis()+350;return;}
    if(!name.length()){server.send(400,"text/plain","Give this custom light a name");return;}for(JsonObject x:arr){String n=x["name"].as<String>();if(n.equalsIgnoreCase(name)){server.send(409,"text/plain","That custom light name is already in use");return;}}
    if(arr.size()>=12){server.send(409,"text/plain","Custom-light capacity reached (12). Delete one before adding another.");return;}uint32_t seq=nextStoredId(arr,'p');if(!seq){server.send(500,"text/plain","Could not reserve a stable custom-light ID");return;}String newId=String("p")+String(seq);JsonObject o=arr.add<JsonObject>();o["id"]=newId;o["name"]=name;o["effect"]=d["effect"]|String("Jump");o["brightness"]=constrain(d["brightness"]|100,1,100);o["speed"]=constrain(d["speed"]|1,1,5);o["enabled"]=true;o["favorite"]=false;JsonArray c=o["colors"].to<JsonArray>();if(d["colors"].is<JsonArray>())for(JsonVariant v:d["colors"].as<JsonArray>()){if(c.size()>=8)break;String color=v.as<String>();if(color.length())c.add(andersonCorrectHex(color));}if(!c.size())c.add("#FFFF44");
    String out;serializeJson(list,out);if(out.length()>3800){server.send(507,"text/plain","Custom-light storage is full");return;}if(!customFileWrite("/custom_lights.json",out)){server.send(500,"text/plain","Custom light file write failed");return;}JsonDocument r;r["ok"]=true;r["id"]=newId;r["count"]=(uint32_t)arr.size();r["fileBytes"]=(uint32_t)presetStoreRaw().length();r["backend"]="NVS";String json;serializeJson(r,json);sendJson(json);
  });
  server.on("/api/custom-schedules",HTTP_GET,[]{
    if(!requireUser())return;if(!customFsReady){server.send(500,"text/plain","Persistent storage unavailable");return;}int year=server.arg("year").toInt(),month=server.arg("month").toInt();String raw=scheduleStoreRaw();JsonDocument list,presets;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();if(deserializeJson(presets,presetStoreRaw())||!presets.is<JsonArray>())presets.to<JsonArray>();JsonDocument d;JsonArray out=d["items"].to<JsonArray>();for(JsonObject o:list.as<JsonArray>()){bool annual=o["annual"]|true;int oy=o["year"]|0,om=o["month"]|0;if(month>=1&&month<=12&&om!=month)continue;if(!annual&&year>=2020&&oy!=year)continue;JsonObject z=out.add<JsonObject>();z["id"]=o["id"];z["presetId"]=o["presetId"];z["year"]=oy;z["month"]=om;z["day"]=o["day"]|0;z["annual"]=annual;z["enabled"]=o["enabled"]|true;Theme t;uint8_t br=100,sp=1;String n;if(loadPresetThemeFromArray(presets.as<JsonArray>(),o["presetId"].as<String>(),t,br,sp,&n)){z["name"]=n;z["effect"]=effectName(t.effect);z["brightness"]=br;z["speed"]=sp;JsonArray c=z["colors"].to<JsonArray>();for(uint8_t i=0;i<t.colorCount;i++)c.add(colorHex(t.colors[i]));}}String json;serializeJson(d,json);sendJson(json);
  });
  server.on("/api/custom-schedules",HTTP_POST,[]{
    if(!requireUser())return;uint8_t role=requestRole();if(!customFsReady){server.send(500,"text/plain","Persistent storage unavailable");return;}JsonDocument d;if(!body(d))return;String id=d["id"].as<String>();String savedId=id;bool removing=(d["remove"]|false)&&id.length();bool toggling=id.length()&&!d["enabled"].isNull();String presetId=d["presetId"].as<String>();
    if(!removing&&!toggling){if(role<ROLE_ADMIN){server.send(403,"application/json","{\"ok\":false,\"error\":\"Only Jason can create custom schedules\"}");return;}Theme t;uint8_t br=100,sp=1;if(!loadPresetTheme(presetId,t,br,sp)){server.send(404,"text/plain","Custom light not found");return;}int month=d["month"]|0,day=d["day"]|0,year=d["year"]|0;if(month<1||month>12||day<1||day>31){server.send(400,"text/plain","Choose a valid schedule date");return;}}
    String raw=scheduleStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonArray arr=list.as<JsonArray>();if(removing){for(int i=(int)arr.size()-1;i>=0;i--)if(arr[i]["id"].as<String>()==id)arr.remove(i);}else if(toggling){bool found=false;for(JsonObject o:arr)if(o["id"].as<String>()==id){o["enabled"]=d["enabled"].as<bool>();found=true;break;}if(!found){server.send(404,"text/plain","Schedule entry not found");return;}}else{if(arr.size()>=32){server.send(409,"text/plain","Schedule capacity reached (32). Delete one before adding another.");return;}int month=d["month"]|0,day=d["day"]|0,year=d["year"]|0;uint32_t seq=nextStoredId(arr,'s');if(!seq){server.send(500,"text/plain","Could not reserve a stable schedule ID");return;}savedId=String("s")+String(seq);JsonObject o=arr.add<JsonObject>();o["id"]=savedId;o["presetId"]=presetId;o["month"]=month;o["day"]=day;o["year"]=year;o["annual"]=d["annual"]|true;o["enabled"]=true;}
    String out;serializeJson(list,out);if(out.length()>3800){server.send(507,"text/plain","Schedule storage is full");return;}if(!customFileWrite("/custom_schedules.json",out)){server.send(500,"text/plain","Schedule file write failed");return;}JsonDocument ack;ack["ok"]=true;ack["id"]=savedId;ack["count"]=(uint32_t)arr.size();ack["fileBytes"]=(uint32_t)scheduleStoreRaw().length();ack["backend"]="NVS";String ackJson;serializeJson(ack,ackJson);sendJson(ackJson);customScheduleRefreshPending=true;customScheduleRefreshAt=millis()+350;
  });
  server.on("/api/system",HTTP_GET,[]{if(!requireAdmin())return;sendJson(systemJson());});

  server.on("/api/palette-migration",HTTP_GET,[]{if(!requireAdmin())return;sendJson(paletteColorMigrationStatusJson());});
  server.on("/api/palette-migration",HTTP_POST,[]{
    if(!requireAdmin())return;JsonDocument d;if(!body(d))return;String action=d["action"]|String("");bool ok=false;if(action=="restore")ok=restoreOriginalPaletteColors();else if(action=="apply")ok=reapplyCorrectedPaletteColors();else{server.send(400,"application/json","{\"ok\":false,\"error\":\"Use action restore or apply\"}");return;}if(!ok){server.send(500,"application/json","{\"ok\":false,\"error\":\"Palette migration operation failed verification\"}");return;}sendJson(paletteColorMigrationStatusJson());delay(250);ESP.restart();
  });

  server.on("/api/remote-update",HTTP_GET,[]{if(!requireAdmin())return;sendJson(remoteUpdateStatusJson(ANDERSON_FIRMWARE_VERSION));});
  server.on("/api/remote-update/check",HTTP_POST,[]{if(!requireAdmin())return;sendJson(remoteUpdateCheckJson(ANDERSON_FIRMWARE_VERSION));});
  server.on("/api/remote-update/install",HTTP_POST,[]{
    if(!requireAdmin())return;String result=remoteUpdateInstallJson(ANDERSON_FIRMWARE_VERSION);sendJson(result);if(remoteUpdateConsumeRebootRequest()){otaAutoRebootPending=true;otaAutoRebootAt=millis()+1800;}
  });

  server.on("/api/firmware",HTTP_GET,[]{sendJson(firmwareJson());});
  // ANDERSON_PROTECTED_OTA: routine uploads require Jason's session; independent recovery verifies Jason's PIN directly.
  server.on("/api/update",HTTP_POST,[]{
    if(!otaUploadAllowed){server.sendHeader("Cache-Control","no-store");server.send(otaUploadResponseCode,"text/plain",otaUploadError.length()?otaUploadError:"Firmware upload was not accepted");return;}
    if(!otaUploadOk){server.send(500,"text/plain",otaUploadError.length()?otaUploadError:"Firmware update failed");return;}
    if(otaRecoveryRequest&&pinProtectionEnabled&&!disablePinProtection()){server.send(500,"text/plain","Firmware was verified, but PIN recovery could not be saved. Retry recovery before rebooting.");return;}JsonDocument d;d["ok"]=true;d["recovery"]=otaRecoveryRequest;d["pinEnabled"]=pinProtectionEnabled;d["message"]=otaRecoveryRequest?"Firmware verified and PIN protection disabled. NanoC6 will reboot automatically.":"Firmware verified. NanoC6 will reboot automatically into the new firmware.";String out;serializeJson(d,out);sendJson(out);otaAutoRebootPending=true;otaAutoRebootAt=millis()+1400;
  },[]{
    HTTPUpload& u=server.upload();
    feedControllerWatchdog();
    if(u.status==UPLOAD_FILE_START){
      otaUploadAllowed=true;otaUploadOk=false;otaUploadResponseCode=403;otaRecoveryRequest=server.hasArg("recovery")&&server.arg("recovery")=="1";otaUploadError="";
      if(otaRecoveryRequest&&pinProtectionEnabled){uint32_t retry=pinRetryAfter();if(retry){otaUploadAllowed=false;otaUploadResponseCode=429;otaUploadError=String("Too many incorrect PIN attempts. Try again in ")+String(retry)+" seconds.";return;}String recoveryPin=server.header(RECOVERY_PIN_HEADER);if(!recoveryPin.length()&&server.hasArg("recoveryPin"))recoveryPin=server.arg("recoveryPin");uint8_t recoveryRole=ROLE_NONE;if(!verifyProfilePin("jason",recoveryPin,recoveryRole)){notePinFailure();otaUploadAllowed=false;otaUploadResponseCode=401;otaUploadError="Jason's four-digit PIN is required for emergency firmware recovery";return;}clearPinFailures();}
      if(!otaRecoveryRequest){uint8_t role=requestRole();if(role<ROLE_ADMIN){otaUploadAllowed=false;otaUploadResponseCode=role==ROLE_NONE?401:403;otaUploadError=role==ROLE_NONE?"A valid Jason session is required for routine firmware updates":"Only Jason can install routine firmware updates";return;}}
      String fn=u.filename;fn.toLowerCase();if(!fn.endsWith(".bin")){otaUploadAllowed=false;otaUploadResponseCode=400;otaUploadError="Select an app-only .bin firmware file";return;}
      if(!Update.begin(UPDATE_SIZE_UNKNOWN,U_FLASH)){otaUploadAllowed=false;otaUploadResponseCode=500;otaUploadError=String("Unable to open OTA slot. Error ")+String(Update.getError());return;}
    }else if(u.status==UPLOAD_FILE_WRITE){
      if(otaUploadAllowed&&!otaUploadError.length()&&Update.write(u.buf,u.currentSize)!=u.currentSize){otaUploadResponseCode=500;otaUploadError=String("Firmware write failed. Error ")+String(Update.getError());Update.abort();}
    }else if(u.status==UPLOAD_FILE_END){
      if(otaUploadAllowed&&!otaUploadError.length()){otaUploadOk=Update.end(true);if(!otaUploadOk){otaUploadResponseCode=500;otaUploadError=String("Firmware validation failed. Error ")+String(Update.getError());}}
    }else if(u.status==UPLOAD_FILE_ABORTED){Update.abort();otaUploadOk=false;otaUploadResponseCode=500;otaUploadError="Firmware upload aborted";}
  });
  server.on("/api/reboot",HTTP_POST,[]{if(!requireAdmin())return;sendJson("{\"ok\":true,\"message\":\"Rebooting NanoC6\"}");otaAutoRebootPending=true;otaAutoRebootAt=millis()+700;});
  server.on("/api/rollback",HTTP_POST,[]{
    if(!requireAdmin())return;const esp_partition_t* running=esp_ota_get_running_partition();const esp_partition_t* other=esp_ota_get_next_update_partition(running);
    if(!otaPartitionValid(other)){server.send(404,"text/plain","No valid previous firmware is available in the other OTA slot");return;}
    if(esp_ota_set_boot_partition(other)!=ESP_OK){server.send(500,"text/plain","Could not select the previous firmware slot");return;}
    sendJson("{\"ok\":true,\"message\":\"Previous firmware selected. Press Reboot NanoC6.\"}");
  });

  server.on("/api/wifi/scan",HTTP_GET,[]{
    if(!requireAdmin())return;
    static uint32_t scanStartedAt=0;
    int n=WiFi.scanComplete();
    if(n==WIFI_SCAN_RUNNING){
      if(scanStartedAt&&(uint32_t)(millis()-scanStartedAt)>20000UL){WiFi.scanDelete();scanStartedAt=0;server.send(504,"application/json","{\"ok\":false,\"error\":\"Wi-Fi scan timed out; retry the scan\"}");return;}
      JsonDocument d;d["scanning"]=true;d["elapsedMs"]=scanStartedAt?(uint32_t)(millis()-scanStartedAt):0;String out;serializeJson(d,out);sendJson(out,202);return;
    }
    if(n>=0){
      JsonDocument d;d["scanning"]=false;JsonArray a=d["networks"].to<JsonArray>();
      for(int i=0;i<n;i++){String ssid=WiFi.SSID(i);if(!ssid.length())continue;bool duplicate=false;for(JsonObject x:a){if(x["ssid"].as<String>()==ssid){duplicate=true;break;}}if(duplicate)continue;JsonObject x=a.add<JsonObject>();x["ssid"]=ssid;x["rssi"]=WiFi.RSSI(i);}
      WiFi.scanDelete();scanStartedAt=0;String out;serializeJson(d,out);sendJson(out);return;
    }
    // Do not reset an already-connected STA just to scan. In setup mode keep the
    // SoftAP alive, then run the radio scan asynchronously so WebServer stays responsive.
    if(setupAP)WiFi.mode(WIFI_AP_STA);else if(WiFi.status()!=WL_CONNECTED)WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);WiFi.scanDelete();delay(10);
    int started=WiFi.scanNetworks(true,true,false,300);
    if(started==WIFI_SCAN_FAILED){scanStartedAt=0;server.send(500,"application/json","{\"ok\":false,\"error\":\"NanoC6 could not start the Wi-Fi scan\"}");return;}
    scanStartedAt=millis();JsonDocument d;d["scanning"]=true;d["started"]=true;String out;serializeJson(d,out);sendJson(out,202);
  });
  server.on("/api/wifi",HTTP_POST,[]{
    if(!requireAdmin())return;JsonDocument d;if(!body(d))return;String ssid=d["ssid"].as<String>(),pass=d["password"].as<String>();if(!ssid.length()){server.send(400,"text/plain","SSID required");return;}if(!store.saveWiFi(ssid,pass)){server.send(500,"text/plain","Wi-Fi settings could not be saved");return;}sendJson("{\"ok\":true}");delay(300);ESP.restart();
  });

  server.on("/api/ble/scan",HTTP_GET,[]{
    if(!requireAdmin())return;if(ble.connecting()){server.send(409,"text/plain","Bluetooth connection in progress. Try scanning again shortly.");return;}auto found=ble.scan();JsonDocument d;JsonArray a=d["devices"].to<JsonArray>();for(auto&f:found){JsonObject x=a.add<JsonObject>();x["name"]=f.name;x["address"]=f.address;x["rssi"]=f.rssi;}String out;serializeJson(d,out);sendJson(out);
  });
  server.on("/api/ble/select",HTTP_POST,[]{
    if(!requireAdmin())return;JsonDocument d;if(!body(d))return;String addr=d["address"].as<String>();bool ok=ble.selectAndConnect(addr);if(ok){if(!store.saveBle()){server.send(500,"text/plain","Controller selected but its saved settings could not be verified");return;}ble.setTarget(0);applyRunning(true);}sendJson(stateJson(),ok?200:500);
  });
  server.on("/api/ble/remove",HTTP_POST,[]{
    if(!requireAdmin())return;JsonDocument d;if(!body(d))return;int slot=d["slot"]|-1;if(slot<0||slot>1){server.send(400,"text/plain","Invalid slot");return;}ble.removeController(slot);if(!store.saveBle()){server.send(500,"text/plain","Controller removal could not be persisted");return;}ble.setTarget(0);sendJson(stateJson());
  });
  server.on("/api/ble/target",HTTP_POST,[]{
    if(!requireUser())return;uint8_t role=requestRole();JsonDocument d;if(!body(d))return;int t=d["target"]|0;if(t<0||t>2)t=0;if(role<ROLE_ADMIN&&t!=0){server.send(403,"application/json","{\"ok\":false,\"error\":\"Only Jason can select individual controllers\"}");return;}ble.setTarget(t);applyRunning(true);sendJson(stateJson());
  });
  server.onNotFound([](){server.send(404,"text/plain","Not found");});
}

static bool scheduledMaintenanceRebootDue(int32_t dayKey,uint16_t minute){
  const int32_t slotKey=dayKey*MAINTENANCE_REBOOT_COUNT+maintenanceRebootSlotForMinute(minute);
  if(!maintenanceRebootClockInitialized){maintenanceRebootClockInitialized=true;maintenanceRebootHandledSlot=slotKey;return false;}
  if(slotKey<=maintenanceRebootHandledSlot)return false;
  maintenanceRebootHandledSlot=slotKey;return true;
}
static void checkScheduledMaintenanceReboot(){
  if(Update.isRunning()||otaAutoRebootPending||!timeValid())return;
  time_t now=time(nullptr);tm local{};if(!localtime_r(&now,&local))return;
  int32_t dayKey=maintenanceRebootDayKey(local);uint16_t minute=(uint16_t)(local.tm_hour*60+local.tm_min);
  if(!scheduledMaintenanceRebootDue(dayKey,minute))return;
  delay(40);ESP.restart();
}
void setup(){
  delay(500);pinMode(BLUE_LED,OUTPUT);pinMode(USER_BUTTON,INPUT_PULLUP);digitalWrite(BLUE_LED,HIGH);
  loopWatchdogActive=beginControllerWatchdog();WiFi.onEvent(onWiFiEvent);
  store.begin();eventStateBegin();remoteUpdateNoteBoot(ANDERSON_FIRMWARE_VERSION);loadPinAuthConfig();customFsReady=storageHealthCheck();if(customFsReady){migrateLegacyCustomStorage();runPaletteColorMigration();migrateMasterCalendarV1();}seedMasterSceneFavoritesV4();loadEventColorTheme();migrateLegacyEventOverrides();loadEventOverrides();connectWiFi();setupMdns();ble.begin(&store.get());
  runningTheme.name="Yellow";runningTheme.effect=Effect::Jump;runningTheme.colors[0]=0xFFFF44;runningTheme.colorCount=1;
  setupRoutes();server.begin();networkServerStarted=true;lastStationIp=(uint32_t)WiFi.localIP();evaluateSchedule(true);digitalWrite(BLUE_LED,LOW);
}
void loop(){
  const uint64_t loopStartUs=(uint64_t)esp_timer_get_time();
  server.handleClient();ble.loop();
  if(ble.consumeConnectionChange())applyRunning(true);
  maintainWiFiConnection();checkScheduledMaintenanceReboot();
  if(!otaAutoRebootPending&&!Update.isRunning()){remoteUpdateAutoLoop(ANDERSON_FIRMWARE_VERSION);if(remoteUpdateConsumeRebootRequest()){otaAutoRebootPending=true;otaAutoRebootAt=millis()+1800;}}
  if(otaAutoRebootPending&&(int32_t)(millis()-otaAutoRebootAt)>=0){otaAutoRebootPending=false;delay(40);ESP.restart();}
  if(customScheduleRefreshPending&&(int32_t)(millis()-customScheduleRefreshAt)>=0){customScheduleRefreshPending=false;evaluateSchedule(true);}
  if(millis()-lastScheduleCheck>15000){lastScheduleCheck=millis();evaluateSchedule();}
  if(power)applyRunning(false);
  bool pressed=digitalRead(USER_BUTTON)==LOW;if(pressed && !buttonDown)buttonDown=millis();if(!pressed)buttonDown=0;
  if(buttonDown && millis()-buttonDown>5000){buttonDown=0;if(store.clearWiFi()){digitalWrite(BLUE_LED,HIGH);delay(500);ESP.restart();}}
  const uint64_t loopEndUs=(uint64_t)esp_timer_get_time();if(cpuWindowStartUs==0)cpuWindowStartUs=loopStartUs;cpuBusyUs+=loopEndUs-loopStartUs;const uint64_t cpuWindowUs=loopEndUs-cpuWindowStartUs;if(cpuWindowUs>=2000000ULL){uint64_t pct=(cpuBusyUs*100ULL+cpuWindowUs/2)/cpuWindowUs;if(pct>100)pct=100;cpuLoadPct=(uint8_t)pct;cpuBusyUs=0;cpuWindowStartUs=loopEndUs;}
  delay(2);
}
