#include "WebServer.h"
#include "esp_timer.h"
#include <sys/socket.h>
#include <netinet/in.h>
#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <utility>

namespace {
constexpr int64_t kUploadAbsoluteTimeoutUs = 10LL * 60LL * 1000000LL;
constexpr int64_t kBodyAbsoluteTimeoutUs = 2LL * 60LL * 1000000LL;
constexpr uint8_t kMaxConsecutiveReceiveTimeouts = 3;

// ESP-IDF's httpd_resp_set_hdr() retains pointers to the supplied strings until
// the response is sent. Arduino-style callers routinely pass temporary String
// objects (for example sendHeader("Content-Encoding", "gzip")), so applying the
// header immediately leaves ESP-IDF holding dangling pointers. Keep owned copies
// for the lifetime of the current request and apply them immediately before send.
thread_local std::vector<std::pair<String,String>> gResponseHeaders;

void applyPendingHeaders(httpd_req_t* req){
  if(!req)return;
  for(auto& h:gResponseHeaders)httpd_resp_set_hdr(req,h.first.c_str(),h.second.c_str());
}
}

thread_local WebServer::RequestContext* WebServer::current_=nullptr;
WebServer* anderson_http_server_singleton=nullptr;

void WebServer::on(const char* u,httpd_method_t m,THandlerFunction h){
  routes_.push_back({String(u?u:"/"),m,std::move(h),{}});
}

void WebServer::on(const char* u,httpd_method_t m,THandlerFunction h,THandlerFunction up){
  routes_.push_back({String(u?u:"/"),m,std::move(h),std::move(up)});
}

void WebServer::begin(){
  if(server_)return;
  anderson_http_server_singleton=this;
  httpd_config_t c=HTTPD_DEFAULT_CONFIG();
  c.server_port=port_;
  c.max_uri_handlers=64;
  c.stack_size=12288;
  c.lru_purge_enable=true;
  c.recv_wait_timeout=20;
  c.send_wait_timeout=20;
  c.uri_match_fn=httpd_uri_match_wildcard;
  if(httpd_start(&server_,&c)!=ESP_OK){server_=nullptr;return;}
  for(auto& r:routes_){
    httpd_uri_t u{};
    u.uri=r.uri.c_str();
    u.method=r.method;
    u.handler=&WebServer::routeThunk;
    u.user_ctx=&r;
    httpd_register_uri_handler(server_,&u);
  }
}

void WebServer::stop(){
  if(server_){httpd_stop(server_);server_=nullptr;}
  if(anderson_http_server_singleton==this)anderson_http_server_singleton=nullptr;
}

const char* WebServer::statusText(int c){
  switch(c){
    case 200:return "200 OK";
    case 201:return "201 Created";
    case 202:return "202 Accepted";
    case 204:return "204 No Content";
    case 400:return "400 Bad Request";
    case 401:return "401 Unauthorized";
    case 403:return "403 Forbidden";
    case 404:return "404 Not Found";
    case 408:return "408 Request Timeout";
    case 409:return "409 Conflict";
    case 423:return "423 Locked";
    case 429:return "429 Too Many Requests";
    case 500:return "500 Internal Server Error";
    case 504:return "504 Gateway Timeout";
    case 507:return "507 Insufficient Storage";
    default:return "500 Internal Server Error";
  }
}

void WebServer::sendHeader(const String& n,const String& v,bool first){
  if(!current_||!current_->req)return;
  if(first)gResponseHeaders.insert(gResponseHeaders.begin(),{n,v});
  else gResponseHeaders.push_back({n,v});
}

void WebServer::send(int code,const char* type,const String& body){
  if(!current_||!current_->req||current_->responded)return;
  httpd_resp_set_status(current_->req,statusText(code));
  httpd_resp_set_type(current_->req,type?type:"text/plain");
  applyPendingHeaders(current_->req);
  if(code==204)httpd_resp_send(current_->req,nullptr,0);
  else httpd_resp_send(current_->req,body.data(),body.size());
  current_->responded=true;
}

void WebServer::send_P(int code,const char* type,PGM_P data,size_t len){
  if(!current_||!current_->req||current_->responded)return;
  httpd_resp_set_status(current_->req,statusText(code));
  httpd_resp_set_type(current_->req,type?type:"application/octet-stream");
  applyPendingHeaders(current_->req);
  httpd_resp_send(current_->req,data,len);
  current_->responded=true;
}

String WebServer::urlDecode(const char* s){
  String out;
  if(!s)return out;
  for(size_t i=0;s[i];++i){
    if(s[i]=='+'){out.push_back(' ');continue;}
    if(s[i]=='%'&&s[i+1]&&s[i+2]){
      char h[3]={s[i+1],s[i+2],0};
      char* e=nullptr;
      long v=strtol(h,&e,16);
      if(e&&*e==0){out.push_back((char)v);i+=2;continue;}
    }
    out.push_back(s[i]);
  }
  return out;
}

String WebServer::arg(const String& name)const{
  if(!current_||!current_->req)return String();
  if(name=="plain")return current_->body;
  size_t qlen=httpd_req_get_url_query_len(current_->req);
  if(!qlen)return String();
  std::vector<char> q(qlen+1);
  if(httpd_req_get_url_query_str(current_->req,q.data(),q.size())!=ESP_OK)return String();
  std::vector<char> v(qlen+1);
  if(httpd_query_key_value(q.data(),name.c_str(),v.data(),v.size())!=ESP_OK)return String();
  return urlDecode(v.data());
}

