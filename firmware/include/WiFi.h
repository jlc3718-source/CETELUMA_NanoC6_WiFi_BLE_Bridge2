#pragma once
#include "Arduino.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include <functional>

static constexpr int WL_CONNECTED=3;
static constexpr int WL_DISCONNECTED=6;
static constexpr int WIFI_SCAN_RUNNING=-1;
static constexpr int WIFI_SCAN_FAILED=-2;
enum wifi_mode_compat_t:uint8_t{WIFI_OFF=0,WIFI_STA=1,WIFI_AP=2,WIFI_AP_STA=3};
enum arduino_event_id_t:uint8_t{ARDUINO_EVENT_WIFI_STA_DISCONNECTED=1,ARDUINO_EVENT_WIFI_STA_GOT_IP=2,ARDUINO_EVENT_WIFI_STA_LOST_IP=3};
struct arduino_event_info_t{struct{uint8_t reason=0;}wifi_sta_disconnected;};
using WiFiEventCb=void(*)(arduino_event_id_t,arduino_event_info_t);

class WiFiClass {
 public:
  bool mode(wifi_mode_compat_t m);void setSleep(bool sleep);void setAutoReconnect(bool on){autoReconnect_=on;}
  void begin(const char* ssid,const char* pass);bool reconnect();int status()const{return gotIp_?WL_CONNECTED:WL_DISCONNECTED;}
  bool softAP(const char* ssid,const char* pass=nullptr);IPAddress localIP()const{return IPAddress(staIp_);}IPAddress softAPIP()const;
  String SSID()const;int32_t RSSI()const;String SSID(int index)const;int32_t RSSI(int index)const;
  int scanNetworks(bool async=false,bool showHidden=false,bool passive=false,uint32_t maxMsPerChan=300);int scanComplete()const;void scanDelete();
  void onEvent(WiFiEventCb cb){callback_=cb;ensureInit();}
 private:
  struct ScanItem{String ssid;int32_t rssi=0;};
  mutable SemaphoreHandle_t mutex_=nullptr;std::vector<ScanItem> scans_;bool initialized_=false,started_=false,gotIp_=false,autoReconnect_=true,scanRunning_=false;uint32_t staIp_=0;esp_netif_t* staNetif_=nullptr;esp_netif_t* apNetif_=nullptr;WiFiEventCb callback_=nullptr;
  void ensureInit();void handleEvent(esp_event_base_t base,int32_t id,void* data);static void eventThunk(void* arg,esp_event_base_t base,int32_t id,void* data);
};
extern WiFiClass WiFi;
