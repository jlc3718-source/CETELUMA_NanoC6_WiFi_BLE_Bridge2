#include "FirmwareUpdate.h"
#include "BoundedHttpBody.h"
#ifndef JH2_BOOT
#include "OracleRelay.h"
#include <freertos/task.h>
#endif
#include <esp_ota_ops.h>
#include <esp_image_format.h>
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>

static const char PUBLIC_KEY[]=R"KEY(-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE3Dw/xqxEPbvkJQAcMeZxBAxwujxN
kuGHPepzClPYMrJ4h5r8iNlyUFpJZcPI/FXe8+atedYKpIZZB5XlOj964Q==
-----END PUBLIC KEY-----
)KEY";
static const char CHANNEL[]="https://raw.githubusercontent.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/jh2-nanoc6-ota/latest.json";
static const char PREFIX[]="https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/releases/download/jason-home-2-nanoc6-v";
static bool busy=false;
static bool autoTaskStarted=false;
static JsonDocument available;
static const esp_partition_t* runtimePartition(){return esp_partition_find_first(ESP_PARTITION_TYPE_APP,ESP_PARTITION_SUBTYPE_APP_OTA_0,"runtime");}
static bool hexValid(const String&s,size_t n){if(s.length()!=n)return false;for(char c:s)if(!isxdigit(c))return false;return true;}
static bool versionValid(const String&s){unsigned a,b,c;char tail;return sscanf(s.c_str(),"%u.%u.%u%c",&a,&b,&c,&tail)==3&&a<10000&&b<10000&&c<10000;}
bool isNewer(const String&a,const String&b){unsigned x[3]{},y[3]{};if(!versionValid(a)||!versionValid(b))return false;sscanf(a.c_str(),"%u.%u.%u",x,x+1,x+2);sscanf(b.c_str(),"%u.%u.%u",y,y+1,y+2);for(int i=0;i<3;i++)if(x[i]!=y[i])return x[i]>y[i];return false;}
bool parseManifest(JsonVariantConst d,FirmwareManifest&m,String&error){
  if((d["schema"]|0)!=1){error="Invalid manifest schema";return false;}
  m.payload=d["payload"]|String("");m.signature=d["signature"]|String("");
  auto sig=from64(m.signature);uint8_t digest[32];mbedtls_sha256((const uint8_t*)m.payload.c_str(),m.payload.length(),digest,0);
  mbedtls_pk_context pk;mbedtls_pk_init(&pk);int rc=mbedtls_pk_parse_public_key(&pk,(const uint8_t*)PUBLIC_KEY,sizeof(PUBLIC_KEY));
  if(!rc)rc=mbedtls_pk_verify(&pk,MBEDTLS_MD_SHA256,digest,32,sig.data(),sig.size());mbedtls_pk_free(&pk);
  if(rc){error="Firmware signature is invalid";return false;}
  JsonDocument fields;int start=0;
  while(start<(int)m.payload.length()){int end=m.payload.indexOf('\n',start);if(end<0)end=m.payload.length();String line=m.payload.substring(start,end);start=end+1;if(!line.length())continue;int eq=line.indexOf('=');if(eq<=0){error="Malformed signed fields";return false;}String k=line.substring(0,eq),v=line.substring(eq+1);if(fields[k].is<String>()){error="Duplicate signed field";return false;}fields[k]=v;}
  if(fields.size()!=6||String(fields["product"]|"")!="jason-home-2-nanoc6"){error="Wrong firmware product";return false;}
  m.version=fields["version"]|String("");m.sha=fields["sha256"]|String("");m.commit=fields["commit"]|String("");m.url=fields["url"]|String("");
  String count=fields["bytes"]|String("");for(char c:count)if(!isdigit(c)){error="Invalid firmware length";return false;}m.bytes=strtoul(count.c_str(),nullptr,10);
  if(!versionValid(m.version)||!hexValid(m.sha,64)||!hexValid(m.commit,40)||m.bytes<1024||m.bytes>0x290000){error="Manifest identity or size is invalid";return false;}
  String expected=String(PREFIX)+m.version+"/jh2-runtime-"+m.version+".bin";
  if(m.url!=expected){error="Firmware URL is outside the Jason Home 2 channel";return false;}return true;
}
bool runtimeValid(){auto*p=runtimePartition();if(!p)return false;esp_partition_pos_t pos{p->address,p->size};esp_image_metadata_t meta{};return esp_image_verify(ESP_IMAGE_VERIFY_SILENT,&pos,&meta)==ESP_OK;}
bool selectRuntime(){auto*p=runtimePartition();return p&&runtimeValid()&&esp_ota_set_boot_partition(p)==ESP_OK;}
bool queueFirmware(JsonVariantConst d,String&error){
  FirmwareManifest m;if(!parseManifest(d,m,error))return false;
  if(!isNewer(m.version,VERSION)){error="Only a newer Jason Home 2 runtime is accepted";return false;}
  String encoded;serializeJson(d,encoded);Preferences n;n.begin("jh2-release",false);bool saved=n.putString("pending",encoded)==encoded.length();n.end();if(!saved){error="Could not save update request";return false;}
  auto*boot=esp_partition_find_first(ESP_PARTITION_TYPE_APP,ESP_PARTITION_SUBTYPE_APP_FACTORY,"boot");
  if(!boot||esp_ota_set_boot_partition(boot)!=ESP_OK){error="Could not select boot updater";return false;}return true;
}
bool fetchManifest(JsonDocument&d){
  if(!timeValid()){lastError="Waiting for Internet clock sync; retry in a few seconds";return false;}
  bool ok=httpsJson(String(CHANNEL)+"?t="+String((uint32_t)time(nullptr)),nullptr,d);
  if(ok)lastError="";
  return ok;
}
bool installFirmware(JsonVariantConst d,String&error){
  FirmwareManifest m;if(!parseManifest(d,m,error))return false;
  auto*p=runtimePartition();if(!p||p->address!=0x130000||p->size!=0x290000){error="Wrong flash layout";return false;}
  if(esp_ota_get_running_partition()->subtype!=ESP_PARTITION_SUBTYPE_APP_FACTORY){error="Runtime replacement must run from boot updater";return false;}
  WiFiClientSecure c;trust(c);HTTPClient h;h.setConnectTimeout(8000);h.setTimeout(12000);h.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  if(!h.begin(c,m.url)){error="Firmware URL unavailable";return false;}const char*hs[]={"Transfer-Encoding"};h.collectHeaders(hs,1);
  int rc=h.GET();if(rc!=200){error="Firmware download HTTP "+String(rc);h.end();return false;}
  // The updater never writes its own factory partition, NVS or user data.
  esp_ota_handle_t handle=0;rc=esp_ota_begin(p,m.bytes,&handle);if(rc!=ESP_OK){error="Could not open runtime partition";h.end();return false;}
  mbedtls_sha256_context sha;mbedtls_sha256_init(&sha);mbedtls_sha256_starts(&sha,0);size_t total=0;
  String te=h.header("Transfer-Encoding");bool chunked=te.equalsIgnoreCase("chunked");const char* why=nullptr;
  bool ok=(!te.length()||chunked)&&readBoundedHttpBody(*h.getStreamPtr(),h.getSize(),chunked,m.bytes,
    [&](const uint8_t*b,size_t n){if(total+n>m.bytes)return false;if(esp_ota_write(handle,b,n)!=ESP_OK)return false;mbedtls_sha256_update(&sha,b,n);total+=n;return true;},
    [](){return millis();},[](){delay(2);},12000,240000,why);
  uint8_t hash[32]{};mbedtls_sha256_finish(&sha,hash);mbedtls_sha256_free(&sha);h.end();
  if(!ok||total!=m.bytes||hexBytes(hash,32)!=m.sha){esp_ota_abort(handle);error=why?String(why):"Firmware length or SHA-256 mismatch";return false;}
  if(esp_ota_end(handle)!=ESP_OK||!selectRuntime()){error="ESP32-C6 image validation failed";return false;}
  Preferences n;n.begin("jh2-release",false);n.putString("version",m.version);n.putString("commit",m.commit);n.remove("pending");n.end();return true;
}
#ifndef JH2_BOOT
// Signed automatic updates run outside the web/BLE event loop to prevent hangs.
static void automaticFirmwareTask(void*){
  vTaskDelay(pdMS_TO_TICKS(30000));
  for(;;){
    if((state["autoUpdate"]|true)&&WiFi.status()==WL_CONNECTED&&timeValid()){
      busy=true;
      JsonDocument manifest;FirmwareManifest m;String error;
      if(fetchManifest(manifest)&&parseManifest(manifest.as<JsonVariantConst>(),m,error)
         &&isNewer(m.version,VERSION)&&queueFirmware(manifest.as<JsonVariantConst>(),error)){
        // Permanent boot updater validates the download's SHA-256 and image.
        relayPrepareForUpdate();
        vTaskDelay(pdMS_TO_TICKS(300));
        ESP.restart();
      }
      busy=false;
    }
    vTaskDelay(pdMS_TO_TICKS(300000)); // check for signed releases every five minutes
  }
}
#endif
void registerFirmware(){
  web.on("/api/firmware",HTTP_GET,[]{if(!authorized())return replyError(401,"Sign in first");JsonDocument d;d["product"]="Jason Home 2 NanoC6";d["version"]=VERSION;d["commit"]=BUILD_SHA;d["runtimeSlotBytes"]=0x290000;d["bootSlotBytes"]=0x120000;d["runtimeCopies"]=1;d["rollback"]=false;d["autoUpdate"]=state["autoUpdate"]|true;d["message"]=lastError;d["available"]=available.as<JsonVariantConst>();reply(200,d.as<JsonVariantConst>());});
  web.on("/api/firmware/check",HTTP_POST,[]{if(!authorized())return replyError(401,"Sign in first");String error;FirmwareManifest m;if(!fetchManifest(available)||!parseManifest(available.as<JsonVariantConst>(),m,error))return replyError(502,error.length()?error:lastError);JsonDocument d;d["ok"]=true;d["version"]=m.version;d["newer"]=isNewer(m.version,VERSION);d["signed"]=true;reply(200,d.as<JsonVariantConst>());});
  web.on("/api/firmware/install",HTTP_POST,[]{if(!authorized())return replyError(401,"Sign in first");String error;if(available.isNull()&&!fetchManifest(available))return replyError(502,lastError);if(!queueFirmware(available.as<JsonVariantConst>(),error))return replyError(400,error);web.send(202,"application/json","{\"ok\":true,\"rebootingToUpdater\":true}");delay(400);ESP.restart();});
#ifndef JH2_BOOT
  if(!autoTaskStarted){TaskHandle_t handle=nullptr;autoTaskStarted=xTaskCreate(automaticFirmwareTask,"jh2-auto-ota",10240,nullptr,1,&handle)==pdPASS;}
#endif
}
void firmwareLoop(){
  // Retained for API compatibility: OTA HTTPS runs in a separate FreeRTOS task.
}

#include "LocalFirmware.inc"
