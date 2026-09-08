#pragma once
#include <Arduino.h>
#include <vector>

enum class Effect : uint8_t { Solid, Fade, Pulse, Rainbow, Chase, Twinkle, Meteor, CandyCane, Fire, Water };
enum class EventKind : uint8_t { Holiday, Awareness, Seasonal };
enum class RuleType : uint8_t { Fixed, Month, NthWeekday, LastWeekday, EasterOffset, Hanukkah };

struct Theme {
  String name = "Warm White";
  Effect effect = Effect::Solid;
  uint32_t colors[8] = {0xFFF1C7};
  uint8_t colorCount = 1;
};

struct EventDef {
  const char* id;
  const char* name;
  EventKind kind;
  RuleType rule;
  int8_t month;
  int8_t day;
  int8_t weekday;
  int8_t nth;
  int16_t offsetDays;
  uint8_t durationDays;
  Effect effect;
  uint32_t colors[6];
  uint8_t colorCount;
};

struct AppSettings {
  String ssid;
  String password;
  String tz = "EST5EDT,M3.2.0,M11.1.0";
  uint16_t onMinutes = 17 * 60;
  uint16_t offMinutes = 23 * 60;
  uint8_t leadDays = 2;
  uint8_t trailDays = 0;
  uint8_t overlap = 0;
  bool schedulerEnabled = true;
  uint64_t enabledMask = UINT64_MAX;
  uint64_t favoriteMask = 0;
  String bleAddress;
  String bleAddress2;
  uint8_t bleProtocol = 0;
  uint8_t bleProtocol2 = 0;
  uint16_t pixelCount = 100;
};

inline const char* effectName(Effect e) {
  switch(e) {
    case Effect::Solid: return "Solid"; case Effect::Fade: return "Fade"; case Effect::Pulse: return "Pulse";
    case Effect::Rainbow: return "Rainbow"; case Effect::Chase: return "Chase"; case Effect::Twinkle: return "Twinkle";
    case Effect::Meteor: return "Meteor"; case Effect::CandyCane: return "Candy Cane"; case Effect::Fire: return "Fire";
    case Effect::Water: return "Water";
  }
  return "Solid";
}

inline Effect effectFromString(const String& s) {
  if (s=="Fade") return Effect::Fade; if (s=="Pulse") return Effect::Pulse; if (s=="Rainbow") return Effect::Rainbow;
  if (s=="Chase") return Effect::Chase; if (s=="Twinkle") return Effect::Twinkle; if (s=="Meteor") return Effect::Meteor;
  if (s=="Candy Cane") return Effect::CandyCane; if (s=="Fire") return Effect::Fire; if (s=="Water") return Effect::Water;
  return Effect::Solid;
}

inline const char* kindName(EventKind k) {
  return k==EventKind::Holiday ? "holiday" : (k==EventKind::Awareness ? "awareness" : "seasonal");
}
