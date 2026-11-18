#include "WledController.h"
#include "BoundedHttpBody.h"
#include <HTTPClient.h>
#include <WiFi.h>

bool WledController::ensureWorker(){
  if(task)return true;
  if((int32_t)(millis()-workerRetryAt)<0)return false;
  workerRetryAt=millis()+5000UL;
  requests=xQueueCreate(1,sizeof(Request));results=xQueueCreate(1,sizeof(Result));
  if(requests&&results&&xTaskCreate(worker,"anderson-wled",6144,this,1,&task)==pdPASS)return true;
  if(requests)vQueueDelete(requests);if(results)vQueueDelete(results);
  requests=results=nullptr;task=nullptr;return false;
}

void WledController::configure(uint8_t slot,bool enabled,const String& host){
  if(slot>1)return;
  slots[slot].configure(enabled&&validWledHost(host.c_str()),host.c_str(),millis());
  peers[slot]=WledPeerInfo{};errors[slot]="";
  if(enabled&&!ensureWorker())errors[slot]="Wi-Fi controller worker unavailable; retrying";
}
void WledController::retry(uint8_t slot){if(slot<2)slots[slot].retry(millis());}
void WledController::setPower(uint8_t slot,bool on){if(slot<2&&slots[slot].enabled)slots[slot].power(on);}
void WledController::setBrightness(uint8_t slot,uint8_t value){if(slot<2&&slots[slot].enabled)slots[slot].brightness(value);}
void WledController::setColor(uint8_t slot,uint32_t rgb){if(slot<2&&slots[slot].enabled)slots[slot].color(rgb);}
bool WledController::connected(uint8_t slot)const{return slot<2&&slots[slot].enabled&&slots[slot].online&&WiFi.status()==WL_CONNECTED;}
WledSlotInfo WledController::slotInfo(uint8_t slot)const{
  WledSlotInfo info;if(slot>1)return info;
  const auto& s=slots[slot];info.enabled=s.enabled;info.host=s.host;info.connected=connected(slot);
  info.name=peers[slot].name;info.version=peers[slot].version;info.pixels=peers[slot].pixels;
  info.error=WiFi.status()!=WL_CONNECTED&&s.enabled?"Nano Wi-Fi disconnected":errors[slot];
  info.attempts=s.attempts;info.failures=s.failures;info.lastSeen=s.lastSeen;info.lastSent=s.lastSent;
  return info;
}

void WledController::transact(const Request& request,Result& result){
  if(WiFi.status()!=WL_CONNECTED){snprintf(result.error,sizeof(result.error),"Nano Wi-Fi disconnected");return;}
  WiFiClient client;HTTPClient http;
  http.setConnectTimeout(500);http.setTimeout(800);http.setReuse(false);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  const char* headers[]={"Transfer-Encoding"};http.collectHeaders(headers,1);
  const String url=String("http://")+request.host+(request.probe?"/json/si":"/json/state");
  if(!http.begin(client,url)){snprintf(result.error,sizeof(result.error),"Could not open WLED connection");return;}
  int code=0;
  if(request.probe)code=http.GET();
  else{
    // The buffer is heap allocated rather than consuming the Wi-Fi task's stack.
    String payload;char* buffer=(char*)malloc(4608);
    if(!buffer){http.end();snprintf(result.error,sizeof(result.error),"Not enough memory for WLED command");return;}
    const bool built=buildWledStateJson(buffer,4608,request.desired,request.segments,request.segmentCount);
    if(built)payload=buffer;free(buffer);
    if(!built||!payload.length()){http.end();snprintf(result.error,sizeof(result.error),"Could not prepare WLED command");return;}
    http.addHeader("Content-Type","application/json");code=http.POST(payload);
  }
  if(code!=200){snprintf(result.error,sizeof(result.error),"WLED request failed (HTTP %d)",code);http.end();return;}
  String body;const size_t limit=request.probe?12288:512;
  bool allocated=body.reserve(request.probe?2048:128);
  const char* error=nullptr;
  const bool chunked=http.header("Transfer-Encoding").equalsIgnoreCase("chunked");
  auto* stream=http.getStreamPtr();
  const bool read=allocated&&stream&&readBoundedHttpBody(*stream,http.getSize(),chunked,limit,
    [&](const uint8_t* data,size_t length){return body.concat((const char*)data,(unsigned int)length);},
    [](){return millis();},[](){vTaskDelay(pdMS_TO_TICKS(2));},800,1800,error);
  http.end();
  if(!read){snprintf(result.error,sizeof(result.error),"%s",error?error:"Could not read WLED response");return;}
  result.ok=request.probe?parseWledPeer(body.c_str(),body.length(),result.peer):parseWledAck(body.c_str(),body.length());
  if(!result.ok)snprintf(result.error,sizeof(result.error),"%s",request.probe?"Address did not return a valid WLED controller":"WLED did not acknowledge the command");
}
void WledController::worker(void* context){
  auto* self=static_cast<WledController*>(context);Request request{};
  for(;;){
    if(xQueueReceive(self->requests,&request,portMAX_DELAY)!=pdTRUE)continue;
    Result result{};result.slot=request.slot;result.probe=request.probe;
    result.generation=request.generation;result.revision=request.revision;
    transact(request,result);xQueueSend(self->results,&result,portMAX_DELAY);
  }
}
void WledController::loop(){
  const uint32_t now=millis();
  if(task&&pending){
    Result result{};
    if(xQueueReceive(results,&result,0)==pdTRUE){
      pending=false;
      if(result.slot<2&&slots[result.slot].accept(result.generation)){
        auto& s=slots[result.slot];
        if(result.ok){if(result.probe)peers[result.slot]=result.peer;s.success(now,result.probe,result.revision);errors[result.slot]="";}
        else{s.failure(now);errors[result.slot]=result.error;}
      }
    }
  }
  const bool wifi=WiFi.status()==WL_CONNECTED;
  if(!wifi){
    if(hadWiFi)for(auto& s:slots)if(s.enabled)s.retry(now);
    hadWiFi=false;return;
  }
  if(!hadWiFi){for(auto& s:slots)if(s.enabled)s.retry(now);hadWiFi=true;}
  if(pending||(!slots[0].enabled&&!slots[1].enabled)||!ensureWorker())return;
  for(uint8_t pass=0;pass<2;pass++){
    const uint8_t slot=(nextSlot+pass)%2;auto& s=slots[slot];
    const bool probe=s.needsProbe(now);
    if(!probe&&!s.needsWrite(now))continue;
    Request request{};request.slot=slot;request.probe=probe;request.generation=s.generation;
    request.revision=s.revision;request.desired=s.desired;
    snprintf(request.host,sizeof(request.host),"%s",s.host);
    request.segmentCount=peers[slot].segmentCount;
    memcpy(request.segments,peers[slot].segments,sizeof(request.segments));
    if(xQueueSend(requests,&request,0)==pdTRUE){pending=true;++s.attempts;nextSlot=(slot+1)%2;}
    break;
  }
}
