#include "OracleRelay.h"
#include "Curtain.h"
#include "FirmwareUpdate.h"
#include <mbedtls/sha256.h>
#include <freertos/task.h>
#include <deque>
static SemaphoreHandle_t lock;
static String endpoint,token,bridgeId,relayError,lastAck="none",activeSha;
static JsonDocument lastResult;
static std::deque<String> acknowledgments;
static volatile uint32_t generation=0,revision=0,lastSync=0,nextSync=0;
static volatile uint32_t localUntil=0;
static volatile bool syncNow=false,streaming=false,online=false,streamFailed=false,pushOnline=false;
static uint64_t lastCommand=0,seen=0;
static uint8_t streamFailures=0;
static volatile uint32_t liveBufferBytes=0,liveBufferTargetBytes=0,wakeSignals=0,lastWakeAt=0;
static volatile uint8_t liveBufferWindows=0;
static uint64_t restartAfterAck=0;
static String getEndpoint(){xSemaphoreTake(lock,portMAX_DELAY);String s=endpoint;xSemaphoreGive(lock);return s;}
static String digest(const uint8_t*data,size_t size){uint8_t d[32];mbedtls_sha256(data,size,d,0);return hexBytes(d,32);}
static void issue(const String& error){xSemaphoreTake(lock,portMAX_DELAY);relayError=error;xSemaphoreGive(lock);}
static bool request(const String&path,JsonDocument&out,const String*body=nullptr){
 String base,key;xSemaphoreTake(lock,portMAX_DELAY);base=endpoint;key=token;xSemaphoreGive(lock);if(!base.length())return false;
 WiFiClientSecure c;trust(c);HTTPClient h;h.setConnectTimeout(7000);h.setTimeout(path.startsWith("/api/curtain-bridge/wait")?6000:12000);
 const char*headers[]={"Transfer-Encoding"};h.collectHeaders(headers,1);
 if(!h.begin(c,base+path)){issue("Cannot open Oracle HTTPS");return false;}h.addHeader("Authorization","Bearer "+key);h.addHeader("X-JH2-Bridge-Token",key);h.addHeader("Content-Type","application/json");
 int rc=body?h.POST(*body):h.GET();String data;
 bool ok=rc==200&&readHttpText(h,data,65536);h.end();
 if(!ok){issue(rc==401?"Oracle rejected bridge credentials":"Oracle HTTPS "+String(rc));return false;}
 if(deserializeJson(out,data)){issue("Malformed Oracle reply");return false;}issue("");return true;
}
// Oracle PUSH channel: one Nano-initiated, authenticated HTTPS event stream.
// No router ports, inbound Nano sockets, or periodic command-discovery GETs.
// Header/framing data can be HTTP chunked; only "data: <revision>" lines matter.
static void pushEvents(void*){
 for(;;){
  if(WiFi.status()!=WL_CONNECTED||!timeValid()||ESP.getFreeHeap()<66000){
   pushOnline=false;vTaskDelay(pdMS_TO_TICKS(2000));continue;
  }
  String base,key;xSemaphoreTake(lock,portMAX_DELAY);base=endpoint;key=token;xSemaphoreGive(lock);
  if(!base.length()||key.length()!=64){pushOnline=false;vTaskDelay(pdMS_TO_TICKS(2000));continue;}
  WiFiClientSecure client;trust(client);HTTPClient http;
  http.setConnectTimeout(4500);http.setTimeout(12000);
  if(!http.begin(client,base+"/api/curtain-bridge/events")){pushOnline=false;vTaskDelay(pdMS_TO_TICKS(1200));continue;}
  http.addHeader("Authorization","Bearer "+key);
  http.addHeader("X-JH2-Bridge-Token",key);
  http.addHeader("Accept","text/event-stream");
  int code=http.GET();
  if(code!=200){pushOnline=false;http.end();vTaskDelay(pdMS_TO_TICKS(2000));continue;}
  auto*source=http.getStreamPtr();uint32_t lastData=millis();
  char line[128]{};size_t used=0;
  pushOnline=true;
  while(WiFi.status()==WL_CONNECTED&&source->connected()&&millis()-lastData<32000){
   if(!source->available()){vTaskDelay(pdMS_TO_TICKS(15));continue;}
   int chr=source->read();if(chr<0)continue;lastData=millis();
   if(chr=='\r')continue;
   if(chr=='\n'){
    line[used]=0;
    if(used>6&&strncmp(line,"data: ",6)==0){
     const unsigned long incoming=strtoul(line+6,nullptr,10);
     if(incoming>revision){++wakeSignals;lastWakeAt=millis();syncNow=true;}
    }
    used=0;continue;
   }
   if(used<sizeof(line)-1)line[used++]=(char)chr;
   else used=0;
  }
  pushOnline=false;http.end();vTaskDelay(pdMS_TO_TICKS(1000));
 }
}
struct RelayStream {
 // Two independently adaptive producer/consumer windows. Reserve heap for
 // TLS, Wi-Fi and BLE, then use up to 80% of the remaining available RAM.
 static constexpr size_t MIN_WINDOW=4096,SAFETY_RESERVE=48*1024;
 uint8_t* windows[2]{nullptr,nullptr};
 size_t windowCapacities[2]{0,0},windowCount=0;
 uint32_t windowOffsets[2]{0,0};
 size_t windowSizes[2]{0,0};
 int8_t consuming=-1;
 uint32_t offset=0,size=0;
 String sha;mbedtls_sha256_context hash;bool verified=false,opened=false,streamMode=false;
 WiFiClientSecure socket;HTTPClient http;
 QueueHandle_t freeQueue=nullptr,readyQueue=nullptr;
 TaskHandle_t prefetchTask=nullptr;
 volatile bool closing=false,done=false,failed=false;
 uint32_t produced=0;
 size_t targetEach() const {
  // Own allocated bytes count as recoverable pool; changing live TLS/BLE
  // memory demand dynamically reduces or increases the safe buffer target.
  size_t pool=ESP.getFreeHeap()+windowCapacities[0]+windowCapacities[1];
  if(pool<=SAFETY_RESERVE+2*MIN_WINDOW)return MIN_WINDOW;
  return std::max(MIN_WINDOW,((((pool-SAFETY_RESERVE)*4)/5)/2/1024)*1024);
 }
 void reportWindows(){
  liveBufferWindows=uint8_t(windowCount);
  liveBufferBytes=uint32_t(windowCapacities[0]+windowCapacities[1]);
  liveBufferTargetBytes=uint32_t(targetEach()*windowCount);
 }
 void adaptWindow(uint8_t index){
  // This index came from freeQueue: BLE cannot be accessing it now.
  if(!windows[index])return;
  size_t prior=windowCapacities[index],wanted=targetEach();
  if(wanted>prior){
   size_t available=ESP.getFreeHeap();
   if(available<=SAFETY_RESERVE+1024)return;
   wanted=std::min(wanted,prior+available-SAFETY_RESERVE);
   wanted=(wanted/1024)*1024;
  }
  wanted=std::max(MIN_WINDOW,wanted);
  if(wanted==prior)return;
  auto*updated=static_cast<uint8_t*>(realloc(windows[index],wanted));
  if(!updated&&wanted>prior+8192){
   size_t half=((prior+(wanted-prior)/2)/1024)*1024;
   updated=static_cast<uint8_t*>(realloc(windows[index],half));
   if(updated)wanted=half;
  }
  if(updated){windows[index]=updated;windowCapacities[index]=wanted;reportWindows();}
 }
 RelayStream(){
  size_t each=targetEach();
  for(;each>=MIN_WINDOW;each=(each/2/1024)*1024){
   windows[0]=static_cast<uint8_t*>(malloc(each));
   if(windows[0])windows[1]=static_cast<uint8_t*>(malloc(each));
   if(windows[0]&&windows[1]){
    windowCapacities[0]=windowCapacities[1]=each;windowCount=2;break;
   }
   if(windows[0])::free(windows[0]);
   if(windows[1])::free(windows[1]);
   windows[0]=windows[1]=nullptr;
   if(each==MIN_WINDOW)break;
  }
  if(!windowCount){
   windows[0]=static_cast<uint8_t*>(malloc(MIN_WINDOW));
   if(windows[0]){windowCapacities[0]=MIN_WINDOW;windowCount=1;}
  }
  reportWindows();
  mbedtls_sha256_init(&hash);mbedtls_sha256_starts(&hash,0);
 }
 ~RelayStream(){
  closing=true;
  // The producer alone owns the Oracle HTTP socket until it has stopped.
  while(prefetchTask&&!done)vTaskDelay(pdMS_TO_TICKS(10));
  http.end();
  if(freeQueue)vQueueDelete(freeQueue);
  if(readyQueue)vQueueDelete(readyQueue);
  for(auto*p:windows)if(p)::free(p);
  liveBufferBytes=0;liveBufferTargetBytes=0;liveBufferWindows=0;
  mbedtls_sha256_free(&hash);
 }
 void credential(String&base,String&key){
  xSemaphoreTake(lock,portMAX_DELAY);base=endpoint;key=token;xSemaphoreGive(lock);
 }
 bool open(){
  if(opened)return streamMode;
  opened=true;String base,key;credential(base,key);trust(socket);
  http.setConnectTimeout(6500);http.setTimeout(15000);
  const char*headers[]={"x-asset-sha256"};http.collectHeaders(headers,1);
  if(!http.begin(socket,base+"/api/curtain-bridge/stream/"+sha))return false;
  http.addHeader("Authorization","Bearer "+key);
  http.addHeader("X-JH2-Bridge-Token",key);
  const int code=http.GET();
  streamMode=code==200&&http.getSize()==(int)size&&http.header("x-asset-sha256")==sha;
  if(!streamMode)http.end();
  return streamMode;
 }
 // Called only by the producer; no other task touches the Oracle HTTP stream.
 bool fromStream(uint8_t*dest,uint32_t at,size_t&n,size_t capacity){
  auto*source=http.getStreamPtr();
  const uint32_t began=millis();
  while(!closing&&!source->available()){
   if(!source->connected()||millis()-began>=12000){
    http.end();streamMode=false;return false;
   }
   vTaskDelay(pdMS_TO_TICKS(2));
  }
  if(closing)return false;
  // Coalesce network bursts briefly; don't wait to fill the whole buffer.
  uint32_t first=millis();
  // Fill whatever arrives, up to the REAL window capacity; do not stall BLE
  // waiting for an entire large window.
  while(!closing&&n<capacity&&n<size-at){
   size_t ready=source->available();
   size_t want=std::min(ready,std::min(capacity-n,size_t(size-at-n)));
   if(want){
    int got=source->read(dest+n,want);
    if(got<=0)break;
    n+=got;
   }else{
    if(millis()-first>=12)break;
    vTaskDelay(pdMS_TO_TICKS(1));
   }
   if(millis()-first>=18)break;
  }
  return n>0;
 }
 bool fromRange(uint8_t*dest,uint32_t at,size_t&n,size_t capacity){
  // Fall back to authenticated, SHA-256-verified 4 KiB ranges.
  String base,key;credential(base,key);
  WiFiClientSecure tls;trust(tls);HTTPClient h;
  h.setConnectTimeout(6500);h.setTimeout(12000);
  const char*headers[]={"x-chunk-sha256"};h.collectHeaders(headers,1);
  if(!h.begin(tls,base+"/api/curtain-bridge/assets/"+sha+"?offset="+
     String(at)+"&length=4096"))return false;
  h.addHeader("Authorization","Bearer "+key);
  h.addHeader("X-JH2-Bridge-Token",key);
  const int code=h.GET(),len=h.getSize();
  const bool valid=code==200&&len>0&&len<=4096&&
   uint32_t(len)<=size-at&&size_t(len)<=capacity;
  if(valid)n=h.getStreamPtr()->readBytes(dest,len);
  const String expected=h.header("x-chunk-sha256");h.end();
  return valid&&n==size_t(len)&&digest(dest,n)==expected;
 }
 static void producer(void*arg){
  auto*self=static_cast<RelayStream*>(arg);
  while(!self->closing&&self->produced<self->size){
   uint8_t index=0;
   if(xQueueReceive(self->freeQueue,&index,pdMS_TO_TICKS(100))!=pdTRUE)continue;
   if(self->closing)break;
   // Size adjusts every time a free window returns to the producer.
   // Neither buffer is freed or resized while the consumer owns it.
   self->adaptWindow(index);
   size_t n=0;const uint32_t at=self->produced;
   const size_t available=self->windowCapacities[index];
   bool ok=(self->streamMode&&self->fromStream(self->windows[index],at,n,available));
   if(!ok){
    self->streamMode=false;
    n=0;ok=self->fromRange(self->windows[index],at,n,available);
   }
   if(!ok||!n){self->failed=true;break;}
   self->windowOffsets[index]=at;
   self->windowSizes[index]=n;
   self->produced+=n;
   while(!self->closing&&xQueueSend(self->readyQueue,&index,pdMS_TO_TICKS(100))!=pdTRUE){}
  }
  self->done=true;
  vTaskDelete(nullptr);
 }
 bool start(){
  if(!windows[0]||windowCapacities[0]<MIN_WINDOW)return false;
  open();
  freeQueue=xQueueCreate(windowCount,sizeof(uint8_t));
  readyQueue=xQueueCreate(windowCount,sizeof(uint8_t));
  if(!freeQueue||!readyQueue)return false;
  for(uint8_t i=0;i<windowCount;i++)xQueueSend(freeQueue,&i,0);
  if(xTaskCreate(producer,"jh2-asset-prefetch",4096,this,1,&prefetchTask)==pdPASS)return true;
  vQueueDelete(freeQueue);vQueueDelete(readyQueue);
  freeQueue=readyQueue=nullptr;
  return false;
 }
 bool read(uint8_t*out,size_t n){
  if(!out||!windows[0]||windowCapacities[0]<MIN_WINDOW){
   issue("Insufficient NanoC6 RAM for image relay");return false;
  }
  if(!freeQueue&&!start()){issue("Cannot start streaming prefetch");return false;}
  while(n&&!closing){
   if(offset>=size)return false;
   if(consuming<0||offset>=windowOffsets[consuming]+windowSizes[consuming]){
    if(consuming>=0){
     uint8_t previous=uint8_t(consuming);
     xQueueSend(freeQueue,&previous,pdMS_TO_TICKS(100));
     consuming=-1;
    }
    uint8_t next=0;
    if(xQueueReceive(readyQueue,&next,pdMS_TO_TICKS(12000))!=pdTRUE){
     issue(failed?"Oracle asset download failed":"Oracle asset stream stalled");return false;
    }
    if(windowOffsets[next]!=offset||!windowSizes[next]){
     issue("Oracle stream window ordering mismatch");return false;
    }
    consuming=next;
   }
   const size_t take=std::min(n,size_t(windowOffsets[consuming]+windowSizes[consuming]-offset));
   memcpy(out,windows[consuming]+offset-windowOffsets[consuming],take);
   mbedtls_sha256_update(&hash,out,take);
   out+=take;offset+=take;n-=take;
  }
  return n==0;
 }
 bool complete(){
  uint8_t d[32];mbedtls_sha256_finish(&hash,d);
  verified=hexBytes(d,32)==sha;return verified;
 }
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
    // GATT write-with-response already applies BLE-level backpressure.
    // Yield periodically, not after every single LED protocol fragment.
    if((i&7)==7)vTaskDelay(pdMS_TO_TICKS(1));
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
  auto status=body["status"].to<JsonObject>();status["firmware"]=VERSION;status["build"]=BUILD_SHA;status["uptimeSeconds"]=millis()/1000;status["wifiRSSI"]=WiFi.RSSI();status["wifiIP"]=WiFi.localIP().toString();status["wifiGateway"]=WiFi.gatewayIP().toString();status["autoUpdate"]=state["autoUpdate"]|true;status["relayStreaming"]=streaming;status["assetStorage"]="oracle";status["freeHeap"]=ESP.getFreeHeap();status["flashBytes"]=ESP.getFlashChipSize();
  JsonDocument curtain;curtainCall("status",JsonVariantConst(),curtain);status["curtain"]=curtain.as<JsonVariantConst>();
  xSemaphoreTake(lock,portMAX_DELAY);status["error"]=relayError;size_t ackCount=std::min(acknowledgments.size(),size_t(32));auto aa=body["acks"].to<JsonArray>();for(size_t i=0;i<ackCount;i++){JsonDocument d;deserializeJson(d,acknowledgments[i]);aa.add(d.as<JsonVariantConst>());}xSemaphoreGive(lock);
  // Forward recent notifications for the unchanged native-slot installer.
  curtainNotifications(body["notifications"].to<JsonArray>(),lastNotice);
  if(localUntil&&(int32_t)(localUntil-millis())>0)body["localOverrideUntil"]=int64_t(time(nullptr))*1000+(localUntil-millis());
  String encoded;serializeJson(body,encoded);syncNow=false;
  if(!request("/api/curtain-bridge/sync",response,&encoded)){online=false;vTaskDelay(pdMS_TO_TICKS(backoff));backoff=std::min<uint32_t>(backoff*2,8000);continue;}
  if(response["credential"].is<JsonObjectConst>()){
   String credentialError;if(!relayConfigure(response["credential"].as<JsonVariantConst>(),credentialError)){issue("Credential rotation failed: "+credentialError);online=false;vTaskDelay(pdMS_TO_TICKS(1000));continue;}
  }
  xSemaphoreTake(lock,portMAX_DELAY);for(size_t i=0;i<ackCount&&!acknowledgments.empty();i++)acknowledgments.pop_front();xSemaphoreGive(lock);if(restartAfterAck&&ackCount){restartAfterAck=0;vTaskDelay(pdMS_TO_TICKS(400));ESP.restart();}online=true;backoff=1000;lastSync=millis();nextSync=millis()+5000;revision=response["revision"]|0U;
  // Node replies with Unix time; NTP remains the primary clock. Never step an already-valid clock.
  for(auto n:body["notifications"].as<JsonArrayConst>())lastNotice=std::max(lastNotice,n["id"].as<uint32_t>());
  for(auto cmd:response["commands"].as<JsonArrayConst>()){
   uint64_t id=cmd["id"].as<uint64_t>();if(id<=seen)continue;
   if(localUntil&&(int32_t)(localUntil-millis())>0){
     // Remote APK manual control takes precedence over a recent local web test.
     if(cmd["source"].as<String>()!="manual")break;
     localUntil=0;
    }
   String action=cmd["action"]|String("");JsonDocument result;bool ok=true;
   if(cmd["source"].as<String>()=="manual")streamFailures=0;
   if(action=="asset"||action=="nativePlay"||action=="effect"||action=="sequenceStart"||action=="sequenceStop"||action=="assetStop"||action=="rawWrite"||action=="disconnect"||(action=="power"&&!(cmd["payload"]["on"]|false))){generation++;streaming=false;}
   // Management requests never trigger BLE scans or reveal local authorization secrets.
   const bool adminAction=action.startsWith("nano");
   if(!adminAction&&action!="disconnect"&&action!="scan"&&action!="status")ok=curtainCall("connect",JsonVariantConst(),result);
   if(ok&&action=="nanoInfo"){
    result["firmware"]=VERSION;result["uptimeSeconds"]=millis()/1000;
    result["wifiIP"]=WiFi.localIP().toString();result["wifiGateway"]=WiFi.gatewayIP().toString();
    result["wifiRSSI"]=WiFi.RSSI();result["freeHeap"]=ESP.getFreeHeap();
    result["autoUpdate"]=state["autoUpdate"]|true;result["streaming"]=streaming;
    result["lastSuccessfulSyncAgeSeconds"]=lastSync?(millis()-lastSync)/1000:-1;
    JsonDocument local;curtainCall("status",JsonVariantConst(),local);result["curtain"]=local.as<JsonVariantConst>();
   }else if(ok&&action=="nanoFirmwareCheck"){
    JsonDocument manifest;FirmwareManifest m;String error;
    ok=fetchManifest(manifest)&&parseManifest(manifest.as<JsonVariantConst>(),m,error);
    if(ok){result["current"]=VERSION;result["available"]=m.version;result["newer"]=isNewer(m.version,VERSION);result["signed"]=true;}
    else result["error"]=error.length()?error:lastError;
   }else if(ok&&action=="nanoAutoUpdate"){
    JsonDocument next;next.set(state);next["autoUpdate"]=cmd["payload"]["enabled"].as<bool>();
    ok=saveJson("/state.json",next.as<JsonVariantConst>());if(ok)state.set(next);
    result["autoUpdate"]=state["autoUpdate"]|true;
    if(!ok)result["error"]="NanoC6 could not persist automatic update setting";
   }else if(ok&&action=="nanoResumeOracle"){
    relayLocalOverride(true);result["message"]="Oracle schedule ownership resumed";
   }else if(ok&&action=="nanoReboot"){
    restartAfterAck=id;result["message"]="NanoC6 will reboot after Oracle confirms this ACK";
   }else if(ok&&action=="nanoInstallUpdate"){
    JsonDocument manifest;FirmwareManifest m;String error;
    ok=fetchManifest(manifest)&&parseManifest(manifest.as<JsonVariantConst>(),m,error);
    if(ok&&isNewer(m.version,VERSION)){ok=queueFirmware(manifest.as<JsonVariantConst>(),error);if(ok){restartAfterAck=id;result["version"]=m.version;result["message"]="Verified update queued; rebooting to permanent updater after ACK";}}
    else if(ok){ok=false;error="No newer signed firmware is available";}
    if(!ok)result["error"]=error.length()?error:lastError;
   }else if(ok&&action=="asset"){
    curtainCall("sequenceStop",JsonVariantConst(),result);String sha=cmd["payload"]["sha256"]|String("");uint32_t size=0;for(auto a:response["assets"].as<JsonArrayConst>())if(a["sha256"].as<String>()==sha)size=a["bytes"]|0U;
    if(!size||size>4*1024*1024){ok=false;result["error"]="Oracle asset is missing or exceeds relay limit";}
    else{streamFailed=false;auto*p=new Play{sha,size,generation,id};activeSha=sha;streaming=true;TaskHandle_t task=nullptr;if(xTaskCreate(playback,"jh2-stream",12288,p,1,&task)!=pdPASS){delete p;ok=false;streaming=false;result["error"]="Insufficient RAM to start relay";}else{result["ok"]=true;result["message"]="Oracle program received; waiting for BLE transmission";setResult(id,"downloaded",result.as<JsonVariantConst>());seen=id;break;}}
   }else if(ok&&action=="assetStop"){result["ok"]=true;result["message"]="Oracle streaming stopped; last curtain frame retained";}
   else if(ok)ok=curtainCall(action,cmd["payload"],result);
   result["ok"]=ok;setResult(id,ok?"applied":"failed",result.as<JsonVariantConst>());seen=id;
   // Send each ACK before moving to the next ordered command.
   break;
  }
  if(syncNow){vTaskDelay(pdMS_TO_TICKS(20));continue;}
  const uint32_t pushGraceStart=millis();
  while((int32_t)(millis()-nextSync)<0&&!syncNow){
   // A 200 OK event-stream response is not proof that Nginx/router
   // actually forwarded the wake-up. Give SSE 400 ms, then use the
   // authenticated 1 s change-wait even if pushOnline still says true.
   if(pushOnline&&millis()-pushGraceStart<400){
    vTaskDelay(pdMS_TO_TICKS(20));continue;
   }
   JsonDocument waited;
   if(!request("/api/curtain-bridge/wait?after="+String(revision)+"&seconds=1",waited)){
    // If the wake request fails, force an authenticated full sync rather
    // than declaring the Nano offline while its main connection works.
    syncNow=true;break;
   }
   if(waited["changed"]|false){syncNow=true;break;}
  }
 }
}
void relayBegin(){lock=xSemaphoreCreateMutex();endpoint=secrets["oracleEndpoint"]|String("");token=secrets["oracleBridgeToken"]|String("");bridgeId=secrets["oracleBridgeId"]|String("");xTaskCreate(poller,"jh2-oracle",12288,nullptr,1,nullptr);xTaskCreate(pushEvents,"jh2-push",8192,nullptr,1,nullptr);}
bool relayConfigure(JsonVariantConst in,String&error){
 String base=in["endpoint"]|String(""),key=in["token"]|String(""),id=in["bridgeId"]|String("");
 if(base!="https://150.136.245.51/jason-home-2"||key.length()!=64||id.length()!=16){error="Paste the pairing configuration from Jason Home 2 Settings";return false;}
 JsonDocument next;next.set(secrets);next["oracleEndpoint"]=base;next["oracleBridgeToken"]=key;next["oracleBridgeId"]=id;
 if(!saveJson("/secrets.json",next.as<JsonVariantConst>())){error="Could not save bridge identity";return false;}secrets.set(next);
 xSemaphoreTake(lock,portMAX_DELAY);endpoint=base;token=key;bridgeId=id;xSemaphoreGive(lock);syncNow=true;return true;
}
void relaySyncNow(){syncNow=true;}
void relayPrepareForUpdate(){generation++;streaming=false;syncNow=true;}
void relayLocalOverride(bool resume){localUntil=resume?0:millis()+15*60000;generation++;streaming=false;syncNow=true;}
void relayDescribe(JsonObject out){xSemaphoreTake(lock,portMAX_DELAY);out["configured"]=token.length()==64;out["endpoint"]=endpoint;out["online"]=online;out["error"]=relayError;out["lastCommandId"]=lastCommand;out["lastDelivery"]=lastAck;out["lastSuccessfulSyncAgoSeconds"]=lastSync?(millis()-lastSync)/1000:-1;out["nextPollSeconds"]=lastSync?(std::max<int32_t>(0,int32_t(nextSync-millis()))/1000):0;out["pollSeconds"]=5;out["pushConnected"]=pushOnline;out["commandTransport"]=pushOnline?"oracle-server-push":"https-recovery";out["streaming"]=streaming;out["assetStorage"]="Oracle";out["ramBufferBytes"]=liveBufferBytes;out["ramBufferTargetBytes"]=liveBufferTargetBytes;out["ramBufferWindows"]=liveBufferWindows;out["ramBufferLimitPercent"]=80;out["ramBufferReserveBytes"]=48*1024;out["wakeSignalCount"]=wakeSignals;out["lastWakeAgoSeconds"]=lastWakeAt?(millis()-lastWakeAt)/1000:-1;out["manualOverrideSeconds"]=localUntil?std::max<int32_t>(0,int32_t(localUntil-millis()))/1000:0;out["flashBytes"]=ESP.getFlashChipSize();out["firmwareBytes"]=ESP.getSketchSize();out["freeSketchBytes"]=ESP.getFreeSketchSpace();out["filesystemBytes"]=LittleFS.totalBytes();out["filesystemUsedBytes"]=LittleFS.usedBytes();xSemaphoreGive(lock);}
