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
#include <mbedtls/sha256.h>
#include <time.h>
#include "WebUIGzip.h"
#include "Types.h"
#include "EventCatalog.h"
#include "SettingsStore.h"
#include "BleController.h"
#include "Scheduler.h"
#include "PaletteMigration.h"
#include "RemoteUpdate.h"

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
bool setupAP=false;
bool otaUploadAllowed=false,otaUploadOk=false,otaRecoveryRequest=false;int otaUploadResponseCode=403;String otaUploadError;
bool otaAutoRebootPending=false;uint32_t otaAutoRebootAt=0;

static String colorHex(uint32_t c){char b[8];snprintf(b,sizeof(b),"#%06lX",(unsigned long)c);return b;}
static uint16_t parseTime(const String& s,uint16_t def){if(s.length()<5)return def;int h=s.substring(0,2).toInt(),m=s.substring(3,5).toInt();if(h<0||h>23||m<0||m>59)return def;return h*60+m;}
static String fmtTime(uint16_t m){char b[6];snprintf(b,sizeof(b),"%02d:%02d",m/60,m%60);return b;}
static bool timeValid(){return time(nullptr)>1700000000;}
static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.0.4";
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
static IPAddress pinAttemptIp;static bool pinAttemptIpSet=false;static uint8_t pinFailureCount=0;static uint32_t pinBlockedUntil=0;

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
static String issueAuthSession(uint8_t role,const String& profile){uint32_t now=millis();size_t slot=0;uint32_t oldestAge=0;bool found=false;for(size_t i=0;i<4;i++){uint32_t age=(uint32_t)(now-authSessions[i].lastSeen);if(!authSessions[i].token.length()||age>AUTH_SESSION_TTL_MS){slot=i;found=true;break;}if(!found||age>oldestAge){oldestAge=age;slot=i;}}authSessions[slot].token=randomHex(32);authSessions[slot].profile=profile;authSessions[slot].role=role;authSessions[slot].lastSeen=now;return authSessions[slot].token;}
static String sessionProfileForToken(const String& token){if(token.length()!=64)return "";for(auto&s:authSessions)if(s.token.length()&&constantTimeEqual(s.token,token))return s.profile;return "";}
static void revokeAuthSession(const String& token){for(auto&s:authSessions)if(token.length()&&constantTimeEqual(s.token,token)){s.token="";s.profile="";s.role=ROLE_NONE;s.lastSeen=0;}}
static uint8_t requestRole(){if(!pinProtectionEnabled)return ROLE_ADMIN;return sessionRoleForToken(server.header(AUTH_HEADER));}
static bool requireRole(uint8_t needed){uint8_t role=requestRole();if(role>=needed)return true;server.sendHeader("Cache-Control","no-store");if(role==ROLE_NONE)server.send(401,"application/json","{\"ok\":false,\"error\":\"A valid profile PIN is required\"}");else server.send(403,"application/json","{\"ok\":false,\"error\":\"This profile cannot use that control\"}");return false;}
static bool requireUser(){return requireRole(ROLE_USER);}
static bool requireAdmin(){return requireRole(ROLE_ADMIN);}
static void syncPinAttemptClient(){IPAddress ip=server.client().remoteIP();if(!pinAttemptIpSet||ip!=pinAttemptIp){pinAttemptIp=ip;pinAttemptIpSet=true;pinFailureCount=0;pinBlockedUntil=0;}}
static uint32_t pinRetryAfter(){syncPinAttemptClient();int32_t remaining=(int32_t)(pinBlockedUntil-millis());return remaining>0?(uint32_t)(remaining+999)/1000:0;}
static void notePinFailure(){syncPinAttemptClient();if(++pinFailureCount>=5){pinFailureCount=0;pinBlockedUntil=millis()+60000UL;}}
static void clearPinFailures(){syncPinAttemptClient();pinFailureCount=0;pinBlockedUntil=0;}
static bool verifyProfilePin(const String& profile,const String& pin,uint8_t& role){role=profileRole(profile);if(role==ROLE_NONE||!fourDigitPin(pin))return false;const String& salt=profile=="jason"?jasonPinSalt:shirleyPinSalt;const String& expected=profile=="jason"?jasonPinHash:shirleyPinHash;return constantTimeEqual(pinDigest(profile,pin,salt),expected);}
static String pinAuthStatusJson(){JsonDocument d;String token=server.header(AUTH_HEADER);uint8_t role=pinProtectionEnabled?sessionRoleForToken(token,false):ROLE_NONE;String profile=role!=ROLE_NONE?sessionProfileForToken(token):String("");d["pinEnabled"]=pinProtectionEnabled;d["configured"]=basePinAuthConfigured();d["pinLength"]=4;d["authenticated"]=role!=ROLE_NONE;if(role!=ROLE_NONE){d["role"]=role==ROLE_ADMIN?"admin":"user";d["name"]=profileDisplayName(profile);}String out;serializeJson(d,out);return out;}

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