bool WebServer::hasArg(const String& name)const{
  if(name=="plain")return current_&&!current_->body.empty();
  return arg(name).length()>0;
}

String WebServer::header(const String& name)const{
  if(!current_||!current_->req)return String();
  size_t n=httpd_req_get_hdr_value_len(current_->req,name.c_str());
  if(!n)return String();
  std::vector<char>b(n+1);
  if(httpd_req_get_hdr_value_str(current_->req,name.c_str(),b.data(),b.size())!=ESP_OK)return String();
  return String(b.data());
}

esp_err_t WebServer::routeThunk(httpd_req_t* req){
  auto* r=static_cast<Route*>(req->user_ctx);
  return r&&anderson_http_server_singleton?anderson_http_server_singleton->dispatch(r,req):ESP_FAIL;
}

esp_err_t WebServer::dispatch(Route* route,httpd_req_t* req){
  RequestContext ctx{};
  ctx.owner=this;
  ctx.req=req;
  current_=&ctx;
  gResponseHeaders.clear();

  if(route->upload){
    String fn=header("X-Anderson-Filename");
    if(!fn.length())fn="firmware.bin";
    ctx.upload.filename=fn;
    ctx.upload.status=UPLOAD_FILE_START;
    ctx.upload.totalSize=req->content_len;
    route->upload();

    size_t remaining=req->content_len;
    uint8_t buffer[2048];
    bool aborted=false;
    bool timedOut=false;
    uint8_t consecutiveTimeouts=0;
    const int64_t deadlineUs=esp_timer_get_time()+kUploadAbsoluteTimeoutUs;

    while(remaining){
      if(esp_timer_get_time()>=deadlineUs){aborted=true;timedOut=true;break;}
      int got=httpd_req_recv(req,(char*)buffer,(int)std::min(remaining,sizeof(buffer)));
      if(got==HTTPD_SOCK_ERR_TIMEOUT){
        if(++consecutiveTimeouts>=kMaxConsecutiveReceiveTimeouts){aborted=true;timedOut=true;break;}
        continue;
      }
      if(got<=0){aborted=true;break;}
      consecutiveTimeouts=0;
      ctx.upload.status=UPLOAD_FILE_WRITE;
      ctx.upload.buf=buffer;
      ctx.upload.currentSize=(size_t)got;
      route->upload();
      remaining-=(size_t)got;
    }

    ctx.upload.buf=nullptr;
    ctx.upload.currentSize=0;
    ctx.upload.status=aborted?UPLOAD_FILE_ABORTED:UPLOAD_FILE_END;
    route->upload();
    if(route->handler)route->handler();
    if(!ctx.responded){
      if(timedOut)send(408,"text/plain","Firmware upload timed out");
      else send(aborted?500:200,"text/plain",aborted?"Upload connection aborted":"OK");
    }
    gResponseHeaders.clear();
    current_=nullptr;
    return ESP_OK;
  }

  if(req->content_len){
    if(req->content_len>131072){
      send(400,"text/plain","Request body too large");
      gResponseHeaders.clear();
      current_=nullptr;
      return ESP_OK;
    }
    ctx.body.reserve(req->content_len);
    size_t remaining=req->content_len;
    char buffer[1024];
    uint8_t consecutiveTimeouts=0;
    const int64_t deadlineUs=esp_timer_get_time()+kBodyAbsoluteTimeoutUs;
    while(remaining){
      if(esp_timer_get_time()>=deadlineUs){
        send(408,"text/plain","Request body timed out");
        gResponseHeaders.clear();
        current_=nullptr;
        return ESP_OK;
      }
      int got=httpd_req_recv(req,buffer,(int)std::min(remaining,sizeof(buffer)));
      if(got==HTTPD_SOCK_ERR_TIMEOUT){
        if(++consecutiveTimeouts>=kMaxConsecutiveReceiveTimeouts){
          send(408,"text/plain","Request body timed out");
          gResponseHeaders.clear();
          current_=nullptr;
          return ESP_OK;
        }
        continue;
      }
      if(got<=0){
        send(400,"text/plain","Request body read failed");
        gResponseHeaders.clear();
        current_=nullptr;
        return ESP_OK;
      }
      consecutiveTimeouts=0;
      ctx.body.append(buffer,got);
      remaining-=got;
    }
  }

  if(route->handler)route->handler();
  if(!ctx.responded)send(204);
  gResponseHeaders.clear();
  current_=nullptr;
  return ESP_OK;
}

IPAddress WebServer::ClientProxy::remoteIP()const{
  if(!WebServer::current_||!WebServer::current_->req)return IPAddress();
  int fd=httpd_req_to_sockfd(WebServer::current_->req);
  sockaddr_storage ss{};
  socklen_t n=sizeof(ss);
  if(fd<0||getpeername(fd,(sockaddr*)&ss,&n)!=0)return IPAddress();
  if(ss.ss_family==AF_INET)return IPAddress(((sockaddr_in*)&ss)->sin_addr.s_addr);
  return IPAddress();
}

void WebServer::ClientProxy::stop(){}
