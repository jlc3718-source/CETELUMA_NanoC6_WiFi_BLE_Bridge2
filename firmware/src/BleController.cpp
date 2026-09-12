#include "BleController.h"
#include <ArduinoJson.h>
#include <algorithm>
#include <math.h>

static uint8_t r8(uint32_t c){return (c>>16)&0xFF;} static uint8_t g8(uint32_t c){return (c>>8)&0xFF;} static uint8_t b8(uint32_t c){return c&0xFF;}
static uint32_t softwareEffectIntervalMs(uint8_t speedLevel){
  static constexpr uint32_t intervalsMs[5]={2000,1000,500,250,100};
  return intervalsMs[constrain(speedLevel,1,5)-1];
}
static String bytesHex(const uint8_t* data,size_t len){
  if(!data||!len)return "";static const char h[]="0123456789ABCDEF";String out;out.reserve(len*3);
  for(size_t i=0;i<len;i++){if(i)out+=' ';out+=h[data[i]>>4];out+=h[data[i]&0x0F];}return out;
}
static String rgbHex(uint32_t c){char b[8];snprintf(b,sizeof(b),"#%06lX",(unsigned long)(c&0xFFFFFF));return String(b);}

#ifndef MOCK_BLE
BleController* BleController::callbackOwner=nullptr;
#endif

void BleController::begin(AppSettings* settings){
  cfg=settings;startedAt=millis();
#ifdef MOCK_BLE
  slots[0].name="ELK-BLEDDM AB";slots[0].address="MOCK-A";
  slots[1].name="ELK-BLEDDM 06";slots[1].address="MOCK-B";
  for(uint8_t i=0;i<2;i++){auto&d=slots[i].diag;d.connected=true;d.writeWithResponse=true;d.writeWithoutResponse=true;d.responseReadSupported=true;d.responseNotifySupported=true;d.responseSubscribed=true;d.writeCharacteristic="FFF3";d.responseCharacteristic="FFF4";}
#else
  callbackOwner=this;
  NimBLEDevice::init("AndersonHome-Bridge");NimBLEDevice::setPower(3);
  slots[0].address=cfg->bleAddress;slots[0].name=cfg->bleName;
  slots[1].address=cfg->bleAddress2;slots[1].name=cfg->bleName2;
  connectRequests=xQueueCreate(1,sizeof(ConnectRequest));
  connectResults=xQueueCreate(1,sizeof(ConnectResult));
  if(connectRequests&&connectResults){
    if(xTaskCreate(connectionWorker,"anderson-ble",4096,this,1,&connectTask)!=pdPASS)connectTask=nullptr;
  }
  if(!connectTask){
    if(connectRequests)vQueueDelete(connectRequests);
    if(connectResults)vQueueDelete(connectResults);
    connectRequests=nullptr;connectResults=nullptr;
  }
#endif
}

bool BleController::slotConnected(uint8_t i) const{if(i>1)return false;
#ifdef MOCK_BLE
  return slots[i].address.length()>0;
#else
  return slots[i].client && slots[i].client->isConnected() && slots[i].chr;
#endif
}
bool BleController::connected() const{return slotConnected(0)||slotConnected(1);} 
int BleController::connectedCount() const{return (slotConnected(0)?1:0)+(slotConnected(1)?1:0);} 
String BleController::name() const{if(slotConnected(0)&&slotConnected(1))return "2 controllers";if(slotConnected(0))return slots[0].name;if(slotConnected(1))return slots[1].name;return "";}
String BleController::address() const{if(slotConnected(0)&&slotConnected(1))return "MULTI";if(slotConnected(0))return slots[0].address;if(slotConnected(1))return slots[1].address;return "";}
String BleController::protocolName() const{return "ELK-BLEDDM / Lotus Lantern";}
BleSlotInfo BleController::slotInfo(uint8_t i) const{BleSlotInfo x;if(i>1)return x;x.name=slots[i].name;x.address=slots[i].address;x.protocol="ELK-BLEDDM / Lotus Lantern";x.connected=slotConnected(i);return x;}
void BleController::setTarget(uint8_t t){t=t<=2?t:0;if(target==t)return;target=t;activeValid=false;}
bool BleController::slotTargeted(uint8_t i) const{return target==0 || target==i+1;}

