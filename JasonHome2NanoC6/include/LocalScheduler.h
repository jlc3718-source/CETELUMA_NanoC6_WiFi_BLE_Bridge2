#pragma once
#include "Common.h"
void schedulerBegin();
void eventAt(size_t i,JsonDocument&event);
size_t eventCount();
int eventIndex(const String&id);
void resolveSchedule(time_t at,JsonDocument&out);
void solarTimes(time_t at,int&dawn,int&dusk);
String clockLabel(int minute);
void defaultLayers(JsonVariantConst event,JsonArray out);
void localNightCandidates(time_t day,JsonArray out);
bool localEventOccurs(JsonVariantConst event,time_t day);
