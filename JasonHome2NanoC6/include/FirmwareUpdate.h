#pragma once
#include "Common.h"
struct FirmwareManifest {String version,sha,commit,url,payload,signature;size_t bytes=0;};
bool parseManifest(JsonVariantConst d,FirmwareManifest& m,String&error);
bool isNewer(const String&a,const String&b);
bool queueFirmware(JsonVariantConst d,String&error);
bool fetchManifest(JsonDocument&d);
bool installFirmware(JsonVariantConst d,String&error);
bool selectRuntime();
bool runtimeValid();
void registerFirmware();
void firmwareLoop();
void recordFirmwareState(const String&phase,const String&reason=String());