std::vector<BleFound> BleController::scan(uint32_t ms){std::vector<BleFound> out;
#ifdef MOCK_BLE
  out.push_back({"ELK-BLEDDM AB","MOCK-A",-42});out.push_back({"ELK-BLEDDM 06","MOCK-B",-47});return out;
#else
  NimBLEScan* sc=NimBLEDevice::getScan();sc->setActiveScan(true);sc->setInterval(80);sc->setWindow(40);NimBLEScanResults results=sc->getResults(ms,false);
  for(int i=0;i<results.getCount();i++){const NimBLEAdvertisedDevice* d=results.getDevice(i);String n=d->getName().c_str();if(!n.length())n="Unnamed BLE";out.push_back({n,String(d->getAddress().toString().c_str()),d->getRSSI()});}
  std::sort(out.begin(),out.end(),[](const BleFound&a,const BleFound&b){return a.rssi>b.rssi;});return out;
#endif
}

bool BleController::connecting() const{
#ifdef MOCK_BLE
  return false;
#else
  return connectPending;
#endif
}

#ifndef MOCK_BLE
// The worker owns a new client until its result is handed back to loop(). It
// never touches slots, settings, themes or a client already used for light output.
void BleController::connectionWorker(void* context){
  auto* self=static_cast<BleController*>(context);ConnectRequest request{};
  for(;;){
    if(xQueueReceive(self->connectRequests,&request,portMAX_DELAY)!=pdTRUE)continue;
    ConnectResult result{nullptr,nullptr,nullptr};
    for(uint8_t type:{BLE_ADDR_PUBLIC,BLE_ADDR_RANDOM}){
      auto* client=NimBLEDevice::createClient();if(!client)break;
      client->setConnectTimeout(3000);client->setConnectRetries(0);
      if(!client->connect(NimBLEAddress(std::string(request.address),type))){NimBLEDevice::deleteClient(client);continue;}
      NimBLERemoteService* svc=client->getService("FFF0");auto* chr=svc?svc->getCharacteristic("FFF3"):nullptr;
      if(!chr){svc=client->getService("FFE5");if(svc)chr=svc->getCharacteristic("FFE9");}
      NimBLERemoteCharacteristic* rx=nullptr;
      if(chr&&svc){
        if(chr->canRead()||chr->canNotify()||chr->canIndicate())rx=chr;
        const auto& chars=svc->getCharacteristics(true);
        for(auto* candidate:chars){
          if(!candidate||candidate==chr)continue;
          if(candidate->canRead()||candidate->canNotify()||candidate->canIndicate()){rx=candidate;break;}
        }
      }
      if(chr&&client->isConnected()){result={client,chr,rx};break;}
      NimBLEDevice::deleteClient(client);
    }
    xQueueSend(self->connectResults,&result,portMAX_DELAY);
  }
}

bool BleController::requestConnection(uint8_t i){
  if(i>1||connectPending||!connectTask||slots[i].address.length()!=17)return false;
  ConnectRequest request{};slots[i].address.toCharArray(request.address,sizeof(request.address));
  disconnectSlot(i);pendingSlot=i;pendingGeneration=slots[i].generation;
  connectPending=xQueueSend(connectRequests,&request,0)==pdTRUE;
  return connectPending;
}

void BleController::notifyCallback(NimBLERemoteCharacteristic* chr,uint8_t* data,size_t length,bool){
  if(callbackOwner)callbackOwner->recordResponse(chr,data,length);
}