// v2.0 Home favorite baseline: all built-in holidays, and only holidays.
// Apply once to existing NVS so an OTA upgrade changes the live device rather than
// merely changing fresh-install defaults. After migration, favorites remain user-editable.
static uint64_t holidayFavoriteMask(){
  uint64_t mask=0;
  for(size_t i=0;i<EVENT_COUNT&&i<64;i++)if(EVENTS[i].kind==EventKind::Holiday)mask|=(1ULL<<i);
  return mask;
}
static bool migrateV2HomeFavorites(){
  Preferences marker;
  if(!marker.begin("anderson",true))return false;
  uint8_t revision=marker.getUChar("homefavrev",0);
  marker.end();
  if(revision>=2)return true;

  // Clear custom-show favorites once so Home starts with holiday favorites only.
  JsonDocument presets;
  if(deserializeJson(presets,presetStoreRaw())||!presets.is<JsonArray>())return false;
  bool customChanged=false;
  for(JsonObject p:presets.as<JsonArray>()){
    if(p["favorite"]|false){p["favorite"]=false;customChanged=true;}
  }
  if(customChanged){String out;serializeJson(presets,out);if(!customFileWrite("/custom_lights.json",out))return false;}

  const uint64_t favorites=holidayFavoriteMask();
  Preferences prefs;
  if(!prefs.begin("anderson",false))return false;
  prefs.putULong64("favorite",favorites);
  bool favoriteOk=prefs.getULong64("favorite",0)==favorites;
  if(favoriteOk)prefs.putUChar("homefavrev",2);
  bool markerOk=favoriteOk&&prefs.getUChar("homefavrev",0)>=2;
  prefs.end();
  if(!markerOk)return false;
  store.get().favoriteMask=favorites;
  return true;
}
static bool storageSelfTest(){Preferences p;if(!p.begin("anderson-test",false))return false;const String t="ANDERSON_STORAGE_OK";size_t n=p.putString("rw",t);String r=p.getString("rw","");p.remove("rw");p.end();return n==t.length()&&r==t;}

static bool loadPresetTheme(const String& id,Theme& t,uint8_t& br,uint8_t& sp,String* outName=nullptr,bool activeOnly=false){
  JsonDocument list;if(deserializeJson(list,presetStoreRaw()))return false;
  for(JsonObject o:list.as<JsonArray>()){
    if(o["id"].as<String>()!=id)continue;if(activeOnly&&!(o["enabled"]|true))return false;t.name=o["name"].as<String>();if(outName)*outName=t.name;t.effect=effectFromString(o["effect"].as<String>());t.colorCount=0;
    for(JsonVariant v:o["colors"].as<JsonArray>()){if(t.colorCount>=8)break;String cs=v.as<String>();if(cs.startsWith("#"))cs.remove(0,1);if(cs.length())t.colors[t.colorCount++]=strtoul(cs.c_str(),nullptr,16);}
    if(!t.colorCount){t.colors[0]=0xFFDA7F;t.colorCount=1;}br=constrain(o["brightness"]|100,1,100);sp=constrain(o["speed"]|1,1,5);return true;
  }return false;
}
static bool resolveCustomSchedule(const tm& l,Theme& t,uint8_t& br,uint8_t& sp){
  JsonDocument list;if(deserializeJson(list,scheduleStoreRaw()))return false;bool found=false;
  for(JsonObject o:list.as<JsonArray>()){
    if(!(o["enabled"]|true))continue;int m=o["month"]|0,d=o["day"]|0,y=o["year"]|0;bool annual=o["annual"]|true;
    if(m!=l.tm_mon+1||d!=l.tm_mday)continue;if(!annual&&y!=l.tm_year+1900)continue;Theme q;uint8_t qb=100,qs=1;if(loadPresetTheme(o["presetId"].as<String>(),q,qb,qs,nullptr,true)){t=q;br=qb;sp=qs;found=true;}
  }return found;
}
static bool removeSchedulesForPreset(const String& presetId){
  String raw=scheduleStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonArray a=list.as<JsonArray>();for(int i=(int)a.size()-1;i>=0;i--)if(a[i]["presetId"].as<String>()==presetId)a.remove(i);String out;serializeJson(list,out);bool ok=customFileWrite("/custom_schedules.json",out);return ok;
}

static bool otaPartitionValid(const esp_partition_t* p){
  if(!p)return false;esp_app_desc_t desc{};return esp_ota_get_partition_description(p,&desc)==ESP_OK;
}
static String firmwareJson(){
  JsonDocument d;const esp_partition_t* running=esp_ota_get_running_partition();const esp_partition_t* next=esp_ota_get_next_update_partition(running);
  d["version"]=ANDERSON_FIRMWARE_VERSION;d["runningPartition"]=running?running->label:"";d["nextPartition"]=next?next->label:"";d["slotSize"]=next?(uint32_t)next->size:0;d["previousAvailable"]=otaPartitionValid(next);
  esp_app_desc_t desc{};if(running&&esp_ota_get_partition_description(running,&desc)==ESP_OK){d["appVersion"]=desc.version;d["project"]=desc.project_name;d["buildDate"]=desc.date;d["buildTime"]=desc.time;}
  String out;serializeJson(d,out);return out;
}

static String systemJson(){
  JsonDocument d;const bool wifiConnected=WiFi.status()==WL_CONNECTED;const esp_partition_t* running=esp_ota_get_running_partition();const uint32_t slotBytes=running?(uint32_t)running->size:0;const uint32_t appBytes=(uint32_t)ESP.getSketchSize();
  d["version"]=ANDERSON_FIRMWARE_VERSION;d["cpuLoad"]=cpuLoadPct;d["cpuMhz"]=(uint32_t)getCpuFrequencyMhz();d["uptimeMs"]=(uint32_t)millis();
  d["heapTotal"]=(uint32_t)ESP.getHeapSize();d["heapFree"]=(uint32_t)ESP.getFreeHeap();d["heapMin"]=(uint32_t)ESP.getMinFreeHeap();d["heapLargest"]=(uint32_t)ESP.getMaxAllocHeap();
  d["wifiConnected"]=wifiConnected;d["rssi"]=wifiConnected?WiFi.RSSI():0;d["ssid"]=wifiConnected?WiFi.SSID():String("");d["ip"]=wifiConnected?WiFi.localIP().toString():WiFi.softAPIP().toString();
  d["bleConnected"]=ble.connected();d["bleCount"]=ble.connectedCount();d["appBytes"]=appBytes;d["slotBytes"]=slotBytes;d["appFreeBytes"]=slotBytes>appBytes?slotBytes-appBytes:0;
  String out;serializeJson(d,out);return out;
}

