#pragma once
#include <Preferences.h>
#include "Types.h"
class SettingsStore {
 public:
  void begin();
  AppSettings& get(){return s;}
  void saveAll();
  void saveWiFi(const String& ssid,const String& pass);
  void clearWiFi();
 private:
  Preferences prefs;
  AppSettings s;
};
