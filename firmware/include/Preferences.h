#pragma once
#include "Arduino.h"
#include "nvs.h"
class Preferences {
  nvs_handle_t handle_=0;bool open_=false;bool readOnly_=true;
 public:
  Preferences()=default;~Preferences(){end();}
  bool begin(const char* ns,bool readOnly=false,const char* partition_label=nullptr);
  void end();
  String getString(const char* key,const char* def="") const;
  String getString(const char* key,const String& def) const{return getString(key,def.c_str());}
  size_t putString(const char* key,const String& value);
  uint8_t getUChar(const char* key,uint8_t def=0) const;size_t putUChar(const char* key,uint8_t v);
  uint16_t getUShort(const char* key,uint16_t def=0) const;size_t putUShort(const char* key,uint16_t v);
  uint32_t getUInt(const char* key,uint32_t def=0) const;size_t putUInt(const char* key,uint32_t v);
  uint64_t getULong64(const char* key,uint64_t def=0) const;size_t putULong64(const char* key,uint64_t v);
  bool getBool(const char* key,bool def=false) const;size_t putBool(const char* key,bool v);
  bool remove(const char* key);bool clear();
};