void BleController::recordResponse(NimBLERemoteCharacteristic* chr,const uint8_t* data,size_t len){
  if(!data||!len)return;
  for(uint8_t i=0;i<2;i++){
    auto&s=slots[i];if(chr!=s.rx&&chr!=s.chr)continue;auto&d=s.diag;d.lastRxHex=bytesHex(data,len);d.lastResponseAt=millis();d.responseParsed=false;
    if(len>=6&&data[0]==0x7E&&data[1]==0x04&&data[2]==0x04){d.responseParsed=true;bool on=data[3]==0xF0||data[5]==0x01;if(d.requestedPowerKnown)d.powerConfirmed=on==d.requestedPower;}
    else if(len>=7&&data[0]==0x7E&&data[1]==0x07&&data[2]==0x05&&data[3]==0x03){d.responseParsed=true;uint32_t c=((uint32_t)data[4]<<16)|((uint32_t)data[5]<<8)|data[6];if(d.requestedColorKnown)d.colorConfirmed=c==d.requestedColor;}
    else if(len>=4&&data[0]==0x7E&&data[1]==0x04&&data[2]==0x01){d.responseParsed=true;if(d.requestedBrightnessKnown)d.brightnessConfirmed=data[3]==d.requestedBrightness;}
    break;
  }
}

void BleController::updateCharacteristicDiagnostics(uint8_t i){
  if(i>1)return;auto&s=slots[i];auto&d=s.diag;d.connected=slotConnected(i);if(!d.connected)return;
  auto*w=s.chr;auto*r=s.rx?s.rx:s.chr;
  if(w){d.writeCharacteristic=String(w->getUUID().toString().c_str());d.writeWithResponse=w->canWrite();d.writeWithoutResponse=w->canWriteNoResponse();d.writeReadSupported=w->canRead();d.writeNotifySupported=w->canNotify();d.writeIndicateSupported=w->canIndicate();}
  if(r){d.responseCharacteristic=String(r->getUUID().toString().c_str());d.responseReadSupported=r->canRead();d.responseNotifySupported=r->canNotify();d.responseIndicateSupported=r->canIndicate();}
  if(r&&!d.responseSubscribed&&(r->canNotify()||r->canIndicate()))d.responseSubscribed=r->subscribe(r->canNotify(),notifyCallback);
}

void BleController::refreshReadback(uint8_t i){
  if(i>1||!slotConnected(i))return;auto&r=slots[i].rx?slots[i].rx:slots[i].chr;if(!r||!r->canRead())return;
  NimBLEAttValue value=r->readValue();if(value.size())recordResponse(r,value.data(),value.size());
}
#endif

bool BleController::selectAndConnect(const String& addr){String advertisedName;
#ifndef MOCK_BLE
  NimBLEScanResults cached=NimBLEDevice::getScan()->getResults();for(int i=0;i<cached.getCount();i++){const NimBLEAdvertisedDevice* d=cached.getDevice(i);String a=d->getAddress().toString().c_str();if(a.equalsIgnoreCase(addr)){advertisedName=d->getName().c_str();break;}}
#else
  advertisedName=addr=="MOCK-B"?"ELK-BLEDDM 06":"ELK-BLEDDM AB";
#endif
  int slot=-1;for(int i=0;i<2;i++)if(slots[i].address.equalsIgnoreCase(addr))slot=i;for(int i=0;i<2&&slot<0;i++)if(!slots[i].address.length())slot=i;if(slot<0)slot=1;
#ifndef MOCK_BLE
  if(addr.length()!=17)return false;
  if(!connectTask)return false;
  if(NimBLEAddress(std::string(addr.c_str()),BLE_ADDR_PUBLIC).isNull())return false;
#endif
  disconnectSlot(slot);++slots[slot].generation;
  slots[slot].address=addr;slots[slot].name=advertisedName.length()?advertisedName:addr;
  slots[slot].nextConnectAt=millis();slots[slot].diag=BleSlotDiagnostics();saveSlots();activeValid=false;
#ifdef MOCK_BLE
  slots[slot].diag.connected=true;slots[slot].diag.writeWithResponse=true;slots[slot].diag.writeWithoutResponse=true;slots[slot].diag.responseReadSupported=true;slots[slot].diag.responseNotifySupported=true;slots[slot].diag.responseSubscribed=true;slots[slot].diag.writeCharacteristic="FFF3";slots[slot].diag.responseCharacteristic="FFF4";connectionChanged=true;
#endif
  return true;
}

