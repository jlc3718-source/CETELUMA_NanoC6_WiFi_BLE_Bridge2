#pragma once
#include "Common.h"
void curtainBegin();
void curtainLoop();
bool curtainCall(const String&action,JsonVariantConst input,JsonDocument&result);
void curtainNotifications(JsonArray output,uint32_t since,size_t byteBudget=8192);

bool curtainRelayWrite(uint8_t channel,const uint8_t*bytes,size_t n);
