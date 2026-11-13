#include "BleController.h"
#include <algorithm>
#include <math.h>

static uint8_t r8(uint32_t c){return (c>>16)&0xFF;} static uint8_t g8(uint32_t c){return (c>>8)&0xFF;} static uint8_t b8(uint32_t c){return c&0xFF;}
static uint32_t softwareEffectIntervalMs(uint8_t speedLevel){static constexpr uint32_t intervalsMs[5]={2000,1000,500,250,100};return intervalsMs[constrain(speedLevel,1,5)-1];}
static constexpr uint32_t RELIABLE_RETRY_DELAY_MS=100UL;
static constexpr uint32_t STATIC_REASSERT_INTERVAL_MS=30000UL;
static constexpr uint32_t CONTROL_REASSERT_INTERVAL_MS=30000UL;
static uint32_t failureRetryMs(uint8_t failures){uint8_t shift=failures>1?min((uint8_t)4,(uint8_t)(failures-1)):0;uint32_t wait=250UL<<shift;return min(wait,5000UL);}

void BleController::begin(AppSettings* settings){
  cfg=settings;startedAt=millis();
#ifdef MOCK_BLE
  slots[0].name="ELK-BLEDDM AB";slots[0].address="MOCK-A";slots[1].name="ELK-BLEDDM 06";slots[1].address="MOCK-B";
#else
  NimBLEDevice::init("AndersonHome-Bridge");NimBLEDevice::setPower(3);slots[0].address=cfg->bleAddress;slots[0].name=cfg->bleName;slots[1].address=cfg->bleAddress2;slots[1].name=cfg->bleName2;
  connectRequests=xQueueCreate(1,sizeof(ConnectRequest));connectResults=xQueueCreate(1,sizeof(ConnectResult));
  if(connectRequests&&connectResults&&xTaskCreate(connectionWorker,"anderson-ble",4096,this,1,&connectTask)!=pdPASS)connectTask=nullptr;
  if(!connectTask){if(connectRequests)vQueueDelete(connectRequests);if(connectResults)vQueueDelete(connectResults);connectRequests=nullptr;connectResults=nullptr;}
#endif
}

bool BleController::slotConnected(uint8_t i) const{if(i>1)return false;
#ifdef MOCK_BLE
  return slots[i].address.length()>0;
#else
  return slots[i].client&&slots[i].client->isConnected()&&slots[i].chr;
#endif
}
bool BleController::connected() const{return slotConnected(0)||slotConnected(1);} int BleController::connectedCount() const{return (slotConnected(0)?1:0)+(slotConnected(1)?1:0);}
String BleController::name() const{if(slotConnected(0)&&slotConnected(1))return "2 controllers";if(slotConnected(0))return slots[0].name;if(slotConnected(1))return slots[1].name;return "";}
String BleController::address() const{if(slotConnected(0)&&slotConnected(1))return "MULTI";if(slotConnected(0))return slots[0].address;if(slotConnected(1))return slots[1].address;return "";}
String BleController::protocolName() const{return "ELK-BLEDDM / Lotus Lantern";}
BleSlotInfo BleController::slotInfo(uint8_t i) const{BleSlotInfo x;if(i>1)return x;x.name=slots[i].name;x.address=slots[i].address;x.protocol=protocolName();x.connected=slotConnected(i);x.attempts=slots[i].connectionAttempts;x.failures=slots[i].connectionFailures;x.scanPerformed=lastScanAt!=0;x.seenInLastScan=slots[i].seenLastScan;x.lastFailure=slots[i].lastFailure==1?"BLE link failed":slots[i].lastFailure==2?"Light GATT service unavailable":String("");x.lastLinkError=slots[i].lastLinkError;x.lastServices=slots[i].lastServices;x.observedAddressType=slots[i].hasObservedAddressType?(int)slots[i].observedAddressType:-1;return x;}
void BleController::clearPending(uint8_t i){if(i>1)return;slots[i].power=PendingFrame();slots[i].brightness=PendingFrame();slots[i].color=PendingFrame();++slots[i].commandGeneration;}
void BleController::clearAllPending(){clearPending(0);clearPending(1);}
void BleController::setTarget(uint8_t t){t=t<=2?t:0;if(target==t)return;target=t;clearAllPending();activeValid=false;}
bool BleController::slotTargeted(uint8_t i) const{return target==0||target==i+1;}

