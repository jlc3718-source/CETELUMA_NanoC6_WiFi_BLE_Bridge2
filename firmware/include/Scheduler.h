#pragma once
#include <Arduino.h>
#include <time.h>
#include "Types.h"
class Scheduler {
 public:
  Scheduler(AppSettings* settings):cfg(settings){}
  Theme resolve(const tm& local);
  bool inRunWindow(const tm& local) const;
  String nextEventLabel(const tm& local) const;
 private:
  AppSettings* cfg;
  bool enabled(size_t i) const {return i<64 ? ((cfg->enabledMask>>i)&1ULL) : true;}
};
