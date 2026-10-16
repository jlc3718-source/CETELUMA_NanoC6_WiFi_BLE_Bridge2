#include "OracleRelay.h"
#include "Curtain.h"
#include "FirmwareUpdate.h"
#include <mbedtls/sha256.h>
#include <freertos/task.h>
#include <deque>
#include <WebSocketsClient.h>
#include "Roots.h"
static SemaphoreHandle_t lock;
static String endpoint,token,bridgeId,relayError,lastAck="none",activeSha;
static JsonDocument lastResult;
static std::deque<String> acknowledgments;
static volatile uint32_t generation=0,revision=0,lastSync=0,nextSync=0;
static volatile uint32_t localUntil=0;
static volatile bool syncNow=false,streaming=false,online=false,streamFailed=false,pushOnline=false;
static uint64_t lastCommand=0,seen=0;
static uint8_t streamFailures=0;
static uint64_t restartAfterAck=0;
static String getEndpoint(){xSemaphoreTake(lock,portMAX_DELAY);String s=endpoint;xSemaphoreGive(lock);return s;}
static String digest(const uint8_t*data,size_t size){uint8_t d[32];mbedtls_sha256(data,size,d,0);return hexBytes(d,32);}
static void issue(const String& error){xSemaphoreTake(lock,portMAX_DELAY);relayError=error;xSemaphoreGive(lock);}
struct RelayStream {
 // Oracle is permanent storage; these two adaptively sized RAM windows
 // form a bounded network-producer / BLE-consumer pipeline.
 uint8_t* windows[2]{nullptr,nullptr};
 size_t capacity=0, windowCount=0;
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
 RelayStream(){
  // Protect Wi-Fi, BLE, TLS handshake and FreeRTOS. 80% of heap above a
  // 48 KiB reserve, up to 2 x 35 KiB; shrink before using 4 KiB fallback.
  const size_t freeBytes=ESP.getFreeHeap(),reserve=48*1024;
  size_t each=freeBytes>reserve+8192?
    std::min<size_t>(35*1024,((freeBytes-reserve)*4/5)/2):4096;
  each=std::max<size_t>(4096,(each/1024)*1024);
  for(;each>=4096;each=(each/2/1024)*1024){
   windows[0]=static_cast<uint8_t*>(malloc(each));
   if(windows[0])windows[1]=static_cast<uint8_t*>(malloc(each));
   if(windows[0]&&windows[1]){
    capacity=each;windowCount=2;break;
   }
   if(windows[0])::free(windows[0]);
   if(windows[1])::free(windows[1]);
   windows[0]=windows[1]=nullptr;
   if(each==4096)break;
  }
  if(!windowCount){
   windows[0]=static_cast<uint8_t*>(malloc(4096));
   if(windows[0]){capacity=4096;windowCount=1;}
  }
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
 bool fromStream(uint8_t*dest,uint32_t at,size_t&n){
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
  while(!closing&&n<std::min<size_t>(capacity,8192)){
   const size_t ready=source->available(),want=std::min<size_t>(ready,
    std::min<size_t>(capacity-n,size_t(size-at-n)));
   if(want){
    const int got=source->read(dest+n,want);
    if(got<=0)break;
    n+=got;
   }else if(millis()-first>=6)break;
   else vTaskDelay(pdMS_TO_TICKS(1));
   if(millis()-first>=6)break;
  }
  return n>0;
 }
 bool fromRange(uint8_t*dest,uint32_t at,size_t&n){
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
   // If TLS/BLE needs the heap, release an unused spare window. Never free
   // the window being read or transmitted. The 4 KiB minimum is preserved.
   if(self->windowCount==2&&ESP.getFreeHeap()<36*1024){
    uint8_t spare=0;
    if(xQueueReceive(self->freeQueue,&spare,0)==pdTRUE&&spare!=index){
     ::free(self->windows[spare]);self->windows[spare]=nullptr;
     self->windowCount=1;
    }
   }
   size_t n=0;const uint32_t at=self->produced;
   bool ok=(self->streamMode&&self->fromStream(self->windows[index],at,n));
   if(!ok){
    self->streamMode=false;
    n=0;ok=self->fromRange(self->windows[index],at,n);
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
  if(!windows[0]||capacity<4096)return false;
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
  if(!out||!windows[0]||capacity<4096){
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
static void markSeen(uint64_t id){xSemaphoreTake(lock,portMAX_DELAY);seen=id;xSemaphoreGive(lock);}
static void executeDelivery(JsonDocument&response){
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
    else{streamFailed=false;auto*p=new Play{sha,size,generation,id};activeSha=sha;streaming=true;TaskHandle_t task=nullptr;if(xTaskCreate(playback,"jh2-stream",12288,p,1,&task)!=pdPASS){delete p;ok=false;streaming=false;result["error"]="Insufficient RAM to start relay";}else{result["ok"]=true;result["message"]="Oracle program received; waiting for BLE transmission";setResult(id,"downloaded",result.as<JsonVariantConst>());markSeen(id);break;}}
   }else if(ok&&action=="assetStop"){result["ok"]=true;result["message"]="Oracle streaming stopped; last curtain frame retained";}
   else if(ok)ok=curtainCall(action,cmd["payload"],result);
   result["ok"]=ok;setResult(id,ok?"applied":"failed",result.as<JsonVariantConst>());markSeen(id);
   // Send each ACK before moving to the next ordered command.
   break;
  }
}

static QueueHandle_t commandInbox=nullptr;
static uint64_t submittedCommand=0;
static void commandWorker(void*){
 for(;;){
  JsonDocument*delivery=nullptr;
  if(xQueueReceive(commandInbox,&delivery,pdMS_TO_TICKS(20))==pdTRUE){
   executeDelivery(*delivery);delete delivery;
   xSemaphoreTake(lock,portMAX_DELAY);submittedCommand=0;xSemaphoreGive(lock);
   // Request the next delivery after the worker can accept it. An ACK may
   // otherwise race worker completion and leave the next command waiting.
   syncNow=true;
  }
  // BLE scans, reconnects and GATT heartbeats can block. Keep them in this
  // existing worker, never in the WebServer loop. No extra task/stack needed.
  curtainLoop();
 }
}
static void commandChannel(void*){
 // This task owns the only command socket. BLE work runs in commandWorker,
 // so a reconnect/transfer cannot stop ping, command receipt, or ACK traffic.
 String boot=randomHex(8),headers;WebSocketsClient socket;
 bool inFlight=false,sentRestartAck=false;uint32_t report=0,sentReport=0,sentAt=0;
 size_t sentAckCount=0;uint32_t lastNotice=0,sentLastNotice=0;
 socket.onEvent([&](WStype_t type,uint8_t*payload,size_t length){
  if(type==WStype_DISCONNECTED){pushOnline=false;online=false;inFlight=false;issue("Oracle command channel disconnected; reconnecting");return;}
  if(type==WStype_CONNECTED){pushOnline=true;syncNow=true;inFlight=false;issue("");return;}
  if(type!=WStype_TEXT)return;
  JsonDocument response;
  if(length>16384||deserializeJson(response,payload,length)||response["type"].as<String>()!="delivery"){
   issue("Invalid Oracle command channel message");socket.disconnect();return;
  }
  online=true;lastSync=millis();revision=response["revision"]|0U;issue("");
  if(inFlight&&response["reportId"].as<uint32_t>()==sentReport){
   xSemaphoreTake(lock,portMAX_DELAY);
   for(size_t i=0;i<sentAckCount&&!acknowledgments.empty();i++)acknowledgments.pop_front();
   xSemaphoreGive(lock);inFlight=false;lastNotice=sentLastNotice;
   if(sentRestartAck){vTaskDelay(pdMS_TO_TICKS(300));ESP.restart();}
  }
  if(response["credential"].is<JsonObjectConst>()){
   String error;
   if(!relayConfigure(response["credential"].as<JsonVariantConst>(),error))issue("Credential rotation failed: "+error);
   socket.disconnect();return; // Authenticate the replacement socket with the persisted credential.
  }
  auto commands=response["commands"].as<JsonArrayConst>();
  if(commands.size()){
   uint64_t id=commands[0]["id"].as<uint64_t>();bool accept=false;
   xSemaphoreTake(lock,portMAX_DELAY);
   if(id>seen&&!submittedCommand){submittedCommand=id;accept=true;}
   xSemaphoreGive(lock);
   if(accept){
    auto*delivery=new JsonDocument;delivery->set(response);
    if(xQueueSend(commandInbox,&delivery,0)!=pdTRUE){delete delivery;xSemaphoreTake(lock,portMAX_DELAY);submittedCommand=0;xSemaphoreGive(lock);}
   }
  }
 });
 String configuredKey;
 for(;;){
  if(WiFi.status()!=WL_CONNECTED||!timeValid()){
   if(pushOnline)socket.disconnect();online=false;vTaskDelay(pdMS_TO_TICKS(250));continue;
  }
  String key,base;xSemaphoreTake(lock,portMAX_DELAY);key=token;base=endpoint;xSemaphoreGive(lock);
  if(key.length()!=64||!base.length()){vTaskDelay(pdMS_TO_TICKS(500));continue;}
  if(key!=configuredKey){
   socket.disconnect();configuredKey=key;
   headers="X-JH2-Bridge-Token: "+key+"\r\n";
   socket.beginSslWithCA("150.136.245.51",443,"/jason-home-2/api/curtain-bridge/channel",JH2_ROOTS,"jh2-bridge");
   socket.setExtraHeaders(headers.c_str());socket.setReconnectInterval(1500);
   socket.enableHeartbeat(10000,5000,2);
  }
  socket.loop();
  if(pushOnline){
   if(inFlight&&millis()-sentAt>15000){socket.disconnect();issue("Oracle command receipt timed out; reconnecting");}
   if(!inFlight&&(syncNow||(int32_t)(millis()-nextSync)>=0)){
    syncNow=false;JsonDocument body;body["type"]="state";body["reportId"]=++report;
    body["recoverDesired"]=streamFailed;body["bridgeId"]=bridgeId;body["bootId"]=boot;
    auto status=body["status"].to<JsonObject>();status["firmware"]=VERSION;status["build"]=BUILD_SHA;
    status["uptimeSeconds"]=millis()/1000;status["wifiRSSI"]=WiFi.RSSI();status["wifiIP"]=WiFi.localIP().toString();
    status["wifiGateway"]=WiFi.gatewayIP().toString();status["autoUpdate"]=state["autoUpdate"]|true;
    status["relayStreaming"]=streaming;status["assetStorage"]="oracle";status["freeHeap"]=ESP.getFreeHeap();
    status["largestHeapBlock"]=ESP.getMaxAllocHeap();status["flashBytes"]=ESP.getFlashChipSize();
    status["commandTransport"]="wss-duplex";status["pollSeconds"]=0;status["pushConnected"]=true;
    JsonDocument curtain;curtainCall("status",JsonVariantConst(),curtain);status["curtain"]=curtain.as<JsonVariantConst>();
    xSemaphoreTake(lock,portMAX_DELAY);status["error"]=relayError;
    sentAckCount=std::min(acknowledgments.size(),size_t(32));sentRestartAck=false;
    auto aa=body["acks"].to<JsonArray>();
    for(size_t i=0;i<sentAckCount;i++){
     JsonDocument ack;deserializeJson(ack,acknowledgments[i]);aa.add(ack.as<JsonVariantConst>());
     if(restartAfterAck&&ack["id"].as<uint64_t>()==restartAfterAck)sentRestartAck=true;
    }
    xSemaphoreGive(lock);
    curtainNotifications(body["notifications"].to<JsonArray>(),lastNotice);
    sentLastNotice=lastNotice;for(auto notice:body["notifications"].as<JsonArrayConst>())sentLastNotice=std::max(sentLastNotice,notice["id"].as<uint32_t>());
    if(localUntil&&(int32_t)(localUntil-millis())>0)body["localOverrideUntil"]=int64_t(time(nullptr))*1000+(localUntil-millis());
    String encoded;serializeJson(body,encoded);
    sentReport=report;sentAt=millis();inFlight=socket.sendTXT(encoded);nextSync=millis()+10000;
    if(!inFlight)socket.disconnect();
   }
  }
  vTaskDelay(pdMS_TO_TICKS(10));
 }
}
void relayBegin(){
 lock=xSemaphoreCreateMutex();endpoint=secrets["oracleEndpoint"]|String("");token=secrets["oracleBridgeToken"]|String("");bridgeId=secrets["oracleBridgeId"]|String("");
 commandInbox=xQueueCreate(1,sizeof(JsonDocument*));
 if(!commandInbox||xTaskCreate(commandWorker,"jh2-commands",12288,nullptr,1,nullptr)!=pdPASS){issue("Cannot start BLE command worker; web recovery remains available");return;}
 if(xTaskCreate(commandChannel,"jh2-channel",12288,nullptr,1,nullptr)!=pdPASS)issue("Cannot start Oracle command channel; web recovery remains available");
}
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
void relayDescribe(JsonObject out){xSemaphoreTake(lock,portMAX_DELAY);out["configured"]=token.length()==64;out["endpoint"]=endpoint;out["online"]=online;out["error"]=relayError;out["lastCommandId"]=lastCommand;out["lastDelivery"]=lastAck;out["lastSuccessfulSyncAgoSeconds"]=lastSync?(millis()-lastSync)/1000:-1;out["nextPollSeconds"]=0;out["pollSeconds"]=0;out["pushConnected"]=pushOnline;out["commandTransport"]=pushOnline?"wss-duplex":"reconnecting";out["streaming"]=streaming;out["assetStorage"]="Oracle";out["ramBufferBytes"]=ESP.getFreeHeap()>100*1024?71680:std::max<uint32_t>(8192,ESP.getFreeHeap()>48*1024?(ESP.getFreeHeap()-48*1024)*4/5:4096);out["manualOverrideSeconds"]=localUntil?std::max<int32_t>(0,int32_t(localUntil-millis()))/1000:0;out["flashBytes"]=ESP.getFlashChipSize();out["firmwareBytes"]=ESP.getSketchSize();out["freeSketchBytes"]=ESP.getFreeSketchSpace();out["filesystemBytes"]=LittleFS.totalBytes();out["filesystemUsedBytes"]=LittleFS.usedBytes();xSemaphoreGive(lock);}