std::vector<BleFound> BleController::scan(uint32_t ms){std::vector<BleFound> out;
#ifdef MOCK_BLE
  out.push_back({"ELK-BLEDDM AB","MOCK-A",-42});out.push_back({"ELK-BLEDDM 06","MOCK-B",-47});return out;
#else
  NimBLEScan* sc=NimBLEDevice::getScan();sc->setActiveScan(true);sc->setInterval(80);sc->setWindow(80);NimBLEScanResults results=sc->getResults(ms,false);
  for(int i=0;i<results.getCount();i++){const NimBLEAdvertisedDevice* d=results.getDevice(i);String n=d->getName().c_str();if(!n.length())n="Unnamed BLE";out.push_back({n,String(d->getAddress().toString().c_str()),d->getRSSI(),d->getAddress().getType(),d->isConnectable()});}
  std::sort(out.begin(),out.end(),[](const BleFound&a,const BleFound&b){return a.rssi>b.rssi;});return out;
#endif
}
bool BleController::startScan(uint32_t ms){if(asyncScanBusy||scanQueued)return false;asyncScanMs=constrain(ms,250UL,10000UL);asyncScanReady=false;
#ifndef MOCK_BLE
  if(connecting()){scanQueued=true;return true;}
#endif
  asyncScanBusy=true;
#ifdef MOCK_BLE
  asyncScanResults=scan(asyncScanMs);asyncScanReady=true;asyncScanBusy=false;return true;
#else
  if(xTaskCreate(scanWorker,"anderson-scan",4096,this,1,&scanTask)!=pdPASS){scanTask=nullptr;asyncScanBusy=false;return false;}return true;
#endif
}
bool BleController::consumeScanResults(std::vector<BleFound>& out){if(asyncScanBusy||!asyncScanReady)return false;out=asyncScanResults;asyncScanReady=false;lastScanAt=millis();lastScanDeviceCount=out.size();for(auto& slot:slots){slot.seenLastScan=false;slot.hasObservedAddressType=false;for(const auto& device:out)if(slot.address.length()&&slot.address.equalsIgnoreCase(device.address)){slot.seenLastScan=true;slot.observedAddressType=device.addressType;slot.hasObservedAddressType=true;break;}}return true;}
bool BleController::connecting() const{
#ifdef MOCK_BLE
  return false;
#else
  return connectPending;
#endif
}

#ifndef MOCK_BLE
void BleController::scanWorker(void* context){auto* self=static_cast<BleController*>(context);auto found=self->scan(self->asyncScanMs);self->asyncScanResults=found;self->asyncScanReady=true;self->asyncScanBusy=false;self->scanTask=nullptr;vTaskDelete(nullptr);}
void BleController::connectionWorker(void* context){auto* self=static_cast<BleController*>(context);ConnectRequest request{};
  for(;;){if(xQueueReceive(self->connectRequests,&request,portMAX_DELAY)!=pdTRUE)continue;
    ConnectResult result{nullptr,nullptr,1,0};
    for(uint8_t attempt=0;attempt<2;attempt++){
      uint8_t type=request.hasPreferredType?(attempt==0?request.preferredType:(uint8_t)(request.preferredType==BLE_ADDR_RANDOM?BLE_ADDR_PUBLIC:BLE_ADDR_RANDOM)):(attempt==0?BLE_ADDR_PUBLIC:BLE_ADDR_RANDOM);
      auto* client=NimBLEDevice::createClient();if(!client)break;
      client->setConnectTimeout(5000);client->setConnectRetries(0);
      if(!client->connect(NimBLEAddress(std::string(request.address),type))){result.linkError=client->getLastError();NimBLEDevice::deleteClient(client);continue;}
      NimBLERemoteService* svc=client->getService("FFF0");auto* chr=svc?svc->getCharacteristic("FFF3"):nullptr;
      if(!chr){svc=client->getService("FFE0");if(svc)chr=svc->getCharacteristic("FFE1");}
      if(!chr){svc=client->getService("FFE5");if(svc)chr=svc->getCharacteristic("FFE9");}
      if(chr&&client->isConnected()){result.client=client;result.chr=chr;result.failureReason=0;result.linkError=0;break;}
      result.failureReason=2;result.linkError=client->getLastError();
      String serviceList;
      if(client->isConnected()){
        const auto& services=client->getServices(true);
        for(const auto* service:services){
          if(!service)continue;
          if(serviceList.length())serviceList+=", ";
          serviceList+=service->getUUID().toString().c_str();
          if(serviceList.length()>70)break;
        }
      }
      if(!serviceList.length())serviceList="No services returned";
      serviceList.toCharArray(result.serviceUuids,sizeof(result.serviceUuids));
      NimBLEDevice::deleteClient(client);
    }
    xQueueSend(self->connectResults,&result,portMAX_DELAY);
  }
}
bool BleController::requestConnection(uint8_t i){if(i>1||connectPending||asyncScanBusy||!connectTask||slots[i].address.length()!=17)return false;ConnectRequest request{};slots[i].address.toCharArray(request.address,sizeof(request.address));request.hasPreferredType=slots[i].hasObservedAddressType&&(slots[i].observedAddressType==BLE_ADDR_PUBLIC||slots[i].observedAddressType==BLE_ADDR_RANDOM);request.preferredType=slots[i].observedAddressType;disconnectSlot(i);pendingSlot=i;pendingGeneration=slots[i].generation;connectPending=xQueueSend(connectRequests,&request,0)==pdTRUE;if(connectPending)++slots[i].connectionAttempts;return connectPending;}
#endif

