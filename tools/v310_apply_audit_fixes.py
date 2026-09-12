#!/usr/bin/env python3
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]
def write(path,text):
    p=ROOT/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)
def replace(path,old,new,count=1):
    p=ROOT/path;s=p.read_text()
    if s.count(old)<count: raise SystemExit(f'missing expected text in {path}: {old[:80]!r}')
    p.write_text(s.replace(old,new,count))
def sub(path,pattern,repl,count=1,flags=0):
    p=ROOT/path;s=p.read_text();s,n=re.subn(pattern,repl,s,count=count,flags=flags)
    if n!=count: raise SystemExit(f'expected {count} regex replacements in {path}, got {n}: {pattern[:80]}')
    p.write_text(s)

BLE_H=r'''#pragma once
#include <Arduino.h>
#include <vector>
#include "Types.h"
#ifndef MOCK_BLE
#include <NimBLEDevice.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#endif

struct BleFound { String name; String address; int rssi; };
struct BleSlotInfo { String name; String address; String protocol; bool connected; };

class BleController {
 public:
  void begin(AppSettings* settings);
  void loop();
  bool connecting() const;
  bool consumeConnectionChange(){bool changed=connectionChanged;connectionChanged=false;return changed;}
  bool connected() const;
  int connectedCount() const;
  String name() const;
  String address() const;
  String protocolName() const;
  std::vector<BleFound> scan(uint32_t ms=2500);
  bool selectAndConnect(const String& address);
  bool removeController(uint8_t slot);
  void setTarget(uint8_t target); // 0=all, 1=slot A, 2=slot B
  uint8_t getTarget() const { return target; }
  BleSlotInfo slotInfo(uint8_t slot) const;
  void setPower(bool on);
  void setBrightness(uint8_t pct,bool reliable=true);
  void setColor(uint32_t rgb,bool reliable=true);
  void applyTheme(const Theme& theme,uint8_t brightness,uint8_t speedLevel,uint32_t nowMs,bool force=false);
 private:
  struct PendingFrame {
    uint8_t data[9]{};
    uint8_t len=0;
    uint8_t sendsRemaining=0;
    uint8_t failures=0;
    uint32_t dueAt=0;
    uint32_t generation=0;
    bool pending=false;
  };
  struct Slot {
    String name;
    String address;
    uint32_t generation=0,nextConnectAt=0,commandGeneration=0;
    PendingFrame power,brightness,color;
#ifndef MOCK_BLE
    NimBLEClient* client=nullptr;
    NimBLERemoteCharacteristic* chr=nullptr;
#endif
  } slots[2];
  AppSettings* cfg=nullptr;
  uint8_t target=0,nextServiceSlot=0;
  uint32_t lastWrite=0,lastEffect=0,lastStaticReassert=0,lastControlReassert=0;
  uint32_t startedAt=0;
  bool connectionChanged=false;
  Theme activeTheme;
  uint8_t activeBrightness=0,activeSpeed=0;
  bool activeValid=false;
#ifndef MOCK_BLE
  struct ConnectRequest { char address[18]; };
  struct ConnectResult { NimBLEClient* client; NimBLERemoteCharacteristic* chr; };
  QueueHandle_t connectRequests=nullptr,connectResults=nullptr;
  TaskHandle_t connectTask=nullptr;
  bool connectPending=false;
  uint8_t pendingSlot=0;
  uint32_t pendingGeneration=0;
  static void connectionWorker(void* context);
  bool requestConnection(uint8_t slot);
#endif
  void disconnectSlot(uint8_t slot);
  bool slotConnected(uint8_t slot) const;
  bool slotTargeted(uint8_t slot) const;
  bool writeSlot(uint8_t slot,const uint8_t* data,size_t len);
  void enqueueFrame(uint8_t slot,PendingFrame& pending,const uint8_t* data,size_t len,bool reliable);
  void enqueueToTargets(uint8_t kind,const uint8_t* data,size_t len,bool reliable);
  void servicePendingWrites(uint32_t now);
  void clearPending(uint8_t slot);
  void clearAllPending();
  void saveSlots();
};
'''

BLE_CPP=r'''#include "BleController.h"
#include <algorithm>
#include <math.h>

static uint8_t r8(uint32_t c){return (c>>16)&0xFF;} static uint8_t g8(uint32_t c){return (c>>8)&0xFF;} static uint8_t b8(uint32_t c){return c&0xFF;}
static uint32_t softwareEffectIntervalMs(uint8_t speedLevel){static constexpr uint32_t intervalsMs[5]={2000,1000,500,250,100};return intervalsMs[constrain(speedLevel,1,5)-1];}
static constexpr uint32_t WRITE_GAP_MS=18UL;
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
BleSlotInfo BleController::slotInfo(uint8_t i) const{BleSlotInfo x;if(i>1)return x;x.name=slots[i].name;x.address=slots[i].address;x.protocol=protocolName();x.connected=slotConnected(i);return x;}
void BleController::clearPending(uint8_t i){if(i>1)return;slots[i].power=PendingFrame();slots[i].brightness=PendingFrame();slots[i].color=PendingFrame();++slots[i].commandGeneration;}
void BleController::clearAllPending(){clearPending(0);clearPending(1);}
void BleController::setTarget(uint8_t t){t=t<=2?t:0;if(target==t)return;target=t;clearAllPending();activeValid=false;}
bool BleController::slotTargeted(uint8_t i) const{return target==0||target==i+1;}

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
void BleController::connectionWorker(void* context){auto* self=static_cast<BleController*>(context);ConnectRequest request{};for(;;){if(xQueueReceive(self->connectRequests,&request,portMAX_DELAY)!=pdTRUE)continue;ConnectResult result{nullptr,nullptr};for(uint8_t type:{BLE_ADDR_PUBLIC,BLE_ADDR_RANDOM}){auto* client=NimBLEDevice::createClient();if(!client)break;client->setConnectTimeout(3000);client->setConnectRetries(0);if(!client->connect(NimBLEAddress(std::string(request.address),type))){NimBLEDevice::deleteClient(client);continue;}NimBLERemoteService* svc=client->getService("FFF0");auto* chr=svc?svc->getCharacteristic("FFF3"):nullptr;if(!chr){svc=client->getService("FFE5");if(svc)chr=svc->getCharacteristic("FFE9");}if(chr&&client->isConnected()){result={client,chr};break;}NimBLEDevice::deleteClient(client);}xQueueSend(self->connectResults,&result,portMAX_DELAY);}}
bool BleController::requestConnection(uint8_t i){if(i>1||connectPending||!connectTask||slots[i].address.length()!=17)return false;ConnectRequest request{};slots[i].address.toCharArray(request.address,sizeof(request.address));disconnectSlot(i);pendingSlot=i;pendingGeneration=slots[i].generation;connectPending=xQueueSend(connectRequests,&request,0)==pdTRUE;return connectPending;}
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

bool BleController::writeSlot(uint8_t i,const uint8_t* data,size_t len){if(!slotConnected(i)||(uint32_t)(millis()-lastWrite)<WRITE_GAP_MS)return false;lastWrite=millis();
#ifdef MOCK_BLE
  (void)data;(void)len;return true;
#else
  const bool requestAck=slots[i].chr&&slots[i].chr->canWrite();return slots[i].chr->writeValue(data,len,requestAck);
#endif
}
void BleController::enqueueFrame(uint8_t i,PendingFrame& p,const uint8_t* data,size_t len,bool reliable){if(i>1||!data||!len||len>sizeof(p.data))return;memcpy(p.data,data,len);p.len=(uint8_t)len;p.sendsRemaining=reliable?2:1;p.failures=0;p.dueAt=millis();p.generation=++slots[i].commandGeneration;p.pending=true;}
void BleController::enqueueToTargets(uint8_t kind,const uint8_t* data,size_t len,bool reliable){for(uint8_t i=0;i<2;i++){if(!slotTargeted(i)||!slotConnected(i))continue;PendingFrame* p=kind==0?&slots[i].power:(kind==1?&slots[i].brightness:&slots[i].color);enqueueFrame(i,*p,data,len,reliable);}}
void BleController::servicePendingWrites(uint32_t now){if((uint32_t)(now-lastWrite)<WRITE_GAP_MS)return;for(uint8_t pass=0;pass<2;pass++){uint8_t i=(uint8_t)((nextServiceSlot+pass)%2);if(!slotConnected(i)){clearPending(i);continue;}PendingFrame* choices[3]={&slots[i].power,&slots[i].brightness,&slots[i].color};for(auto* p:choices){if(!p->pending||(int32_t)(now-p->dueAt)<0)continue;uint32_t generation=p->generation;bool ok=writeSlot(i,p->data,p->len);if(!p->pending||p->generation!=generation)return;if(ok){p->failures=0;if(p->sendsRemaining>0)--p->sendsRemaining;if(!p->sendsRemaining)p->pending=false;else p->dueAt=millis()+RELIABLE_RETRY_DELAY_MS;}else{if(p->failures<255)++p->failures;p->dueAt=millis()+failureRetryMs(p->failures);}nextServiceSlot=(uint8_t)((i+1)%2);return;}}}}

void BleController::setPower(bool on){uint8_t f[9]={0x7E,0x04,0x04,(uint8_t)(on?0xF0:0x00),0x00,(uint8_t)(on?0x01:0x00),0xFF,0x00,0xEF};enqueueToTargets(0,f,9,true);}
void BleController::setColor(uint32_t c,bool reliable){uint8_t f[9]={0x7E,0x07,0x05,0x03,r8(c),g8(c),b8(c),0x10,0xEF};enqueueToTargets(2,f,9,reliable);}
void BleController::setBrightness(uint8_t B,bool reliable){B=constrain(B,0,100);uint8_t f[9]={0x7E,0x04,0x01,B,0x00,0x00,0x00,0x00,0xEF};enqueueToTargets(1,f,9,reliable);}

void BleController::applyTheme(const Theme& t,uint8_t bright,uint8_t speedLevel,uint32_t nowMs,bool force){
  bool changed=!activeValid||activeTheme.name!=t.name||activeTheme.effect!=t.effect||activeTheme.colorCount!=t.colorCount||activeBrightness!=bright||activeSpeed!=speedLevel;if(!changed)for(uint8_t i=0;i<t.colorCount&&i<8;i++)if(activeTheme.colors[i]!=t.colors[i]){changed=true;break;}
  const bool starting=force||changed;if(starting){activeTheme=t;activeBrightness=bright;activeSpeed=speedLevel;activeValid=true;setPower(true);setBrightness(bright,true);lastEffect=0;lastStaticReassert=nowMs;lastControlReassert=nowMs;}
  uint8_t count=max((uint8_t)1,t.colorCount);uint32_t interval=softwareEffectIntervalMs(speedLevel);
  if(t.effect==Effect::Solid){bool periodic=!starting&&(uint32_t)(nowMs-lastStaticReassert)>=STATIC_REASSERT_INTERVAL_MS;if(starting||periodic){if(periodic){setPower(true);setBrightness(bright,true);}setColor(t.colors[0],true);lastStaticReassert=nowMs;}return;}
  if(t.effect==Effect::Jump&&count==1){bool periodic=!starting&&(uint32_t)(nowMs-lastStaticReassert)>=STATIC_REASSERT_INTERVAL_MS;if(starting||periodic){if(periodic){setPower(true);setBrightness(bright,true);}setColor(t.colors[0],true);lastStaticReassert=nowMs;}return;}
  if(!starting&&(uint32_t)(nowMs-lastControlReassert)>=CONTROL_REASSERT_INTERVAL_MS){setPower(true);if(t.effect!=Effect::Breath)setBrightness(bright,true);lastControlReassert=nowMs;}
  if(t.effect==Effect::Jump){if(!force&&nowMs-lastEffect<interval)return;lastEffect=nowMs;uint32_t step=(nowMs/interval)%count;setColor(t.colors[step],starting);return;}
  if(t.effect==Effect::Strobe){uint32_t half=max((uint32_t)45,interval/2);if(!force&&nowMs-lastEffect<half)return;lastEffect=nowMs;uint32_t phase=nowMs/half;if((phase&1)==0)setColor(0x000000,false);else setColor(t.colors[(phase/2)%count],starting);return;}
  if(t.effect==Effect::Breath){uint32_t frame=max((uint32_t)55,interval/5);if(!force&&nowMs-lastEffect<frame)return;lastEffect=nowMs;float cycleMs=(float)(interval*8UL),phase=fmodf((float)nowMs,cycleMs)/cycleMs;int idx=(int)(phase*count)%count,nxt=(idx+1)%count;float local=fmodf(phase*count,1.0f);uint32_t a=t.colors[idx],z=t.colors[nxt];uint8_t R=(uint8_t)(r8(a)+(r8(z)-r8(a))*local),G=(uint8_t)(g8(a)+(g8(z)-g8(a))*local),B=(uint8_t)(b8(a)+(b8(z)-b8(a))*local);uint32_t color=((uint32_t)R<<16)|((uint32_t)G<<8)|B;float wave=0.5f-0.5f*cosf(phase*2.0f*PI);uint8_t level=(uint8_t)max(1.0f,bright*(0.10f+0.90f*wave));setColor(count>1?color:t.colors[0],starting);setBrightness(level,false);return;}
}

void BleController::loop(){
#ifndef MOCK_BLE
  if(connectTask){ConnectResult result{};if(connectPending&&xQueueReceive(connectResults,&result,0)==pdTRUE){auto& slot=slots[pendingSlot];connectPending=false;if(slot.generation==pendingGeneration&&result.client){slot.client=result.client;slot.chr=result.chr;clearPending(pendingSlot);activeValid=false;connectionChanged=true;}else if(result.client)NimBLEDevice::deleteClient(result.client);if(slot.generation==pendingGeneration){uint32_t n=millis();slot.nextConnectAt=n+((uint32_t)(n-startedAt)<60000UL?5000UL:30000UL);}}uint32_t n=millis();for(uint8_t i=0;i<2;i++)if(slotConnected(i))slots[i].nextConnectAt=n;if(!connectPending)for(uint8_t i=0;i<2;i++){if(slots[i].address.length()&&!slotConnected(i)&&(int32_t)(n-slots[i].nextConnectAt)>=0){if(requestConnection(i))break;slots[i].nextConnectAt=n+30000UL;}}}
#endif
  servicePendingWrites(millis());
}
'''

