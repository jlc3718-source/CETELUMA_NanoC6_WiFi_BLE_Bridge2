#pragma once
#include "Common.h"
void relayBegin();
void relayDescribe(JsonObject out);
bool relayConfigure(JsonVariantConst in,String& error);
void relaySyncNow();
// Quiesce an active stream before a signed autonomous runtime update/reboot.
void relayPrepareForUpdate();
void relayPauseForFirmwareCheck(bool hold);
void relayLocalOverride(bool resume=false);