// Kept separate from the main UI so a tab/profile JavaScript problem cannot block OTA recovery.
static const char RECOVERY_UI[] PROGMEM=R"AHREC(<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0a3f88"><title>Anderson Home Firmware Recovery</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:24px 14px;background:linear-gradient(155deg,#061934,#0b438d 52%,#04152d);color:#f4f7fb;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}main{width:min(100%,540px);margin:0 auto}.brand{text-align:center;margin:8px 0 20px}h1{font-size:26px;margin:0}.sub{font-size:13px;line-height:1.45;color:#aeb8c5}.panel{padding:18px;border:1px solid #49566a;border-radius:18px;background:#101720;box-shadow:0 18px 46px #0005}.meta{margin:12px 0;padding:11px;border:1px solid #2a3a4c;border-radius:12px;background:#0c1219}.label{font-size:13px;margin:12px 0 6px}.field,.btn{width:100%;min-height:46px;padding:10px;border:1px solid #34465a;border-radius:12px;background:#0e151e;color:#f4f7fb;font:inherit}.pin{text-align:center;font-size:22px;font-weight:800;letter-spacing:.4em;padding-left:.4em}#pinWrap[hidden]{display:none}.btn{margin-top:10px;cursor:pointer;background:linear-gradient(#27aaff,#148de1);border-color:#3bb2ff;font-weight:750}.btn:disabled{opacity:.55}progress{width:100%;height:14px;margin-top:11px}a{color:#7dc9ff}.status{min-height:42px;margin-top:8px}</style></head>
<body><main><div class="brand"><h1>Anderson Home</h1><div class="sub">Independent firmware recovery</div></div><section class="panel"><strong>Emergency APP-only Firmware Recovery</strong><div class="sub">This page does not depend on the profile chooser, its session, or the main controller interface.</div><div id="meta" class="meta sub">Checking controller firmware…</div><form id="form" method="post" action="/api/update?recovery=1" enctype="multipart/form-data"><div class="label">APP-only firmware BIN</div><input id="file" class="field" type="file" name="firmware" accept=".bin,application/octet-stream" required><div id="pinWrap"><div class="label">Jason’s four-digit PIN</div><input id="pin" class="field pin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="off"><div class="sub">Required when PIN protection is on. It is verified directly by the recovery service.</div></div><button id="upload" class="btn" type="submit">Upload, Install &amp; Reboot</button></form><progress id="progress" max="100" value="0"></progress><div id="status" class="sub status" aria-live="polite">Choose only the APP_ONLY.bin release file. A successful recovery disables PIN protection but preserves all other saved settings.</div><div class="sub"><a href="/">Return to user chooser</a></div></section></main>
<script>(function(){let before='',pinRequired=false;const get=id=>document.getElementById(id),say=message=>get('status').textContent=message;async function info(){try{const response=await fetch('/api/firmware?recovery='+Date.now(),{cache:'no-store'});if(!response.ok)throw 0;const firmware=await response.json();before=firmware.runningPartition||before;get('meta').innerHTML='<strong>Running:</strong> '+(firmware.runningPartition||'—')+(firmware.version?' • '+firmware.version:'')+'<br>Update slot: '+(firmware.nextPartition||'—')}catch(error){get('meta').textContent='Firmware details unavailable; the upload form remains ready.'}try{const response=await fetch('/api/auth/status?recovery='+Date.now(),{cache:'no-store'});if(!response.ok)throw 0;const auth=await response.json();pinRequired=auth.pinEnabled===true;get('pinWrap').hidden=!pinRequired}catch(error){get('pinWrap').hidden=false}}function wait(){let tries=0;say('Controller is rebooting. Waiting for it to return…');const poll=async()=>{tries++;try{const response=await fetch('/api/firmware?recovery='+Date.now(),{cache:'no-store'});if(response.ok){const firmware=await response.json();if(!before||firmware.runningPartition!==before||tries>=8){before=firmware.runningPartition||before;say('Recovery completed. PIN protection is off and the controller is back online.');get('pin').value='';get('upload').disabled=false;info();return}}}catch(error){}if(tries<45)setTimeout(poll,1000);else{say('Upload finished, but reconnect timed out. Reopen this page after Wi-Fi reconnects.');get('upload').disabled=false}};setTimeout(poll,2800)}get('pin').addEventListener('input',event=>event.target.value=event.target.value.replace(/\D/g,'').slice(0,4));get('form').addEventListener('submit',event=>{event.preventDefault();const file=get('file').files&&get('file').files[0],pin=get('pin').value;if(!file)return say('Choose an APP-only .bin firmware file first.');if(!/\.bin$/i.test(file.name))return say('The firmware filename must end in .bin.');if((pinRequired||pin.length)&&!/^\d{4}$/.test(pin))return say('Enter Jason’s four-digit PIN.');const data=new FormData();data.append('firmware',file,file.name);const request=new XMLHttpRequest();request.open('POST','/api/update?recovery=1');if(pin)request.setRequestHeader('X-Anderson-Recovery-PIN',pin);get('upload').disabled=true;get('progress').value=0;say('Verifying recovery access and opening the inactive firmware slot…');request.upload.onprogress=e=>{if(e.lengthComputable){const percent=Math.round(e.loaded*100/e.total);get('progress').value=percent;say(percent<100?'Uploading firmware… '+percent+'%':'Upload complete. Verifying firmware…')}};request.onload=()=>{if(request.status>=200&&request.status<300){get('progress').value=100;say('Firmware verified. Disabling PIN protection and rebooting…');wait()}else{get('upload').disabled=false;say(request.responseText||'Firmware update failed.')}};request.onerror=()=>{get('upload').disabled=false;say('Upload connection failed before installation completed.')};request.send(data)});info()})();</script></body></html>)AHREC";


