#include "AndersonDiagnostics.h"
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_random.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

namespace AndersonDiagnostics {
namespace {
constexpr char URL[]="https://oracle-home-dev.150.136.245.51.sslip.io/anderson-logs/v1/events";
constexpr uint8_t CAP=24;
constexpr uint32_t SEND_INTERVAL=15000UL;
constexpr uint32_t ERROR_RETRY=30000UL;
constexpr uint32_t SNAPSHOT_INTERVAL=300000UL;
// Let's Encrypt ISRG Root X1. Never setInsecure() for diagnostic uploads.
const char ROOT_CA[] PROGMEM=R"CERT(-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
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
bool active=false,suspended=false,workerStarted=false;
char bearer[112]{};

void uploader(void*) {
  for(;;) {
    vTaskDelay(pdMS_TO_TICKS(3500));
    if(WiFi.status()!=WL_CONNECTED || suspended)continue;
    Event batch[12];uint8_t n=0;char secret[sizeof(bearer)]{};
    portENTER_CRITICAL(&lock);
    uint32_t now=millis();
    if(active&&count&&(uint32_t)(now-lastSendMs)>=(lastHttp==200?SEND_INTERVAL:ERROR_RETRY)){
      n=min((uint8_t)12,count);
      for(uint8_t i=0;i<n;i++)batch[i]=ring[(tail+i)%CAP];
      memcpy(secret,bearer,sizeof(secret));
      lastSendMs=now;
    }
    portEXIT_CRITICAL(&lock);
    if(!n)continue;

    JsonDocument doc;doc["schema"]=1;doc["device"]="anderson-nanoc6";
    char bootHex[12];snprintf(bootHex,sizeof(bootHex),"%08lX",(unsigned long)bootId);
    doc["boot"]=bootHex;
    JsonArray events=doc["events"].to<JsonArray>();
    for(uint8_t i=0;i<n;i++){
      JsonObject e=events.add<JsonObject>();e["seq"]=batch[i].seq;
      e["u"]=batch[i].uptime;e["ts"]=batch[i].utc;
      e["code"]=batch[i].code;e["slot"]=batch[i].slot;
      e["value"]=batch[i].value;
      if(batch[i].detail[0])e["detail"]=batch[i].detail;
    }
    String payload;serializeJson(doc,payload);
    WiFiClientSecure client;client.setCACert(ROOT_CA);
    client.setHandshakeTimeout(5);
    HTTPClient http;http.setConnectTimeout(3500);http.setTimeout(3500);
    http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
    int code=-1;uint32_t ack=0;bool success=false;
    if(http.begin(client,URL)){
      http.addHeader("Content-Type","application/json");
      http.addHeader("Authorization",String("Bearer ")+secret);
      code=http.POST(payload);
      if(code==200){
        String response=http.getString();JsonDocument answer;
        if(response.length()<512&&!deserializeJson(answer,response)
          &&(answer["ok"]|false)){
          ack=answer["ack"]|0UL;success=ack==batch[n-1].seq;
        }
      }
      http.end();
    }
    memset(secret,0,sizeof(secret));
    portENTER_CRITICAL(&lock);
    lastHttp=code;
    if(success){
      while(count&&ring[tail].seq<=ack){tail=(tail+1)%CAP;count--;uploaded++;}
    }
    portEXIT_CRITICAL(&lock);
  }
}
}

void record(uint8_t code,int8_t slot,int32_t value,const char* detail) {
  if(code>=20)return;
  Event entry{};entry.seq=++seq;entry.uptime=millis();
  time_t now=time(nullptr);entry.utc=(now>1700000000&&now<4102444800)?(uint32_t)now:0;
  entry.code=code;entry.slot=slot;entry.value=value;
  if(detail)for(size_t i=0;i<sizeof(entry.detail)-1&&detail[i];i++)
    entry.detail[i]=(detail[i]>=32&&detail[i]<127)?detail[i]:'_';
  portENTER_CRITICAL(&lock);
  if(count==CAP){tail=(tail+1)%CAP;--count;++dropped;}
  ring[(tail+count)%CAP]=entry;++count;
  portEXIT_CRITICAL(&lock);
}
void begin() {
  bootId=esp_random();
  Preferences p;if(p.begin("anderson-log",true)){
    String key=p.getString("token","");active=p.getBool("enabled",false)&&key.length()>=40;
    key.toCharArray(bearer,sizeof(bearer));p.end();
  }
  lastHttp=200;
  record(0,-1,0,"nano-boot");
  if(!workerStarted){
    TaskHandle_t task=nullptr;
    workerStarted=xTaskCreate(uploader,"anderson-diag",8192,nullptr,1,&task)==pdPASS;
  }
}
bool configure(const String& newToken,bool enabled){
  if(newToken.length()&& (newToken.length()<40||newToken.length()>=sizeof(bearer)))return false;
  for(size_t i=0;i<newToken.length();i++){
    char c=newToken[i];
    if(!((c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='-'||c=='_'))return false;
  }
  String finalKey=newToken.length()?newToken:String(bearer);
  if(enabled&&finalKey.length()<40)return false;
  Preferences p;if(!p.begin("anderson-log",false))return false;
  bool ok=true;
  if(newToken.length())ok=p.putString("token",newToken)==newToken.length();
  if(ok)ok=p.putBool("enabled",enabled)>0;
  p.end();
  if(!ok)return false;
  portENTER_CRITICAL(&lock);
  if(newToken.length())newToken.toCharArray(bearer,sizeof(bearer));
  active=enabled;lastSendMs=0;lastHttp=200;
  portEXIT_CRITICAL(&lock);
  record(18,-1,enabled?1:0,"diagnostics-config");
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
  portEXIT_CRITICAL(&lock);
  out["endpoint"]=URL;
}
}