void BleController::saveSlots(){if(!cfg)return;cfg->bleAddress=slots[0].address;cfg->bleProtocol=slots[0].address.length()?4:0;cfg->bleName=slots[0].name;cfg->bleAddress2=slots[1].address;cfg->bleProtocol2=slots[1].address.length()?4:0;cfg->bleName2=slots[1].name;}
void BleController::disconnectSlot(uint8_t i){if(i>1)return;
#ifndef MOCK_BLE
  slots[i].rx=nullptr;slots[i].chr=nullptr;if(slots[i].client){if(slots[i].client->isConnected())slots[i].client->disconnect();NimBLEDevice::deleteClient(slots[i].client);slots[i].client=nullptr;}
#endif
  slots[i].diag.connected=false;slots[i].diag.responseSubscribed=false;
}
bool BleController::removeController(uint8_t i){if(i>1)return false;disconnectSlot(i);++slots[i].generation;slots[i].name="";slots[i].address="";slots[i].diag=BleSlotDiagnostics();saveSlots();activeValid=false;return true;}

bool BleController::writeSlot(uint8_t i,const uint8_t* data,size_t len){if(!slotConnected(i))return false;
  const uint32_t elapsed=(uint32_t)(millis()-lastWrite);if(elapsed<18UL)delay(18UL-elapsed);lastWrite=millis();
  auto&d=slots[i].diag;d.connected=true;d.lastWriteAt=millis();d.lastTxHex=bytesHex(data,len);d.lastWriteOk=false;d.lastWriteAcknowledged=false;d.lastWriteQueued=false;
  if(len>=4&&data[0]==0x7E&&data[1]==0x04&&data[2]==0x04){d.lastCommand=data[3]==0xF0?"Power ON":"Power OFF";d.requestedPowerKnown=true;d.requestedPower=data[3]==0xF0;d.powerConfirmed=false;}
  else if(len>=7&&data[0]==0x7E&&data[1]==0x07&&data[2]==0x05&&data[3]==0x03){d.requestedColorKnown=true;d.requestedColor=((uint32_t)data[4]<<16)|((uint32_t)data[5]<<8)|data[6];d.colorConfirmed=false;d.lastCommand=String("Color ")+rgbHex(d.requestedColor);}
  else if(len>=4&&data[0]==0x7E&&data[1]==0x04&&data[2]==0x01){d.requestedBrightnessKnown=true;d.requestedBrightness=data[3];d.brightnessConfirmed=false;d.lastCommand=String("Brightness ")+String(data[3])+"%";}
  else d.lastCommand="BLE frame";
#ifdef MOCK_BLE
  d.writeWithResponse=true;d.lastWriteOk=true;d.lastWriteAcknowledged=true;d.lastRxHex=d.lastTxHex;d.lastResponseAt=millis();d.responseParsed=true;
  if(len>=4&&data[0]==0x7E&&data[1]==0x04&&data[2]==0x04)d.powerConfirmed=true;
  else if(len>=7&&data[0]==0x7E&&data[1]==0x07&&data[2]==0x05&&data[3]==0x03)d.colorConfirmed=true;
  else if(len>=4&&data[0]==0x7E&&data[1]==0x04&&data[2]==0x01)d.brightnessConfirmed=true;
  return true;
#else
  updateCharacteristicDiagnostics(i);const bool requestAck=slots[i].chr&&slots[i].chr->canWrite();bool ok=slots[i].chr->writeValue(data,len,requestAck);d.lastWriteOk=ok;d.lastWriteAcknowledged=ok&&requestAck;d.lastWriteQueued=ok&&!requestAck;return ok;
#endif
}

BleSlotDiagnostics BleController::slotDiagnostics(uint8_t i,bool refresh){BleSlotDiagnostics empty;if(i>1)return empty;
#ifdef MOCK_BLE
  (void)refresh;slots[i].diag.connected=slotConnected(i);
#else
  updateCharacteristicDiagnostics(i);if(refresh)refreshReadback(i);
#endif
  return slots[i].diag;
}