struct EventOverrideCfg {
  bool valid=false;
  Effect effect=Effect::Jump;
  uint32_t colors[8]={0};
  uint8_t colorCount=0;
  uint8_t speed=1;
};
static EventOverrideCfg eventOverrides[64];

static String eventOverrideKey(size_t i){return String("e")+String((unsigned)i);}
static uint8_t scheduledEventSpeedHint=1;
Theme applyEventOverrideByIndex(size_t i,const Theme& base){
  Theme t=base;if(i>=64||!eventOverrides[i].valid){scheduledEventSpeedHint=1;return t;}
  scheduledEventSpeedHint=constrain(eventOverrides[i].speed,1,5);t.effect=eventOverrides[i].effect;t.colorCount=eventOverrides[i].colorCount;
  for(uint8_t c=0;c<t.colorCount;c++)t.colors[c]=eventOverrides[i].colors[c];
  return t;
}
static Theme effectiveEventTheme(size_t i){return applyEventOverrideByIndex(i,themeFromEvent(i));}
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
  Preferences p;p.begin("anderson-event",false);p.putString(eventOverrideKey(i).c_str(),raw);p.end();
}
static void clearEventOverride(size_t i){if(i>=64)return;eventOverrides[i]=EventOverrideCfg();Preferences p;p.begin("anderson-event",false);p.remove(eventOverrideKey(i).c_str());p.end();}

