#include "BleController.h"
#include <math.h>

static uint8_t r8(uint32_t c){return (c>>16)&0xFF;} static uint8_t g8(uint32_t c){return (c>>8)&0xFF;} static uint8_t b8(uint32_t c){return c&0xFF;}
static uint32_t hsv(float h,float s,float v){h=fmodf(h,360.0f);if(h<0)h+=360.0f;float c=v*s,x=c*(1.0f-fabsf(fmodf(h/60.0f,2.0f)-1.0f)),m=v-c,r=0,g=0,b=0;if(h<60){r=c;g=x;}else if(h<120){r=x;g=c;}else if(h<180){g=c;b=x;}else if(h<240){g=x;b=c;}else if(h<300){r=x;b=c;}else{r=c;b=x;}return ((uint32_t)((r+m)*255)<<16)|((uint32_t)((g+m)*255)<<8)|(uint32_t)((b+m)*255);}

String BleController::protocolLabel(uint8_t p) const{if(p==1)return "LEDBLE A";if(p==2)return "RGBIC B";if(p==3)return "RGBIC B shifted";if(p==4)return "ELK-BLEDDM / Lotus Lantern";return "Auto";}
uint8_t BleController::detectProtocol(const String& n) const{String u=n;u.toUpperCase();if(u.startsWith("ELK-BLEDDM")||u.startsWith("ELK-BLEDOM")||u.startsWith("ELK-"))return 4;if(u.startsWith("LEDCAR-02")||u.startsWith("LEDDMX-02")||u.startsWith("LEDDMX-04"))return 3;if(u.startsWith("LEDCAR-01")||u.startsWith("LEDDMX"))return 2;return 1;}

