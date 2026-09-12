#pragma once
#include <Preferences.h>
#include "Types.h"
class SettingsStore {
 public:
  void begin();
  AppSettings& get(){return s;}
  bool saveAll();
  bool saveSettings(const AppSettings& next);
  bool saveBle();
  bool saveWiFi(const String& ssid,const String& pass);
  bool clearWiFi();
 private:
  Preferences prefs;
  AppSettings s;
  bool writeSettings(const AppSettings& value);
};
