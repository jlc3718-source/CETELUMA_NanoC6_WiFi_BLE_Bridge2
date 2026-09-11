#include "BleController.h"
#include <algorithm>
#include <math.h>

static uint8_t r8(uint32_t c){return (c>>16)&0xFF;} static uint8_t g8(uint32_t c){return (c>>8)&0xFF;} static uint8_t b8(uint32_t c){return c&0xFF;}
static uint32_t softwareEffectIntervalMs(uint8_t speedLevel){
  static constexpr uint32_t intervalsMs[5]={2000,1000,500,250,100};
  return intervalsMs[constrain(speedLevel,1,5)-1];
}

void BleController::begin(AppSettings* settings){
  cfg=settings;startedAt=millis();
#ifdef MOCK_BLE
  slots[0].name="ELK-BLEDDM AB";slots[0].address="MOCK-A";
  slots[1].name="ELK-BLEDDM 06";slots[1].address="MOCK-B";
#else
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
    ConnectResult result{nullptr,nullptr};
    for(uint8_t type:{BLE_ADDR_PUBLIC,BLE_ADDR_RANDOM}){
      auto* client=NimBLEDevice::createClient();if(!client)break;
      client->setConnectTimeout(3000);client->setConnectRetries(0);
      if(!client->connect(NimBLEAddress(std::string(request.address),type))){NimBLEDevice::deleteClient(client);continue;}
      auto* svc=client->getService("FFF0");auto* chr=svc?svc->getCharacteristic("FFF3"):nullptr;
      if(!chr){svc=client->getService("FFE5");if(svc)chr=svc->getCharacteristic("FFE9");}
      if(chr&&client->isConnected()){result={client,chr};break;}
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
  slots[slot].nextConnectAt=millis();saveSlots();activeValid=false;
#ifdef MOCK_BLE
  connectionChanged=true;
#endif
  return true;
}

void BleController::saveSlots(){if(!cfg)return;cfg->bleAddress=slots[0].address;cfg->bleProtocol=slots[0].address.length()?4:0;cfg->bleName=slots[0].name;cfg->bleAddress2=slots[1].address;cfg->bleProtocol2=slots[1].address.length()?4:0;cfg->bleName2=slots[1].name;}
void BleController::disconnectSlot(uint8_t i){if(i>1)return;
#ifndef MOCK_BLE
  slots[i].chr=nullptr;if(slots[i].client){if(slots[i].client->isConnected())slots[i].client->disconnect();NimBLEDevice::deleteClient(slots[i].client);slots[i].client=nullptr;}
#endif
}
bool BleController::removeController(uint8_t i){if(i>1)return false;disconnectSlot(i);++slots[i].generation;slots[i].name="";slots[i].address="";saveSlots();activeValid=false;return true;}

bool BleController::writeSlot(uint8_t i,const uint8_t* data,size_t len){if(!slotConnected(i))return false;
  const uint32_t elapsed=(uint32_t)(millis()-lastWrite);
  if(elapsed<18UL)delay(18UL-elapsed);
  lastWrite=millis();
#ifdef MOCK_BLE
  Serial.printf("[MOCK BLE %u] ",i);for(size_t j=0;j<len;j++)Serial.printf("%02X ",data[j]);Serial.println();return true;
#else
  return slots[i].chr->writeValue(data,len,false);
#endif
}

void BleController::setPower(bool on){for(uint8_t i=0;i<2;i++){if(!slotTargeted(i)||!slotConnected(i))continue;uint8_t f[9]={0x7E,0x04,0x04,(uint8_t)(on?0xF0:0x00),0x00,(uint8_t)(on?0x01:0x00),0xFF,0x00,0xEF};writeSlot(i,f,9);}}
void BleController::setColor(uint32_t c){uint8_t R=r8(c),G=g8(c),B=b8(c);for(uint8_t i=0;i<2;i++){if(!slotTargeted(i)||!slotConnected(i))continue;uint8_t f[9]={0x7E,0x07,0x05,0x03,R,G,B,0x10,0xEF};writeSlot(i,f,9);}}
void BleController::setBrightness(uint8_t B){B=constrain(B,0,100);for(uint8_t i=0;i<2;i++){if(!slotTargeted(i)||!slotConnected(i))continue;uint8_t f[9]={0x7E,0x04,0x01,B,0x00,0x00,0x00,0x00,0xEF};writeSlot(i,f,9);}}

void BleController::applyTheme(const Theme& t,uint8_t bright,uint8_t speedLevel,uint32_t nowMs,bool force){
  bool changed=!activeValid||activeTheme.name!=t.name||activeTheme.effect!=t.effect||activeTheme.colorCount!=t.colorCount||activeBrightness!=bright||activeSpeed!=speedLevel;
  if(!changed)for(uint8_t i=0;i<t.colorCount&&i<8;i++)if(activeTheme.colors[i]!=t.colors[i]){changed=true;break;}
  if(force||changed){
    activeTheme=t;activeBrightness=bright;activeSpeed=speedLevel;activeValid=true;setPower(true);setBrightness(bright);lastEffect=0;
  }
  uint8_t count=max((uint8_t)1,t.colorCount);
  // One logical interval is shared by every software-generated effect. The controller only
  // receives color/brightness frames, so it cannot clamp the maximum interval used here.
  uint32_t interval=softwareEffectIntervalMs(speedLevel);

  // Solid / Static: hold the theme's first color continuously with no animation.
  if(t.effect==Effect::Solid){
    if(force||changed)setColor(t.colors[0]);
    return;
  }

  // Jump: discrete color-to-color changes. One color intentionally behaves as a steady color.
  if(t.effect==Effect::Jump){
    if(count==1){if(force||changed)setColor(t.colors[0]);return;}
    if(!force && nowMs-lastEffect<interval)return;
    lastEffect=nowMs;
    uint32_t step=(nowMs/interval)%count;
    setColor(t.colors[step]);
    if(force||changed)setBrightness(bright);
    return;
  }

  // Strobe: each selected interval remains one complete off/on flash.
  if(t.effect==Effect::Strobe){
    uint32_t half=max((uint32_t)45,interval/2);
    if(!force && nowMs-lastEffect<half)return;
    lastEffect=nowMs;
    uint32_t phase=nowMs/half;
    if((phase&1)==0){setColor(0x000000);}
    else {setColor(t.colors[(phase/2)%count]);}
    if(force||changed)setBrightness(bright);
    return;
  }

  // Breath and Gradient use interval-derived frames and an eight-interval fade cycle so neither
  // effect can fall back to a separate fixed speed.
  uint32_t frame=max((uint32_t)55,interval/5);
  if(!force && nowMs-lastEffect<frame)return;
  lastEffect=nowMs;
  float cycleMs=(float)(interval*8UL);
  float phase=fmodf((float)nowMs,cycleMs)/cycleMs;
  int idx=(int)(phase*count)%count;
  int nxt=(idx+1)%count;
  float local=fmodf(phase*count,1.0f);
  uint32_t a=t.colors[idx],z=t.colors[nxt];
  uint8_t R=(uint8_t)(r8(a)+(r8(z)-r8(a))*local);
  uint8_t G=(uint8_t)(g8(a)+(g8(z)-g8(a))*local);
  uint8_t B=(uint8_t)(b8(a)+(b8(z)-b8(a))*local);
  uint32_t color=((uint32_t)R<<16)|((uint32_t)G<<8)|B;

  if(t.effect==Effect::Breath){
    // Switch/blend colors slowly while brightness rises and falls.
    float wave=0.5f-0.5f*cosf(phase*2.0f*PI);
    uint8_t level=(uint8_t)max(1.0f,bright*(0.10f+0.90f*wave));
    setColor(count>1?color:t.colors[0]);
    setBrightness(level);
    return;
  }

  // Gradient: continuously blend through the event/preset colors at the selected speed.
  setColor(color);
  if(force||changed)setBrightness(bright);
}

void BleController::loop(){
#ifndef MOCK_BLE
  if(!connectTask)return;
  ConnectResult result{};
  if(connectPending&&xQueueReceive(connectResults,&result,0)==pdTRUE){
    auto& slot=slots[pendingSlot];connectPending=false;
    if(slot.generation==pendingGeneration&&result.client){
      slot.client=result.client;slot.chr=result.chr;activeValid=false;connectionChanged=true;
    }else if(result.client)NimBLEDevice::deleteClient(result.client);
    if(slot.generation==pendingGeneration){
      uint32_t now=millis();slot.nextConnectAt=now+((uint32_t)(now-startedAt)<60000UL?5000UL:30000UL);
    }
  }
  uint32_t now=millis();
  for(uint8_t i=0;i<2;i++)if(slotConnected(i))slots[i].nextConnectAt=now;
  if(connectPending)return;
  for(uint8_t i=0;i<2;i++){
    if(slots[i].address.length()&&!slotConnected(i)&&(int32_t)(now-slots[i].nextConnectAt)>=0){
      if(requestConnection(i))return;
      slots[i].nextConnectAt=now+30000UL;
    }
  }
#endif
}
