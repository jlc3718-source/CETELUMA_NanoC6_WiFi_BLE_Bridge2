#include "Curtain.h"
#include "SmartDawnProtocol.h"
#include <NimBLEDevice.h>
#include <nimconfig.h>
#include "nimble/porting/nimble/include/syscfg/syscfg.h"
// Check the effective host compilation values, not just a build flag.
static_assert(MYNEWT_VAL(MSYS_2_BLOCK_SIZE) >= 512,
  "The NimBLE host is not building with a large-enough receive mbuf");

#include <cstring>
static const char* CURT_SERVICE="00000074-1972-1925-3022-077119514e44";
static const char* CURT_WRITE="01020074-1972-1925-3022-077119514e44";
static const char* CURT_HEART="02020074-1972-1925-3022-077119514e44";
static const char* CURT_NOTIFY="01010074-1972-1925-3022-077119514e44";
static const char* CURT_UPLOAD="27923001-2072-1925-3022-077119514e44";
static NimBLEClient*client=nullptr;
static NimBLERemoteCharacteristic*writer=nullptr,*heart=nullptr,*upload=nullptr,*notify=nullptr;
static SmartDawn::Session session;
static std::vector<int> sequence;
static size_t position=0;
static uint32_t nextEffect=0,interval=60000,lastHeart=0,retryAt=0,noticeNumber=0,lastRaw=0;
// Keep raw GATT notifications in a fixed ring without allocating Strings or
// encoding base64 inside the NimBLE host callback during five-packet catalog reads.
static constexpr size_t NOTICE_SLOTS=48;
struct Notice{uint32_t number=0;uint16_t length=0;uint8_t bytes[512]{};};
static Notice notices[NOTICE_SLOTS];
static size_t noticeHead=0,noticeCount=0;
static volatile uint32_t nativeCatalogPackets=0,nativeProgressIgnored=0,nativeNoticeDrops=0;
static SemaphoreHandle_t noticesLock;
static SemaphoreHandle_t bleLock;
static uint32_t burstPackets=0,burstErrors=0,burstFallbackPackets=0;
static uint8_t burstSinceYield=0;
// Manufacturer image/GIF doodle and dedicated native-file upload only.
// Control opcodes stay on response-acknowledged GATT writes.
static bool imageBurstWrite(NimBLERemoteCharacteristic*ch,const uint8_t*bytes,size_t n){
 if(ch&&ch->canWriteNoResponse()){
  // Use NimBLE write WITHOUT response; paced bursts keep the controller
  // and ESP32 BLE host queue from overflowing during long GIF transfers.
  bool ok=ch->writeValue(bytes,n,false);
  if(!ok){++burstErrors;vTaskDelay(pdMS_TO_TICKS(3));ok=ch->writeValue(bytes,n,false);}
  if(ok){++burstPackets;if(++burstSinceYield>=6){burstSinceYield=0;vTaskDelay(pdMS_TO_TICKS(3));}}
  return ok;
 }
 ++burstFallbackPackets;
 return ch&&ch->canWrite()&&ch->writeValue(bytes,n,true);
}
static bool connected(){return client&&client->isConnected()&&writer;}
static void disconnect(){sequence.clear();writer=heart=upload=notify=nullptr;if(client){client->disconnect();NimBLEDevice::deleteClient(client);client=nullptr;}}
static bool writeFrame(const SmartDawn::Frame&f){return connected()&&writer->writeValue(f.bytes,f.length,true);}
static bool effect(int id){SmartDawn::Frame a,b;return SmartDawn::effectFrames(session,id,a,b)&&writeFrame(a)&&writeFrame(b);}
static void notification(NimBLERemoteCharacteristic*c,uint8_t*data,size_t n,bool){
  (void)c;
  if(!data||!n||n>512){++nativeNoticeDrops;return;}
  // 2630 is unsolicited playback progress, which the catalog and upload
  // collectors never consume. Prioritize 2904 and upload ACKs instead.
  const bool wholeDDP=n>=24&&data[1]==1&&data[2]==0&&data[3]==0&&
    (data[4]==0xf0||data[4]==0xf1)&&data[5]==1;
  const uint16_t op=wholeDDP?(uint16_t(data[10])<<8)|data[11]:0;
  if(op==2630){++nativeProgressIgnored;return;}
  xSemaphoreTake(noticesLock,portMAX_DELAY);
  const size_t pos=(noticeHead+noticeCount)%NOTICE_SLOTS;
  if(noticeCount==NOTICE_SLOTS){noticeHead=(noticeHead+1)%NOTICE_SLOTS;++nativeNoticeDrops;}
  else ++noticeCount;
  Notice&slot=notices[pos];
  slot.number=++noticeNumber;
  slot.length=uint16_t(n);
  memcpy(slot.bytes,data,n);
  if(op==2904)++nativeCatalogPackets;
  xSemaphoreGive(noticesLock);
}
void curtainNotifications(JsonArray a,uint32_t since){
  // Never perform String/base64/JSON allocations while holding the BLE lock.
  uint32_t cursor=since;
  for(size_t sent=0;sent<NOTICE_SLOTS;sent++){
    Notice snapshot;
    bool found=false;
    xSemaphoreTake(noticesLock,portMAX_DELAY);
    for(size_t i=0;i<noticeCount;i++){
      const Notice&candidate=notices[(noticeHead+i)%NOTICE_SLOTS];
      if(candidate.number>cursor){snapshot=candidate;found=true;break;}
    }
    xSemaphoreGive(noticesLock);
    if(!found)break;
    auto record=a.add<JsonObject>();
    record["id"]=snapshot.number;
    record["uuid"]=CURT_NOTIFY;
    record["data"]=to64(snapshot.bytes,snapshot.length);
    cursor=snapshot.number;
  }
}
static bool connect(){
  if(connected())return true;disconnect();auto*scan=NimBLEDevice::getScan();scan->setActiveScan(true);scan->setInterval(80);scan->setWindow(40);auto found=scan->getResults(4500,false);String saved=state["curtainAddress"]|String("");
  const NimBLEAdvertisedDevice*target=nullptr;
  for(int i=0;i<found.getCount();i++){auto*d=found.getDevice(i);String name=d->getName().c_str(),address=d->getAddress().toString().c_str();if(name=="DN5E58"||(saved.length()&&saved.equalsIgnoreCase(address))){target=d;break;}}
  if(!target){scan->clearResults();lastError="DN5E58 not found. Close the phone Bluetooth connection and retry.";return false;}
  client=NimBLEDevice::createClient();if(!client)return false;client->setConnectTimeout(6000);client->setConnectRetries(0);
  bool ok=client->connect(target);String address=target->getAddress().toString().c_str();scan->clearResults();if(!ok){disconnect();lastError="Curtain connection failed";return false;}
  auto*svc=client->getService(CURT_SERVICE);if(!svc){disconnect();lastError="SmartDawn service not found";return false;}
  writer=svc->getCharacteristic(CURT_WRITE);heart=svc->getCharacteristic(CURT_HEART);upload=svc->getCharacteristic(CURT_UPLOAD);notify=svc->getCharacteristic(CURT_NOTIFY);
  if(!writer||!writer->canWrite()){disconnect();return false;}
  if(notify&&notify->canNotify())notify->subscribe(true,notification);session={};state["curtainAddress"]=address;state["curtainAutoConnect"]=true;saveJson("/state.json",state.as<JsonVariantConst>());return true;
}
void curtainBegin(){bleLock=xSemaphoreCreateRecursiveMutex();noticesLock=xSemaphoreCreateMutex();NimBLEDevice::init("JasonHome2-NanoC6");NimBLEDevice::setMTU(517);NimBLEDevice::setPower(3);}
static bool callUnlocked(const String&action,JsonVariantConst in,JsonDocument&out){
  bool ok=true;String message;
  if((action=="effect"||action=="nativePlay"||action=="solid"||action=="rawWrite"||action=="power")&&state["curtainSequence"].is<JsonObject>()){state.remove("curtainSequence");saveJson("/state.json",state.as<JsonVariantConst>());}

  if(action=="status"){out["address"]=state["curtainAddress"];out["name"]="DN5E58";out["burstPackets"]=burstPackets;out["burstErrors"]=burstErrors;out["burstFallbackPackets"]=burstFallbackPackets;out["burstWithoutResponseSupported"]=heart&&heart->canWriteNoResponse();out["nativeCatalogPackets"]=nativeCatalogPackets;out["nativeHostMsys2Bytes"]=MYNEWT_VAL(MSYS_2_BLOCK_SIZE);out["nativeProgressIgnored"]=nativeProgressIgnored;out["nativeNoticeDrops"]=nativeNoticeDrops;out["sequenceRunning"]=!sequence.empty();out["sequenceEffects"].to<JsonArray>();for(int id:sequence)out["sequenceEffects"].add(id);}
  else if(action=="connect")ok=connect();
  else if(action=="disconnect"){state["curtainAutoConnect"]=false;saveJson("/state.json",state.as<JsonVariantConst>());disconnect();}
  else if(action=="scan"){
    auto*scan=NimBLEDevice::getScan();scan->setActiveScan(true);auto found=scan->getResults(4000,false);auto a=out["devices"].to<JsonArray>();for(int i=0;i<found.getCount();i++){auto*d=found.getDevice(i);auto item=a.add<JsonObject>();item["name"]=d->getName().c_str();item["address"]=d->getAddress().toString().c_str();item["rssi"]=d->getRSSI();}scan->clearResults();
  }
  else if(action=="sequenceStop"){sequence.clear();state.remove("curtainSequence");saveJson("/state.json",state.as<JsonVariantConst>());}
  else if(!connected()){ok=false;message="Curtain is disconnected";}
  else if(action=="nativePlay"){
    sequence.clear();uint32_t cid=in["cid"]|0U,slot=in["slot"]|999U;
    uint8_t payload[12];size_t n=0;payload[n++]=8;auto varint=[&](uint32_t v){do{uint8_t b=v&127;v>>=7;payload[n++]=b|(v?128:0);}while(v);};varint(cid);payload[n++]=16;varint(slot);
    SmartDawn::Frame f;ok=cid==83928&&slot<=255&&SmartDawn::commandFrame(session,2606,payload,n,f)&&writeFrame(f);
  }
  else if(action=="solid"){
    sequence.clear();String color=in["color"]|String("");ok=color.length()==7&&color[0]=='#';
    uint32_t rgb=ok?strtoul(color.substring(1).c_str(),nullptr,16):0;
    SmartDawn::Frame f;
    if(ok)ok=SmartDawn::commandFrame(session,2514,nullptr,0,f)&&writeFrame(f)&&SmartDawn::scalarFrame(session,2701,1,f)&&writeFrame(f)&&SmartDawn::commandFrame(session,2713,nullptr,0,f)&&writeFrame(f);
    if(ok&&heart){uint8_t b[30]{};b[0]=session.seq++;b[1]=1;b[2]=0;b[3]=1;b[4]=1;b[5]=rgb>>16;b[6]=rgb>>8;b[7]=rgb;b[8]=0;int n=9,left=1600;while(left){int run=std::min(left,127);b[n++]=0x80|run;left-=run;}ok=heart->writeValue(b,n,heart->canWrite());}
    if(ok){int level=in["brightness"]|100;if(level==0)ok=SmartDawn::commandFrame(session,2515,nullptr,0,f)&&writeFrame(f);else ok=SmartDawn::scalarFrame(session,0x09cd,SmartDawn::rawBrightness(level),f)&&writeFrame(f);}
  }
  else if(action=="rawWrite"){
    sequence.clear();String uuid=in["uuid"]|String("");uuid.toLowerCase();auto*ch=uuid==CURT_WRITE?writer:uuid==CURT_HEART?heart:uuid==CURT_UPLOAD?upload:nullptr;auto b=from64(in["data"]|String(""));
    if(!ch||b.empty()||b.size()>508||b.size()>client->getMTU()-3){ok=false;message="Unsupported curtain UUID or packet exceeds negotiated MTU";}else{lastRaw=millis();ok=(ch==upload||ch==heart)?imageBurstWrite(ch,b.data(),b.size()):ch->writeValue(b.data(),b.size(),true);}
  }else if(action=="subscribeRaw"){String uuid=in["uuid"]|String("");uuid.toLowerCase();ok=uuid==CURT_NOTIFY&&notify&&notify->canNotify()&&notify->subscribe(true,notification);}
  else if(action=="effect"){sequence.clear();ok=effect(in["id"]|-1);}
  else if(action=="power"){sequence.clear();SmartDawn::Frame f;ok=(in["on"].is<bool>()||in["value"].is<bool>())&&SmartDawn::commandFrame(session,(in["on"]|in["value"].as<bool>())?0x09d2:0x09d3,nullptr,0,f)&&writeFrame(f);}
  else if(action=="brightness"||action=="speed"||action=="layout"){
    int v=in["value"]|-1;SmartDawn::Frame f;uint16_t op=action=="brightness"?0x09cd:action=="speed"?0x09db:0x09c6;
    if(action=="brightness"){if(v==0){SmartDawn::Frame f;ok=SmartDawn::commandFrame(session,0x09d3,nullptr,0,f)&&writeFrame(f);out["ok"]=ok;out["connected"]=connected();return ok;}v=SmartDawn::rawBrightness(v);}if(action=="layout"&&v!=0&&v!=4&&v!=5&&v!=6)v=-1;
    ok=v>=0&&v<=255&&SmartDawn::scalarFrame(session,op,v,f)&&writeFrame(f);
  }else if(action=="sequenceStart"){
    std::vector<int>ids;for(auto id:in["effects"].as<JsonArrayConst>()){int n=id.as<int>();if(n<0||n>87){ok=false;break;}ids.push_back(n);}int seconds=in["intervalSeconds"]|60;
    if(!ok||ids.size()<2||ids.size()>88||seconds<5||seconds>3600)ok=false;
    else{ok=effect(ids[0]);if(ok){sequence=ids;position=1;interval=seconds*1000UL;nextEffect=millis()+interval;state["curtainSequence"]=in;saveJson("/state.json",state.as<JsonVariantConst>());}else sequence.clear();}
  }else{ok=false;message="Unknown curtain action";}
  out["sequenceRunning"]=!sequence.empty();out["sequenceCount"]=sequence.size();out["sequenceIntervalSeconds"]=interval/1000;out["ok"]=ok;out["connected"]=connected();out["ready"]=connected();out["mtu"]=client?client->getMTU():23;out["bleTransmitted"]=ok&&action!="status"&&action!="scan";out["physicalPlaybackConfirmed"]=false;out["message"]=ok?"NanoC6 BLE request completed; physical playback is not confirmed":message.length()?message:lastError;out["error"]=ok?String(""):out["message"].as<String>();return ok;
}
static void loopUnlocked(){
  uint32_t now=millis();if(!connected()){
    if((state["curtainAutoConnect"]|false)&&(int32_t)(now-retryAt)>=0){retryAt=now+15000;if(connect()&&state["curtainSequence"].is<JsonObject>()){JsonDocument result;curtainCall("sequenceStart",state["curtainSequence"],result);}}
    return;
  }
  if(!sequence.empty()&&(int32_t)(now-nextEffect)>=0){if(effect(sequence[position++%sequence.size()]))nextEffect=now+interval;else sequence.clear();}
  if(now-lastHeart>=6000&&(!lastRaw||now-lastRaw>15000)){lastHeart=now;if(heart){uint8_t b[4]{};heart->writeValue(b,4,true);}}
}

