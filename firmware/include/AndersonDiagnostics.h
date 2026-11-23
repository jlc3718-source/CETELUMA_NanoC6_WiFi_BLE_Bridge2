#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

// Diagnostic event codes are compatible with existing Anderson event history; direct GitHub upload.
// Independent of BLE/WLED command handling; logging must never block light control.
namespace AndersonDiagnostics {
void begin();
void record(uint8_t code,int8_t slot=-1,int32_t value=0,const char* detail=nullptr);
bool configure(const String& newToken,bool enabled);
void tick(bool firmwareBusy);
void status(JsonObject out);
}
