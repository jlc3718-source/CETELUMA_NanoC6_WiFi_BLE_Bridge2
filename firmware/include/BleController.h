#pragma once
#include <Arduino.h>
#include <vector>
#include "Types.h"
#ifndef MOCK_BLE
#include <NimBLEDevice.h>
#endif

struct BleFound { String name; String address; int rssi; };
struct BleSlotInfo { String name; String address; String protocol; bool connected; };

class BleController {
 public:
  void begin(AppSettings* settings);
  void loop();
  bool connected() const;
  int connectedCount() const;
  String name() const;
  String address() const;
  String protocolName() const;
  std::vector<BleFound> scan(uint32_t ms=2500);
  bool selectAndConnect(const String& address,uint8_t protocol);
  bool removeController(uint8_t slot);
  void setTarget(uint8_t target); // 0=all, 1=slot A, 2=slot B
  uint8_t getTarget() const { return target; }
  BleSlotInfo slotInfo(uint8_t slot) const;
  void disconnect();
  void setPower(bool on);
  void setBrightness(uint8_t pct);
  void setSpeed(uint8_t pct);
  void setColor(uint32_t rgb);
  void setMode(uint8_t mode);
  void applyTheme(const Theme& theme,uint8_t brightness,uint8_t speedLevel,uint32_t nowMs,bool force=false);
 private:
  struct Slot {
    String name;
    String address;
    uint8_t protocol=0;
#ifndef MOCK_BLE
    NimBLEClient* client=nullptr;
    NimBLERemoteCharacteristic* chr=nullptr;
#endif
  } slots[2];
  AppSettings* cfg=nullptr;
  uint8_t target=0;
  uint32_t lastWrite=0,lastEffect=0;
  Theme activeTheme;
  uint8_t activeBrightness=0,activeSpeed=0;
  bool activeValid=false;
  uint8_t detectProtocol(const String& n) const;
  String protocolLabel(uint8_t p) const;
  bool connectSlot(uint8_t slot,const String& address,uint8_t protocol,const String& advertisedName="");
  void disconnectSlot(uint8_t slot);
  bool slotConnected(uint8_t slot) const;
  bool slotTargeted(uint8_t slot) const;
  bool writeSlot(uint8_t slot,const uint8_t* data,size_t len);
  void saveSlots();
};
