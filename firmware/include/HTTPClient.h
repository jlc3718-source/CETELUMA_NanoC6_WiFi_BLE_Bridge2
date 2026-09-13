#pragma once
#include "Arduino.h"
#include "NetworkClient.h"
#include "WiFiClientSecure.h"
#include <vector>
static constexpr int HTTP_CODE_OK=200;
static constexpr int HTTPC_STRICT_FOLLOW_REDIRECTS=1;
class HTTPClient {
 public:
  ~HTTPClient(){end();}void setConnectTimeout(int ms){connectTimeout_=ms;}void setTimeout(int ms){timeout_=ms;}void setFollowRedirects(int){follow_=true;}
  bool begin(WiFiClientSecure&,const String& url);void addHeader(const String& name,const String& value);int GET();int getSize()const{return contentLength_>INT32_MAX?-1:(int)contentLength_;}NetworkClient* getStreamPtr(){return &stream_;}void end();
 private:String url_;int connectTimeout_=6000,timeout_=8000,status_=-1;int64_t contentLength_=-1;bool follow_=false;esp_http_client_handle_t client_=nullptr;NetworkClient stream_;std::vector<std::pair<String,String>> headers_;
};
