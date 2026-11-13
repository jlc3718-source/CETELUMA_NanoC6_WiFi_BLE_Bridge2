#pragma once
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
struct BleSlotInfo { String name; String address; String protocol; bool connected; uint32_t attempts=0, failures=0; bool scanPerformed=false, seenInLastScan=false; String lastFailure; };

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
  std::vector<BleFound> scan(uint32_t ms=6500);
  bool startScan(uint32_t ms=2500);
  bool scanInProgress() const { return asyncScanBusy; }
  bool consumeScanResults(std::vector<BleFound>& out);
  bool selectAndConnect(const String& address);
  bool removeController(uint8_t slot);
  bool renameController(uint8_t slot,const String& name);
  void setTarget(uint8_t target); // 0=all, 1=slot A, 2=slot B
  uint8_t getTarget() const { return target; }
  BleSlotInfo slotInfo(uint8_t slot) const;
  uint32_t lastScanCount() const { return lastScanDeviceCount; }
  bool scanCompleted() const { return lastScanAt!=0; }
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
    uint32_t connectionAttempts=0,connectionFailures=0;
    uint8_t lastFailure=0; // 0 none, 1 BLE link failed, 2 GATT characteristic missing
    bool seenLastScan=false;
    PendingFrame power,brightness,color;
#ifndef MOCK_BLE
    NimBLEClient* client=nullptr;
    NimBLERemoteCharacteristic* chr=nullptr;
#endif
  } slots[2];
  AppSettings* cfg=nullptr;
  uint8_t target=0,nextServiceSlot=0;
  uint32_t lastEffect=0,lastStaticReassert=0,lastControlReassert=0;
  uint32_t startedAt=0,lastScanAt=0,lastScanDeviceCount=0;
  bool connectionChanged=false;
  Theme activeTheme;
  uint8_t activeBrightness=0,activeSpeed=0;
  bool activeValid=false;
  std::vector<BleFound> asyncScanResults;
  volatile bool asyncScanBusy=false,asyncScanReady=false;
  uint32_t asyncScanMs=2500;
#ifndef MOCK_BLE
  struct ConnectRequest { char address[18]; };
  struct ConnectResult { NimBLEClient* client; NimBLERemoteCharacteristic* chr; uint8_t failureReason; };
  QueueHandle_t connectRequests=nullptr,connectResults=nullptr;
  TaskHandle_t connectTask=nullptr,scanTask=nullptr;
  bool connectPending=false;
  uint8_t pendingSlot=0;
  uint32_t pendingGeneration=0;
  static void connectionWorker(void* context);
  static void scanWorker(void* context);
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
