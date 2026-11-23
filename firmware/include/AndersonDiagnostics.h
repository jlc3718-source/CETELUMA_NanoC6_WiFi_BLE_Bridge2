#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

// Diagnostic event codes are compatible with existing Anderson event history; direct GitHub upload.
// Independent of BLE/WLED command handling; logging must never block light control.
namespace AndersonDiagnostics {
void begin();
void record(uint8_t code,int8_t slot=-1,int32_t value=0,const char* detail=nullptr);
// Additive scene context: requested palette, effect, origin, power, and controller target.
void recordScene(const char* source,const char* name,const char* effect,
                 const uint32_t* colors,uint8_t colorCount,bool power,
                 uint8_t brightness,uint8_t speed,int8_t target);
// Preserve each existing sampled success event while capturing its exact BLE frame.
void recordBleWrite(int8_t slot,const uint8_t* frame,size_t length);
bool configure(const String& newToken,bool enabled);
void tick(bool firmwareBusy);
void status(JsonObject out);
}
