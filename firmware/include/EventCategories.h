#pragma once
#include <Arduino.h>

struct EventCategoryDef {
  const char* id;
  const char* name;
  const char* color;
};

static constexpr uint8_t EVENT_CATEGORY_COUNT = 15;

void eventCategoriesBegin();
uint8_t eventCategoryIndex(size_t eventIndex);
const EventCategoryDef& eventCategoryDef(uint8_t categoryIndex);
bool eventCategoryEnabled(uint8_t categoryIndex);
bool eventCategorySetEnabled(uint8_t categoryIndex, bool enabled);
bool eventCategoryAllowsEvent(size_t eventIndex);
uint32_t eventCategoryMask();
