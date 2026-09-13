#pragma once
#include "Arduino.h"
#include "esp_http_client.h"
#include <algorithm>
#include <cstdint>
class NetworkClient {
 public:
  void attach(esp_http_client_handle_t h,int64_t length){h_=h;length_=length;read_=0;connected_=h!=nullptr;}
  int available()const{
    if(!connected_||!h_)return 0;
    if(length_>=0){
      const int64_t remaining=length_-read_;
      if(remaining<=0)return 0;
      return (int)std::min<int64_t>(remaining,4096);
    }
    // esp_http_client does not expose a non-consuming byte-count query.
    // Advertise one normal receive window so callers issue a bounded read
    // instead of falling into the former one-byte-at-a-time download path.
    return 4096;
  }
  int read(uint8_t* out,size_t len){
    if(!connected_||!h_||!out||!len)return 0;
    int n=esp_http_client_read(h_,(char*)out,(int)len);
    if(n>0){
      read_+=n;
      if(length_>=0&&read_>=length_)connected_=false;
      return n;
    }
    if(n==0)connected_=false;
    return n;
  }
  bool connected()const{return connected_;}
  void stop(){connected_=false;}
 private:esp_http_client_handle_t h_=nullptr;int64_t length_=-1,read_=0;bool connected_=false;
};