REMOTE_H=r'''#pragma once
#include <Arduino.h>
String remoteUpdateStatusJson(const char* currentVersion);
String remoteUpdateCheckJson(const char* currentVersion);
String remoteUpdateInstallJson(const char* currentVersion);
String remoteUpdateResumeJson(const char* currentVersion);
void remoteUpdateAutoLoop(const char* currentVersion);
bool remoteUpdateConsumeRebootRequest();
void remoteUpdateNoteBoot(const char* currentVersion,const char* buildCommit);
bool remoteUpdateOperationBusy();
bool remoteUpdateTryClaimExternalOperation();
void remoteUpdateReleaseExternalOperation();
bool remoteUpdateSetRollbackHold(const char* rejectedVersion);
void remoteUpdateClearHold();
'''

REMOTE_CPP=r'''#include "RemoteUpdate.h"
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <Update.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <mbedtls/base64.h>
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>
#include <esp_system.h>
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

static constexpr const char* OTA_MANIFEST_URL="https://raw.githubusercontent.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/ota/latest.json";
static constexpr const char* OTA_RELEASE_PREFIX="https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/releases/download/anderson-v";
static constexpr size_t OTA_SLOT_BYTES=0x1E0000;
static constexpr const char* OTA_NVS="anderson-ota";
static constexpr uint32_t OTA_AUTO_FIRST_CHECK_MS=20UL*1000UL;
static constexpr uint32_t OTA_AUTO_INTERVAL_MS=5UL*60UL*1000UL;
static constexpr uint32_t OTA_AUTO_RETRY_BASE_MS=30UL*1000UL;
static constexpr uint32_t OTA_AUTO_RETRY_MAX_MS=5UL*60UL*1000UL;
static constexpr uint32_t OTA_MANIFEST_IDLE_MS=8000UL,OTA_MANIFEST_DEADLINE_MS=20000UL;
static constexpr uint32_t OTA_DOWNLOAD_IDLE_MS=12000UL,OTA_DOWNLOAD_DEADLINE_MS=180000UL;
static constexpr size_t OTA_MANIFEST_MAX_BYTES=4096;
static constexpr const char OTA_PUBLIC_KEY[]=R"KEY(-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE3Dw/xqxEPbvkJQAcMeZxBAxwujxN
kuGHPepzClPYMrJ4h5r8iNlyUFpJZcPI/FXe8+atedYKpIZZB5XlOj964Q==
-----END PUBLIC KEY-----
)KEY";

enum : uint8_t {OWNER_NONE=0,OWNER_REMOTE=1,OWNER_EXTERNAL=2};
enum : uint8_t {JOB_CHECK=1,JOB_INSTALL=2,JOB_AUTO=3};
struct RemoteStatus {bool checked=false,ok=false,signatureValid=false,updateAvailable=false,installing=false,installReady=false,operationComplete=true,updateHold=false;int httpStatus=0;size_t bytes=0,downloadedBytes=0;uint32_t operationId=0;String phase="idle",availableVersion,sha256,commit,url,message="Not checked yet",rejectedVersion;};
struct RemoteJob {uint8_t kind=0;uint32_t id=0;char currentVersion[20]{};};
static RemoteStatus last;static String lastInstallMessage;static std::atomic<uint8_t> operationOwner{OWNER_NONE};static std::atomic<bool> rebootRequested{false};static QueueHandle_t jobQueue=nullptr;static TaskHandle_t workerTask=nullptr;static SemaphoreHandle_t statusMutex=nullptr;static std::atomic<uint32_t> operationSequence{0};static bool autoTimerStarted=false;static std::atomic<uint32_t> autoNextCheckAt{0};static std::atomic<uint8_t> autoFailureCount{0};

struct StatusLock{StatusLock(){if(statusMutex)xSemaphoreTake(statusMutex,portMAX_DELAY);}~StatusLock(){if(statusMutex)xSemaphoreGive(statusMutex);}};
static void ensureRuntime();
static RemoteStatus snapshot(){ensureRuntime();StatusLock lock;return last;}
static void publish(const RemoteStatus&s){ensureRuntime();StatusLock lock;last=s;}
static void setMessage(const String&m){ensureRuntime();StatusLock lock;lastInstallMessage=m;}
static String getMessage(){ensureRuntime();StatusLock lock;return lastInstallMessage;}
static bool allHex(const String&s,size_t n){if(s.length()!=n)return false;for(size_t i=0;i<s.length();i++){char c=s[i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')||(c>='A'&&c<='F')))return false;}return true;}
static String hexBytes(const uint8_t*data,size_t len){static const char h[]="0123456789abcdef";String out;out.reserve(len*2);for(size_t i=0;i<len;i++){out+=h[data[i]>>4];out+=h[data[i]&15];}return out;}
struct VersionParts{int major=0,minor=0,patch=0;char suffix=0;bool valid=false;};
static VersionParts parseVersion(const String&input){VersionParts v;String s=input;s.trim();int p1=s.indexOf('.'),p2=p1<0?-1:s.indexOf('.',p1+1);if(p1<=0||p2<=p1+1)return v;String a=s.substring(0,p1),b=s.substring(p1+1,p2),c=s.substring(p2+1);if(c.length()&&c[c.length()-1]>='a'&&c[c.length()-1]<='z'){v.suffix=c[c.length()-1];c.remove(c.length()-1);}auto digits=[](const String&x){if(!x.length())return false;for(size_t i=0;i<x.length();i++)if(x[i]<'0'||x[i]>'9')return false;return true;};if(!digits(a)||!digits(b)||!digits(c))return v;v.major=a.toInt();v.minor=b.toInt();v.patch=c.toInt();v.valid=true;return v;}
static int compareVersion(const String&a,const String&b){VersionParts x=parseVersion(a),y=parseVersion(b);if(!x.valid||!y.valid)return 0;if(x.major!=y.major)return x.major>y.major?1:-1;if(x.minor!=y.minor)return x.minor>y.minor?1:-1;if(x.patch!=y.patch)return x.patch>y.patch?1:-1;if(x.suffix==y.suffix)return 0;if(!x.suffix)return 1;if(!y.suffix)return -1;return x.suffix>y.suffix?1:-1;}
static uint32_t retryDelayFor(uint8_t failures){uint8_t shift=failures<4?failures:4;uint32_t retry=OTA_AUTO_RETRY_BASE_MS<<shift;return min(retry,OTA_AUTO_RETRY_MAX_MS);}
static void scheduleAutoRetry(uint32_t completedAt){uint8_t failures=autoFailureCount.load();uint32_t retry=retryDelayFor(failures);if(failures<255)autoFailureCount.store((uint8_t)(failures+1));autoNextCheckAt.store(completedAt+retry);}
static void scheduleAutoSuccess(uint32_t completedAt){autoFailureCount.store(0);autoNextCheckAt.store(completedAt+OTA_AUTO_INTERVAL_MS);}
static uint32_t autoCheckSecondsRemaining(){if(!autoTimerStarted)return (OTA_AUTO_FIRST_CHECK_MS+999UL)/1000UL;int32_t remaining=(int32_t)(autoNextCheckAt.load()-millis());return remaining>0?(uint32_t)(remaining+999)/1000UL:0UL;}

static bool readHold(String&rejected){Preferences p;if(!p.begin(OTA_NVS,true))return false;bool hold=p.getBool("hold",false);rejected=p.getString("rejected","");p.end();return hold&&parseVersion(rejected).valid;}
bool remoteUpdateSetRollbackHold(const char* rejectedVersion){String v=rejectedVersion?String(rejectedVersion):String("");if(!parseVersion(v).valid)return false;Preferences p;if(!p.begin(OTA_NVS,false))return false;bool ok=p.putBool("hold",true)>0&&p.putString("rejected",v)==v.length();p.end();return ok;}
void remoteUpdateClearHold(){Preferences p;if(!p.begin(OTA_NVS,false))return;p.remove("hold");p.remove("rejected");p.end();}

static bool verifySignature(const String&payload,const String&sig64){uint8_t sig[96];size_t sigLen=0;if(mbedtls_base64_decode(sig,sizeof(sig),&sigLen,(const unsigned char*)sig64.c_str(),sig64.length())!=0||!sigLen)return false;uint8_t digest[32];if(mbedtls_sha256((const unsigned char*)payload.c_str(),payload.length(),digest,0)!=0)return false;mbedtls_pk_context pk;mbedtls_pk_init(&pk);int rc=mbedtls_pk_parse_public_key(&pk,(const unsigned char*)OTA_PUBLIC_KEY,sizeof(OTA_PUBLIC_KEY));if(rc==0)rc=mbedtls_pk_verify(&pk,MBEDTLS_MD_SHA256,digest,sizeof(digest),sig,sigLen);mbedtls_pk_free(&pk);return rc==0;}
static bool parsePayload(const String&payload,RemoteStatus&out){bool gv=false,gb=false,gs=false,gc=false,gu=false;int start=0;while(start<(int)payload.length()){int nl=payload.indexOf('\n',start);if(nl<0)nl=payload.length();String line=payload.substring(start,nl);start=nl+1;if(!line.length())continue;int eq=line.indexOf('=');if(eq<=0)return false;String k=line.substring(0,eq),v=line.substring(eq+1);if(k=="version"&&!gv){out.availableVersion=v;gv=true;}else if(k=="bytes"&&!gb){if(!v.length())return false;for(size_t i=0;i<v.length();i++)if(v[i]<'0'||v[i]>'9')return false;out.bytes=(size_t)v.toInt();gb=true;}else if(k=="sha256"&&!gs){out.sha256=v;out.sha256.toLowerCase();gs=true;}else if(k=="commit"&&!gc){out.commit=v;out.commit.toLowerCase();gc=true;}else if(k=="url"&&!gu){out.url=v;gu=true;}else return false;}if(!gv||!gb||!gs||!gc||!gu)return false;if(!parseVersion(out.availableVersion).valid||out.bytes==0||out.bytes>=OTA_SLOT_BYTES||!allHex(out.sha256,64)||!allHex(out.commit,40))return false;String expected=String(OTA_RELEASE_PREFIX)+out.availableVersion+"/and_"+out.availableVersion+".bin";return out.url==expected;}
static bool setPending(const RemoteStatus&s){Preferences p;if(!p.begin(OTA_NVS,false))return false;bool ok=p.putString("pending",s.availableVersion)==s.availableVersion.length()&&p.putString("sha",s.sha256)==s.sha256.length()&&p.putString("commit",s.commit)==s.commit.length();p.end();return ok;}
static void clearPending(){Preferences p;if(!p.begin(OTA_NVS,false))return;p.remove("pending");p.remove("sha");p.remove("commit");p.end();}
static void saveLastMessage(const String&version,const String&message){Preferences p;if(p.begin(OTA_NVS,false)){p.putString("lastver",version);p.putString("lastmsg",message);p.end();}setMessage(message);}

static bool readHttpBodyCapped(HTTPClient&http,String&body,String&failure){int announced=http.getSize();if(announced>(int)OTA_MANIFEST_MAX_BYTES){failure="Remote manifest exceeds the maximum allowed size";return false;}NetworkClient*stream=http.getStreamPtr();body="";body.reserve(announced>0?announced:512);uint8_t buffer[512];size_t total=0;uint32_t started=millis(),lastData=started;for(;;){if((uint32_t)(millis()-started)>OTA_MANIFEST_DEADLINE_MS){failure="Manifest request exceeded its absolute deadline";return false;}int available=stream->available();if(available>0){size_t want=min((size_t)available,sizeof(buffer));if(total+want>OTA_MANIFEST_MAX_BYTES){failure="Remote manifest exceeds the maximum allowed size";return false;}int got=stream->read(buffer,want);if(got>0){body.concat((const char*)buffer,(unsigned int)got);total+=(size_t)got;lastData=millis();continue;}}if(announced>=0&&total>=(size_t)announced)break;if(!stream->connected()&&!stream->available())break;if((uint32_t)(millis()-lastData)>OTA_MANIFEST_IDLE_MS){failure="Manifest request stalled";return false;}vTaskDelay(pdMS_TO_TICKS(2));}if(!total){failure="Remote manifest is empty";return false;}return true;}
static bool fetchVerifiedManifest(const char*current,RemoteStatus&st){st.checked=true;st.phase="checking manifest";publish(st);if(WiFi.status()!=WL_CONNECTED){st.message="Wi-Fi is not connected";return false;}WiFiClientSecure client;client.setInsecure();client.setHandshakeTimeout(12);HTTPClient http;http.setConnectTimeout(6000);http.setTimeout(8000);String requestUrl=String(OTA_MANIFEST_URL)+"?cb="+String((uint32_t)esp_random(),HEX)+"-"+String((uint32_t)millis(),HEX);if(!http.begin(client,requestUrl)){st.message="Could not open the remote manifest URL";return false;}http.addHeader("Cache-Control","no-cache, no-store, max-age=0");http.addHeader("Pragma","no-cache");st.httpStatus=http.GET();if(st.httpStatus!=HTTP_CODE_OK){st.message=String("Manifest request failed (HTTP ")+String(st.httpStatus)+")";http.end();return false;}String body,failure;if(!readHttpBodyCapped(http,body,failure)){http.end();st.message=failure;return false;}http.end();JsonDocument d;if(deserializeJson(d,body)||!d.is<JsonObject>()||(d["schema"]|0)!=1){st.message="Remote manifest format is invalid";return false;}String payload=d["payload"]|String(""),sig=d["signature"]|String("");if(!payload.length()||!sig.length()){st.message="Remote manifest is missing its signed payload";return false;}st.signatureValid=verifySignature(payload,sig);if(!st.signatureValid){st.message="Remote manifest signature is invalid";return false;}if(!parsePayload(payload,st)){st.message="Signed manifest payload is invalid";return false;}int cmp=compareVersion(st.availableVersion,String(current));String rejected;st.updateHold=readHold(rejected);st.rejectedVersion=rejected;st.ok=true;st.updateAvailable=cmp>0;if(st.updateHold&&st.updateAvailable&&compareVersion(st.availableVersion,rejected)<=0){st.updateAvailable=false;st.message=String("Update hold is active for rejected release ")+rejected+". Resume updates or wait for a newer fixed release.";}else if(st.updateHold&&st.updateAvailable){st.message=String("Verified newer recovery update ")+st.availableVersion+" is available beyond held release "+rejected+".";}else if(cmp>0)st.message=String("Verified update available: ")+st.availableVersion;else if(cmp==0)st.message=String("Signed manifest verified. Anderson Home ")+current+" is current.";else st.message=String("Signed manifest verified but advertises older firmware ")+st.availableVersion+"; downgrade is blocked.";return true;}

static bool downloadAndStage(RemoteStatus&st){st.installing=true;st.installReady=false;st.downloadedBytes=0;st.phase="downloading firmware";publish(st);WiFiClientSecure client;client.setInsecure();client.setHandshakeTimeout(12);HTTPClient http;http.setConnectTimeout(6000);http.setTimeout(12000);http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);if(!http.begin(client,st.url)){st.ok=false;st.installing=false;st.message="Could not open the signed firmware URL";return false;}int code=http.GET();st.httpStatus=code;if(code!=HTTP_CODE_OK){st.ok=false;st.installing=false;st.message=String("Firmware download failed (HTTP ")+String(code)+")";http.end();return false;}int announced=http.getSize();if(announced>0&&(size_t)announced!=st.bytes){st.ok=false;st.installing=false;st.message="Firmware Content-Length does not match the signed manifest";http.end();return false;}if(!Update.begin(st.bytes,U_FLASH)){st.ok=false;st.installing=false;st.message=String("Could not open inactive OTA slot. Error ")+String(Update.getError());http.end();return false;}mbedtls_sha256_context sha;mbedtls_sha256_init(&sha);if(mbedtls_sha256_starts(&sha,0)!=0){Update.abort();mbedtls_sha256_free(&sha);http.end();st.ok=false;st.installing=false;st.message="Could not start SHA-256 verification";return false;}NetworkClient*stream=http.getStreamPtr();uint8_t buffer[2048];size_t total=0;uint32_t started=millis(),lastData=started;bool failed=false;String failure;while(total<st.bytes){if((uint32_t)(millis()-started)>OTA_DOWNLOAD_DEADLINE_MS){failed=true;failure="Firmware download exceeded its absolute deadline";break;}int available=stream->available();if(available>0){size_t want=min((size_t)available,sizeof(buffer));want=min(want,st.bytes-total);int got=stream->read(buffer,want);if(got>0){if(mbedtls_sha256_update(&sha,buffer,(size_t)got)!=0){failed=true;failure="SHA-256 update failed";break;}if(Update.write(buffer,(size_t)got)!=(size_t)got){failed=true;failure=String("Firmware write failed. Error ")+String(Update.getError());break;}total+=(size_t)got;st.downloadedBytes=total;lastData=millis();st.phase="writing inactive OTA slot";publish(st);continue;}}if((uint32_t)(millis()-lastData)>OTA_DOWNLOAD_IDLE_MS){failed=true;failure="Firmware download stalled before the signed byte count was received";break;}vTaskDelay(pdMS_TO_TICKS(2));}uint8_t digest[32];bool hashFinished=!failed&&mbedtls_sha256_finish(&sha,digest)==0;mbedtls_sha256_free(&sha);http.end();if(failed||!hashFinished||total!=st.bytes){Update.abort();st.ok=false;st.installing=false;st.message=failure.length()?failure:(!hashFinished?"Could not finish SHA-256 verification":"Firmware download ended before the signed byte count");return false;}String actual=hexBytes(digest,sizeof(digest));if(actual!=st.sha256){Update.abort();st.ok=false;st.installing=false;st.message="Downloaded firmware SHA-256 does not match the signed manifest";return false;}st.phase="validating staged image";publish(st);if(!setPending(st)){Update.abort();st.ok=false;st.installing=false;st.message="Could not save remote-update recovery status; current firmware was left active";return false;}if(!Update.end(true)){clearPending();st.ok=false;st.installing=false;st.message=String("Firmware validation failed. Error ")+String(Update.getError());return false;}st.installing=false;st.installReady=true;st.updateAvailable=false;st.ok=true;st.phase="ready to reboot";st.message=String("Remote firmware ")+st.availableVersion+" downloaded, SHA-256 verified, and selected for reboot.";saveLastMessage(st.availableVersion,st.message);return true;}

static void completeJob(RemoteStatus&st,bool autoJob,bool success,bool keepOwner){st.operationComplete=true;publish(st);if(autoJob){uint32_t completed=millis();if(success)scheduleAutoSuccess(completed);else scheduleAutoRetry(completed);}if(!keepOwner)operationOwner.store(OWNER_NONE);}
static void worker(void*){RemoteJob job{};for(;;){if(xQueueReceive(jobQueue,&job,portMAX_DELAY)!=pdTRUE)continue;RemoteStatus st;st.operationId=job.id;st.operationComplete=false;st.phase="starting";String rejected;st.updateHold=readHold(rejected);st.rejectedVersion=rejected;publish(st);bool autoJob=job.kind==JOB_AUTO;bool manifestOk=fetchVerifiedManifest(job.currentVersion,st);if(!manifestOk){st.ok=false;st.phase="failed";completeJob(st,autoJob,false,false);continue;}if(job.kind==JOB_CHECK||!st.updateAvailable){st.phase=st.ok?"complete":"failed";completeJob(st,autoJob,true,false);continue;}bool staged=downloadAndStage(st);if(!staged){st.phase="failed";completeJob(st,autoJob,false,false);continue;}st.operationComplete=true;publish(st);if(autoJob)scheduleAutoSuccess(millis());rebootRequested.store(true);/* owner stays REMOTE until main consumes reboot */}}
static void ensureRuntime(){if(statusMutex&&jobQueue&&workerTask)return;if(!statusMutex)statusMutex=xSemaphoreCreateMutex();if(!jobQueue)jobQueue=xQueueCreate(1,sizeof(RemoteJob));if(jobQueue&&!workerTask)xTaskCreate(worker,"anderson-ota",8192,nullptr,1,&workerTask);}
static String statusJson(const char*current){RemoteStatus st=snapshot();JsonDocument d;d["checked"]=st.checked;d["ok"]=st.ok;d["signatureValid"]=st.signatureValid;d["currentVersion"]=current;d["updateAvailable"]=st.updateAvailable;d["autoInstall"]=true;d["autoCheckMinutes"]=OTA_AUTO_INTERVAL_MS/60000UL;d["autoCheckSecondsRemaining"]=autoCheckSecondsRemaining();d["downloadEnabled"]=true;d["installEnabled"]=true;d["installing"]=st.installing;d["installReady"]=st.installReady;d["operationId"]=st.operationId;d["operationComplete"]=st.operationComplete;d["phase"]=st.phase;d["operationBusy"]=remoteUpdateOperationBusy();d["updateHold"]=st.updateHold;d["manifestUrl"]=OTA_MANIFEST_URL;d["otaSlotBytes"]=OTA_SLOT_BYTES;d["httpStatus"]=st.httpStatus;d["message"]=st.message;if(st.rejectedVersion.length())d["rejectedVersion"]=st.rejectedVersion;if(st.availableVersion.length())d["availableVersion"]=st.availableVersion;if(st.bytes)d["bytes"]=(uint32_t)st.bytes;if(st.downloadedBytes)d["downloadedBytes"]=(uint32_t)st.downloadedBytes;if(st.sha256.length())d["sha256"]=st.sha256;if(st.commit.length())d["commit"]=st.commit;if(st.url.length())d["url"]=st.url;String msg=getMessage();if(msg.length())d["lastInstallMessage"]=msg;String j;serializeJson(d,j);return j;}
static String queueJob(uint8_t kind,const char*current){ensureRuntime();uint8_t expected=OWNER_NONE;if(!operationOwner.compare_exchange_strong(expected,OWNER_REMOTE)){RemoteStatus st=snapshot();st.ok=false;st.message="Another firmware operation is already active";publish(st);return statusJson(current);}RemoteJob job{};job.kind=kind;job.id=operationSequence.fetch_add(1)+1;strlcpy(job.currentVersion,current?current:"",sizeof(job.currentVersion));RemoteStatus st;st.operationId=job.id;st.operationComplete=false;st.phase="queued";st.message="Firmware operation queued";String rejected;st.updateHold=readHold(rejected);st.rejectedVersion=rejected;publish(st);if(!jobQueue||xQueueSend(jobQueue,&job,0)!=pdTRUE){operationOwner.store(OWNER_NONE);st.ok=false;st.operationComplete=true;st.phase="failed";st.message="Could not queue firmware operation";publish(st);}return statusJson(current);}

String remoteUpdateStatusJson(const char*current){ensureRuntime();return statusJson(current);}
String remoteUpdateCheckJson(const char*current){return queueJob(JOB_CHECK,current);}
String remoteUpdateInstallJson(const char*current){return queueJob(JOB_INSTALL,current);}
String remoteUpdateResumeJson(const char*current){if(remoteUpdateOperationBusy())return statusJson(current);remoteUpdateClearHold();RemoteStatus st=snapshot();st.updateHold=false;st.rejectedVersion="";st.ok=true;st.message="Automatic signed updates resumed.";publish(st);return statusJson(current);}
bool remoteUpdateOperationBusy(){return operationOwner.load()!=OWNER_NONE;}
bool remoteUpdateTryClaimExternalOperation(){uint8_t expected=OWNER_NONE;return operationOwner.compare_exchange_strong(expected,OWNER_EXTERNAL);}
void remoteUpdateReleaseExternalOperation(){uint8_t expected=OWNER_EXTERNAL;operationOwner.compare_exchange_strong(expected,OWNER_NONE);}
void remoteUpdateAutoLoop(const char*current){ensureRuntime();if(rebootRequested.load()||operationOwner.load()!=OWNER_NONE)return;uint32_t now=millis();if(!autoTimerStarted){autoTimerStarted=true;autoNextCheckAt.store(now+OTA_AUTO_FIRST_CHECK_MS);return;}if((int32_t)(now-autoNextCheckAt.load())<0)return;if(WiFi.status()!=WL_CONNECTED){scheduleAutoRetry(now);return;}queueJob(JOB_AUTO,current);}
bool remoteUpdateConsumeRebootRequest(){if(!rebootRequested.exchange(false))return false;operationOwner.store(OWNER_NONE);return true;}

void remoteUpdateNoteBoot(const char*currentVersion,const char*buildCommit){ensureRuntime();Preferences p;if(!p.begin(OTA_NVS,false))return;String pending=p.getString("pending","");String pendingCommit=p.getString("commit","");String prior=p.getString("lastmsg","");String msg;if(pending.length()){if(pending==currentVersion&&pendingCommit.length()&&pendingCommit==String(buildCommit)){msg=String("Remote update ")+pending+" booted successfully from commit "+pendingCommit+".";p.putString("lastver",pending);String rejected=p.getString("rejected","");if(p.getBool("hold",false)&&parseVersion(rejected).valid&&compareVersion(String(currentVersion),rejected)>0){p.remove("hold");p.remove("rejected");}}else{msg=String("Remote update ")+pending+" was pending, but running identity is "+currentVersion+" / "+buildCommit+". The rejected release is now held.";p.putBool("hold",true);p.putString("rejected",pending);}p.putString("lastmsg",msg);p.remove("pending");p.remove("sha");p.remove("commit");}else msg=prior;p.end();setMessage(msg);RemoteStatus st=snapshot();String rejected;st.updateHold=readHold(rejected);st.rejectedVersion=rejected;publish(st);}
'''