void addTheme(JsonObject o,const Theme&t){o["name"]=t.name;o["effect"]=effectName(t.effect);JsonArray a=o["colors"].to<JsonArray>();for(int i=0;i<t.colorCount;i++)a.add(colorHex(t.colors[i]));}
String stateJson(){
  JsonDocument d;d["firmwareVersion"]=ANDERSON_FIRMWARE_VERSION;d["power"]=power;d["brightness"]=brightness;d["speed"]=speedLevel;JsonObject r=d["running"].to<JsonObject>();addTheme(r,runningTheme);
  auto&s=store.get();d["scheduleWindow"]="Scheduled "+fmtTime(s.onMinutes)+" – "+fmtTime(s.offMinutes);JsonObject cfg=d["settings"].to<JsonObject>();cfg["on"]=fmtTime(s.onMinutes);cfg["off"]=fmtTime(s.offMinutes);cfg["lead"]=s.leadDays;cfg["trail"]=s.trailDays;cfg["overlap"]=s.overlap;cfg["tz"]=s.tz;cfg["scheduler"]=s.schedulerEnabled;
  tm l{};if(timeValid()){time_t n=time(nullptr);localtime_r(&n,&l);d["nextEvent"]=scheduler.nextEventLabel(l);}else d["nextEvent"]="Waiting for time sync";
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
  ble.setTarget(0);brightness=100;speedLevel=1;bool should=scheduler.inRunWindow(l)&&store.get().schedulerEnabled;if(!should){if(power){power=false;ble.setPower(false);}return;}
  Theme t;uint8_t cb=100,cs=1;if(resolveCustomSchedule(l,t,cb,cs)){brightness=cb;speedLevel=cs;}else{scheduledEventSpeedHint=1;t=scheduler.resolve(l);speedLevel=scheduledEventSpeedHint;}bool changed=!power||runningTheme.name!=t.name||runningTheme.effect!=t.effect;power=true;runningTheme=t;if(changed||force)applyRunning(true);
}
void startAP(){
  WiFi.mode(WIFI_AP_STA);WiFi.softAP("AndersonHome-Setup","andersonhome");setupAP=true;
}
void connectWiFi(){
  auto&s=store.get();WiFi.mode(WIFI_STA);WiFi.setSleep(false);
  if(!s.ssid.length()){startAP();return;}WiFi.begin(s.ssid.c_str(),s.password.c_str());
  uint32_t start=millis();while(WiFi.status()!=WL_CONNECTED && millis()-start<18000){delay(250);}
  if(WiFi.status()==WL_CONNECTED){setupAP=false;configTzTime(s.tz.c_str(),"pool.ntp.org","time.nist.gov");}
  else{startAP();}
}
void setupMdns(){
  if(MDNS.begin("anderson-home")){MDNS.setInstanceName("Anderson Home");MDNS.addService("http","tcp",80);}
}
void setupRoutes(){
  const char* collectedHeaders[]={AUTH_HEADER,RECOVERY_PIN_HEADER};server.collectHeaders(collectedHeaders,2);
  server.on("/",HTTP_GET,[]{server.sendHeader("Cache-Control","no-store, no-cache, must-revalidate");server.sendHeader("Content-Encoding","gzip");server.send_P(200,"text/html",(PGM_P)WEB_UI_GZ,WEB_UI_GZ_LEN);});
  server.on("/recovery",HTTP_GET,[]{server.sendHeader("Cache-Control","no-store, no-cache, must-revalidate");server.sendHeader("X-Content-Type-Options","nosniff");server.send_P(200,"text/html",RECOVERY_UI);});
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
    if(d["colors"].is<JsonArray>()){JsonArray a=d["colors"].as<JsonArray>();runningTheme.colorCount=0;for(JsonVariant v:a){if(runningTheme.colorCount>=8)break;String s=v.as<String>();if(s.startsWith("#"))s.remove(0,1);runningTheme.colors[runningTheme.colorCount++]=strtoul(s.c_str(),nullptr,16);}if(runningTheme.colorCount==0){runningTheme.colors[0]=0xFFDA7F;runningTheme.colorCount=1;}}
    applyRunning(true);sendJson(stateJson());
  });

  server.on("/api/events",HTTP_GET,[]{
    if(!requireUser())return;int year=server.arg("year").toInt(),month=server.arg("month").toInt();if(year<2020)year=2026;if(month<1||month>12)month=1;
    JsonDocument d;JsonArray arr=d["events"].to<JsonArray>();auto&s=store.get();int monthly=0;
    for(size_t i=0;i<EVENT_COUNT;i++){if(!eventOccursInMonth(i,year,month))continue;Theme et=effectiveEventTheme(i);JsonObject e=arr.add<JsonObject>();e["id"]=EVENTS[i].id;e["name"]=EVENTS[i].name;e["kind"]=kindName(EVENTS[i].kind);e["when"]=eventWhen(i,year);e["effect"]=effectName(et.effect);e["customized"]=i<64?eventOverrides[i].valid:false;e["speed"]=(i<64&&eventOverrides[i].valid)?eventOverrides[i].speed:1;e["enabled"]=i<64?((s.enabledMask>>i)&1ULL):true;e["favorite"]=i<64?((s.favoriteMask>>i)&1ULL):false;JsonArray c=e["colors"].to<JsonArray>();for(int j=0;j<et.colorCount;j++)c.add(colorHex(et.colors[j]));if(EVENTS[i].rule==RuleType::Month&&EVENTS[i].kind==EventKind::Awareness&&e["enabled"].as<bool>())monthly++;}
    d["overlap"]=monthly>1?String(monthly)+" month-long events enabled — overlap rule applies.":(monthly==1?"1 month-long event enabled.":"No month-long awareness themes enabled.");
    String out;serializeJson(d,out);sendJson(out);
  });
  server.on("/api/favorites",HTTP_GET,[]{
    if(!requireUser())return;JsonDocument d;JsonArray arr=d["events"].to<JsonArray>();auto&s=store.get();
    for(size_t i=0;i<EVENT_COUNT&&i<64;i++){if(!((s.favoriteMask>>i)&1ULL))continue;Theme et=effectiveEventTheme(i);JsonObject e=arr.add<JsonObject>();e["id"]=EVENTS[i].id;e["name"]=EVENTS[i].name;e["effect"]=effectName(et.effect);e["speed"]=eventOverrides[i].valid?eventOverrides[i].speed:1;JsonArray c=e["colors"].to<JsonArray>();for(int j=0;j<et.colorCount;j++)c.add(colorHex(et.colors[j]));}
    JsonDocument presets;if(!deserializeJson(presets,presetStoreRaw())&&presets.is<JsonArray>())for(JsonObject p:presets.as<JsonArray>()){if(!(p["favorite"]|false))continue;JsonObject e=arr.add<JsonObject>();e["id"]=p["id"];e["name"]=p["name"];e["effect"]=p["effect"]|String("Jump");e["brightness"]=constrain(p["brightness"]|100,1,100);e["speed"]=constrain(p["speed"]|1,1,5);e["enabled"]=p["enabled"]|true;e["custom"]=true;JsonArray c=e["colors"].to<JsonArray>();for(JsonVariant v:p["colors"].as<JsonArray>())c.add(v.as<String>());}
    String out;serializeJson(d,out);sendJson(out);
  });
  server.on("/api/event",HTTP_POST,[]{
    if(!requireUser())return;JsonDocument d;if(!body(d))return;String id=d["id"].as<String>();int i=eventIndexById(id);if(i<0||i>=64){server.send(404,"text/plain","Unknown event");return;}auto&s=store.get();
    if(!d["enabled"].isNull()){if(d["enabled"].as<bool>())s.enabledMask|=(1ULL<<i);else s.enabledMask&=~(1ULL<<i);}
    if(!d["favorite"].isNull()){if(d["favorite"].as<bool>())s.favoriteMask|=(1ULL<<i);else s.favoriteMask&=~(1ULL<<i);}
    if(d["reset"]|false){clearEventOverride(i);}
    else if(!d["effect"].isNull()||!d["speed"].isNull()||d["colors"].is<JsonArray>()){Theme et=effectiveEventTheme(i);uint8_t esp=eventOverrides[i].valid?eventOverrides[i].speed:1;if(!d["effect"].isNull())et.effect=effectFromString(d["effect"].as<String>());if(!d["speed"].isNull())esp=constrain(d["speed"].as<int>(),1,5);if(d["colors"].is<JsonArray>()){et.colorCount=0;for(JsonVariant v:d["colors"].as<JsonArray>()){if(et.colorCount>=8)break;String cs=v.as<String>();if(cs.startsWith("#"))cs.remove(0,1);if(cs.length())et.colors[et.colorCount++]=strtoul(cs.c_str(),nullptr,16);}if(!et.colorCount){et.colors[0]=0xFFDA7F;et.colorCount=1;}}saveEventOverride(i,et,esp);}
    store.saveAll();evaluateSchedule(true);sendJson(stateJson());
  });
  server.on("/api/events/bulk",HTTP_POST,[]{
    if(!requireUser())return;JsonDocument d;if(!body(d))return;int y=d["year"]|2026,m=d["month"]|1;bool en=d["enabled"]|false;auto&s=store.get();for(size_t i=0;i<EVENT_COUNT&&i<64;i++)if(eventOccursInMonth(i,y,m)){if(en)s.enabledMask|=(1ULL<<i);else s.enabledMask&=~(1ULL<<i);}store.saveAll();server.send(204);
  });

  server.on("/api/settings",HTTP_POST,[]{
    if(!requireUser())return;uint8_t role=requestRole();JsonDocument d;if(!body(d))return;bool adminChange=!d["overlap"].isNull()||!d["on"].isNull()||!d["off"].isNull()||!d["lead"].isNull()||!d["trail"].isNull()||!d["tz"].isNull();if(role<ROLE_ADMIN&&adminChange){server.send(403,"application/json","{\"ok\":false,\"error\":\"Only Jason can change controller settings\"}");return;}auto&s=store.get();
    if(!d["overlap"].isNull()){String v=d["overlap"].as<String>();s.overlap=v=="split"?1:(v=="combine"?2:0);}
    if(!d["on"].isNull())s.onMinutes=parseTime(d["on"].as<String>(),s.onMinutes);if(!d["off"].isNull())s.offMinutes=parseTime(d["off"].as<String>(),s.offMinutes);
    if(!d["lead"].isNull())s.leadDays=constrain(d["lead"].as<int>(),0,14);if(!d["trail"].isNull())s.trailDays=constrain(d["trail"].as<int>(),0,7);
    if(!d["tz"].isNull()){s.tz=d["tz"].as<String>();configTzTime(s.tz.c_str(),"pool.ntp.org","time.nist.gov");}
    if(!d["scheduler"].isNull())s.schedulerEnabled=d["scheduler"].as<bool>();
    store.saveAll();sendJson(stateJson());
  });

  server.on("/api/colors",HTTP_GET,[]{
    if(!requireUser())return;Preferences p;p.begin("anderson-colors",true);String raw=p.getString("saved","[]");p.end();
    JsonDocument list;if(deserializeJson(list,raw))list.to<JsonArray>();JsonDocument d;JsonArray out=d["colors"].to<JsonArray>();
    for(JsonVariant v:list.as<JsonArray>())out.add(v.as<String>());String json;serializeJson(d,json);sendJson(json);
  });
  server.on("/api/colors",HTTP_POST,[]{
    if(!requireUser())return;JsonDocument d;if(!body(d))return;String col=d["color"].as<String>();col.trim();if(!col.startsWith("#"))col="#"+col;col.toUpperCase();
    if(col.length()!=7){server.send(400,"text/plain","Color must be #RRGGBB");return;}bool remove=d["remove"]|false;
    Preferences p;p.begin("anderson-colors",false);String raw=p.getString("saved","[]");JsonDocument list;if(deserializeJson(list,raw))list.to<JsonArray>();JsonArray arr=list.as<JsonArray>();
    int found=-1;for(int i=0;i<(int)arr.size();i++){String x=arr[i].as<String>();x.toUpperCase();if(x==col){found=i;break;}}
    if(remove){if(found>=0)arr.remove(found);}else if(found<0&&arr.size()<32)arr.add(col);
    String saved;serializeJson(list,saved);p.putString("saved",saved);p.end();JsonDocument out;JsonArray oa=out["colors"].to<JsonArray>();for(JsonVariant v:arr)oa.add(v.as<String>());String json;serializeJson(out,json);sendJson(json);
  });

  // ANDERSON_HOME_CUSTOM_LIGHTS: all profiles may preview and change Enabled/Favorite; only Jason may create or delete.
  server.on("/api/presets",HTTP_GET,[]{
    if(!requireUser())return;if(!customFsReady){server.send(500,"text/plain","Persistent storage unavailable");return;}String raw=presetStoreRaw();JsonDocument check;if(deserializeJson(check,raw)||!check.is<JsonArray>())raw="[]";String json;json.reserve(raw.length()+20);json="{\"presets\":";json+=raw;json+="}";sendJson(json);
  });
  server.on("/api/preset",HTTP_POST,[]{
    if(!requireUser())return;uint8_t role=requestRole();if(!customFsReady){server.send(500,"text/plain","Persistent storage unavailable");return;}JsonDocument d;if(!body(d))return;String id=d["id"] | "";String deleteId=d["deleteId"] | "";String name=d["name"] | "";name.trim();String raw=presetStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonArray arr=list.as<JsonArray>();bool preferenceUpdate=id.length()&&!deleteId.length()&&!name.length()&&(!d["enabled"].isNull()||!d["favorite"].isNull());
    if(preferenceUpdate){bool found=false;bool enabled=true,favorite=false;for(JsonObject o:arr)if(o["id"].as<String>()==id){if(!d["enabled"].isNull())o["enabled"]=d["enabled"].as<bool>();if(!d["favorite"].isNull())o["favorite"]=d["favorite"].as<bool>();enabled=o["enabled"]|true;favorite=o["favorite"]|false;found=true;break;}if(!found){server.send(404,"text/plain","Custom light not found");return;}String out;serializeJson(list,out);if(out.length()>3800){server.send(507,"text/plain","Custom-light storage is full");return;}if(!customFileWrite("/custom_lights.json",out)){server.send(500,"text/plain","Custom light preference write failed");return;}JsonDocument ack;ack["ok"]=true;ack["id"]=id;ack["enabled"]=enabled;ack["favorite"]=favorite;String json;serializeJson(ack,json);sendJson(json);customScheduleRefreshPending=true;customScheduleRefreshAt=millis()+350;return;}
    if(role<ROLE_ADMIN){server.send(403,"application/json","{\"ok\":false,\"error\":\"Only Jason can create or delete custom lights\"}");return;}
    if(deleteId.length()){for(int i=(int)arr.size()-1;i>=0;i--)if(arr[i]["id"].as<String>()==deleteId)arr.remove(i);String out;serializeJson(list,out);if(!customFileWrite("/custom_lights.json",out)){server.send(500,"text/plain","Custom light file write failed");return;}removeSchedulesForPreset(deleteId);sendJson("{\"ok\":true}");customScheduleRefreshPending=true;customScheduleRefreshAt=millis()+350;return;}
    if(!name.length()){server.send(400,"text/plain","Give this custom light a name");return;}for(JsonObject x:arr){String n=x["name"].as<String>();if(n.equalsIgnoreCase(name)){server.send(409,"text/plain","That custom light name is already in use");return;}}
    if(arr.size()>=12)arr.remove(0);uint32_t seq=nextStoredId(arr,'p');String newId=String("p")+String(seq);JsonObject o=arr.add<JsonObject>();o["id"]=newId;o["name"]=name;o["effect"]=d["effect"]|String("Jump");o["brightness"]=constrain(d["brightness"]|100,1,100);o["speed"]=constrain(d["speed"]|1,1,5);o["enabled"]=true;o["favorite"]=false;JsonArray c=o["colors"].to<JsonArray>();if(d["colors"].is<JsonArray>())for(JsonVariant v:d["colors"].as<JsonArray>()){if(c.size()>=8)break;String color=v.as<String>();if(color.length())c.add(color);}if(!c.size())c.add("#FFF1C7");
    String out;serializeJson(list,out);if(out.length()>3800){server.send(507,"text/plain","Custom-light storage is full");return;}if(!customFileWrite("/custom_lights.json",out)){server.send(500,"text/plain","Custom light file write failed");return;}JsonDocument r;r["ok"]=true;r["id"]=newId;r["count"]=(uint32_t)arr.size();r["fileBytes"]=(uint32_t)presetStoreRaw().length();r["backend"]="NVS";String json;serializeJson(r,json);sendJson(json);
  });
  server.on("/api/custom-schedules",HTTP_GET,[]{
    if(!requireUser())return;if(!customFsReady){server.send(500,"text/plain","Persistent storage unavailable");return;}int year=server.arg("year").toInt(),month=server.arg("month").toInt();String raw=scheduleStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonDocument d;JsonArray out=d["items"].to<JsonArray>();for(JsonObject o:list.as<JsonArray>()){bool annual=o["annual"]|true;int oy=o["year"]|0,om=o["month"]|0;if(month>=1&&month<=12&&om!=month)continue;if(!annual&&year>=2020&&oy!=year)continue;JsonObject z=out.add<JsonObject>();z["id"]=o["id"];z["presetId"]=o["presetId"];z["year"]=oy;z["month"]=om;z["day"]=o["day"]|0;z["annual"]=annual;z["enabled"]=o["enabled"]|true;Theme t;uint8_t br=100,sp=1;String n;if(loadPresetTheme(o["presetId"].as<String>(),t,br,sp,&n)){z["name"]=n;z["effect"]=effectName(t.effect);z["brightness"]=br;z["speed"]=sp;JsonArray c=z["colors"].to<JsonArray>();for(uint8_t i=0;i<t.colorCount;i++)c.add(colorHex(t.colors[i]));}}String json;serializeJson(d,json);sendJson(json);
  });
  server.on("/api/custom-schedules",HTTP_POST,[]{
    if(!requireUser())return;uint8_t role=requestRole();if(!customFsReady){server.send(500,"text/plain","Persistent storage unavailable");return;}JsonDocument d;if(!body(d))return;String id=d["id"].as<String>();String savedId=id;bool removing=(d["remove"]|false)&&id.length();bool toggling=id.length()&&!d["enabled"].isNull();String presetId=d["presetId"].as<String>();
    if(!removing&&!toggling){if(role<ROLE_ADMIN){server.send(403,"application/json","{\"ok\":false,\"error\":\"Only Jason can create custom schedules\"}");return;}Theme t;uint8_t br=100,sp=1;if(!loadPresetTheme(presetId,t,br,sp)){server.send(404,"text/plain","Custom light not found");return;}int month=d["month"]|0,day=d["day"]|0,year=d["year"]|0;if(month<1||month>12||day<1||day>31){server.send(400,"text/plain","Choose a valid schedule date");return;}}
    String raw=scheduleStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonArray arr=list.as<JsonArray>();if(removing){for(int i=(int)arr.size()-1;i>=0;i--)if(arr[i]["id"].as<String>()==id)arr.remove(i);}else if(toggling){bool found=false;for(JsonObject o:arr)if(o["id"].as<String>()==id){o["enabled"]=d["enabled"].as<bool>();found=true;break;}if(!found){server.send(404,"text/plain","Schedule entry not found");return;}}else{int month=d["month"]|0,day=d["day"]|0,year=d["year"]|0;uint32_t seq=nextStoredId(arr,'s');savedId=String("s")+String(seq);JsonObject o=arr.add<JsonObject>();o["id"]=savedId;o["presetId"]=presetId;o["month"]=month;o["day"]=day;o["year"]=year;o["annual"]=d["annual"]|true;o["enabled"]=true;}
    while(arr.size()>32)arr.remove(0);String out;serializeJson(list,out);if(out.length()>3800){server.send(507,"text/plain","Schedule storage is full");return;}if(!customFileWrite("/custom_schedules.json",out)){server.send(500,"text/plain","Schedule file write failed");return;}JsonDocument ack;ack["ok"]=true;ack["id"]=savedId;ack["count"]=(uint32_t)arr.size();ack["fileBytes"]=(uint32_t)scheduleStoreRaw().length();ack["backend"]="NVS";String ackJson;serializeJson(ack,ackJson);sendJson(ackJson);customScheduleRefreshPending=true;customScheduleRefreshAt=millis()+350;
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
    if(!requireAdmin())return;if(setupAP) WiFi.mode(WIFI_AP_STA); else WiFi.mode(WIFI_STA);WiFi.setSleep(false);WiFi.scanDelete();delay(150);int n=WiFi.scanNetworks(false,true,false,500);JsonDocument d;JsonArray a=d["networks"].to<JsonArray>();if(n>0){for(int i=0;i<n;i++){String ssid=WiFi.SSID(i);if(!ssid.length())continue;bool duplicate=false;for(JsonObject x:a){if(x["ssid"].as<String>()==ssid){duplicate=true;break;}}if(duplicate)continue;JsonObject x=a.add<JsonObject>();x["ssid"]=ssid;x["rssi"]=WiFi.RSSI(i);}}WiFi.scanDelete();String out;serializeJson(d,out);sendJson(out);
  });
  server.on("/api/wifi",HTTP_POST,[]{
    if(!requireAdmin())return;JsonDocument d;if(!body(d))return;String ssid=d["ssid"].as<String>(),pass=d["password"].as<String>();if(!ssid.length()){server.send(400,"text/plain","SSID required");return;}store.saveWiFi(ssid,pass);sendJson("{\"ok\":true}");delay(300);ESP.restart();
  });

  server.on("/api/ble/scan",HTTP_GET,[]{
    if(!requireAdmin())return;auto found=ble.scan();JsonDocument d;JsonArray a=d["devices"].to<JsonArray>();for(auto&f:found){JsonObject x=a.add<JsonObject>();x["name"]=f.name;x["address"]=f.address;x["rssi"]=f.rssi;}String out;serializeJson(d,out);sendJson(out);
  });
  server.on("/api/ble/select",HTTP_POST,[]{
    if(!requireAdmin())return;JsonDocument d;if(!body(d))return;String addr=d["address"].as<String>();bool ok=ble.selectAndConnect(addr);if(ok){store.saveAll();ble.setTarget(0);applyRunning(true);}sendJson(stateJson(),ok?200:500);
  });
  server.on("/api/ble/remove",HTTP_POST,[]{
    if(!requireAdmin())return;JsonDocument d;if(!body(d))return;int slot=d["slot"]|-1;if(slot<0||slot>1){server.send(400,"text/plain","Invalid slot");return;}ble.removeController(slot);store.saveAll();ble.setTarget(0);sendJson(stateJson());
  });
  server.on("/api/ble/target",HTTP_POST,[]{
    if(!requireUser())return;uint8_t role=requestRole();JsonDocument d;if(!body(d))return;int t=d["target"]|0;if(t<0||t>2)t=0;if(role<ROLE_ADMIN&&t!=0){server.send(403,"application/json","{\"ok\":false,\"error\":\"Only Jason can select individual controllers\"}");return;}ble.setTarget(t);applyRunning(true);sendJson(stateJson());
  });
  server.onNotFound([](){server.send(404,"text/plain","Not found");});
}

