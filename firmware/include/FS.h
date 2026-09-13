#pragma once
#include "Arduino.h"
#include <cstdio>
class File {
  FILE* f_=nullptr;
 public:
  File()=default;explicit File(FILE* f):f_(f){}File(const File&)=delete;File& operator=(const File&)=delete;File(File&& o)noexcept:f_(o.f_){o.f_=nullptr;}File& operator=(File&&o)noexcept{if(this!=&o){close();f_=o.f_;o.f_=nullptr;}return *this;}~File(){close();}
  explicit operator bool()const{return f_!=nullptr;}
  String readString();size_t print(const String& s);void flush(){if(f_)fflush(f_);}void close(){if(f_){fclose(f_);f_=nullptr;}}
};
