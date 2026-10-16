#pragma once
#include "Common.h"
bool handleAiApi(const String&path,JsonVariantConst request,bool post);
bool startPreview(JsonVariantConst event,String&job);
void endPreview();
bool nextLocalEventDate(JsonVariantConst event,time_t now,int&year,int&month,int&day);
