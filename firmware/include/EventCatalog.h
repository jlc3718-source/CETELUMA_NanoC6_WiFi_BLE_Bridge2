#pragma once
#include <Arduino.h>
#include <time.h>
#include "Types.h"

extern const EventDef EVENTS[];
extern const size_t EVENT_COUNT;

int eventIndexById(const String& id);
bool eventOccursInMonth(size_t index, int year, int month);
bool eventActiveOn(size_t index, const tm& local);
bool eventWindowActiveOn(size_t index, const tm& local, uint8_t lead, uint8_t trail);
String eventWhen(size_t index, int year);
Theme themeFromEvent(size_t index);
time_t eventStartEpoch(size_t index, int year);