write('firmware/include/BleController.h',BLE_H)
write('firmware/src/BleController.cpp',BLE_CPP)
write('firmware/include/RemoteUpdate.h',REMOTE_H)
write('firmware/src/RemoteUpdate.cpp',REMOTE_CPP)
write('firmware/include/BuildIdentity.h','#pragma once\n#ifndef ANDERSON_BUILD_COMMIT\n#define ANDERSON_BUILD_COMMIT "unknown"\n#endif\n')

# main.cpp: version, build identity, firmware status, async remote routes, operation arbitration, rollback hold, late boot-health note.
replace('firmware/src/main.cpp','#include "RemoteUpdate.h"\n','#include "RemoteUpdate.h"\n#include "BuildIdentity.h"\n')
replace('firmware/src/main.cpp','static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.1.9";','static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.1.10";')
replace('firmware/src/main.cpp','bool otaUploadAllowed=false,otaUploadOk=false,otaRecoveryRequest=false;int otaUploadResponseCode=403;String otaUploadError;','bool otaUploadAllowed=false,otaUploadOk=false,otaRecoveryRequest=false,otaExternalClaimed=false;int otaUploadResponseCode=403;String otaUploadError;')
replace('firmware/src/main.cpp','d["version"]=ANDERSON_FIRMWARE_VERSION;d["runningPartition"]=running?running->label:"";','d["version"]=ANDERSON_FIRMWARE_VERSION;d["buildCommit"]=ANDERSON_BUILD_COMMIT;d["runningPartition"]=running?running->label:"";')
replace('firmware/src/main.cpp','if(Update.isRunning()||otaAutoRebootPending||!timeValid())return;','if(Update.isRunning()||remoteUpdateOperationBusy()||otaAutoRebootPending||!timeValid())return;')
old_routes='''  server.on("/api/remote-update",HTTP_GET,[]{if(!requireAdmin())return;sendJson(remoteUpdateStatusJson(ANDERSON_FIRMWARE_VERSION));});\n  server.on("/api/remote-update/check",HTTP_POST,[]{if(!requireAdmin())return;sendJson(remoteUpdateCheckJson(ANDERSON_FIRMWARE_VERSION));});\n  server.on("/api/remote-update/install",HTTP_POST,[]{\n    if(!requireAdmin())return;String result=remoteUpdateInstallJson(ANDERSON_FIRMWARE_VERSION);sendJson(result);if(remoteUpdateConsumeRebootRequest()){otaAutoRebootPending=true;otaAutoRebootAt=millis()+1800;}\n  });'''
new_routes='''  server.on("/api/remote-update",HTTP_GET,[]{if(!requireAdmin())return;sendJson(remoteUpdateStatusJson(ANDERSON_FIRMWARE_VERSION));});\n  server.on("/api/remote-update/check",HTTP_POST,[]{if(!requireAdmin())return;sendJson(remoteUpdateCheckJson(ANDERSON_FIRMWARE_VERSION));});\n  server.on("/api/remote-update/install",HTTP_POST,[]{if(!requireAdmin())return;sendJson(remoteUpdateInstallJson(ANDERSON_FIRMWARE_VERSION));});\n  server.on("/api/remote-update/resume",HTTP_POST,[]{if(!requireAdmin())return;sendJson(remoteUpdateResumeJson(ANDERSON_FIRMWARE_VERSION));});'''
replace('firmware/src/main.cpp',old_routes,new_routes)
replace('firmware/src/main.cpp','''      String fn=u.filename;fn.toLowerCase();if(!fn.endsWith(".bin")){otaUploadAllowed=false;otaUploadResponseCode=400;otaUploadError="Select an app-only .bin firmware file";return;}\n      if(!Update.begin(UPDATE_SIZE_UNKNOWN,U_FLASH)){otaUploadAllowed=false;otaUploadResponseCode=500;otaUploadError=String("Unable to open OTA slot. Error ")+String(Update.getError());return;}''','''      String fn=u.filename;fn.toLowerCase();if(!fn.endsWith(".bin")){otaUploadAllowed=false;otaUploadResponseCode=400;otaUploadError="Select an app-only .bin firmware file";return;}\n      if(!remoteUpdateTryClaimExternalOperation()){otaUploadAllowed=false;otaUploadResponseCode=409;otaUploadError="Another firmware operation is already active";return;}otaExternalClaimed=true;\n      if(!Update.begin(UPDATE_SIZE_UNKNOWN,U_FLASH)){otaUploadAllowed=false;otaUploadResponseCode=500;otaUploadError=String("Unable to open OTA slot. Error ")+String(Update.getError());remoteUpdateReleaseExternalOperation();otaExternalClaimed=false;return;}''')
replace('firmware/src/main.cpp','''    }else if(u.status==UPLOAD_FILE_WRITE){\n      if(otaUploadAllowed&&!otaUploadError.length()&&Update.write(u.buf,u.currentSize)!=u.currentSize){otaUploadResponseCode=500;otaUploadError=String("Firmware write failed. Error ")+String(Update.getError());Update.abort();}\n    }else if(u.status==UPLOAD_FILE_END){\n      if(otaUploadAllowed&&!otaUploadError.length()){otaUploadOk=Update.end(true);if(!otaUploadOk){otaUploadResponseCode=500;otaUploadError=String("Firmware validation failed. Error ")+String(Update.getError());}}\n    }else if(u.status==UPLOAD_FILE_ABORTED){Update.abort();otaUploadOk=false;otaUploadResponseCode=500;otaUploadError="Firmware upload aborted";}''','''    }else if(u.status==UPLOAD_FILE_WRITE){\n      if(otaUploadAllowed&&!otaUploadError.length()&&Update.write(u.buf,u.currentSize)!=u.currentSize){otaUploadResponseCode=500;otaUploadError=String("Firmware write failed. Error ")+String(Update.getError());Update.abort();otaUploadAllowed=false;if(otaExternalClaimed){remoteUpdateReleaseExternalOperation();otaExternalClaimed=false;}}\n    }else if(u.status==UPLOAD_FILE_END){\n      if(otaUploadAllowed&&!otaUploadError.length()){otaUploadOk=Update.end(true);if(!otaUploadOk){otaUploadResponseCode=500;otaUploadError=String("Firmware validation failed. Error ")+String(Update.getError());}}if(otaExternalClaimed){remoteUpdateReleaseExternalOperation();otaExternalClaimed=false;}\n    }else if(u.status==UPLOAD_FILE_ABORTED){Update.abort();if(otaExternalClaimed){remoteUpdateReleaseExternalOperation();otaExternalClaimed=false;}otaUploadOk=false;otaUploadResponseCode=500;otaUploadError="Firmware upload aborted";}''')
replace('firmware/src/main.cpp','''  server.on("/api/reboot",HTTP_POST,[]{if(!requireAdmin())return;sendJson("{\\"ok\\":true,\\"message\\":\\"Rebooting NanoC6\\"}");otaAutoRebootPending=true;otaAutoRebootAt=millis()+700;});\n  server.on("/api/rollback",HTTP_POST,[]{\n    if(!requireAdmin())return;const esp_partition_t* running=esp_ota_get_running_partition();const esp_partition_t* other=esp_ota_get_next_update_partition(running);\n    if(!otaPartitionValid(other)){server.send(404,"text/plain","No valid previous firmware is available in the other OTA slot");return;}\n    if(esp_ota_set_boot_partition(other)!=ESP_OK){server.send(500,"text/plain","Could not select the previous firmware slot");return;}\n    sendJson("{\\"ok\\":true,\\"message\\":\\"Previous firmware selected. Press Reboot NanoC6.\\"}");\n  });''','''  server.on("/api/reboot",HTTP_POST,[]{if(!requireAdmin())return;if(remoteUpdateOperationBusy()||Update.isRunning()){server.send(409,"application/json","{\\"ok\\":false,\\"error\\":\\"A firmware operation is already active\\"}");return;}sendJson("{\\"ok\\":true,\\"message\\":\\"Rebooting NanoC6\\"}");otaAutoRebootPending=true;otaAutoRebootAt=millis()+700;});\n  server.on("/api/rollback",HTTP_POST,[]{\n    if(!requireAdmin())return;if(remoteUpdateOperationBusy()||Update.isRunning()){server.send(409,"application/json","{\\"ok\\":false,\\"error\\":\\"A firmware operation is already active\\"}");return;}const esp_partition_t* running=esp_ota_get_running_partition();const esp_partition_t* other=esp_ota_get_next_update_partition(running);\n    if(!otaPartitionValid(other)){server.send(404,"text/plain","No valid previous firmware is available in the other OTA slot");return;}\n    if(!remoteUpdateSetRollbackHold(ANDERSON_FIRMWARE_VERSION)){server.send(500,"text/plain","Could not save the rejected-release update hold");return;}\n    if(esp_ota_set_boot_partition(other)!=ESP_OK){remoteUpdateClearHold();server.send(500,"text/plain","Could not select the previous firmware slot");return;}\n    JsonDocument d;d["ok"]=true;d["message"]="Previous firmware selected and the current release is marked rejected.";d["rejectedVersion"]=ANDERSON_FIRMWARE_VERSION;d["legacyRollbackCaution"]="If the previous slot is older than 3.1.10, it cannot enforce the new update-hold key. Keep its Internet/OTA access blocked until you intentionally resume updates or install a newer fixed release.";String out;serializeJson(d,out);sendJson(out);\n  });''')
replace('firmware/src/main.cpp','store.begin();eventStateBegin();remoteUpdateNoteBoot(ANDERSON_FIRMWARE_VERSION);loadPinAuthConfig();','store.begin();eventStateBegin();loadPinAuthConfig();')
replace('firmware/src/main.cpp','setupRoutes();server.begin();networkServerStarted=true;lastStationIp=(uint32_t)WiFi.localIP();evaluateSchedule(true);digitalWrite(BLUE_LED,LOW);','setupRoutes();server.begin();networkServerStarted=true;lastStationIp=(uint32_t)WiFi.localIP();evaluateSchedule(true);remoteUpdateNoteBoot(ANDERSON_FIRMWARE_VERSION,ANDERSON_BUILD_COMMIT);digitalWrite(BLUE_LED,LOW);')