void BleController::begin(AppSettings* settings){
  cfg=settings;
#ifdef MOCK_BLE
  slots[0].name="ELK-BLEDDM AB";slots[0].address="MOCK-A";slots[0].protocol=4;
  slots[1].name="ELK-BLEDDM 06";slots[1].address="MOCK-B";slots[1].protocol=4;
#else
  NimBLEDevice::init("AndersonHome-Bridge");NimBLEDevice::setPower(3);
  if(cfg->bleAddress.length()) connectSlot(0,cfg->bleAddress,cfg->bleProtocol);
  if(cfg->bleAddress2.length()) connectSlot(1,cfg->bleAddress2,cfg->bleProtocol2);
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
String BleController::protocolName() const{if(slots[0].address.length()&&slots[1].address.length()){if(slots[0].protocol==slots[1].protocol)return protocolLabel(slots[0].protocol);return "Mixed";}if(slots[0].address.length())return protocolLabel(slots[0].protocol);if(slots[1].address.length())return protocolLabel(slots[1].protocol);return "Auto";}
BleSlotInfo BleController::slotInfo(uint8_t i) const{BleSlotInfo x;if(i>1)return x;x.name=slots[i].name;x.address=slots[i].address;x.protocol=protocolLabel(slots[i].protocol);x.connected=slotConnected(i);return x;}
void BleController::setTarget(uint8_t t){target=t<=2?t:0;activeValid=false;}
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

bool BleController::connectSlot(uint8_t i,const String& addr,uint8_t p,const String& advertisedName){if(i>1)return false;
#ifdef MOCK_BLE
  slots[i].address=addr;slots[i].name=advertisedName.length()?advertisedName:(i?"ELK-BLEDDM 06":"ELK-BLEDDM AB");slots[i].protocol=p?p:4;return true;
#else
  disconnectSlot(i);
  uint8_t selected=p;if(selected==0 && advertisedName.length())selected=detectProtocol(advertisedName);
  auto tryConnect=[&](uint8_t addressType)->bool{NimBLEAddress a(std::string(addr.c_str()),addressType);slots[i].client=NimBLEDevice::createClient();if(!slots[i].client->connect(a)){NimBLEDevice::deleteClient(slots[i].client);slots[i].client=nullptr;return false;}return true;};
  if(!tryConnect(BLE_ADDR_PUBLIC)&&!tryConnect(BLE_ADDR_RANDOM))return false;
  NimBLERemoteService* svc=nullptr;NimBLERemoteCharacteristic* chr=nullptr;
  if(selected==4){svc=slots[i].client->getService("FFF0");if(svc)chr=svc->getCharacteristic("FFF3");if(!chr){svc=slots[i].client->getService("FFE5");if(svc)chr=svc->getCharacteristic("FFE9");}}
  else {svc=slots[i].client->getService("FFE0");if(svc)chr=svc->getCharacteristic("FFE1");}
  if(!svc||!chr){disconnectSlot(i);return false;}
  slots[i].chr=chr;slots[i].address=addr;slots[i].protocol=selected?selected:1;slots[i].name=advertisedName.length()?advertisedName:addr;return true;
#endif
}

bool BleController::selectAndConnect(const String& addr,uint8_t p){String advertisedName;
#ifndef MOCK_BLE
  NimBLEScanResults cached=NimBLEDevice::getScan()->getResults();for(int i=0;i<cached.getCount();i++){const NimBLEAdvertisedDevice* d=cached.getDevice(i);String a=d->getAddress().toString().c_str();if(a.equalsIgnoreCase(addr)){advertisedName=d->getName().c_str();break;}}
#else
  advertisedName=addr=="MOCK-B"?"ELK-BLEDDM 06":"ELK-BLEDDM AB";
#endif
  uint8_t selected=p;if(selected==0&&advertisedName.length())selected=detectProtocol(advertisedName);
  int slot=-1;for(int i=0;i<2;i++)if(slots[i].address.equalsIgnoreCase(addr))slot=i;for(int i=0;i<2&&slot<0;i++)if(!slots[i].address.length())slot=i;if(slot<0)slot=1;
  bool ok=connectSlot(slot,addr,selected,advertisedName);if(ok){saveSlots();activeValid=false;}return ok;
}

void BleController::saveSlots(){if(!cfg)return;cfg->bleAddress=slots[0].address;cfg->bleProtocol=slots[0].protocol;cfg->bleAddress2=slots[1].address;cfg->bleProtocol2=slots[1].protocol;}
void BleController::disconnectSlot(uint8_t i){if(i>1)return;
#ifndef MOCK_BLE
  slots[i].chr=nullptr;if(slots[i].client){if(slots[i].client->isConnected())slots[i].client->disconnect();NimBLEDevice::deleteClient(slots[i].client);slots[i].client=nullptr;}
#endif
}
void BleController::disconnect(){disconnectSlot(0);disconnectSlot(1);}
bool BleController::removeController(uint8_t i){if(i>1)return false;disconnectSlot(i);slots[i].name="";slots[i].address="";slots[i].protocol=0;saveSlots();activeValid=false;return true;}

bool BleController::writeSlot(uint8_t i,const uint8_t* data,size_t len){if(!slotConnected(i))return false;if(millis()-lastWrite<18)delay(18-(millis()-lastWrite));lastWrite=millis();
#ifdef MOCK_BLE
  Serial.printf("[MOCK BLE %u] ",i);for(size_t j=0;j<len;j++)Serial.printf("%02X ",data[j]);Serial.println();return true;
#else
  return slots[i].chr->writeValue(data,len,slots[i].protocol==4?false:true);
#endif
}

void BleController::setPower(bool on){for(uint8_t i=0;i<2;i++){if(!slotTargeted(i)||!slotConnected(i))continue;uint8_t p=slots[i].protocol;uint8_t f[9];if(p==4){uint8_t x[9]={0x7E,0x04,0x04,(uint8_t)(on?0xF0:0x00),0x00,(uint8_t)(on?0x01:0x00),0xFF,0x00,0xEF};memcpy(f,x,9);}else if(p==1){uint8_t x[9]={0x7E,0xFF,0x04,(uint8_t)(on?1:0),0xFF,0xFF,0xFF,0xFF,0xEF};memcpy(f,x,9);}else if(p==2){uint8_t x[9]={0x7B,0xFF,0x04,(uint8_t)(on?1:0),0xFF,0xFF,0xFF,0xFF,0xBF};memcpy(f,x,9);}else{uint8_t x[9]={0x7B,0x04,(uint8_t)(on?1:0),0xFF,0xFF,0xFF,0xFF,0xFF,0xBF};memcpy(f,x,9);}writeSlot(i,f,9);}}
void BleController::setColor(uint32_t c){uint8_t R=r8(c),G=g8(c),B=b8(c);for(uint8_t i=0;i<2;i++){if(!slotTargeted(i)||!slotConnected(i))continue;uint8_t p=slots[i].protocol,f[9];if(p==4){uint8_t x[9]={0x7E,0x07,0x05,0x03,R,G,B,0x10,0xEF};memcpy(f,x,9);}else if(p==1){uint8_t x[9]={0x7E,0xFF,0x05,0x03,R,G,B,0xFF,0xEF};memcpy(f,x,9);}else if(p==2){uint8_t x[9]={0x7B,0xFF,0x07,R,G,B,0x00,0xFF,0xBF};memcpy(f,x,9);}else{uint8_t x[9]={0x7B,0x07,R,G,B,0x00,0xFF,0xFF,0xBF};memcpy(f,x,9);}writeSlot(i,f,9);}}
void BleController::setBrightness(uint8_t B){B=constrain(B,0,100);for(uint8_t i=0;i<2;i++){if(!slotTargeted(i)||!slotConnected(i))continue;uint8_t p=slots[i].protocol,f[9];if(p==4){uint8_t x[9]={0x7E,0x04,0x01,B,0x00,0x00,0x00,0x00,0xEF};memcpy(f,x,9);}else if(p==1){uint8_t x[9]={0x7E,0xFF,0x01,B,0x00,0xFF,0xFF,0xFF,0xEF};memcpy(f,x,9);}else if(p==2){uint8_t x[9]={0x7B,0xFF,0x01,(uint8_t)(B*32/100),B,0x01,0xFF,0xFF,0xBF};memcpy(f,x,9);}else{uint8_t x[9]={0x7B,0x01,B,0x00,0xFF,0xFF,0xFF,0xFF,0xBF};memcpy(f,x,9);}writeSlot(i,f,9);}}
void BleController::setSpeed(uint8_t S){S=constrain(S,0,100);for(uint8_t i=0;i<2;i++){if(!slotTargeted(i)||!slotConnected(i)||slots[i].protocol==4)continue;uint8_t p=slots[i].protocol,f[9];if(p==1){uint8_t x[9]={0x7E,0xFF,0x02,S,0x00,0xFF,0xFF,0xFF,0xEF};memcpy(f,x,9);}else if(p==2){uint8_t x[9]={0x7B,0xFF,0x02,S,0x00,0xFF,0xFF,0xFF,0xBF};memcpy(f,x,9);}else{uint8_t x[9]={0x7B,0x02,S,0x00,0xFF,0xFF,0xFF,0xFF,0xBF};memcpy(f,x,9);}writeSlot(i,f,9);}}
void BleController::setMode(uint8_t M){for(uint8_t i=0;i<2;i++){if(!slotTargeted(i)||!slotConnected(i)||slots[i].protocol==4)continue;uint8_t p=slots[i].protocol,f[9];if(p==1){uint8_t x[9]={0x7E,0xFF,0x03,M,0x03,0xFF,0xFF,0xFF,0xEF};memcpy(f,x,9);}else if(p==2){uint8_t x[9]={0x7B,0xFF,0x03,M,0xFF,0xFF,0xFF,0xFF,0xBF};memcpy(f,x,9);}else{uint8_t x[9]={0x7B,0x03,M,0xFF,0xFF,0xFF,0xFF,0xFF,0xBF};memcpy(f,x,9);}writeSlot(i,f,9);}}

bool BleController::targetUsesSoftwareEffects() const{for(uint8_t i=0;i<2;i++)if(slotTargeted(i)&&slotConnected(i)&&slots[i].protocol==4)return true;return false;}
void BleController::applyTheme(const Theme& t,uint8_t bright,uint8_t speedLevel,uint32_t nowMs,bool force){uint8_t sp=map(constrain(speedLevel,1,5),1,5,20,95);bool changed=!activeValid||activeTheme.name!=t.name||activeTheme.effect!=t.effect;if(force||changed){activeTheme=t;activeValid=true;setPower(true);setBrightness(bright);setSpeed(sp);}if(t.effect==Effect::Solid){if(force||changed)setColor(t.colors[0]);return;}
  if(!targetUsesSoftwareEffects()&&(t.effect==Effect::Rainbow||t.effect==Effect::Chase||t.effect==Effect::Meteor)){if(force||changed){uint8_t mode=t.effect==Effect::Rainbow?3:(t.effect==Effect::Chase?39:23);setMode(mode);}return;}
  uint32_t interval=map(constrain(speedLevel,1,5),1,5,650,90);if(!force&&nowMs-lastEffect<interval)return;lastEffect=nowMs;float phase=(nowMs%(interval*40))/(float)(interval*40);uint32_t color=t.colors[0];uint8_t b=bright;
  if(t.effect==Effect::Fade){int idx=(int)(phase*t.colorCount)%t.colorCount,nxt=(idx+1)%t.colorCount;float f=fmodf(phase*t.colorCount,1.0f);uint32_t a=t.colors[idx],z=t.colors[nxt];uint8_t R=r8(a)+(r8(z)-r8(a))*f,G=g8(a)+(g8(z)-g8(a))*f,B=b8(a)+(b8(z)-b8(a))*f;color=((uint32_t)R<<16)|((uint32_t)G<<8)|B;}
  else if(t.effect==Effect::Pulse){b=(uint8_t)(bright*(0.25f+0.75f*(0.5f+0.5f*sinf(phase*2*PI))));}
  else if(t.effect==Effect::Rainbow){color=hsv(phase*360,1,1);}
  else if(t.effect==Effect::Twinkle){color=t.colors[random(t.colorCount)];b=random(35,max(36,(int)bright+1));}
  else if(t.effect==Effect::CandyCane||t.effect==Effect::Chase||t.effect==Effect::Meteor){color=t.colors[((nowMs/interval)%max(1,(int)t.colorCount))];}
  else if(t.effect==Effect::Fire){color=((uint32_t)255<<16)|((uint32_t)random(40,170)<<8);}
  else if(t.effect==Effect::Water){color=((uint32_t)random(0,30)<<16)|((uint32_t)random(90,200)<<8)|255;}
  else color=t.colors[((nowMs/interval)%max(1,(int)t.colorCount))];
  setColor(color);setBrightness(b);
}

void BleController::loop(){
#ifndef MOCK_BLE
  static uint32_t retry=0;if(millis()-retry<30000)return;retry=millis();
  if(cfg){if(cfg->bleAddress.length()&&!slotConnected(0))connectSlot(0,cfg->bleAddress,cfg->bleProtocol);if(cfg->bleAddress2.length()&&!slotConnected(1))connectSlot(1,cfg->bleAddress2,cfg->bleProtocol2);}
#endif
}
