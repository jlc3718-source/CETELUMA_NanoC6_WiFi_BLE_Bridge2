#pragma once
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include "WledProtocol.h"

struct WledSlotInfo {
  bool enabled=false,connected=false;
  String host,name,version,error;
  uint16_t pixels=0;
  uint32_t attempts=0,failures=0,lastSeen=0,lastSent=0;
};

class WledController {
 public:
  void configure(uint8_t slot,bool enabled,const String& host);
  void loop();
  void retry(uint8_t slot);
  void setPower(uint8_t slot,bool on);
  void setBrightness(uint8_t slot,uint8_t percent);
  void setColor(uint8_t slot,uint32_t rgb);
  WledSlotInfo slotInfo(uint8_t slot)const;
  bool connected(uint8_t slot)const;
 private:
  WledDeliveryState slots[2];
  WledPeerInfo peers[2];
  String errors[2];
  struct Request {
    uint8_t slot=0;bool probe=false;
    uint32_t generation=0,revision=0;
    char host[64]{};
    WledDesiredState desired;
    uint8_t segmentCount=0,segments[32]{};
  };
  struct Result {
    uint8_t slot=0;bool probe=false,ok=false;
    uint32_t generation=0,revision=0;
    char error[100]{};
    WledPeerInfo peer;
  };
  QueueHandle_t requests=nullptr,results=nullptr;
  TaskHandle_t task=nullptr;
  bool pending=false,hadWiFi=false;
  uint8_t nextSlot=0;
  uint32_t workerRetryAt=0;
  bool ensureWorker();
  static void worker(void* context);
  static void transact(const Request& request,Result& result);
};
