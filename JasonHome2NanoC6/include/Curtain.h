#pragma once
#include "Common.h"
void curtainBegin();
void curtainLoop();
bool curtainCall(const String&action,JsonVariantConst input,JsonDocument&result);
void curtainNotifications(JsonArray output,uint32_t since);