// ANDERSON_DAILY_MAINTENANCE_REBOOT: reboot once each local calendar day during the 18:00 minute.
static int32_t dailyRebootDateKey=0;
static uint32_t dailyRebootLastCheck=0;
static void loadDailyRebootMarker(){
  Preferences p;if(!p.begin("anderson-maint",true))return;dailyRebootDateKey=p.getInt("rebootDate",0);p.end();
}
static void checkDailyMaintenanceReboot(){
  if((uint32_t)(millis()-dailyRebootLastCheck)<1000UL)return;dailyRebootLastCheck=millis();
  if(!timeValid()||otaAutoRebootPending)return;
  time_t now=time(nullptr);tm local{};localtime_r(&now,&local);
  if(local.tm_hour!=18||local.tm_min!=0)return;
  int32_t dateKey=(local.tm_year+1900)*10000+(local.tm_mon+1)*100+local.tm_mday;
  if(dailyRebootDateKey==dateKey)return;
  Preferences p;if(!p.begin("anderson-maint",false))return;size_t wrote=p.putInt("rebootDate",dateKey);int32_t verify=p.getInt("rebootDate",0);p.end();
  if(wrote!=sizeof(int32_t)||verify!=dateKey)return;
  dailyRebootDateKey=dateKey;delay(100);ESP.restart();
}

