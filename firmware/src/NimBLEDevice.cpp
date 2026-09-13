#include "NimBLEDevice.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include "esp_bt.h"
#include <atomic>
#include <cstdio>
#include <cstring>

static bool g_init=false;static std::atomic_bool g_synced{false};static uint8_t g_own=BLE_OWN_ADDR_PUBLIC;static SemaphoreHandle_t g_sync=nullptr;static SemaphoreHandle_t g_bleMutex=nullptr;static NimBLEScan g_scan;
static uint16_t uuid16(const char* s){if(!s)return 0;return (uint16_t)strtoul(s,nullptr,16);}

NimBLEAddress::NimBLEAddress(const std::string& t,uint8_t type){addr_.type=type;unsigned x[6];if(sscanf(t.c_str(),"%x:%x:%x:%x:%x:%x",&x[5],&x[4],&x[3],&x[2],&x[1],&x[0])==6){for(int i=0;i<6;i++)addr_.val[i]=(uint8_t)x[i];null_=false;}}
std::string NimBLEAddress::toString()const{if(null_)return std::string();char b[18];snprintf(b,sizeof(b),"%02X:%02X:%02X:%02X:%02X:%02X",addr_.val[5],addr_.val[4],addr_.val[3],addr_.val[2],addr_.val[1],addr_.val[0]);return b;}

void NimBLEDevice::hostTask(void*){nimble_port_run();nimble_port_freertos_deinit();}
void NimBLEDevice::onSync(){if(ble_hs_id_infer_auto(0,&g_own)!=0)g_own=BLE_OWN_ADDR_PUBLIC;g_synced.store(true,std::memory_order_release);if(g_sync)xSemaphoreGive(g_sync);}
void NimBLEDevice::init(const char* name){
  if(g_init){
    if(!ready()&&g_sync)xSemaphoreTake(g_sync,pdMS_TO_TICKS(3000));
    return;
  }
  g_sync=xSemaphoreCreateBinary();
  g_bleMutex=xSemaphoreCreateMutex();
  if(!g_sync||!g_bleMutex){
    if(g_sync){vSemaphoreDelete(g_sync);g_sync=nullptr;}
    if(g_bleMutex){vSemaphoreDelete(g_bleMutex);g_bleMutex=nullptr;}
    return;
  }
  g_synced.store(false,std::memory_order_release);
  if(nimble_port_init()!=0){
    vSemaphoreDelete(g_sync);g_sync=nullptr;
    vSemaphoreDelete(g_bleMutex);g_bleMutex=nullptr;
    return;
  }
  ble_svc_gap_init();
  ble_svc_gatt_init();
  ble_svc_gap_device_name_set(name?name:"AndersonHome-Bridge");
  ble_hs_cfg.sync_cb=&NimBLEDevice::onSync;
  nimble_port_freertos_init(&NimBLEDevice::hostTask);
  g_init=true;
  xSemaphoreTake(g_sync,pdMS_TO_TICKS(3000));
}
bool NimBLEDevice::ready(){return g_init&&g_synced.load(std::memory_order_acquire);}
void NimBLEDevice::setPower(int){
#if CONFIG_BT_ENABLED
  esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_DEFAULT,ESP_PWR_LVL_P3);
#endif
}
NimBLEScan* NimBLEDevice::getScan(){return &g_scan;}uint8_t NimBLEDevice::ownAddrType(){return g_own;}

int NimBLEScan::gapEvent(struct ble_gap_event* e,void* arg){auto* self=(NimBLEScan*)arg;if(e->type==BLE_GAP_EVENT_DISC){ble_hs_adv_fields f{};ble_hs_adv_parse_fields(&f,e->disc.data,e->disc.length_data);std::string name;if(f.name&&f.name_len)name.assign((const char*)f.name,f.name_len);NimBLEAddress a;char b[18];snprintf(b,sizeof(b),"%02X:%02X:%02X:%02X:%02X:%02X",e->disc.addr.val[5],e->disc.addr.val[4],e->disc.addr.val[3],e->disc.addr.val[2],e->disc.addr.val[1],e->disc.addr.val[0]);a=NimBLEAddress(b,e->disc.addr.type);bool exists=false;for(auto&x:self->results_.items_)if(x.getAddress().toString()==a.toString()){exists=true;break;}if(!exists)self->results_.items_.emplace_back(name,a,e->disc.rssi);}else if(e->type==BLE_GAP_EVENT_DISC_COMPLETE){if(g_sync)xSemaphoreGive(g_sync);}return 0;}
NimBLEScanResults NimBLEScan::getResults(uint32_t ms,bool){NimBLEDevice::init("AndersonHome-Bridge");results_.items_.clear();if(!NimBLEDevice::ready())return results_;if(g_bleMutex)xSemaphoreTake(g_bleMutex,portMAX_DELAY);if(g_sync)xSemaphoreTake(g_sync,0);ble_gap_disc_params p{};p.passive=active_?0:1;p.itvl=interval_;p.window=window_;p.filter_duplicates=1;int rc=ble_gap_disc(NimBLEDevice::ownAddrType(),(int32_t)ms,&p,&NimBLEScan::gapEvent,this);if(rc==0&&g_sync)xSemaphoreTake(g_sync,pdMS_TO_TICKS(ms+1000));ble_gap_disc_cancel();if(g_bleMutex)xSemaphoreGive(g_bleMutex);return results_;}

