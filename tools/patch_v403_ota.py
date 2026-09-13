#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD = "4.0.2"
NEW = "4.0.3"


def replace_once(path: Path, old: str, new: str):
    text = path.read_text()
    if text.count(old) != 1:
        raise SystemExit(f"Expected exactly one match in {path}: {old!r}, found {text.count(old)}")
    path.write_text(text.replace(old, new, 1))

http_h = ROOT / "firmware/include/HTTPClient.h"
http_h.write_text(r'''#pragma once
#include "Arduino.h"
#include "NetworkClient.h"
#include "WiFiClientSecure.h"
#include <esp_err.h>
#include <vector>
static constexpr int HTTP_CODE_OK=200;
static constexpr int HTTPC_STRICT_FOLLOW_REDIRECTS=1;
class HTTPClient {
 public:
  ~HTTPClient(){end();}
  void setConnectTimeout(int ms){connectTimeout_=ms;}
  void setTimeout(int ms){timeout_=ms;}
  void setFollowRedirects(int){follow_=true;}
  bool begin(WiFiClientSecure& secure,const String& url);
  void addHeader(const String& name,const String& value);
  int GET();
  int getSize()const{return contentLength_>INT32_MAX?-1:(int)contentLength_;}
  NetworkClient* getStreamPtr(){return &stream_;}
  String errorName()const{return lastError_==ESP_OK?String(""):String(esp_err_to_name(lastError_));}
  void end();
 private:
  String url_;
  int connectTimeout_=6000,timeout_=8000,status_=-1;
  int64_t contentLength_=-1;
  bool follow_=false,insecure_=false;
  unsigned handshakeSeconds_=12;
  esp_err_t lastError_=ESP_OK;
  esp_http_client_handle_t client_=nullptr;
  NetworkClient stream_;
  std::vector<std::pair<String,String>> headers_;
};
''')

http_cpp = ROOT / "firmware/src/HTTPClient.cpp"
http_cpp.write_text(r'''#include "HTTPClient.h"
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
''')

sdk = ROOT / "firmware/sdkconfig.defaults"
text = sdk.read_text()
replace_token = f'CONFIG_APP_PROJECT_VER="{OLD}"'
if text.count(replace_token) != 1:
    raise SystemExit("Unexpected sdkconfig version marker")
text = text.replace(replace_token, f'CONFIG_APP_PROJECT_VER="{NEW}"', 1)
if "CONFIG_ESP_TLS_INSECURE=y" not in text:
    marker = "CONFIG_MBEDTLS_CERTIFICATE_BUNDLE_DEFAULT_CMN=y\n"
    if marker not in text:
        raise SystemExit("Certificate bundle marker missing")
    text = text.replace(marker, marker + "CONFIG_ESP_TLS_INSECURE=y\nCONFIG_ESP_TLS_SKIP_SERVER_CERT_VERIFY=y\n", 1)
sdk.write_text(text)

(ROOT / "FIRMWARE_VERSION.txt").write_text(NEW + "\n")
replace_once(ROOT / "firmware/src/main.cpp", f'ANDERSON_FIRMWARE_VERSION="{OLD}"', f'ANDERSON_FIRMWARE_VERSION="{NEW}"')

readme = ROOT / "README.md"
if readme.exists():
    readme.write_text(readme.read_text().replace(f"**v{OLD}**", f"**v{NEW}**"))

remote = ROOT / "firmware/src/RemoteUpdate.cpp"
old_diag = 'st.message=String("Firmware download failed (HTTP ")+String(code)+")";http.end();return false;'
new_diag = 'st.message=String("Firmware download failed (HTTP ")+String(code)+")";if(code<0){String detail=http.errorName();if(detail.length())st.message+=String(" - ")+detail;}http.end();return false;'
replace_once(remote, old_diag, new_diag)

# One-time patch helper: remove itself and its trigger after applying the real source changes.
for rel in ("tools/patch_v403_ota.py", ".github/workflows/patch-v403-ota.yml"):
    p = ROOT / rel
    if p.exists():
        p.unlink()

print("Applied Anderson Home v4.0.3 OTA downloader fix")