void setup(){
  delay(500);pinMode(BLUE_LED,OUTPUT);pinMode(USER_BUTTON,INPUT_PULLUP);digitalWrite(BLUE_LED,HIGH);
  store.begin();remoteUpdateNoteBoot(ANDERSON_FIRMWARE_VERSION);loadDailyRebootMarker();loadPinAuthConfig();customFsReady=storageSelfTest();if(customFsReady){migrateLegacyCustomStorage();migrateV2HomeFavorites();runPaletteColorMigration();}loadEventOverrides();connectWiFi();setupMdns();ble.begin(&store.get());
  runningTheme.name="Warm White";runningTheme.effect=Effect::Jump;runningTheme.colors[0]=0xFFDA7F;runningTheme.colorCount=1;
  setupRoutes();server.begin();evaluateSchedule(true);digitalWrite(BLUE_LED,LOW);
}
void loop(){
  const uint64_t loopStartUs=(uint64_t)esp_timer_get_time();
  server.handleClient();ble.loop();
  checkDailyMaintenanceReboot();
  if(!otaAutoRebootPending){remoteUpdateAutoLoop(ANDERSON_FIRMWARE_VERSION);if(remoteUpdateConsumeRebootRequest()){otaAutoRebootPending=true;otaAutoRebootAt=millis()+1800;}}
  if(otaAutoRebootPending&&(int32_t)(millis()-otaAutoRebootAt)>=0){otaAutoRebootPending=false;delay(40);ESP.restart();}
  if(customScheduleRefreshPending&&(int32_t)(millis()-customScheduleRefreshAt)>=0){customScheduleRefreshPending=false;evaluateSchedule(true);}
  if(millis()-lastScheduleCheck>15000){lastScheduleCheck=millis();evaluateSchedule();}
  if(power)applyRunning(false);
  bool pressed=digitalRead(USER_BUTTON)==LOW;if(pressed && !buttonDown)buttonDown=millis();if(!pressed)buttonDown=0;
  if(buttonDown && millis()-buttonDown>5000){buttonDown=0;store.clearWiFi();digitalWrite(BLUE_LED,HIGH);delay(500);ESP.restart();}
  const uint64_t loopEndUs=(uint64_t)esp_timer_get_time();if(cpuWindowStartUs==0)cpuWindowStartUs=loopStartUs;cpuBusyUs+=loopEndUs-loopStartUs;const uint64_t cpuWindowUs=loopEndUs-cpuWindowStartUs;if(cpuWindowUs>=2000000ULL){uint64_t pct=(cpuBusyUs*100ULL+cpuWindowUs/2)/cpuWindowUs;if(pct>100)pct=100;cpuLoadPct=(uint8_t)pct;cpuBusyUs=0;cpuWindowStartUs=loopEndUs;}
  delay(2);
}