NimBLEClient::NimBLEClient(){opDone_=xSemaphoreCreateBinary();service_.client_=this;}
NimBLEClient::~NimBLEClient(){disconnect();if(opDone_)vSemaphoreDelete(opDone_);}
int NimBLEClient::gapEvent(struct ble_gap_event* e,void* arg){auto* self=(NimBLEClient*)arg;if(e->type==BLE_GAP_EVENT_CONNECT){self->opStatus_=e->connect.status;if(e->connect.status==0){self->connHandle_=e->connect.conn_handle;self->connected_=true;}if(self->opDone_)xSemaphoreGive(self->opDone_);}else if(e->type==BLE_GAP_EVENT_DISCONNECT){self->connected_=false;self->connHandle_=BLE_HS_CONN_HANDLE_NONE;}return 0;}
bool NimBLEClient::connect(const NimBLEAddress& a){if(a.isNull())return false;NimBLEDevice::init("AndersonHome-Bridge");if(!NimBLEDevice::ready())return false;if(g_bleMutex)xSemaphoreTake(g_bleMutex,portMAX_DELAY);if(opDone_)xSemaphoreTake(opDone_,0);opStatus_=BLE_HS_EUNKNOWN;int rc=ble_gap_connect(NimBLEDevice::ownAddrType(),&a.native(),timeoutMs_,nullptr,&NimBLEClient::gapEvent,this);if(rc==0&&opDone_)xSemaphoreTake(opDone_,pdMS_TO_TICKS(timeoutMs_+1000));bool ok=connected_&&opStatus_==0;if(g_bleMutex)xSemaphoreGive(g_bleMutex);return ok;}
void NimBLEClient::disconnect(){if(connected_&&connHandle_!=BLE_HS_CONN_HANDLE_NONE){ble_gap_terminate(connHandle_,BLE_ERR_REM_USER_CONN_TERM);vTaskDelay(pdMS_TO_TICKS(30));}connected_=false;connHandle_=BLE_HS_CONN_HANDLE_NONE;}
int NimBLEClient::serviceCb(uint16_t,const ble_gatt_error* err,const ble_gatt_svc* svc,void* arg){auto*self=(NimBLEClient*)arg;if(err->status==0&&svc){self->service_.start_=svc->start_handle;self->service_.end_=svc->end_handle;return 0;}if(err->status==BLE_HS_EDONE){self->opStatus_=(self->service_.start_?0:BLE_HS_ENOENT);if(self->opDone_)xSemaphoreGive(self->opDone_);return 0;}self->opStatus_=err->status;if(self->opDone_)xSemaphoreGive(self->opDone_);return 0;}
NimBLERemoteService* NimBLEClient::getService(const char* u){if(!connected_)return nullptr;service_.start_=service_.end_=0;ble_uuid16_t id=BLE_UUID16_INIT(uuid16(u));if(opDone_)xSemaphoreTake(opDone_,0);int rc=ble_gattc_disc_svc_by_uuid(connHandle_,&id.u,&NimBLEClient::serviceCb,this);if(rc!=0)return nullptr;if(opDone_)xSemaphoreTake(opDone_,pdMS_TO_TICKS(3000));return service_.start_?&service_:nullptr;}
int NimBLEClient::characteristicCb(uint16_t,const ble_gatt_error* err,const ble_gatt_chr* chr,void* arg){auto*self=(NimBLERemoteService*)arg;if(err->status==0&&chr){self->chr_.valueHandle_=chr->val_handle;self->chr_.properties_=chr->properties;return 0;}auto* client=self->client_;if(err->status==BLE_HS_EDONE){client->opStatus_=self->chr_.valueHandle_?0:BLE_HS_ENOENT;if(client->opDone_)xSemaphoreGive(client->opDone_);return 0;}client->opStatus_=err->status;if(client->opDone_)xSemaphoreGive(client->opDone_);return 0;}
NimBLERemoteCharacteristic* NimBLERemoteService::getCharacteristic(const char* u){if(!client_||!client_->connected_)return nullptr;chr_.client_=client_;chr_.valueHandle_=0;chr_.properties_=0;ble_uuid16_t id=BLE_UUID16_INIT(uuid16(u));if(client_->opDone_)xSemaphoreTake(client_->opDone_,0);int rc=ble_gattc_disc_chrs_by_uuid(client_->connHandle_,start_,end_,&id.u,&NimBLEClient::characteristicCb,this);if(rc!=0)return nullptr;if(client_->opDone_)xSemaphoreTake(client_->opDone_,pdMS_TO_TICKS(3000));return chr_.valueHandle_?&chr_:nullptr;}
int NimBLEClient::writeCb(uint16_t,const ble_gatt_error* err,ble_gatt_attr*,void* arg){auto*self=(NimBLEClient*)arg;self->opStatus_=err?err->status:BLE_HS_EUNKNOWN;if(self->opDone_)xSemaphoreGive(self->opDone_);return 0;}
bool NimBLERemoteCharacteristic::writeValue(const uint8_t* data,size_t len,bool response){if(!client_||!client_->connected_||!valueHandle_||!data||!len)return false;if(!response)return ble_gattc_write_no_rsp_flat(client_->connHandle_,valueHandle_,data,len)==0;if(client_->opDone_)xSemaphoreTake(client_->opDone_,0);client_->opStatus_=BLE_HS_EUNKNOWN;int rc=ble_gattc_write_flat(client_->connHandle_,valueHandle_,data,len,&NimBLEClient::writeCb,client_);if(rc!=0)return false;if(client_->opDone_)xSemaphoreTake(client_->opDone_,pdMS_TO_TICKS(1500));return client_->opStatus_==0;}