# Release build identity is generated from the exact checked-out commit before compilation.
p=ROOT/'tools/release.py';s=p.read_text();
s=s.replace("MAIN = ROOT / 'firmware/src/main.cpp'\n","MAIN = ROOT / 'firmware/src/main.cpp'\nBUILD_IDENTITY = ROOT / 'firmware/include/BuildIdentity.h'\n",1)
s=s.replace('''def prepare():\n    validate_runtime_version()\n    check()\n    lines = ['#pragma once', '#include <Arduino.h>']''','''def prepare():\n    validate_runtime_version()\n    check()\n    commit = git('rev-parse', 'HEAD')\n    BUILD_IDENTITY.write_text('#pragma once\\n#define ANDERSON_BUILD_COMMIT "' + commit + '"\\n')\n    lines = ['#pragma once', '#include <Arduino.h>']''',1)
p.write_text(s)

# UI: operation-scoped identity verification and asynchronous remote worker polling.
p=ROOT/'firmware/web/index.html';html=p.read_text()
html=html.replace('Automatic signed updates are enabled. The NanoC6 checks every 15 minutes, verifies the signature and SHA-256, installs to the inactive OTA slot, then reboots. Manual Check/Install remain available as fallback.','Automatic signed updates are enabled. The NanoC6 checks 20 seconds after boot and every 5 minutes while healthy, verifies the signature and SHA-256, installs to the inactive OTA slot, then reboots. Manual Check/Install remain available as fallback.')
html=html.replace('<button id="installRemoteFirmware" class="btn primary" style="width:100%;margin-top:9px" disabled>Install Verified Remote Update</button>','<button id="installRemoteFirmware" class="btn primary" style="width:100%;margin-top:9px" disabled>Install Verified Remote Update</button><button id="resumeRemoteFirmware" class="btn" style="width:100%;margin-top:9px" hidden>Resume Automatic Updates</button>')
start=html.index("let otaBeforePartition='',otaExpectedPartition='',otaExpectedVersion=';")
end=html.index("function refreshVisibleState()",start)
new_js=r'''let otaOperation=null,remoteUpdateVersion='',remoteUpdateCommit='';
async function loadFirmwareInfo(){try{const f=await api('/api/firmware?ts='+Date.now()),mb=f.slotSize?(f.slotSize/1048576).toFixed(2):'—';$('fwMeta').innerHTML=`<strong>Running:</strong> ${f.runningPartition||'—'}${f.version?' • '+f.version:''}<br><span class="sub">Source: ${f.buildCommit||'unknown'} • Update slot: ${f.nextPartition||'—'} • ${mb} MB maximum app size</span>`;$('rollbackFirmware').disabled=!f.previousAvailable;try{const r=await api('/api/remote-update?ts='+Date.now());$('resumeRemoteFirmware').hidden=!r.updateHold;if(r.updateHold)$('remoteFwStatus').textContent=`Automatic update hold active for rejected release ${r.rejectedVersion||'unknown'}. A newer fixed release may still be offered.`}catch(e){}}catch(e){$('fwMeta').textContent=API_MODE?'Firmware information unavailable.':'Connect to the NanoC6 to manage firmware.'}}
function beginFirmwareOperation(snapshot,opts={}){otaOperation={targetPartition:snapshot?.nextPartition||'',expectedVersion:opts.version||'',expectedCommit:opts.commit||'',localUnknown:!!opts.localUnknown};return otaOperation}
function clearFirmwareOperation(){otaOperation=null}
async function waitForFirmwareReturn(){const op=otaOperation;if(!op)return;let tries=0;$('fwStatus').textContent='NanoC6 is rebooting. Waiting for Wi-Fi and the web server to return…';const poll=async()=>{tries++;try{const {response:r,text}=await controllerRequest('/api/firmware?ts='+Date.now(),{cache:'no-store'},5000);if(r.ok){const f=JSON.parse(text),actualVersion=f.version||f.appVersion||'',partitionOk=!op.targetPartition||f.runningPartition===op.targetPartition,versionOk=!op.expectedVersion||actualVersion===op.expectedVersion,commitOk=!op.expectedCommit||f.buildCommit===op.expectedCommit;if(op.localUnknown&&op.targetPartition&&f.runningPartition===op.targetPartition){$('fwStatus').textContent=`Boot slot changed to ${f.runningPartition}; image identity unverified because local BIN metadata was not known.`;clearFirmwareOperation();loadFirmwareInfo();return}if(!op.localUnknown&&partitionOk&&versionOk&&commitOk){$('fwStatus').textContent=`Verified Anderson Home ${actualVersion} from ${f.buildCommit||'unknown commit'} is running on ${f.runningPartition||'the target slot'}. Refreshing…`;clearFirmwareOperation();setTimeout(()=>location.reload(),700);return}if(f.runningPartition){const why=[];if(!partitionOk)why.push(`slot ${f.runningPartition} != ${op.targetPartition}`);if(!versionOk)why.push(`version ${actualVersion||'unknown'} != ${op.expectedVersion}`);if(!commitOk)why.push(`commit ${f.buildCommit||'unknown'} != ${op.expectedCommit}`);$('fwStatus').textContent=`Controller returned, but requested firmware identity is not verified (${why.join('; ')}). Still checking…`}}}catch(e){}if(tries<45){setTimeout(poll,1000)}else{$('fwStatus').textContent='Controller reconnect check ended without verifying the requested firmware identity. The old image may still be running or may have rolled back.';$('uploadFirmware').disabled=false;clearFirmwareOperation()}};setTimeout(poll,2600)}
function stageFirmware(){const file=$('firmwareFile').files&&$('firmwareFile').files[0];if(!file)return status('Choose an app-only .bin firmware file first.');if(!/\.bin$/i.test(file.name))return status('Firmware file must end in .bin.');api('/api/firmware?ts='+Date.now()).then(snapshot=>{beginFirmwareOperation(snapshot,{localUnknown:true});const fd=new FormData();fd.append('firmware',file,file.name);const x=new XMLHttpRequest();x.open('POST','/api/update');if(window.andersonAuthToken)x.setRequestHeader('X-Anderson-Session',window.andersonAuthToken);$('uploadFirmware').disabled=true;$('fwProgress').value=0;$('fwStatus').textContent='Starting update. Verifying Jason’s session and opening the inactive OTA slot…';x.upload.onprogress=e=>{if(e.lengthComputable){const p=Math.round(e.loaded*100/e.total);$('fwProgress').value=p;$('fwStatus').textContent=p<100?'Uploading and writing firmware to the inactive OTA slot… '+p+'%':'Upload complete. Validating image and selecting the new boot slot…'}};x.onload=()=>{if(x.status>=200&&x.status<300){$('fwProgress').value=100;$('fwStatus').textContent='Firmware image validated. Rebooting NanoC6…';status('Firmware installed. NanoC6 is rebooting.');waitForFirmwareReturn()}else{$('uploadFirmware').disabled=false;$('fwStatus').textContent=x.responseText||'Firmware update failed.';clearFirmwareOperation();status('Firmware update failed.');if(x.status===401)window.dispatchEvent(new Event('anderson-auth-required'))}};x.onerror=()=>{$('uploadFirmware').disabled=false;$('fwStatus').textContent='Upload connection failed before installation completed.';clearFirmwareOperation();status('Firmware upload failed.')};x.send(fd)}).catch(e=>{$('fwStatus').textContent='Could not capture a fresh update target: '+e.message})}
async function pollRemoteOperation(id,timeoutMs=200000){const deadline=Date.now()+timeoutMs;for(;;){const d=await api('/api/remote-update?ts='+Date.now());if(Number(d.operationId)===Number(id)&&d.operationComplete)return d;if(Date.now()>deadline)throw new Error('firmware operation timed out');$('remoteFwStatus').textContent=`${d.phase||'Working'}${d.bytes?` • ${d.downloadedBytes||0}/${d.bytes} bytes`:''}`;await new Promise(r=>setTimeout(r,700))}}
async function checkRemoteFirmware(){const b=$('checkRemoteFirmware'),install=$('installRemoteFirmware'),out=$('remoteFwStatus');b.disabled=true;install.disabled=true;remoteUpdateVersion='';remoteUpdateCommit='';out.textContent='Queueing signed update check…';try{const q=await post('/api/remote-update/check',{},10000);if(!q.operationId)throw new Error(q.message||'check could not be queued');const d=await pollRemoteOperation(q.operationId,45000);$('resumeRemoteFirmware').hidden=!d.updateHold;if(d.ok&&d.signatureValid){remoteUpdateVersion=d.updateAvailable?(d.availableVersion||''):'';remoteUpdateCommit=d.updateAvailable?(d.commit||''):'';install.disabled=!remoteUpdateVersion;out.textContent=d.updateAvailable?`Verified update ${d.availableVersion} (${d.commit||'unknown commit'}) is available.`:(d.message||'Signed manifest verified; this firmware is current.')}else out.textContent=d.message||'Remote-update verification failed.'}catch(e){out.textContent='Remote-update check failed: '+e.message}finally{b.disabled=false}}
async function installRemoteFirmware(){const b=$('installRemoteFirmware'),check=$('checkRemoteFirmware'),out=$('remoteFwStatus');if(!remoteUpdateVersion)return checkRemoteFirmware();if(!confirm(`Download, verify, install, and reboot into Anderson Home ${remoteUpdateVersion}?`))return;b.disabled=true;check.disabled=true;try{const snapshot=await api('/api/firmware?ts='+Date.now());beginFirmwareOperation(snapshot);out.textContent=`Queueing Anderson Home ${remoteUpdateVersion} secure installation…`;const q=await post('/api/remote-update/install',{},10000);if(!q.operationId)throw new Error(q.message||'install could not be queued');const d=await pollRemoteOperation(q.operationId,200000);if(d.ok&&d.installReady){otaOperation.expectedVersion=d.availableVersion||remoteUpdateVersion;otaOperation.expectedCommit=d.commit||remoteUpdateCommit;out.textContent=`Anderson Home ${otaOperation.expectedVersion} verified and staged from ${otaOperation.expectedCommit}. NanoC6 is rebooting…`;$('fwStatus').textContent=out.textContent;waitForFirmwareReturn();return}throw new Error(d.message||'remote firmware installation failed')}catch(e){out.textContent='Remote firmware installation failed: '+e.message;b.disabled=false;check.disabled=false;clearFirmwareOperation()}}
$('checkRemoteFirmware').addEventListener('click',checkRemoteFirmware);$('installRemoteFirmware').addEventListener('click',installRemoteFirmware);$('resumeRemoteFirmware').addEventListener('click',async()=>{try{const d=await post('/api/remote-update/resume',{},10000);$('resumeRemoteFirmware').hidden=!d.updateHold;$('remoteFwStatus').textContent=d.message||'Automatic updates resumed.'}catch(e){$('remoteFwStatus').textContent='Could not resume updates: '+e.message}});$('uploadFirmware').addEventListener('click',stageFirmware);
$('rebootNano').addEventListener('click',async()=>{if(!confirm('Reboot the NanoC6 now?'))return;$('fwStatus').textContent='Rebooting NanoC6…';try{await post('/api/reboot',{})}catch(e){$('fwStatus').textContent='Reboot request failed: '+e.message;return}setTimeout(()=>{loadState();loadFirmwareInfo()},6500)});
$('rollbackFirmware').addEventListener('click',async()=>{if(!confirm('Select the previous firmware slot for the next reboot and hold this release from automatic reinstall?'))return;try{const d=await post('/api/rollback',{});$('fwStatus').textContent=(d.message||'Previous firmware selected.')+(d.legacyRollbackCaution?' IMPORTANT: '+d.legacyRollbackCaution:'');status('Previous firmware selected for next boot.')}catch(e){$('fwStatus').textContent='Rollback selection failed: '+e.message}});
'''
html=html[:start]+new_js+html[end:]
p.write_text(html)

