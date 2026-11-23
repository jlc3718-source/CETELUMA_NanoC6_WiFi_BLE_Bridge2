#include "AndersonDiagnostics.h"
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_random.h>
#include <mbedtls/base64.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <time.h>

// Direct, authenticated GitHub REST contents API. No Oracle relay or data path.
// Repository is private; credentials are saved only in device NVS.
namespace AndersonDiagnostics {
namespace {
constexpr char API_ROOT[]="https://api.github.com/repos/jlc3718-source/anderson-home-diagnostics/contents/events/";
constexpr uint8_t CAP=64;
constexpr uint32_t SEND_INTERVAL=60000UL;
constexpr uint32_t ERROR_RETRY=60000UL;
constexpr uint32_t SNAPSHOT_INTERVAL=300000UL;
// Only the public trust anchors are firmware constants. Never embed an access token.
// DigiCert Global Root G2/G3 cover current api.github.com TLS chains.
const char GITHUB_CA[] PROGMEM=R"CERT(-----BEGIN CERTIFICATE-----
MIIDjjCCAnagAwIBAgIQAzrx5qcRqaC7KGSxHQn65TANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEcyMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuzfNNNx7a8myaJCtSnX/RrohCgiN9RlUyfuI
2/Ou8jqJkTx65qsGGmvPrC3oXgkkRLpimn7Wo6h+4FR1IAWsULecYxpsMNzaHxmx
1x7e/dfgy5SDN67sH0NO3Xss0r0upS/kqbitOtSZpLYl6ZtrAGCSYP9PIUkY92eQ
q2EGnI/yuum06ZIya7XzV+hdG82MHauVBJVJ8zUtluNJbd134/tJS7SsVQepj5Wz
tCO7TG1F8PapspUwtP1MVYwnSlcUfIKdzXOS0xZKBgyMUNGPHgm+F6HmIcr9g+UQ
vIOlCsRnKPZzFBQ9RnbDhxSJITRNrw9FDKZJobq7nMWxM4MphQIDAQABo0IwQDAP
BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQUTiJUIBiV
5uNu5g/6+rkS7QYXjzkwDQYJKoZIhvcNAQELBQADggEBAGBnKJRvDkhj6zHd6mcY
1Yl9PMWLSn/pvtsrF9+wX3N3KjITOYFnQoQj8kVnNeyIv/iPsGEMNKSuIEyExtv4
NeF22d+mQrvHRAiGfzZ0JFrabA0UWTW98kndth/Jsw1HKj2ZL7tcu7XUIOGZX1NG
Fdtom/DzMNU+MeKNhJ7jitralj41E6Vf8PlwUHBHQRFXGU7Aj64GxJUTFy8bJZ91
8rGOmaFvE7FBcf6IKshPECBV1/MUReXgRPTqh5Uykw7+U0b6LJ3/iyK5S9kJRaTe
pLiaWN0bfVKfjllDiIGknibVb63dDcY3fe0Dkhvld1927jyNxF1WW6LZZm6zNTfl
MrY=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICPzCCAcWgAwIBAgIQBVVWvPJepDU1w6QP1atFcjAKBggqhkjOPQQDAzBhMQsw
CQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3d3cu
ZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBHMzAe
Fw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVTMRUw
EwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5jb20x
IDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEczMHYwEAYHKoZIzj0CAQYF
K4EEACIDYgAE3afZu4q4C/sLfyHS8L6+c/MzXRq8NOrexpu80JX28MzQC7phW1FG
fp4tn+6OYwwX7Adw9c+ELkCDnOg/QW07rdOkFFk2eJ0DQ+4QE2xy3q6Ip6FrtUPO
Z9wj/wMco+I+o0IwQDAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAd
BgNVHQ4EFgQUs9tIpPmhxdiuNkHMEWNpYim8S8YwCgYIKoZIzj0EAwMDaAAwZQIx
AK288mw/EkrRLTnDCgmXc/SINoyIJ7vmiI1Qhadj+Z4y3maTD/HMsQmP3Wyr+mt/
oAIwOWZbwmSNuJ5Q3KjVSaLtx9zRSX8XAbjIho9OjIgrqJqpisXRAL34VOKa5Vt8
sycX
-----END CERTIFICATE-----
)CERT";
struct Event {
  uint32_t seq,uptime,utc;
  int32_t value;
  uint8_t code;
  int8_t slot;
  char detail[32];
};
portMUX_TYPE lock=portMUX_INITIALIZER_UNLOCKED;
Event ring[CAP]{};
uint8_t tail=0,count=0;
uint32_t seq=0,bootId=0,dropped=0;
uint32_t lastSendMs=0,lastSnapshotMs=0,uploaded=0;
int lastHttp=0;
bool active=false,workerStarted=false;
volatile bool suspended=false;
char bearer[160]{};
char lastPath[105]{};

bool base64Json(const String& input,String& encoded) {
  size_t cap=((input.length()+2)/3)*4+1;
  if(cap>8000)return false;
  auto* data=(unsigned char*)malloc(cap);
  if(!data)return false;
  size_t written=0;
  int result=mbedtls_base64_encode(data,cap,&written,
                (const unsigned char*)input.c_str(),input.length());
  bool ok=result==0&&written<cap;
  if(ok){data[written]=0;encoded=String((char*)data);ok=encoded.length()==written;}
  free(data);return ok;
}

void uploader(void*) {
  for(;;) {
    vTaskDelay(pdMS_TO_TICKS(3000));
    if(WiFi.status()!=WL_CONNECTED || suspended)continue;
    const time_t clock=time(nullptr);
    // Require a valid clock for TLS verification and date-grouped log files.
    if(clock<1700000000 || clock>4102444800)continue;
    Event batch[12];uint8_t n=0;char secret[sizeof(bearer)]{};
    portENTER_CRITICAL(&lock);
    uint32_t now=millis();
    if(active&&count&&(uint32_t)(now-lastSendMs)>=(lastHttp==201?SEND_INTERVAL:ERROR_RETRY)){
      n=min((uint8_t)12,count);
      for(uint8_t i=0;i<n;i++)batch[i]=ring[(tail+i)%CAP];
      memcpy(secret,bearer,sizeof(secret));
      lastSendMs=now;
    }
    portEXIT_CRITICAL(&lock);
    if(!n)continue;

    JsonDocument packet;packet["schema"]=1;packet["device"]="anderson-nanoc6";
    char bootHex[12];snprintf(bootHex,sizeof(bootHex),"%08lX",(unsigned long)bootId);
    packet["boot"]=bootHex;
    JsonArray events=packet["events"].to<JsonArray>();
    for(uint8_t i=0;i<n;i++){
      JsonObject e=events.add<JsonObject>();e["seq"]=batch[i].seq;
      e["u"]=batch[i].uptime;e["ts"]=batch[i].utc;
      e["code"]=batch[i].code;e["slot"]=batch[i].slot;
      e["value"]=batch[i].value;
      if(batch[i].detail[0])e["detail"]=batch[i].detail;
    }
    String json;serializeJson(packet,json);
    String encoded;
    if(!base64Json(json,encoded)){
      portENTER_CRITICAL(&lock);lastHttp=-101;portEXIT_CRITICAL(&lock);
      memset(secret,0,sizeof(secret));continue;
    }
    struct tm date{};gmtime_r(&clock,&date);
    char datePath[16];strftime(datePath,sizeof(datePath),"%Y-%m-%d",&date);
    char path[105];snprintf(path,sizeof(path),"%s/%s_%lu-%lu.json",
        datePath,bootHex,(unsigned long)batch[0].seq,(unsigned long)batch[n-1].seq);
    String url=String(API_ROOT)+path;
    JsonDocument request;
    request["message"]=String("Anderson diagnostics ")+bootHex+" #"+batch[0].seq+"-"+batch[n-1].seq;
    request["content"]=encoded;
    request["branch"]="main";
    String body;serializeJson(request,body);

    WiFiClientSecure client;client.setCACert(GITHUB_CA);client.setHandshakeTimeout(7);
    HTTPClient http;http.setConnectTimeout(6000);http.setTimeout(8000);
    http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);http.setReuse(false);
    int code=-1;bool success=false;
    if(http.begin(client,url)){
      http.addHeader("Authorization",String("Bearer ")+secret);
      http.addHeader("Accept","application/vnd.github+json");
      http.addHeader("X-GitHub-Api-Version","2022-11-28");
      http.addHeader("User-Agent","AndersonHome-NanoC6");
      http.addHeader("Content-Type","application/json");
      code=http.PUT(body);
      success=code==201;
      http.end();
    }
    memset(secret,0,sizeof(secret));
    portENTER_CRITICAL(&lock);
    lastHttp=code;
    if(success){
      snprintf(lastPath,sizeof(lastPath),"%s",path);
      // Only remove records that were in this successful, specific snapshot.
      while(count&&ring[tail].seq<=batch[n-1].seq){
        tail=(tail+1)%CAP;--count;++uploaded;
      }
    }
    portEXIT_CRITICAL(&lock);
  }
}
}
void record(uint8_t code,int8_t slot,int32_t value,const char* detail) {
  if(code>=20)return;
  Event entry{};entry.uptime=millis();
  time_t now=time(nullptr);entry.utc=(now>1700000000&&now<4102444800)?(uint32_t)now:0;
  entry.code=code;entry.slot=slot;entry.value=value;
  if(detail)for(size_t i=0;i<sizeof(entry.detail)-1&&detail[i];i++)
    entry.detail[i]=(detail[i]>=32&&detail[i]<127)?detail[i]:'_';
  portENTER_CRITICAL(&lock);
  entry.seq=++seq;
  if(count==CAP){tail=(tail+1)%CAP;--count;++dropped;}
  ring[(tail+count)%CAP]=entry;++count;
  portEXIT_CRITICAL(&lock);
}
void begin() {
  bootId=esp_random();
  Preferences p;if(p.begin("anderson-gh",true)){
    String key=p.getString("token","");
    active=p.getBool("enabled",false)&&key.length()>=40;
    key.toCharArray(bearer,sizeof(bearer));p.end();
  }
  lastHttp=201;
  record(0,-1,0,"nano-boot");
  if(active&&!workerStarted){
    TaskHandle_t task=nullptr;
    workerStarted=xTaskCreate(uploader,"anderson-diag",8192,nullptr,1,&task)==pdPASS;
  }
}
bool configure(const String& newToken,bool enabled){
  if(newToken.length()&&(newToken.length()<40||newToken.length()>=sizeof(bearer)))return false;
  for(size_t i=0;i<newToken.length();i++){
    char c=newToken[i];
    if(!((c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='-'||c=='_'))return false;
  }
  String finalKey=newToken.length()?newToken:String(bearer);
  if(enabled&&finalKey.length()<40)return false;
  Preferences p;if(!p.begin("anderson-gh",false))return false;
  bool ok=true;
  if(newToken.length())ok=p.putString("token",newToken)==newToken.length();
  if(ok)ok=p.putBool("enabled",enabled)>0;
  p.end();
  if(!ok)return false;
  portENTER_CRITICAL(&lock);
  if(newToken.length())newToken.toCharArray(bearer,sizeof(bearer));
  active=enabled;lastSendMs=0;lastHttp=201;
  portEXIT_CRITICAL(&lock);
  if(enabled&&!workerStarted){
    TaskHandle_t task=nullptr;
    workerStarted=xTaskCreate(uploader,"anderson-diag",8192,nullptr,1,&task)==pdPASS;
  }
  record(18,-1,enabled?1:0,"github-diagnostics-config");
  return true;
}
void tick(bool firmwareBusy){
  suspended=firmwareBusy;
  uint32_t now=millis();
  if((uint32_t)(now-lastSnapshotMs)<SNAPSHOT_INTERVAL)return;
  lastSnapshotMs=now;
  if(active)record(13,-1,WiFi.status()==WL_CONNECTED?WiFi.RSSI():-127,"nano-wifi-rssi");
}
void status(JsonObject out){
  portENTER_CRITICAL(&lock);
  out["enabled"]=active;out["paired"]=bearer[0]!=0;
  out["pending"]=count;out["dropped"]=dropped;
  out["uploaded"]=uploaded;out["lastHttp"]=lastHttp;
  out["workerReady"]=workerStarted;
  out["lastPath"]=lastPath;
  portEXIT_CRITICAL(&lock);
  out["mode"]="github-direct";
  out["repository"]="jlc3718-source/anderson-home-diagnostics";
}
}
