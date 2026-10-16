#include "OracleRelay.h"
#include "Curtain.h"
#include <mbedtls/sha256.h>
#include <freertos/task.h>
#include <deque>
static SemaphoreHandle_t lock;
static String endpoint,token,bridgeId,relayError,lastAck="none",activeSha;
static JsonDocument lastResult;
static std::deque<String> acknowledgments;
static volatile uint32_t generation=0,revision=0,lastSync=0,nextSync=0;
static volatile uint32_t localUntil=0;
static volatile bool syncNow=false,streaming=false,online=false,streamFailed=false;
static uint64_t lastCommand=0,seen=0;
static uint8_t streamFailures=0;
static String getEndpoint(){xSemaphoreTake(lock,portMAX_DELAY);String s=endpoint;xSemaphoreGive(lock);return s;}
static String digest(const uint8_t*data,size_t size){uint8_t d[32];mbedtls_sha256(data,size,d,0);return hexBytes(d,32);}
static void issue(const String& error){xSemaphoreTake(lock,portMAX_DELAY);relayError=error;xSemaphoreGive(lock);}
static bool request(const String&path,JsonDocument&out,const String*body=nullptr){
 String base,key;xSemaphoreTake(lock,portMAX_DELAY);base=endpoint;key=token;xSemaphoreGive(lock);if(!base.length())return false;
 WiFiClientSecure c;trust(c);HTTPClient h;h.setConnectTimeout(7000);h.setTimeout(path.startsWith("/api/curtain-bridge/wait")?25000:12000);
 const char*headers[]={"Transfer-Encoding"};h.collectHeaders(headers,1);
 if(!h.begin(c,base+path)){issue("Cannot open Oracle HTTPS");return false;}h.addHeader("Authorization","Bearer "+key);h.addHeader("X-JH2-Bridge-Token",key);h.addHeader("Content-Type","application/json");
 int rc=body?h.POST(*body):h.GET();String data;
 bool ok=rc==200&&readHttpText(h,data,65536);h.end();
 if(!ok){issue(rc==401?"Oracle rejected bridge credentials":"Oracle HTTPS "+String(rc));return false;}
 if(deserializeJson(out,data)){issue("Malformed Oracle reply");return false;}issue("");return true;
}
struct RelayStream {
 uint8_t buffer[4096];uint32_t offset=0,loadedAt=0,loaded=0,size=0;String sha;mbedtls_sha256_context hash;bool verified=false;
 RelayStream(){mbedtls_sha256_init(&hash);mbedtls_sha256_starts(&hash,0);}~RelayStream(){mbedtls_sha256_free(&hash);}
 bool read(uint8_t*out,size_t n){
  while(n){if(offset>=size)return false;
   if(offset<loadedAt||offset>=loadedAt+loaded){
    String base,key;xSemaphoreTake(lock,portMAX_DELAY);base=endpoint;key=token;xSemaphoreGive(lock);
    WiFiClientSecure c;trust(c);HTTPClient h;h.setTimeout(12000);const char*hs[]={"x-chunk-sha256"};h.collectHeaders(hs,1);
    if(!h.begin(c,base+"/api/curtain-bridge/assets/"+sha+"?offset="+String(offset)+"&length=4096"))return false;
    h.addHeader("Authorization","Bearer "+key);h.addHeader("X-JH2-Bridge-Token",key);int rc=h.GET();int len=h.getSize();
    bool ok=rc==200&&len>0&&len<=4096&&uint32_t(len)<=size-offset;size_t got=0;
    if(ok)got=h.getStreamPtr()->readBytes(buffer,len);
    String expected=h.header("x-chunk-sha256");h.end();
    if(!ok||got!=size_t(len)||digest(buffer,got)!=expected){issue("Oracle relay chunk failed integrity/length check");return false;}
    loadedAt=offset;loaded=got;
   }
   size_t count=std::min(n,size_t(loadedAt+loaded-offset));memcpy(out,buffer+offset-loadedAt,count);mbedtls_sha256_update(&hash,out,count);out+=count;offset+=count;n-=count;
  }
  return true;
 }
 bool complete(){uint8_t d[32];mbedtls_sha256_finish(&hash,d);verified=hexBytes(d,32)==sha;return verified;}
};
struct Play {String sha;uint32_t size,gen;uint64_t id;};
static void setResult(uint64_t id,const char*status,JsonVariantConst result){xSemaphoreTake(lock,portMAX_DELAY);lastCommand=id;lastAck=status;lastResult.set(result);JsonDocument ack;ack["id"]=id;ack["state"]=status;ack["result"]=result;String text;serializeJson(ack,text);acknowledgments.push_back(text);syncNow=true;xSemaphoreGive(lock);}
static void playback(void*arg){
 Play p=*static_cast<Play*>(arg);delete static_cast<Play*>(arg);bool applied=false;String error;
 do{
  RelayStream stream;stream.sha=p.sha;stream.size=p.size;uint8_t header[8];
  if(!stream.read(header,8)||memcmp(header,"JHC1",4)){error="Invalid relay program header";break;}
  uint16_t frames=header[4]|(header[5]<<8);if(!frames||frames>180){error="Invalid relay frame count";break;}
  for(uint16_t f=0;f<frames&&p.gen==generation;f++){
   uint8_t fh[6];if(!stream.read(fh,6)){error="Oracle stream interrupted; last frame retained";break;}
   uint32_t hold=uint32_t(fh[0])|(uint32_t(fh[1])<<8)|(uint32_t(fh[2])<<16)|(uint32_t(fh[3])<<24);uint16_t count=fh[4]|(fh[5]<<8);
   if(count>5000||hold>60000){error="Invalid relay frame";break;}
   for(uint16_t i=0;i<count&&p.gen==generation;i++){
    uint8_t rh[3],packet[508];if(!stream.read(rh,3)){error="Truncated relay packet";break;}uint16_t n=rh[1]|(rh[2]<<8);
    if(n>sizeof(packet)||!n||rh[0]>1||!stream.read(packet,n)){error="Invalid relay packet";break;}
    if(!curtainRelayWrite(rh[0],packet,n)){error="BLE write failed; last displayed frame retained";break;}
    vTaskDelay(pdMS_TO_TICKS(5));
   }
   if(error.length()||p.gen!=generation)break;
   if(!applied){JsonDocument result;result["ok"]=true;result["connected"]=true;result["bleTransmitted"]=true;result["physicalPlaybackConfirmed"]=false;result["message"]="NanoC6 transmitted the first frame over BLE; Oracle is relaying playback. Physical output requires inspection.";setResult(p.id,"applied",result.as<JsonVariantConst>());applied=true;}
   for(uint32_t waited=0;waited<hold&&p.gen==generation;waited+=20)vTaskDelay(pdMS_TO_TICKS(20));
  }
  if(error.length()||p.gen!=generation)break;
  if(stream.offset!=stream.size||!stream.complete()){error="Complete relay digest mismatch";break;}
  if(!header[6])break;
 }while(p.gen==generation&&WiFi.status()==WL_CONNECTED);
 if(error.length()){streamFailures++;streamFailed=streamFailures<=3;issue(error);if(!applied){JsonDocument result;result["ok"]=false;result["error"]=error;setResult(p.id,"failed",result.as<JsonVariantConst>());}}
 if(p.gen==generation){streaming=false;syncNow=true;}vTaskDelete(nullptr);
}
static void poller(void*){
 uint32_t backoff=1000,lastNotice=0;String boot=randomHex(8);
 for(;;){
  if(WiFi.status()!=WL_CONNECTED||!timeValid()||!getEndpoint().length()){online=false;vTaskDelay(pdMS_TO_TICKS(1000));continue;}
  JsonDocument body,response;body["recoverDesired"]=streamFailed;body["bridgeId"]=bridgeId;body["bootId"]=boot;
  auto status=body["status"].to<JsonObject>();status["firmware"]=VERSION;status["build"]=BUILD_SHA;status["uptimeSeconds"]=millis()/1000;status["wifiRSSI"]=WiFi.RSSI();status["relayStreaming"]=streaming;status["assetStorage"]="oracle";status["freeHeap"]=ESP.getFreeHeap();status["flashBytes"]=ESP.getFlashChipSize();
  JsonDocument curtain;curtainCall("status",JsonVariantConst(),curtain);status["curtain"]=curtain.as<JsonVariantConst>();
  xSemaphoreTake(lock,portMAX_DELAY);status["error"]=relayError;size_t ackCount=std::min(acknowledgments.size(),size_t(32));auto aa=body["acks"].to<JsonArray>();for(size_t i=0;i<ackCount;i++){JsonDocument d;deserializeJson(d,acknowledgments[i]);aa.add(d.as<JsonVariantConst>());}xSemaphoreGive(lock);
  // Forward recent notifications for the unchanged native-slot installer.
  curtainNotifications(body["notifications"].to<JsonArray>(),0);
  if(localUntil&&(int32_t)(localUntil-millis())>0)body["localOverrideUntil"]=int64_t(time(nullptr))*1000+(localUntil-millis());
  String encoded;serializeJson(body,encoded);syncNow=false;
  if(!request("/api/curtain-bridge/sync",response,&encoded)){online=false;vTaskDelay(pdMS_TO_TICKS(backoff));backoff=std::min<uint32_t>(backoff*2,30000);continue;}
  if(response["credential"].is<JsonObjectConst>()){
   String credentialError;if(!relayConfigure(response["credential"].as<JsonVariantConst>(),credentialError)){issue("Credential rotation failed: "+credentialError);online=false;vTaskDelay(pdMS_TO_TICKS(1000));continue;}
  }
  xSemaphoreTake(lock,portMAX_DELAY);for(size_t i=0;i<ackCount&&!acknowledgments.empty();i++)acknowledgments.pop_front();xSemaphoreGive(lock);online=true;backoff=1000;lastSync=millis();nextSync=millis()+5000;revision=response["revision"]|0U;
  // Node replies with Unix time; NTP remains the primary clock. Never step an already-valid clock.
  for(auto n:body["notifications"].as<JsonArrayConst>())lastNotice=std::max(lastNotice,n["id"].as<uint32_t>());
  for(auto cmd:response["commands"].as<JsonArrayConst>()){
   uint64_t id=cmd["id"].as<uint64_t>();if(id<=seen)continue;
   if(localUntil&&(int32_t)(localUntil-millis())>0)break;
   String action=cmd["action"]|String("");JsonDocument result;bool ok=true;
   if(cmd["source"].as<String>()=="manual")streamFailures=0;
   if(action=="asset"||action=="nativePlay"||action=="effect"||action=="sequenceStart"||action=="sequenceStop"||action=="assetStop"||action=="rawWrite"||action=="disconnect"||(action=="power"&&!(cmd["payload"]["on"]|false))){generation++;streaming=false;}
   if(action!="disconnect"&&action!="scan"&&action!="status")ok=curtainCall("connect",JsonVariantConst(),result);
   if(ok&&action=="asset"){
    curtainCall("sequenceStop",JsonVariantConst(),result);String sha=cmd["payload"]["sha256"]|String("");uint32_t size=0;for(auto a:response["assets"].as<JsonArrayConst>())if(a["sha256"].as<String>()==sha)size=a["bytes"]|0U;
    if(!size||size>4*1024*1024){ok=false;result["error"]="Oracle asset is missing or exceeds relay limit";}
    else{streamFailed=false;auto*p=new Play{sha,size,generation,id};activeSha=sha;streaming=true;TaskHandle_t task=nullptr;if(xTaskCreate(playback,"jh2-stream",12288,p,1,&task)!=pdPASS){delete p;ok=false;streaming=false;result["error"]="Insufficient RAM to start relay";}else{result["ok"]=true;result["message"]="Oracle program received; waiting for BLE transmission";setResult(id,"downloaded",result.as<JsonVariantConst>());seen=id;break;}}
   }else if(ok&&action=="assetStop"){result["ok"]=true;result["message"]="Oracle streaming stopped; last curtain frame retained";}
   else if(ok)ok=curtainCall(action,cmd["payload"],result);
   result["ok"]=ok;setResult(id,ok?"applied":"failed",result.as<JsonVariantConst>());seen=id;
   // Send each ACK before moving to the next ordered command.
   break;
  }
  if(syncNow){vTaskDelay(pdMS_TO_TICKS(30));continue;}
  while((int32_t)(millis()-nextSync)<0&&!syncNow){
   JsonDocument waited;if(!request("/api/curtain-bridge/wait?after="+String(revision)+(streaming?"&seconds=1":"&seconds=20"),waited)){online=false;break;}
   // Check for commands after each long-poll response; full snapshots occur every 5 seconds.
   if(waited["changed"]|false)break;
  }
 }
}
void relayBegin(){lock=xSemaphoreCreateMutex();endpoint=secrets["oracleEndpoint"]|String("");token=secrets["oracleBridgeToken"]|String("");bridgeId=secrets["oracleBridgeId"]|String("");xTaskCreate(poller,"jh2-oracle",12288,nullptr,1,nullptr);}
bool relayConfigure(JsonVariantConst in,String&error){
 String base=in["endpoint"]|String(""),key=in["token"]|String(""),id=in["bridgeId"]|String("");
 if(base!="https://150.136.245.51/jason-home-2"||key.length()!=64||id.length()!=16){error="Paste the pairing configuration from Jason Home 2 Settings";return false;}
 JsonDocument next;next.set(secrets);next["oracleEndpoint"]=base;next["oracleBridgeToken"]=key;next["oracleBridgeId"]=id;
 if(!saveJson("/secrets.json",next.as<JsonVariantConst>())){error="Could not save bridge identity";return false;}secrets.set(next);
 xSemaphoreTake(lock,portMAX_DELAY);endpoint=base;token=key;bridgeId=id;xSemaphoreGive(lock);syncNow=true;return true;
}
void relaySyncNow(){syncNow=true;}
void relayLocalOverride(bool resume){localUntil=resume?0:millis()+15*60000;generation++;streaming=false;syncNow=true;}
void relayDescribe(JsonObject out){xSemaphoreTake(lock,portMAX_DELAY);out["configured"]=token.length()==64;out["endpoint"]=endpoint;out["online"]=online;out["error"]=relayError;out["lastCommandId"]=lastCommand;out["lastDelivery"]=lastAck;out["lastSuccessfulSyncAgoSeconds"]=lastSync?(millis()-lastSync)/1000:-1;out["nextPollSeconds"]=lastSync?(std::max<int32_t>(0,int32_t(nextSync-millis()))/1000):0;out["pollSeconds"]=5;out["streaming"]=streaming;out["assetStorage"]="Oracle";out["ramBufferBytes"]=4096;out["manualOverrideSeconds"]=localUntil?std::max<int32_t>(0,int32_t(localUntil-millis()))/1000:0;out["flashBytes"]=ESP.getFlashChipSize();out["firmwareBytes"]=ESP.getSketchSize();out["freeSketchBytes"]=ESP.getFreeSketchSpace();out["filesystemBytes"]=LittleFS.totalBytes();out["filesystemUsedBytes"]=LittleFS.usedBytes();xSemaphoreGive(lock);}
