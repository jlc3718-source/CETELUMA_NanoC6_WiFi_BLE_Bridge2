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
};
