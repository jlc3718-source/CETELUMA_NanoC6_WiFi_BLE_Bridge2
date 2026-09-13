#include "HTTPClient.h"
#include "esp_crt_bundle.h"
bool HTTPClient::begin(WiFiClientSecure&,const String& u){end();url_=u;return !url_.empty();}
void HTTPClient::addHeader(const String& n,const String& v){headers_.push_back({n,v});}
int HTTPClient::GET(){
  if(url_.empty())return -1;
  esp_http_client_config_t c{};
  c.url=url_.c_str();
  c.timeout_ms=connectTimeout_;
  c.crt_bundle_attach=esp_crt_bundle_attach;
  c.keep_alive_enable=true;
  c.disable_auto_redirect=true;
  client_=esp_http_client_init(&c);
  if(!client_)return -1;
  for(auto&h:headers_)esp_http_client_set_header(client_,h.first.c_str(),h.second.c_str());
  for(int redirect=0;redirect<6;redirect++){
    if(esp_http_client_open(client_,0)!=ESP_OK){status_=-1;return status_;}
    esp_http_client_set_timeout_ms(client_,timeout_);
    contentLength_=esp_http_client_fetch_headers(client_);
    status_=esp_http_client_get_status_code(client_);
    if(follow_&&(status_==301||status_==302||status_==303||status_==307||status_==308)){
      if(esp_http_client_set_redirection(client_)!=ESP_OK)return status_;
      esp_http_client_close(client_);
      continue;
    }
    stream_.attach(client_,contentLength_);
    return status_;
  }
  return status_;
}
void HTTPClient::end(){stream_.stop();if(client_){esp_http_client_close(client_);esp_http_client_cleanup(client_);client_=nullptr;}headers_.clear();contentLength_=-1;status_=-1;}