bool BleController::selectAndConnect(const String& addr){String advertisedName;
#ifndef MOCK_BLE
  NimBLEScanResults cached=NimBLEDevice::getScan()->getResults();for(int i=0;i<cached.getCount();i++){const NimBLEAdvertisedDevice* d=cached.getDevice(i);String a=d->getAddress().toString().c_str();if(a.equalsIgnoreCase(addr)){advertisedName=d->getName().c_str();break;}}
#else
  advertisedName=addr=="MOCK-B"?"ELK-BLEDDM 06":"ELK-BLEDDM AB";
#endif
  int slot=-1;for(int i=0;i<2;i++)if(slots[i].address.equalsIgnoreCase(addr))slot=i;for(int i=0;i<2&&slot<0;i++)if(!slots[i].address.length())slot=i;if(slot<0)slot=1;
#ifndef MOCK_BLE
  if(addr.length()!=17||!connectTask||NimBLEAddress(std::string(addr.c_str()),BLE_ADDR_PUBLIC).isNull())return false;
#endif
  disconnectSlot(slot);++slots[slot].generation;slots[slot].address=addr;slots[slot].name=advertisedName.length()?advertisedName:addr;slots[slot].nextConnectAt=millis();clearPending(slot);saveSlots();activeValid=false;
#ifdef MOCK_BLE
  connectionChanged=true;
#endif
  return true;
}
void BleController::saveSlots(){if(!cfg)return;cfg->bleAddress=slots[0].address;cfg->bleProtocol=slots[0].address.length()?4:0;cfg->bleName=slots[0].name;cfg->bleAddress2=slots[1].address;cfg->bleProtocol2=slots[1].address.length()?4:0;cfg->bleName2=slots[1].name;}
void BleController::disconnectSlot(uint8_t i){if(i>1)return;clearPending(i);
#ifndef MOCK_BLE
  slots[i].chr=nullptr;if(slots[i].client){if(slots[i].client->isConnected())slots[i].client->disconnect();NimBLEDevice::deleteClient(slots[i].client);slots[i].client=nullptr;}
#endif
}
bool BleController::removeController(uint8_t i){if(i>1)return false;disconnectSlot(i);++slots[i].generation;slots[i].name="";slots[i].address="";saveSlots();activeValid=false;return true;}
bool BleController::renameController(uint8_t i,const String& requestedName){if(i>1||!slots[i].address.length())return false;String clean=requestedName;clean.trim();if(!clean.length())return false;if(clean.length()>32)clean=clean.substring(0,32);slots[i].name=clean;saveSlots();return true;}

