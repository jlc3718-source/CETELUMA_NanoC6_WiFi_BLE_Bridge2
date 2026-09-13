#include "HTTPClient.h"
#include "esp_crt_bundle.h"

bool HTTPClient::begin(WiFiClientSecure& secure,const String& u){
  end();
  url_=u;
  insecure_=secure.insecure_;
  handshakeSeconds_=secure.handshakeSeconds_;
  return !url_.empty();
}

void HTTPClient::addHeader(const String& n,const String& v){headers_.push_back({n,v});}

int HTTPClient::GET(){
  if(url_.empty())return -1;
  lastError_=ESP_OK;
  esp_http_client_config_t c{};
  c.url=url_.c_str();
  const int handshakeMs=handshakeSeconds_>0?(int)(handshakeSeconds_*1000U):0;
  c.timeout_ms=handshakeMs>connectTimeout_?handshakeMs:connectTimeout_;
  c.keep_alive_enable=true;
  c.disable_auto_redirect=true;
  c.max_redirection_count=6;
  c.buffer_size=4096;
  c.buffer_size_tx=1024;
  if(insecure_){
    c.crt_bundle_attach=nullptr;
    c.skip_cert_common_name_check=true;
  }else{
    c.crt_bundle_attach=esp_crt_bundle_attach;
  }
  client_=esp_http_client_init(&c);
  if(!client_){lastError_=ESP_ERR_NO_MEM;return -1;}
  for(auto&h:headers_)esp_http_client_set_header(client_,h.first.c_str(),h.second.c_str());
  for(int redirect=0;redirect<6;redirect++){
    lastError_=esp_http_client_open(client_,0);
    if(lastError_!=ESP_OK){status_=-1;return status_;}
    esp_http_client_set_timeout_ms(client_,timeout_);
    contentLength_=esp_http_client_fetch_headers(client_);
    status_=esp_http_client_get_status_code(client_);
    if(follow_&&(status_==301||status_==302||status_==303||status_==307||status_==308)){
      lastError_=esp_http_client_set_redirection(client_);
      if(lastError_!=ESP_OK){status_=-1;return status_;}
      esp_http_client_close(client_);
      continue;
    }
    stream_.attach(client_,contentLength_);
    return status_;
  }
  lastError_=ESP_ERR_INVALID_STATE;
  status_=-1;
  return status_;
}

void HTTPClient::end(){
  stream_.stop();
  if(client_){esp_http_client_close(client_);esp_http_client_cleanup(client_);client_=nullptr;}
  headers_.clear();
  contentLength_=-1;
  status_=-1;
  lastError_=ESP_OK;
}