String BleController::diagnosticsJson(bool refresh){
  JsonDocument doc;doc["protocol"]="ELK-BLEDDM / Lotus Lantern";doc["target"]=target;doc["connectedCount"]=connectedCount();JsonArray arr=doc["controllers"].to<JsonArray>();uint32_t now=millis();
  for(uint8_t i=0;i<2;i++){auto si=slotInfo(i);auto d=slotDiagnostics(i,refresh);JsonObject o=arr.add<JsonObject>();o["slot"]=i;o["label"]=i==0?"Controller A":"Controller B";o["name"]=si.name;o["address"]=si.address;o["connected"]=si.connected;
    o["writeCharacteristic"]=d.writeCharacteristic;o["responseCharacteristic"]=d.responseCharacteristic;o["writeWithResponseSupported"]=d.writeWithResponse;o["writeWithoutResponseSupported"]=d.writeWithoutResponse;o["writeReadSupported"]=d.writeReadSupported;o["writeNotifySupported"]=d.writeNotifySupported;o["writeIndicateSupported"]=d.writeIndicateSupported;o["responseReadSupported"]=d.responseReadSupported;o["responseNotifySupported"]=d.responseNotifySupported;o["responseIndicateSupported"]=d.responseIndicateSupported;o["responseSubscribed"]=d.responseSubscribed;
    o["lastCommand"]=d.lastCommand;o["lastTxHex"]=d.lastTxHex;o["lastRxHex"]=d.lastRxHex;o["lastWriteOk"]=d.lastWriteOk;o["lastWriteAcknowledged"]=d.lastWriteAcknowledged;o["lastWriteQueued"]=d.lastWriteQueued;o["responseParsed"]=d.responseParsed;o["powerConfirmed"]=d.powerConfirmed;o["colorConfirmed"]=d.colorConfirmed;o["brightnessConfirmed"]=d.brightnessConfirmed;o["lastWriteAgeMs"]=d.lastWriteAt?(uint32_t)(now-d.lastWriteAt):0;o["lastResponseAgeMs"]=d.lastResponseAt?(uint32_t)(now-d.lastResponseAt):0;
    if(d.requestedPowerKnown)o["requestedPower"]=d.requestedPower;if(d.requestedColorKnown)o["requestedColor"]=rgbHex(d.requestedColor);if(d.requestedBrightnessKnown)o["requestedBrightness"]=d.requestedBrightness;
    String status="Idle";if(!si.connected)status=si.address.length()?"Saved / reconnecting":"Not configured";else if(d.powerConfirmed||d.colorConfirmed||d.brightnessConfirmed)status="Controller state confirmed";else if(d.lastWriteAcknowledged)status="GATT write acknowledged; state unverified";else if(d.lastWriteQueued)status="Sent without response; state unverified";else if(d.lastWriteAt&&!d.lastWriteOk)status="Last write failed";o["status"]=status;
  }
  String out;serializeJson(doc,out);return out;
}

void BleController::setPower(bool on){for(uint8_t i=0;i<2;i++){if(!slotTargeted(i)||!slotConnected(i))continue;uint8_t f[9]={0x7E,0x04,0x04,(uint8_t)(on?0xF0:0x00),0x00,(uint8_t)(on?0x01:0x00),0xFF,0x00,0xEF};writeSlot(i,f,9);}}
void BleController::setColor(uint32_t c){uint8_t R=r8(c),G=g8(c),B=b8(c);for(uint8_t i=0;i<2;i++){if(!slotTargeted(i)||!slotConnected(i))continue;uint8_t f[9]={0x7E,0x07,0x05,0x03,R,G,B,0x10,0xEF};writeSlot(i,f,9);}}
void BleController::setBrightness(uint8_t B){B=constrain(B,0,100);for(uint8_t i=0;i<2;i++){if(!slotTargeted(i)||!slotConnected(i))continue;uint8_t f[9]={0x7E,0x04,0x01,B,0x00,0x00,0x00,0x00,0xEF};writeSlot(i,f,9);}}