bool BleController::writeSlot(uint8_t i,const uint8_t* data,size_t len){if(!slotConnected(i))return false;
#ifdef MOCK_BLE
  (void)data;(void)len;return true;
#else
  auto* chr=slots[i].chr;if(!chr)return false;const bool canNoResponse=chr->canWriteNoResponse(),canResponse=chr->canWrite();if(!canNoResponse&&!canResponse)return false;const bool requestAck=!canNoResponse;return chr->writeValue(data,len,requestAck);
#endif
}
void BleController::enqueueFrame(uint8_t i,PendingFrame& p,const uint8_t* data,size_t len,bool reliable){if(i>1||!data||!len||len>sizeof(p.data))return;memcpy(p.data,data,len);p.len=(uint8_t)len;p.sendsRemaining=reliable?2:1;p.failures=0;p.dueAt=millis();p.generation=++slots[i].commandGeneration;p.pending=true;}
void BleController::enqueueToTargets(uint8_t kind,const uint8_t* data,size_t len,bool reliable){for(uint8_t i=0;i<2;i++){if(!slotTargeted(i)||!slotConnected(i))continue;PendingFrame* p=kind==0?&slots[i].power:(kind==1?&slots[i].brightness:&slots[i].color);enqueueFrame(i,*p,data,len,reliable);}}
void BleController::servicePendingWrites(uint32_t now){bool serviced=false;for(uint8_t pass=0;pass<2;pass++){uint8_t i=(uint8_t)((nextServiceSlot+pass)%2);if(!slotConnected(i)){clearPending(i);continue;}PendingFrame* choices[3]={&slots[i].power,&slots[i].brightness,&slots[i].color};for(auto* p:choices){if(!p->pending||(int32_t)(now-p->dueAt)<0)continue;uint32_t generation=p->generation;bool ok=writeSlot(i,p->data,p->len);if(!p->pending||p->generation!=generation)break;if(ok){p->failures=0;if(p->sendsRemaining>0)--p->sendsRemaining;if(!p->sendsRemaining)p->pending=false;else p->dueAt=millis()+RELIABLE_RETRY_DELAY_MS;}else{if(p->failures<255)++p->failures;p->dueAt=millis()+failureRetryMs(p->failures);}serviced=true;break;}}if(serviced)nextServiceSlot=(uint8_t)((nextServiceSlot+1)%2);}

void BleController::setPower(bool on){
  if(!on){for(uint8_t i=0;i<2;i++)if(slotTargeted(i))clearPending(i);activeValid=false;}
  uint8_t f[9]={0x7E,0x04,0x04,(uint8_t)(on?0xF0:0x00),0x00,(uint8_t)(on?0x01:0x00),0xFF,0x00,0xEF};enqueueToTargets(0,f,9,true);
}
void BleController::setColor(uint32_t c,bool reliable){uint8_t f[9]={0x7E,0x07,0x05,0x03,r8(c),g8(c),b8(c),0x10,0xEF};enqueueToTargets(2,f,9,reliable);}
void BleController::setBrightness(uint8_t B,bool reliable){B=constrain(B,0,100);uint8_t f[9]={0x7E,0x04,0x01,B,0x00,0x00,0x00,0x00,0xEF};enqueueToTargets(1,f,9,reliable);}