# Regression tests: nonblocking BLE queue and audited OTA/UI/publisher invariants.
write('tools/test_connection_recovery.py',r'''"""Focused BLE delivery and request-recovery regressions."""
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[1]
ble=(ROOT/'firmware/src/BleController.cpp').read_text();hdr=(ROOT/'firmware/include/BleController.h').read_text()
assert 'delay(RELIABLE_RETRY_DELAY_MS)' not in ble
assert 'writeReliableToTargets' not in ble
assert 'servicePendingWrites' in ble and 'PendingFrame' in hdr
assert 'WRITE_GAP_MS=18UL' in ble and '(uint32_t)(now-lastWrite)<WRITE_GAP_MS' in ble
assert 'p->generation!=generation' in ble
assert 'failureRetryMs' in ble
assert 'STATIC_REASSERT_INTERVAL_MS=30000UL' in ble
assert 't.effect==Effect::Jump&&count==1' in ble
# Model the fixed-size, superseding queue: failed work retries, then a newer generation cancels it.
class P:
 def __init__(s):s.gen=0;s.pending=False;s.remaining=0;s.fail=0
 def put(s,reliable=True):s.gen+=1;s.pending=True;s.remaining=2 if reliable else 1;s.fail=0;return s.gen
 def result(s,g,ok):
  if not s.pending or g!=s.gen:return
  if ok:s.remaining-=1;s.pending=s.remaining>0;s.fail=0
  else:s.fail+=1
p=P();g=p.put();p.result(g,False);assert p.pending and p.fail==1
g2=p.put();p.result(g,True);assert p.pending and p.gen==g2
p.result(g2,True);assert p.pending and p.remaining==1
p.result(g2,True);assert not p.pending
print('PASS: BLE delivery uses a bounded nonblocking superseding queue with retry/convergence semantics')
html=(ROOT/'firmware/web/index.html').read_text();helper=html[html.index('async function controllerRequest('):html.index('/* ANDERSON_LOCKOUT_SAFE_PROFILE_GATE */')]
js=helper+r'''\nconst assert=require('node:assert/strict');function stalled(signal){return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));}(async()=>{global.fetch=(_,options)=>stalled(options.signal);await assert.rejects(controllerRequest('/test',{},5),/timed out/);global.fetch=async()=>({ok:true,text:async()=>'{"ok":true}'});const result=await controllerRequest('/test',{},50);assert.equal(JSON.parse(result.text).ok,true);console.log('PASS: timed-out requests release the UI for retry')})().catch(e=>{console.error(e);process.exitCode=1});\n'''
subprocess.run(['node'],input=js,text=True,check=True)
''')

