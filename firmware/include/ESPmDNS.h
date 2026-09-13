#pragma once
#include "Arduino.h"
class MDNSClass {
 public:
  bool begin(const char* host);void setInstanceName(const char* name);void addService(const char* service,const char* proto,uint16_t port);void end();
 private:bool active_=false;String host_;
};
extern MDNSClass MDNS;
