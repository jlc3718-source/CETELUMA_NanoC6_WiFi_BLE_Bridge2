#pragma once
#include "Arduino.h"
#include "esp_http_server.h"
#include <functional>
#include <vector>

using THandlerFunction=std::function<void(void)>;
enum HTTPUploadStatus:uint8_t{UPLOAD_FILE_START=0,UPLOAD_FILE_WRITE=1,UPLOAD_FILE_END=2,UPLOAD_FILE_ABORTED=3};
struct HTTPUpload {HTTPUploadStatus status=UPLOAD_FILE_START;String filename;uint8_t* buf=nullptr;size_t currentSize=0,totalSize=0;};

class WebServer {
 public:
  explicit WebServer(uint16_t port=80):port_(port){}
  ~WebServer(){stop();}
  void collectHeaders(const char*[],size_t){}
  void on(const char* uri,httpd_method_t method,THandlerFunction handler);
  void on(const char* uri,httpd_method_t method,THandlerFunction handler,THandlerFunction uploadHandler);
  void onNotFound(THandlerFunction handler){notFound_=std::move(handler);}
  void begin();void stop();void handleClient(){}
  void sendHeader(const String& name,const String& value,bool first=false);
  void send(int code,const char* type,const String& body);void send(int code,const char* type,const char* body){send(code,type,String(body?body:""));}void send(int code){send(code,"text/plain","");}
  void send_P(int code,const char* type,PGM_P data,size_t len);
  String arg(const String& name)const;bool hasArg(const String& name)const;String header(const String& name)const;
  HTTPUpload& upload(){return current_?current_->upload:dummyUpload_;}
  class ClientProxy {friend class WebServer;WebServer* owner_;explicit ClientProxy(WebServer* o):owner_(o){} public:IPAddress remoteIP()const;void stop();};
  ClientProxy client(){return ClientProxy(this);}
 private:
  struct Route{String uri;httpd_method_t method;THandlerFunction handler;THandlerFunction upload;};
  struct RequestContext{WebServer* owner=nullptr;httpd_req_t* req=nullptr;String body;HTTPUpload upload;bool responded=false;};
  uint16_t port_;httpd_handle_t server_=nullptr;std::vector<Route> routes_;THandlerFunction notFound_;HTTPUpload dummyUpload_;
  static thread_local RequestContext* current_;
  static esp_err_t routeThunk(httpd_req_t* req);esp_err_t dispatch(Route* route,httpd_req_t* req);
  static String urlDecode(const char* s);static const char* statusText(int code);
};
