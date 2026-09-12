#pragma once
#include <Arduino.h>
#include <vector>
#include "Types.h"
// ANDERSON_BLE_DIAGNOSTICS_V1
#ifndef MOCK_BLE
#include <NimBLEDevice.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#endif

struct BleFound { String name; String address; int rssi; };
struct BleSlotInfo { String name; String address; String protocol; bool connected; };
struct BleSlotDiagnostics {
  bool connected=false;
  bool writeWithResponse=false;
  bool writeWithoutResponse=false;
  bool writeReadSupported=false;
  bool writeNotifySupported=false;
  bool writeIndicateSupported=false;
  bool responseReadSupported=false;
  bool responseNotifySupported=false;
  bool responseIndicateSupported=false;
  bool responseSubscribed=false;
  bool lastWriteOk=false;
  bool lastWriteAcknowledged=false;
  bool lastWriteQueued=false;
  bool responseParsed=false;
  bool requestedPowerKnown=false;
  bool requestedPower=false;
  bool requestedColorKnown=false;
  uint32_t requestedColor=0;
  bool requestedBrightnessKnown=false;
  uint8_t requestedBrightness=0;
  bool powerConfirmed=false;
  bool colorConfirmed=false;
  bool brightnessConfirmed=false;
  uint32_t lastWriteAt=0;
  uint32_t lastResponseAt=0;
  String writeCharacteristic;
  String responseCharacteristic;
  String lastCommand;
  String lastTxHex;
  String lastRxHex;
};

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
  BleSlotDiagnostics slotDiagnostics(uint8_t slot,bool refreshReadback=false);
  String diagnosticsJson(bool refreshReadback=true);
  void setPower(bool on);
  void setBrightness(uint8_t pct);
  void setColor(uint32_t rgb);
  void applyTheme(const Theme& theme,uint8_t brightness,uint8_t speedLevel,uint32_t nowMs,bool force=false);
 private:
  struct Slot {
    String name;
    String address;
    uint32_t generation=0,nextConnectAt=0;
    BleSlotDiagnostics diag;
#ifndef MOCK_BLE
    NimBLEClient* client=nullptr;
    NimBLERemoteCharacteristic* chr=nullptr;
    NimBLERemoteCharacteristic* rx=nullptr;
#endif
  } slots[2];
  AppSettings* cfg=nullptr;
  uint8_t target=0;
  uint32_t lastWrite=0,lastEffect=0;
  uint32_t startedAt=0;
  bool connectionChanged=false;
  Theme activeTheme;
  uint8_t activeBrightness=0,activeSpeed=0;
  bool activeValid=false;
#ifndef MOCK_BLE
  struct ConnectRequest { char address[18]; };
  struct ConnectResult { NimBLEClient* client; NimBLERemoteCharacteristic* chr; NimBLERemoteCharacteristic* rx; };
  QueueHandle_t connectRequests=nullptr,connectResults=nullptr;
  TaskHandle_t connectTask=nullptr;
  bool connectPending=false;
  uint8_t pendingSlot=0;
  uint32_t pendingGeneration=0;
  static BleController* callbackOwner;
  static void connectionWorker(void* context);
  static void notifyCallback(NimBLERemoteCharacteristic* chr,uint8_t* data,size_t length,bool isNotify);
  bool requestConnection(uint8_t slot);
  void updateCharacteristicDiagnostics(uint8_t slot);
  void recordResponse(NimBLERemoteCharacteristic* chr,const uint8_t* data,size_t len);
  void refreshReadback(uint8_t slot);
#endif
  void disconnectSlot(uint8_t slot);
  bool slotConnected(uint8_t slot) const;
  bool slotTargeted(uint8_t slot) const;
  bool writeSlot(uint8_t slot,const uint8_t* data,size_t len);
  void saveSlots();
};
