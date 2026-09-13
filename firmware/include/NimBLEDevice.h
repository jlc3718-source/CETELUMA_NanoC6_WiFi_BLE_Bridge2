#pragma once
#include "Arduino.h"
#include <memory>
#include <string>
#include <vector>
#include "host/ble_hs.h"
#include "host/ble_gap.h"
#include "host/ble_gatt.h"
#include "host/ble_uuid.h"

class NimBLEAddress {
 public:
  NimBLEAddress()=default;NimBLEAddress(const std::string& text,uint8_t type=BLE_ADDR_PUBLIC);
  bool isNull()const{return null_;}std::string toString()const;const ble_addr_t& native()const{return addr_;}
 private:ble_addr_t addr_{};bool null_=true;
};
class NimBLEAdvertisedDevice {
 public:
  NimBLEAdvertisedDevice()=default;NimBLEAdvertisedDevice(std::string name,NimBLEAddress addr,int rssi):name_(std::move(name)),addr_(addr),rssi_(rssi){}
  const std::string& getName()const{return name_;}NimBLEAddress getAddress()const{return addr_;}int getRSSI()const{return rssi_;}
 private:std::string name_;NimBLEAddress addr_;int rssi_=0;
};
class NimBLEScanResults {
 public:
  int getCount()const{return (int)items_.size();}const NimBLEAdvertisedDevice* getDevice(int i)const{return i>=0&&i<(int)items_.size()?&items_[i]:nullptr;}
 private:friend class NimBLEScan;std::vector<NimBLEAdvertisedDevice> items_;
};
class NimBLEScan {
 public:
  void setActiveScan(bool v){active_=v;}void setInterval(uint16_t v){interval_=v;}void setWindow(uint16_t v){window_=v;}
  NimBLEScanResults getResults(uint32_t ms,bool=false);NimBLEScanResults getResults()const{return results_;}
 private:bool active_=true;uint16_t interval_=80,window_=40;NimBLEScanResults results_;static int gapEvent(struct ble_gap_event* event,void* arg);
};
class NimBLEClient;
class NimBLERemoteCharacteristic {
 public:
  bool canWrite()const{return (properties_&BLE_GATT_CHR_PROP_WRITE)!=0;}bool writeValue(const uint8_t* data,size_t len,bool response);
 private:friend class NimBLERemoteService;NimBLEClient* client_=nullptr;uint16_t valueHandle_=0;uint8_t properties_=0;
};
class NimBLERemoteService {
 public:
  NimBLERemoteCharacteristic* getCharacteristic(const char* uuid);
 private:friend class NimBLEClient;NimBLEClient* client_=nullptr;uint16_t start_=0,end_=0;NimBLERemoteCharacteristic chr_;
};
class NimBLEClient {
 public:
  NimBLEClient();~NimBLEClient();void setConnectTimeout(uint32_t ms){timeoutMs_=ms;}void setConnectRetries(uint8_t){}
  bool connect(const NimBLEAddress& address);bool isConnected()const{return connected_;}void disconnect();NimBLERemoteService* getService(const char* uuid);
  uint16_t connHandle()const{return connHandle_;}
 private:friend class NimBLERemoteService;friend class NimBLERemoteCharacteristic;uint16_t connHandle_=BLE_HS_CONN_HANDLE_NONE;bool connected_=false;uint32_t timeoutMs_=3000;SemaphoreHandle_t opDone_=nullptr;int opStatus_=BLE_HS_EUNKNOWN;NimBLERemoteService service_;
  static int gapEvent(struct ble_gap_event* event,void* arg);static int serviceCb(uint16_t,const struct ble_gatt_error*,const struct ble_gatt_svc*,void*);static int characteristicCb(uint16_t,const struct ble_gatt_error*,const struct ble_gatt_chr*,void*);static int writeCb(uint16_t,const struct ble_gatt_error*,struct ble_gatt_attr*,void*);
};
class NimBLEDevice {
 public:
  static void init(const char* name);static void setPower(int level);static NimBLEScan* getScan();static NimBLEClient* createClient(){return new NimBLEClient();}static void deleteClient(NimBLEClient* c){delete c;}
  static uint8_t ownAddrType();
 private:static void hostTask(void*);static void onSync();
};