bool curtainCall(const String&action,JsonVariantConst in,JsonDocument&out){
 // The UI must not hang for the entire BLE 4.5 s scan / 6 s reconnect.
 // Status may return immediately with "busy" while control transfers continue.
 if(xSemaphoreTakeRecursive(bleLock,action=="status"?pdMS_TO_TICKS(15):portMAX_DELAY)!=pdTRUE){
   out["ok"]=true;out["busy"]=true;out["message"]="BLE is reconnecting or transferring; controller remains responsive";
   out["connected"]=false;out["ready"]=false;return true;
 }
 bool ok=callUnlocked(action,in,out);xSemaphoreGiveRecursive(bleLock);return ok;
}
void curtainLoop(){if(xSemaphoreTakeRecursive(bleLock,0)==pdTRUE){loopUnlocked();xSemaphoreGiveRecursive(bleLock);}}
bool curtainRelayWrite(uint8_t channel,const uint8_t*bytes,size_t n){
 xSemaphoreTakeRecursive(bleLock,portMAX_DELAY);
 auto*ch=channel==0?writer:channel==1?heart:nullptr;
 bool ok=connected()&&ch&&client&&bytes&&n>0&&n<=508;
 if(ok){
  const size_t mtu=client->getMTU();
  ok=mtu>=23;
  if(ok&&n<=mtu-3)ok=channel==1?imageBurstWrite(ch,bytes,n):ch->writeValue(bytes,n,true);
  else if(ok){
   // Reframe a complete DDP doodle packet only when the peer negotiated
   // a smaller MTU. The 2026-10-16 native trace used a 126-byte ATT write.
   // Never silently truncate, and preserve packet ID/type/fragment order.
   ok=n>=5&&bytes[1]==1&&bytes[2]==0&&mtu>7;
   if(ok){
    const size_t available=mtu-7,count=(n-4+available-1)/available;
    ok=count<=255;
    for(size_t index=0;ok&&index<count;index++){
     const size_t begin=4+index*available,part=std::min(available,n-begin);
     uint8_t frame[508];frame[0]=bytes[0];frame[1]=(uint8_t)count;
     frame[2]=(uint8_t)(count-index-1);frame[3]=bytes[3];
     memcpy(frame+4,bytes+begin,part);
     ok=channel==1?imageBurstWrite(ch,frame,part+4):ch->writeValue(frame,part+4,true);
    }
   }
  }
 }
 if(ok)lastRaw=millis();
 xSemaphoreGiveRecursive(bleLock);return ok;
}