# Replace the old extracted synchronous OTA timing test with a model of completion-time backoff plus source guards.
p=ROOT/'tools/test_maintenance.py';tm=p.read_text();a=tm.index('# Test the actual automatic-update loop and monitor countdown with simulated time.');b=tm.index('# Focused failure regressions',a)
new=r'''# Validate asynchronous OTA cadence/backoff without compiling network/RTOS implementation.
remote=(Path(__file__).resolve().parents[1]/'firmware/src/RemoteUpdate.cpp').read_text()
assert 'OTA_AUTO_FIRST_CHECK_MS=20UL*1000UL' in remote
assert 'OTA_AUTO_INTERVAL_MS=5UL*60UL*1000UL' in remote
assert 'OTA_AUTO_RETRY_BASE_MS=30UL*1000UL' in remote
assert 'OTA_AUTO_RETRY_MAX_MS=5UL*60UL*1000UL' in remote
assert 'completed=millis()' in remote and 'scheduleAutoRetry(completed)' in remote
assert 'xTaskCreate(worker,"anderson-ota"' in remote
assert 'OTA_MANIFEST_MAX_BYTES=4096' in remote and 'OTA_DOWNLOAD_DEADLINE_MS=180000UL' in remote
failures=0;delays=[]
for _ in range(5):
 delays.append(min(30000*(2**min(failures,4)),300000));failures+=1
assert delays==[30000,60000,120000,240000,300000]
failures=0;assert min(30000*(2**min(failures,4)),300000)==30000
# Completion-time scheduling: a 40s operation plus 30s backoff waits until t=70s, not t=30s.
started=100000;completed=started+40000;assert completed+30000==170000
print('PASS: 20-second startup, five-minute healthy cadence, 30/60/120/240/300 completion-time backoff, bounded manifest and absolute download deadline')

'''
tm=tm[:a]+new+tm[b:];p.write_text(tm)

