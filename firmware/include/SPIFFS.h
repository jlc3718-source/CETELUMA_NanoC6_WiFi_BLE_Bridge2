#pragma once
#include "FS.h"
class SPIFFSClass {
 public:
  bool begin(bool formatOnFail=false);File open(const char* path,const char* mode);bool exists(const char* path);bool remove(const char* path);bool rename(const char* from,const char* to);size_t totalBytes();size_t usedBytes();
 private:
  bool mounted_=false;String full(const char* path)const;
};
extern SPIFFSClass SPIFFS;
