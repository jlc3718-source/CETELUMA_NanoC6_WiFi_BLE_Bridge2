#pragma once
#include "Common.h"
void relayBegin();
void relayDescribe(JsonObject out);
bool relayConfigure(JsonVariantConst in,String& error);
void relaySyncNow();
void relayLocalOverride(bool resume=false);
