// Permanent updater: no web interface, BLE, filesystem, schedule or extra app copy.
#include "Common.h"
#include "Roots.h"
#include "Build.h"
#include <mbedtls/base64.h>
String lastError;
const char* VERSION=JH2_VERSION;
const char* BUILD_SHA=JH2_BUILD_SHA;
static uint32_t retryAt=0;
bool timeValid(){return time(nullptr)>1735689600;}
void startNetwork(){
  Serial.begin(115200);delay(100);Preferences n;n.begin("jh2-network",true);String ssid=n.getString("ssid",""),password=n.getString("password","");n.end();
  WiFi.persistent(false);WiFi.setSleep(false);WiFi.mode(WIFI_STA);WiFi.begin(ssid.c_str(),password.c_str());
  configTzTime("EST5EDT,M3.2.0/2,M11.1.0/2","time.cloudflare.com","pool.ntp.org");Serial.println("Jason Home 2 minimal updater");
}
void networkLoop(){if(WiFi.status()!=WL_CONNECTED&&(int32_t)(millis()-retryAt)>=0){retryAt=millis()+30000;WiFi.reconnect();}}
void trust(WiFiClientSecure&c){c.setCACert(JH2_ROOTS);c.setHandshakeTimeout(10);c.setTimeout(12);}
String hexBytes(const uint8_t*p,size_t n){String s;s.reserve(n*2);const char*h="0123456789abcdef";for(size_t i=0;i<n;i++){s+=h[p[i]>>4];s+=h[p[i]&15];}return s;}
Bytes from64(const String&s){size_t n=0;Bytes out(s.length()*3/4+4);if(mbedtls_base64_decode(out.data(),out.size(),&n,(const uint8_t*)s.c_str(),s.length()))return {};out.resize(n);return out;}
