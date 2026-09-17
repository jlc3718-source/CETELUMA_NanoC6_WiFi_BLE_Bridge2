#include "EventCategories.h"
#include <Preferences.h>

static constexpr char EVENT_CATEGORY_NS[] = "anderson-cat";
static constexpr uint32_t ALL_CATEGORIES_MASK = (1UL << EVENT_CATEGORY_COUNT) - 1UL;

static constexpr EventCategoryDef CATEGORY_DEFS[EVENT_CATEGORY_COUNT] = {
  {"holiday", "Holiday", "#FFEA00"},
  {"patriotic", "Patriotic / Federal", "#FF0040"},
  {"religious", "Religious", "#BF00FF"},
  {"military", "Military / Veterans", "#5983FF"},
  {"firstresponders", "First Responders / Public Safety", "#FF6A00"},
  {"family", "Family / Personal", "#E65076"},
  {"cultural", "Cultural / Heritage", "#00FF95"},
  {"civic", "Community / Civic", "#00D4FF"},
  {"sports", "Sports / Game Days", "#95FF00"},
  {"health", "Health / Medical Awareness", "#00C7A6"},
  {"memorial", "Memorial / Remembrance", "#FFFFFF"},
  {"lgbtq", "LGBTQ+ / Pride", "#E650B4"},
  {"environment", "Environmental", "#9CC746"},
  {"seasonal", "Seasonal", "#FFAA00"},
  {"social", "Awareness — General / Social", "#C78646"},
};

// Primary display/scheduling category for evt001..evt210. Values index CATEGORY_DEFS.
static constexpr uint8_t EVENT_CATEGORY_INDEX[210] = {
  9,9,9,9,9,0,9,2,2,14,1,7,10,7,6,9,9,14,1,13,9,
  9,8,9,0,1,2,6,2,2,7,6,9,6,9,9,9,9,9,9,9,9,
  9,6,9,0,2,9,12,9,9,3,11,9,14,14,9,9,9,9,0,9,2,
  2,2,9,9,9,10,12,9,12,9,8,14,6,6,3,9,9,9,9,9,7,
  6,9,5,9,9,4,3,11,9,4,3,2,9,11,9,9,6,4,3,14,1,
  1,9,14,5,13,9,9,14,9,9,9,9,1,9,5,3,9,9,9,9,9,
  9,3,7,7,7,7,9,9,9,9,9,9,9,9,9,9,9,1,9,9,10,
  2,5,6,7,3,2,9,7,11,3,9,9,14,9,14,9,9,9,9,4,11,
  6,9,9,11,6,9,10,11,2,9,13,6,9,9,9,9,9,5,9,14,2,
  2,7,2,3,9,9,11,0,6,4,9,9,2,10,7,7,13,2,2,6,0,
};
static_assert(sizeof(EVENT_CATEGORY_INDEX) / sizeof(EVENT_CATEGORY_INDEX[0]) == 210, "event category map count");

static uint32_t enabledMask = ALL_CATEGORIES_MASK;
static bool loaded = false;

void eventCategoriesBegin(){
  Preferences p;
  if(!p.begin(EVENT_CATEGORY_NS,true)){enabledMask=ALL_CATEGORIES_MASK;loaded=true;return;}
  enabledMask=p.getUInt("mask",ALL_CATEGORIES_MASK)&ALL_CATEGORIES_MASK;
  p.end();loaded=true;
}

uint8_t eventCategoryIndex(size_t eventIndex){return eventIndex<210?EVENT_CATEGORY_INDEX[eventIndex]:9;}
const EventCategoryDef& eventCategoryDef(uint8_t categoryIndex){return CATEGORY_DEFS[categoryIndex<EVENT_CATEGORY_COUNT?categoryIndex:9];}
uint32_t eventCategoryMask(){if(!loaded)eventCategoriesBegin();return enabledMask;}
bool eventCategoryEnabled(uint8_t categoryIndex){if(categoryIndex>=EVENT_CATEGORY_COUNT)return false;if(!loaded)eventCategoriesBegin();return (enabledMask&(1UL<<categoryIndex))!=0;}
bool eventCategoryAllowsEvent(size_t eventIndex){return eventCategoryEnabled(eventCategoryIndex(eventIndex));}

bool eventCategorySetEnabled(uint8_t categoryIndex,bool enabled){
  if(categoryIndex>=EVENT_CATEGORY_COUNT)return false;if(!loaded)eventCategoriesBegin();
  uint32_t bit=1UL<<categoryIndex,next=enabled?(enabledMask|bit):(enabledMask&~bit);if(next==enabledMask)return true;
  Preferences p;if(!p.begin(EVENT_CATEGORY_NS,false))return false;size_t wrote=p.putUInt("mask",next);bool ok=wrote>0&&(p.getUInt("mask",~next)&ALL_CATEGORIES_MASK)==next;p.end();if(!ok)return false;enabledMask=next;return true;
}