AUDIT_TEST=r'''from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
main=(ROOT/'firmware/src/main.cpp').read_text();ui=(ROOT/'firmware/web/index.html').read_text();remote=(ROOT/'firmware/src/RemoteUpdate.cpp').read_text();pub=(ROOT/'.github/workflows/publish-anderson-home.yml').read_text();clean=(ROOT/'.github/scripts/anderson-branch-cleanup.sh').read_text()
assert 'd["buildCommit"]=ANDERSON_BUILD_COMMIT' in main
assert 'remoteUpdateNoteBoot(ANDERSON_FIRMWARE_VERSION,ANDERSON_BUILD_COMMIT)' in main
assert main.index('server.begin()') < main.index('remoteUpdateNoteBoot(ANDERSON_FIRMWARE_VERSION,ANDERSON_BUILD_COMMIT)')
assert 'partitionVerified||versionVerified' not in ui and 'versionOk&&commitOk' in ui
assert 'image identity unverified because local BIN metadata was not known' in ui
assert '/api/remote-update/resume' in main and 'remoteUpdateSetRollbackHold' in main
assert 'legacyRollbackCaution' in main
assert 'getString()' not in remote and 'OTA_MANIFEST_MAX_BYTES=4096' in remote and 'OTA_DOWNLOAD_DEADLINE_MS=180000UL' in remote
assert 'remote-update/releases/$VERSION.json' in pub
assert pub.index('Fast-forward production main') < pub.index('Promote the signed OTA manifest')
assert 'actions/runs/$BUILD_RUN_ID' in pub and 'head_repository.full_name' in pub
assert 'merge-base --is-ancestor "$sha" origin/main' in clean and 'status=in_progress' in clean
print('PASS: Anderson v3.1.10 audit invariants present')
'''
write('tools/test_audit_fixes.py',AUDIT_TEST)

# Build workflow uses one persistent release branch and validates audit invariants.
p=ROOT/'.github/workflows/compile-anderson-home-multi.yml';w=p.read_text();w=w.replace("branches: ['codex/**']","branches: ['codex/release-current']");w=w.replace("      - name: Check Anderson source regressions\n        run: python tools/test_regressions.py\n","      - name: Check Anderson source regressions\n        run: python tools/test_regressions.py\n      - name: Check audited delivery invariants\n        run: python tools/test_audit_fixes.py\n");w=w.replace("key: ${{ runner.os }}-anderson-objects-v1-${{ hashFiles('firmware/platformio.ini') }}-${{ github.sha }}","key: ${{ runner.os }}-anderson-objects-v2-${{ hashFiles('firmware/platformio.ini') }}-${{ github.ref_name }}-${{ github.sha }}");w=w.replace("${{ runner.os }}-anderson-objects-v1-${{ hashFiles('firmware/platformio.ini') }}-","${{ runner.os }}-anderson-objects-v2-${{ hashFiles('firmware/platformio.ini') }}-${{ github.ref_name }}-");p.write_text(w)

PUBLISH=r'''name: Publish Anderson Home Firmware
on:
  workflow_run:
    workflows: ["Build Anderson Home Firmware"]
    types: [completed]
  workflow_dispatch:
    inputs:
      build_run_id: {description: Successful Anderson firmware build run ID, required: true, type: string}
      head_sha: {description: Exact firmware source commit SHA from that build, required: true, type: string}
      head_branch: {description: Release branch used for that build, required: true, type: string}
concurrency: {group: anderson-production-publish, cancel-in-progress: false}
permissions: {contents: write, actions: write}
jobs:
  publish:
    if: >-
      (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.head_branch == 'codex/release-current') ||
      (github.event_name == 'workflow_dispatch' && inputs.head_branch == 'codex/release-current')
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    env:
      GH_TOKEN: ${{ github.token }}
      HEAD_SHA: ${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || inputs.head_sha }}
      HEAD_BRANCH: ${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_branch || inputs.head_branch }}
      BUILD_RUN_ID: ${{ github.event_name == 'workflow_run' && github.event.workflow_run.id || inputs.build_run_id }}
    steps:
      - uses: actions/checkout@v4
        with: {ref: main, fetch-depth: 0}
      - name: Validate trusted build run before candidate checkout
        run: |
          gh api "/repos/$GITHUB_REPOSITORY/actions/runs/$BUILD_RUN_ID" > /tmp/run.json
          python - <<'PY'
          import json,os
          r=json.load(open('/tmp/run.json'))
          repo=os.environ['GITHUB_REPOSITORY']; sha=os.environ['HEAD_SHA']; branch=os.environ['HEAD_BRANCH']
          assert r['name']=='Build Anderson Home Firmware'
          assert r['conclusion']=='success'
          assert r['head_repository']['full_name']==repo
          assert r['head_sha']==sha and r['head_branch']==branch=='codex/release-current'
          assert r['event'] in ('push','workflow_dispatch')
          PY
          git fetch origin "$HEAD_BRANCH" --quiet
          test "$(git rev-parse "origin/$HEAD_BRANCH")" = "$HEAD_SHA"
      - name: Checkout exact trusted candidate
        uses: actions/checkout@v4
        with: {ref: '${{ env.HEAD_SHA }}', fetch-depth: 0}
      - name: Resolve production version
        run: |
          VERSION="$(tr -d '\r\n' < FIRMWARE_VERSION.txt)"
          [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+[a-z]?$ ]]
          echo "VERSION=$VERSION" >> "$GITHUB_ENV"
          echo "OTA_URL=https://github.com/${GITHUB_REPOSITORY}/releases/download/anderson-v$VERSION/and_$VERSION.bin" >> "$GITHUB_ENV"
          git fetch origin main --quiet
          git merge-base --is-ancestor origin/main "$HEAD_SHA"
      - name: Download exact successful build artifact
        run: gh run download "$BUILD_RUN_ID" --name "Anderson-Home-NanoC6-v$VERSION" --dir release-work
      - name: Verify artifact identity
        run: |
          python - <<'PY'
          from pathlib import Path
          import hashlib,json,os
          root=Path('release-work');version=os.environ['VERSION'];head=os.environ['HEAD_SHA'];manifest=json.loads((root/'release.json').read_text());name=f'and_{version}.bin';data=(root/name).read_bytes();digest=hashlib.sha256(data).hexdigest()
          assert manifest['version']==version and manifest['commit']==head and manifest['ota_slot_bytes']==0x1E0000
          assert data and data[0]==0xE9 and len(data)<0x1E0000
          assert manifest['files'][name]['bytes']==len(data) and manifest['files'][name]['sha256']==digest
          with open(os.environ['GITHUB_ENV'],'a') as f:f.write(f'OTA_BYTES={len(data)}\nOTA_SHA256={digest}\n')
          PY
      - name: Resolve durable or pending signed OTA manifest
        run: |
          mkdir -p publish-input; rm -f publish-input/latest.json
          for attempt in $(seq 1 120); do
            for path in "remote-update/releases/$VERSION.json" "remote-update/pending/$VERSION.json"; do
              if gh api -H "Accept: application/vnd.github.raw+json" "/repos/$GITHUB_REPOSITORY/contents/$path?ref=ota" > publish-input/latest.json 2>/dev/null && [ -s publish-input/latest.json ]; then break 2; fi
              rm -f publish-input/latest.json
            done
            sleep 5
          done
          test -s publish-input/latest.json
          python tools/verify_ota_manifest.py --manifest publish-input/latest.json --version "$VERSION" --bytes "$OTA_BYTES" --sha256 "$OTA_SHA256" --commit "$HEAD_SHA" --url "$OTA_URL"
      - name: Publish or verify immutable stable release
        run: |
          TAG="anderson-v$VERSION"
          if gh release view "$TAG" --json targetCommitish,isDraft,isPrerelease >/tmp/release.json 2>/dev/null; then
            python - <<'PY'
          import json,os
          r=json.load(open('/tmp/release.json'));assert r['targetCommitish']==os.environ['HEAD_SHA'];assert not r['isDraft'] and not r['isPrerelease']
          PY
          else
            gh release create "$TAG" "release-work/and_$VERSION.bin" release-work/release.json --target "$HEAD_SHA" --title "Anderson Home v$VERSION" --notes "Verified Anderson Home production release from commit $HEAD_SHA."
          fi
          rm -rf public-check;mkdir public-check;gh release download "$TAG" --pattern "and_$VERSION.bin" --pattern release.json --dir public-check
          cmp "release-work/and_$VERSION.bin" "public-check/and_$VERSION.bin";cmp release-work/release.json public-check/release.json
      - name: Fast-forward production main
        run: |
          git fetch origin main --quiet
          if [ "$(git rev-parse origin/main)" != "$HEAD_SHA" ]; then git merge-base --is-ancestor origin/main "$HEAD_SHA";git push origin "$HEAD_SHA:refs/heads/main"; fi
      - name: Promote the signed OTA manifest
        run: |
          git fetch origin ota --quiet;rm -rf ../anderson-ota;git worktree add -B ota-release ../anderson-ota origin/ota
          mkdir -p ../anderson-ota/remote-update/pending ../anderson-ota/remote-update/releases
          if [ -s ../anderson-ota/latest.json ]; then
            python - <<'PY'
          import json,os,re
          def v(x):
            m=re.fullmatch(r'(\d+)\.(\d+)\.(\d+)([a-z]?)',x);return (*map(int,m.groups()[:3]),m.group(4))
          cur=json.load(open('../anderson-ota/latest.json'))['payload'].splitlines()[0].split('=',1)[1]
          assert v(os.environ['VERSION'])>=v(cur),f'refusing OTA downgrade {cur} -> {os.environ["VERSION"]}'
          PY
          fi
          cp publish-input/latest.json ../anderson-ota/latest.json;cp publish-input/latest.json ../anderson-ota/remote-update/latest.json;cp publish-input/latest.json "../anderson-ota/remote-update/releases/$VERSION.json";rm -f "../anderson-ota/remote-update/pending/$VERSION.json"
          cd ../anderson-ota;git config user.name github-actions[bot];git config user.email 41898282+github-actions[bot]@users.noreply.github.com;git add latest.json remote-update
          if ! git diff --cached --quiet;then git commit -m "Publish signed Anderson Home v$VERSION OTA manifest";git push origin HEAD:refs/heads/ota;fi
      - name: Verify live OTA channel
        run: |
          gh api -H "Accept: application/vnd.github.raw+json" "/repos/$GITHUB_REPOSITORY/contents/latest.json?ref=ota" > /tmp/live.json
          cmp publish-input/latest.json /tmp/live.json
      - name: Production housekeeping
        continue-on-error: true
        env: {CLEAN_RELEASES: '1', DELETE_BRANCH: '${{ env.HEAD_BRANCH }}', BRANCH_MAX_AGE_HOURS: '2'}
        run: |
          bash .github/scripts/anderson-retention.sh
          bash .github/scripts/anderson-cache-cleanup.sh
          bash .github/scripts/anderson-branch-cleanup.sh
'''
write('.github/workflows/publish-anderson-home.yml',PUBLISH)