void BleController::applyTheme(const Theme& t,uint8_t bright,uint8_t speedLevel,uint32_t nowMs,bool force){
  bool changed=!activeValid||activeTheme.name!=t.name||activeTheme.effect!=t.effect||activeTheme.colorCount!=t.colorCount||activeBrightness!=bright||activeSpeed!=speedLevel;
  if(!changed)for(uint8_t i=0;i<t.colorCount&&i<8;i++)if(activeTheme.colors[i]!=t.colors[i]){changed=true;break;}
  if(force||changed){activeTheme=t;activeBrightness=bright;activeSpeed=speedLevel;activeValid=true;setPower(true);setBrightness(bright);lastEffect=0;}
  uint8_t count=max((uint8_t)1,t.colorCount);uint32_t interval=softwareEffectIntervalMs(speedLevel);
  if(t.effect==Effect::Solid){if(force||changed)setColor(t.colors[0]);return;}
  if(t.effect==Effect::Jump){if(count==1){if(force||changed)setColor(t.colors[0]);return;}if(!force && nowMs-lastEffect<interval)return;lastEffect=nowMs;uint32_t step=(nowMs/interval)%count;setColor(t.colors[step]);if(force||changed)setBrightness(bright);return;}
  if(t.effect==Effect::Strobe){uint32_t half=max((uint32_t)45,interval/2);if(!force && nowMs-lastEffect<half)return;lastEffect=nowMs;uint32_t phase=nowMs/half;if((phase&1)==0){setColor(0x000000);}else {setColor(t.colors[(phase/2)%count]);}if(force||changed)setBrightness(bright);return;}
  if(t.effect==Effect::Breath){uint32_t frame=max((uint32_t)55,interval/5);if(!force && nowMs-lastEffect<frame)return;lastEffect=nowMs;float cycleMs=(float)(interval*8UL),phase=fmodf((float)nowMs,cycleMs)/cycleMs;int idx=(int)(phase*count)%count,nxt=(idx+1)%count;float local=fmodf(phase*count,1.0f);uint32_t a=t.colors[idx],z=t.colors[nxt];uint8_t R=(uint8_t)(r8(a)+(r8(z)-r8(a))*local),G=(uint8_t)(g8(a)+(g8(z)-g8(a))*local),B=(uint8_t)(b8(a)+(b8(z)-b8(a))*local);uint32_t color=((uint32_t)R<<16)|((uint32_t)G<<8)|B;float wave=0.5f-0.5f*cosf(phase*2.0f*PI);uint8_t level=(uint8_t)max(1.0f,bright*(0.10f+0.90f*wave));setColor(count>1?color:t.colors[0]);setBrightness(level);return;}
}

void BleController::loop(){
#ifndef MOCK_BLE
  if(!connectTask)return;ConnectResult result{};
  if(connectPending&&xQueueReceive(connectResults,&result,0)==pdTRUE){auto& slot=slots[pendingSlot];connectPending=false;if(slot.generation==pendingGeneration&&result.client){slot.client=result.client;slot.chr=result.chr;slot.rx=result.rx;slot.diag=BleSlotDiagnostics();updateCharacteristicDiagnostics(pendingSlot);activeValid=false;connectionChanged=true;}else if(result.client)NimBLEDevice::deleteClient(result.client);if(slot.generation==pendingGeneration){uint32_t now=millis();slot.nextConnectAt=now+((uint32_t)(now-startedAt)<60000UL?5000UL:30000UL);}}
  uint32_t now=millis();for(uint8_t i=0;i<2;i++)if(slotConnected(i))slots[i].nextConnectAt=now;if(connectPending)return;for(uint8_t i=0;i<2;i++){if(slots[i].address.length()&&!slotConnected(i)&&(int32_t)(now-slots[i].nextConnectAt)>=0){if(requestConnection(i))return;slots[i].nextConnectAt=now+30000UL;}}
#endif
}