void BleController::applyTheme(const Theme& t,uint8_t bright,uint8_t speedLevel,uint32_t nowMs,bool force){
  const Theme& syncTheme=t;
  bool changed=!activeValid||activeTheme.name!=syncTheme.name||activeTheme.effect!=syncTheme.effect||activeTheme.colorCount!=syncTheme.colorCount||activeBrightness!=bright||activeSpeed!=speedLevel;if(!changed)for(uint8_t i=0;i<syncTheme.colorCount&&i<8;i++)if(activeTheme.colors[i]!=syncTheme.colors[i]){changed=true;break;}
  const bool starting=force||changed;if(starting){activeTheme=syncTheme;activeBrightness=bright;activeSpeed=speedLevel;activeValid=true;setPower(true);setBrightness(bright,true);lastEffect=0;lastStaticReassert=nowMs;lastControlReassert=nowMs;}
  uint8_t count=max((uint8_t)1,syncTheme.colorCount);uint32_t interval=softwareEffectIntervalMs(speedLevel);
  if(syncTheme.effect==Effect::Solid){bool periodic=!starting&&(uint32_t)(nowMs-lastStaticReassert)>=STATIC_REASSERT_INTERVAL_MS;if(starting||periodic){if(periodic){setPower(true);setBrightness(bright,true);}setColor(syncTheme.colors[0],true);lastStaticReassert=nowMs;}return;}
  if(syncTheme.effect==Effect::Jump&&count==1){bool periodic=!starting&&(uint32_t)(nowMs-lastStaticReassert)>=STATIC_REASSERT_INTERVAL_MS;if(starting||periodic){if(periodic){setPower(true);setBrightness(bright,true);}setColor(syncTheme.colors[0],true);lastStaticReassert=nowMs;}return;}
  if(!starting&&(uint32_t)(nowMs-lastControlReassert)>=CONTROL_REASSERT_INTERVAL_MS){setPower(true);if(syncTheme.effect!=Effect::Breath)setBrightness(bright,true);lastControlReassert=nowMs;}
  if(syncTheme.effect==Effect::Jump){if(!force&&nowMs-lastEffect<interval)return;lastEffect=nowMs;uint32_t step=(nowMs/interval)%count;setColor(syncTheme.colors[step],true);return;}
  if(syncTheme.effect==Effect::Strobe){uint32_t half=max((uint32_t)45,interval/2);if(!force&&nowMs-lastEffect<half)return;lastEffect=nowMs;uint32_t phase=nowMs/half;if((phase&1)==0)setColor(0x000000,true);else setColor(syncTheme.colors[(phase/2)%count],true);return;}
  if(syncTheme.effect==Effect::Breath){uint32_t frame=max((uint32_t)55,interval/5);if(!force&&nowMs-lastEffect<frame)return;lastEffect=nowMs;float cycleMs=(float)(interval*8UL),phase=fmodf((float)nowMs,cycleMs)/cycleMs;int idx=(int)(phase*count)%count,nxt=(idx+1)%count;float local=fmodf(phase*count,1.0f);uint32_t a=syncTheme.colors[idx],z=syncTheme.colors[nxt];uint8_t R=(uint8_t)(r8(a)+(r8(z)-r8(a))*local),G=(uint8_t)(g8(a)+(g8(z)-g8(a))*local),B=(uint8_t)(b8(a)+(b8(z)-b8(a))*local);uint32_t color=((uint32_t)R<<16)|((uint32_t)G<<8)|B;float wave=0.5f-0.5f*cosf(phase*2.0f*PI);uint8_t level=(uint8_t)max(1.0f,bright*(0.10f+0.90f*wave));setColor(count>1?color:syncTheme.colors[0],starting);setBrightness(level,false);return;}
}

void BleController::loop(){
#ifndef MOCK_BLE
  if(automaticScan&&!asyncScanBusy&&asyncScanReady){std::vector<BleFound> observed;consumeScanResults(observed);automaticScan=false;}
  if(connectTask&&!asyncScanBusy){ConnectResult result{};if(connectPending&&xQueueReceive(connectResults,&result,0)==pdTRUE){auto& slot=slots[pendingSlot];connectPending=false;if(slot.generation==pendingGeneration&&result.client){slot.client=result.client;slot.chr=result.chr;slot.lastFailure=0;slot.lastLinkError=0;slot.lastServices="";clearPending(pendingSlot);activeValid=false;connectionChanged=true;}else{if(result.client)NimBLEDevice::deleteClient(result.client);if(slot.generation==pendingGeneration){++slot.connectionFailures;slot.lastFailure=result.failureReason;slot.lastLinkError=result.linkError;if(result.failureReason==2)slot.lastServices=result.serviceUuids;}}if(slot.generation==pendingGeneration){uint32_t n=millis();slot.nextConnectAt=n+((uint32_t)(n-startedAt)<60000UL?5000UL:12000UL);}}uint32_t n=millis();
    for(uint8_t i=0;i<2;i++)if(slotConnected(i))slots[i].nextConnectAt=n;
    if(!connectPending&&scanQueued){scanQueued=false;startScan(asyncScanMs);}
    if(!connectPending&&!asyncScanBusy&&!scanQueued&&!asyncScanReady&&connectedCount()==0
       &&(slots[0].address.length()||slots[1].address.length())
       &&(slots[0].connectionFailures+slots[1].connectionFailures)>=3
       &&(lastAutoScanAt==0?(uint32_t)(n-startedAt)>=60000UL:(uint32_t)(n-lastAutoScanAt)>=90000UL)){
      if(startScan(6500)){automaticScan=true;lastAutoScanAt=n;}
    }
    if(!connectPending&&!asyncScanBusy&&!scanQueued)for(uint8_t i=0;i<2;i++){
      if(slots[i].address.length()&&!slotConnected(i)&&(int32_t)(n-slots[i].nextConnectAt)>=0){
        if(requestConnection(i))break;slots[i].nextConnectAt=n+30000UL;
      }
    }
  }
#endif
  servicePendingWrites(millis());
}
