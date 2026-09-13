#pragma once
#include "Arduino.h"
#include "esp_http_client.h"
class NetworkClient {
 public:
  void attach(esp_http_client_handle_t h,int64_t length){h_=h;length_=length;read_=0;connected_=h!=nullptr;}
  int available(){return connected_?1:0;}
  int read(uint8_t* out,size_t len){if(!connected_||!h_)return 0;int n=esp_http_client_read(h_,(char*)out,(int)len);if(n>0){read_+=n;if(length_>=0&&read_>=length_)connected_=false;return n;}if(n==0)connected_=false;return n;}
  bool connected()const{return connected_;}
  void stop(){connected_=false;}
 private:esp_http_client_handle_t h_=nullptr;int64_t length_=-1,read_=0;bool connected_=false;
};
