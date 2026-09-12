#pragma once
#include <Arduino.h>

// Append new effects so the numeric values of existing saved/built-in effects never shift.
enum class Effect : uint8_t { Jump, Breath, Strobe, Gradient, Solid };
enum class EventKind : uint8_t { Holiday, Awareness, Seasonal };
enum class RuleType : uint8_t { Fixed, Month, NthWeekday, LastWeekday, EasterOffset, Hanukkah, MonthEnd, YearTable };

struct Theme {
  String name = "Warm White";
  Effect effect = Effect::Jump;
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
  bool schedule2Enabled = true;
  uint64_t enabledMask = UINT64_MAX;
  uint64_t favoriteMask = 0;
  String bleAddress;
  String bleAddress2;
  String bleName;
  String bleName2;
  uint8_t bleProtocol = 0;
  uint8_t bleProtocol2 = 0;
  uint16_t pixelCount = 100;
};

inline const char* effectName(Effect e) {
  switch(e) {
    case Effect::Jump: return "Jump";
    case Effect::Breath: return "Breath";
    case Effect::Strobe: return "Strobe";
    case Effect::Gradient: return "Gradient";
    case Effect::Solid: return "Solid";
  }
  return "Jump";
}

inline Effect effectFromString(const String& s) {
  // Current Anderson Home effect set. Legacy names are intentionally mapped so
  // old presets/API calls cannot reintroduce retired effects.
  if (s=="Breath" || s=="Pulse") return Effect::Breath;
  if (s=="Strobe" || s=="Twinkle") return Effect::Strobe;
  if (s=="Gradient" || s=="Fade" || s=="Rainbow" || s=="Fire" || s=="Water") return Effect::Gradient;
  if (s=="Solid" || s=="Static") return Effect::Solid;
  // Jump remains the safe replacement for Chase/Meteor/Candy Cane and unknown names.
  return Effect::Jump;
}

inline const char* kindName(EventKind k) {
  return k==EventKind::Holiday ? "holiday" : (k==EventKind::Awareness ? "awareness" : "seasonal");
}