CLEAN=r'''#!/usr/bin/env bash
set -euo pipefail
: "${GH_TOKEN:?GH_TOKEN is required}";: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
MAX_AGE_HOURS="${BRANCH_MAX_AGE_HOURS:-2}";CURRENT_BRANCH="${GITHUB_REF_NAME:-}";NOW_EPOCH="$(date -u +%s)";DELETED=0;KEPT=0
is_protected_branch(){ case "$1" in main|ota|codex/release-current|anderson-android-icon-release|anderson-play-icon-v1.0.1|build/silverado-aaos|codex/silverado-*|codex/anderson-android-v1) return 0;;*) return 1;;esac; }
is_anderson_work_branch(){ case "$1" in automation/*|cleanup/*|cleanup-staging*|staging/*|publish/*|work/*|diag/*|codex/v*|codex/anderson-*|codex/release-*|codex/full-code-audit-*|codex/daily-*|codex/lighting-test-*|codex/remove-*|codex/release-cleanup-*|codex/system-monitor-*|codex/white-calibration-*) return 0;;*) return 1;;esac; }
# Fail closed: inability to inspect PRs or workflow activity must never cause deletion.
OPEN_PR_JSON="$(gh api --paginate "/repos/$GITHUB_REPOSITORY/pulls?state=open&per_page=100")" || { echo 'PR inspection failed; deleting nothing';exit 1; }
has_open_pr(){ jq -e --arg b "$1" '.[]|select(.head.repo.full_name==env.GITHUB_REPOSITORY and .head.ref==$b)' <<<"$OPEN_PR_JSON" >/dev/null; }
has_active_run(){ local b="$1";local json;json="$(gh api "/repos/$GITHUB_REPOSITORY/actions/runs?branch=$(printf %s "$b"|jq -sRr @uri)&per_page=20")" || return 0;jq -e '.workflow_runs[]|select(.status=="queued" or .status=="in_progress" or .status=="waiting" or .status=="requested" or .status=="pending")' <<<"$json" >/dev/null; }
in_main(){ local sha="$1";git fetch origin main --quiet;git merge-base --is-ancestor "$sha" origin/main; }
delete_if_safe(){ local branch="$1";is_protected_branch "$branch"&&return 1;has_open_pr "$branch"&&return 1;has_active_run "$branch"&&return 1;local sha;sha="$(gh api "/repos/$GITHUB_REPOSITORY/branches/$branch" --jq '.commit.sha')"||return 1;in_main "$sha"||return 1;echo "Deleting integrated inactive Anderson branch: $branch";gh api --method DELETE "/repos/$GITHUB_REPOSITORY/git/refs/heads/$branch";DELETED=$((DELETED+1));return 0; }
mapfile -t BRANCHES < <(gh api --paginate "/repos/$GITHUB_REPOSITORY/branches?per_page=100" --jq '.[].name') || { echo 'Branch inspection failed; deleting nothing';exit 1; }
for branch in "${BRANCHES[@]:-}";do [[ -n "$branch" ]]||continue;is_protected_branch "$branch"&&continue;is_anderson_work_branch "$branch"||continue;[[ "$branch" == "$CURRENT_BRANCH" ]]&&continue;sha="$(gh api "/repos/$GITHUB_REPOSITORY/branches/$branch" --jq '.commit.sha' 2>/dev/null)"||continue;committed="$(gh api "/repos/$GITHUB_REPOSITORY/commits/$sha" --jq '.commit.committer.date' 2>/dev/null)"||continue;age_hours=$(( (NOW_EPOCH-$(date -u -d "$committed" +%s))/3600 ));if [[ "$branch" == "${DELETE_BRANCH:-}" ]]||((age_hours>=MAX_AGE_HOURS));then delete_if_safe "$branch"||{ echo "Keeping unsafe/unintegrated/active branch: $branch";KEPT=$((KEPT+1));};else KEPT=$((KEPT+1));fi;done
echo "Anderson branch cleanup complete: deleted=$DELETED kept=$KEPT"
'''
write('.github/scripts/anderson-branch-cleanup.sh',CLEAN)

# Documentation alignment without accumulating another handoff.
for path in ('AGENTS.md','README.md'):
 p=ROOT/path
 if not p.exists():continue
 t=p.read_text()
 t=t.replace('codex/release-*','codex/release-current').replace('codex/ branch','codex/release-current branch').replace('codex/` branch','codex/release-current` branch')
 t=t.replace('one 3 PM','four 00:00/06:00/12:00/18:00').replace('every 15 minutes','every 5 minutes').replace('one minute','20 seconds')
 p.write_text(t)

# Add a real resumable delivery receipt command to release.py. It deliberately requires a signer path only at the signing stage.
p=ROOT/'tools/release.py';s=p.read_text()
insert=r'''
def deliver(args):
    """Resume the canonical release-current build/publish path and emit a receipt."""
    source=args.source_sha or git('rev-parse','HEAD'); receipt=ROOT/'.anderson-delivery.json'
    state={'source_sha':source,'version':version(),'branch':'codex/release-current'}
    if receipt.exists():
        try:
            prior=json.loads(receipt.read_text())
            if prior.get('source_sha')==source:state.update(prior)
        except Exception:pass
    def gh(*a):return subprocess.check_output(['gh',*a],text=True).strip()
    if git('rev-parse','HEAD')!=source:raise ValueError('Working tree must be at --source-sha')
    run=state.get('build_run_id')
    if not run:
        subprocess.run(['gh','workflow','run','compile-anderson-home-multi.yml','--ref','codex/release-current'],check=True)
        import time
        for _ in range(30):
            time.sleep(2);raw=gh('run','list','--workflow','compile-anderson-home-multi.yml','--branch','codex/release-current','--limit','10','--json','databaseId,headSha,status,conclusion');rows=json.loads(raw);hit=next((x for x in rows if x['headSha']==source),None)
            if hit:run=hit['databaseId'];break
        if not run:raise RuntimeError('Could not resolve build run for source SHA')
        state['build_run_id']=run;receipt.write_text(json.dumps(state,indent=2)+'\n')
    print(json.dumps(state,indent=2))
'''
s=s.replace("\n\nif __name__ == '__main__':",insert+"\n\nif __name__ == '__main__':",1)
s=s.replace("    p = sub.add_parser('download')","    p = sub.add_parser('deliver')\n    p.add_argument('--source-sha')\n    p = sub.add_parser('download')",1)
s=s.replace("    elif args.command == 'download': download(args)","    elif args.command == 'download': download(args)\n    elif args.command == 'deliver': deliver(args)",1)
p.write_text(s)

print('v3.1.10 audit fixes applied')
