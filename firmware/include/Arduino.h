#pragma once
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <type_traits>
#include <vector>
#include <sys/types.h>
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "esp_netif_ip_addr.h"
#include "esp_ota_ops.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#ifndef PROGMEM
#define PROGMEM
#endif
using PGM_P = const char*;
static constexpr int HEX=16;
static constexpr int DEC=10;
static constexpr int HIGH=1;
static constexpr int LOW=0;
static constexpr int OUTPUT=1;
static constexpr int INPUT=0;
static constexpr int INPUT_PULLUP=2;
#ifndef PI
#define PI 3.14159265358979323846
#endif

template<class T> inline T min(T a,T b){return std::min(a,b);}
template<class T> inline T max(T a,T b){return std::max(a,b);}
template<class T,class L,class H> inline T constrain(T x,L lo,H hi){T l=(T)lo,h=(T)hi;return x<l?l:(x>h?h:x);}

class String : public std::string {
 public:
  using std::string::string;
  using std::string::operator=;
  String()=default;
  String(const std::string& s):std::string(s){}
  String(std::string&& s):std::string(std::move(s)){}
  String(char c):std::string(1,c){}
  template<class T,typename std::enable_if<std::is_integral<T>::value,int>::type=0>
  String(T value,int base=DEC){char b[80];if(base==HEX)snprintf(b,sizeof(b),"%llx",(unsigned long long)value);else if(std::is_signed<T>::value)snprintf(b,sizeof(b),"%lld",(long long)value);else snprintf(b,sizeof(b),"%llu",(unsigned long long)value);assign(b);}
  String(float value,unsigned char decimals=2){char f[12];snprintf(f,sizeof(f),"%%.%uf",(unsigned)decimals);char b[64];snprintf(b,sizeof(b),f,(double)value);assign(b);}
  String(double value,unsigned char decimals=2){char f[12];snprintf(f,sizeof(f),"%%.%uf",(unsigned)decimals);char b[64];snprintf(b,sizeof(b),f,value);assign(b);}
  int indexOf(char c,size_t from=0) const {auto p=find(c,from);return p==npos?-1:(int)p;}
  int indexOf(const char* s,size_t from=0) const {auto p=find(s?s:"",from);return p==npos?-1:(int)p;}
  int indexOf(const String& s,size_t from=0) const {auto p=find(s,from);return p==npos?-1:(int)p;}
  int lastIndexOf(char c) const {auto p=rfind(c);return p==npos?-1:(int)p;}
  String substring(size_t from) const {if(from>=size())return String();return String(substr(from));}
  String substring(size_t from,size_t to) const {if(from>=size()||to<=from)return String();return String(substr(from,std::min(to,size())-from));}
  long toInt() const {char* e=nullptr;long v=strtol(c_str(),&e,10);return e==c_str()?0:v;}
  float toFloat() const {char* e=nullptr;float v=strtof(c_str(),&e);return e==c_str()?0.0f:v;}
  void trim(){size_t a=0,b=size();while(a<b&&std::isspace((unsigned char)(*this)[a]))a++;while(b>a&&std::isspace((unsigned char)(*this)[b-1]))b--;*this=substr(a,b-a);}
  void toLowerCase(){std::transform(begin(),end(),begin(),[](unsigned char c){return (char)std::tolower(c);});}
  void toUpperCase(){std::transform(begin(),end(),begin(),[](unsigned char c){return (char)std::toupper(c);});}
  bool startsWith(const char* p) const {if(!p)return false;size_t n=strlen(p);return size()>=n&&compare(0,n,p)==0;}
  bool startsWith(const String& p) const {return size()>=p.size()&&compare(0,p.size(),p)==0;}
  bool endsWith(const char* p) const {if(!p)return false;size_t n=strlen(p);return size()>=n&&compare(size()-n,n,p)==0;}
  bool endsWith(const String& p) const {return size()>=p.size()&&compare(size()-p.size(),p.size(),p)==0;}
  bool equalsIgnoreCase(const String& o) const {if(size()!=o.size())return false;for(size_t i=0;i<size();++i)if(std::tolower((unsigned char)(*this)[i])!=std::tolower((unsigned char)o[i]))return false;return true;}
  bool equalsIgnoreCase(const char* o) const {return equalsIgnoreCase(String(o?o:""));}
  void remove(size_t index,size_t count=npos){if(index<size())erase(index,count);}
  void replace(const String& from,const String& to){if(from.empty())return;size_t pos=0;while((pos=find(from,pos))!=npos){std::string::replace(pos,from.size(),to);pos+=to.size();}}
  void toCharArray(char* out,size_t len) const {if(!out||!len)return;size_t n=std::min(len-1,size());memcpy(out,data(),n);out[n]=0;}
  bool concat(const char* data,unsigned int len){if(!data)return false;append(data,len);return true;}
  bool concat(const String& s){append(s);return true;}
  size_t write(uint8_t c){push_back((char)c);return 1;}
  size_t write(const uint8_t* d,size_t n){if(d&&n)append((const char*)d,n);return n;}
};

inline String operator+(const String& a,const String& b){return String(static_cast<const std::string&>(a)+static_cast<const std::string&>(b));}
inline String operator+(const String& a,const char* b){return String(static_cast<const std::string&>(a)+std::string(b?b:""));}
inline String operator+(const char* a,const String& b){return String(std::string(a?a:"")+static_cast<const std::string&>(b));}
inline String operator+(const String& a,char b){String x=a;x.push_back(b);return x;}

class IPAddress {
  uint32_t addr_=0;
 public:
  IPAddress()=default; explicit IPAddress(uint32_t a):addr_(a){}
  operator uint32_t() const{return addr_;}
  bool operator==(const IPAddress& o)const{return addr_==o.addr_;}
  bool operator!=(const IPAddress& o)const{return addr_!=o.addr_;}
  String toString() const {esp_ip4_addr_t a{};a.addr=addr_;char b[16]{};snprintf(b,sizeof(b),IPSTR,IP2STR(&a));return String(b);}
};

uint32_t millis();
uint32_t micros();
void delay(uint32_t ms);
void yield();
void pinMode(int pin,int mode);
void digitalWrite(int pin,int value);
int digitalRead(int pin);
void configTzTime(const char* tz,const char* server1,const char* server2=nullptr,const char* server3=nullptr);
uint32_t getCpuFrequencyMhz();

class ESPClass {
 public:
  [[noreturn]] void restart() const;
  uint32_t getHeapSize() const;
  uint32_t getFreeHeap() const;
  uint32_t getMinFreeHeap() const;
  uint32_t getMaxAllocHeap() const;
  uint32_t getSketchSize() const;
};
extern ESPClass ESP;
