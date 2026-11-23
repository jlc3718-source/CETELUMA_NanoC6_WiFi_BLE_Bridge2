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

-----BEGIN CERTIFICATE-----
MIIDRjCCAsugAwIBAgIQGp6v7G3o4ZtcGTFBto2Q3TAKBggqhkjOPQQDAzCBiDEL
MAkGA1UEBhMCVVMxEzARBgNVBAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0plcnNl
eSBDaXR5MR4wHAYDVQQKExVUaGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNVBAMT
JVVTRVJUcnVzdCBFQ0MgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkwHhcNMjEwMzIy
MDAwMDAwWhcNMzgwMTE4MjM1OTU5WjBfMQswCQYDVQQGEwJHQjEYMBYGA1UEChMP
U2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQDEy1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIg
QXV0aGVudGljYXRpb24gUm9vdCBFNDYwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAAR2
+pmpbiDt+dd34wc7qNs9Xzjoq1WmVk/WSOrsfy2qw7LFeeyZYX8QeccCWvkEN/U0
NSt3zn8gj1KjAIns1aeibVvjS5KToID1AZTc8GgHHs3u/iVStSBDHBv+6xnOQ6Oj
ggEgMIIBHDAfBgNVHSMEGDAWgBQ64QmG1M8ZwpZ2dEl23OA1xmNjmjAdBgNVHQ4E
FgQU0SLaTFnxS18mOKqd1u7rDcP7qWEwDgYDVR0PAQH/BAQDAgGGMA8GA1UdEwEB
/wQFMAMBAf8wHQYDVR0lBBYwFAYIKwYBBQUHAwEGCCsGAQUFBwMCMBEGA1UdIAQK
MAgwBgYEVR0gADBQBgNVHR8ESTBHMEWgQ6BBhj9odHRwOi8vY3JsLnVzZXJ0cnVz
dC5jb20vVVNFUlRydXN0RUNDQ2VydGlmaWNhdGlvbkF1dGhvcml0eS5jcmwwNQYI
KwYBBQUHAQEEKTAnMCUGCCsGAQUFBzABhhlodHRwOi8vb2NzcC51c2VydHJ1c3Qu
Y29tMAoGCCqGSM49BAMDA2kAMGYCMQCMCyBit99vX2ba6xEkDe+YO7vC0twjbkv9
PKpqGGuZ61JZryjFsp+DFpEclCVy4noCMQCwvZDXD/m2Ko1HA5Bkmz7YQOFAiNDD
49IWa2wdT7R3DtODaSXH/BiXv8fwB9su4tU=
-----END CERTIFICATE-----
)CERT";
struct Event {
  uint32_t seq,uptime,utc;
  int32_t value;
  uint8_t code;
  int8_t slot;
  char detail[32];
  // Fixed-size optional metadata; no dynamic allocation or secrets in the queue.
  char source[24],effect[12];
  uint32_t colors[8];
  uint8_t colorCount=0,power=0,brightness=0,speed=0;
  int8_t target=0;
  uint8_t frame[9],frameLen=0;
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
      if(batch[i].code==14){
        JsonObject scene=e["scene"].to<JsonObject>();
        scene["name"]=batch[i].detail;
        scene["source"]=batch[i].source;
        scene["effect"]=batch[i].effect;
        scene["power"]=batch[i].power!=0;
        scene["brightness"]=batch[i].brightness;
        scene["speed"]=batch[i].speed;
        scene["target"]=batch[i].target; // 0=both, 1=House, 2=Garage
        JsonArray colors=scene["colors"].to<JsonArray>();
        for(uint8_t j=0;j<batch[i].colorCount&&j<8;j++){
          char hex[8];snprintf(hex,sizeof(hex),"#%06lX",(unsigned long)(batch[i].colors[j]&0xFFFFFFUL));
          colors.add(String(hex));
        }
      }
      if(batch[i].code==7&&batch[i].frameLen){
        JsonObject write=e["write"].to<JsonObject>();
        const uint8_t* f=batch[i].frame;
        const uint8_t kind=batch[i].frameLen>2?f[2]:0;
        write["type"]=kind==5?"color":(kind==4?"power":(kind==1?"brightness":"other"));
        if(kind==5&&batch[i].frameLen>=7){
          char hex[8];snprintf(hex,sizeof(hex),"#%02X%02X%02X",f[4],f[5],f[6]);
          write["rgb"]=hex;
        }else if(kind==1&&batch[i].frameLen>=4)write["brightness"]=f[3];
        else if(kind==4&&batch[i].frameLen>=6)write["power"]=f[5]!=0;
        char raw[19]={};
        for(uint8_t j=0;j<batch[i].frameLen&&j<9;j++)snprintf(raw+j*2,3,"%02X",f[j]);
        write["frame"]=raw;
      }
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
static void queueEvent(Event& entry) {
  entry.uptime=millis();
  time_t now=time(nullptr);entry.utc=(now>1700000000&&now<4102444800)?(uint32_t)now:0;
  portENTER_CRITICAL(&lock);
  entry.seq=++seq;
  if(count==CAP){tail=(tail+1)%CAP;--count;++dropped;}
  ring[(tail+count)%CAP]=entry;++count;
  portEXIT_CRITICAL(&lock);
}
void record(uint8_t code,int8_t slot,int32_t value,const char* detail) {
  if(code>=20)return;
  Event entry{};entry.code=code;entry.slot=slot;entry.value=value;
  if(detail)for(size_t i=0;i<sizeof(entry.detail)-1&&detail[i];i++)
    entry.detail[i]=(detail[i]>=32&&detail[i]<127)?detail[i]:'_';
  queueEvent(entry);
}
void recordScene(const char* source,const char* name,const char* effect,
                 const uint32_t* colors,uint8_t colorCount,bool power,
                 uint8_t brightness,uint8_t speed,int8_t target) {
  Event entry{};entry.code=14;entry.slot=target?target-1:-1;entry.value=power?1:0;
  snprintf(entry.detail,sizeof(entry.detail),"%s",name?name:"");
  snprintf(entry.source,sizeof(entry.source),"%s",source?source:"unknown");
  snprintf(entry.effect,sizeof(entry.effect),"%s",effect?effect:"unknown");
  entry.colorCount=colors?min((uint8_t)8,colorCount):0;
  for(uint8_t i=0;i<entry.colorCount;i++)entry.colors[i]=colors[i]&0xFFFFFFUL;
  entry.power=power?1:0;entry.brightness=brightness;entry.speed=speed;entry.target=target;
  queueEvent(entry);
}
void recordBleWrite(int8_t slot,const uint8_t* frame,size_t length) {
  if(!frame||length<3)return;
  Event entry{};entry.code=7;entry.slot=slot;entry.value=frame[2];
  snprintf(entry.detail,sizeof(entry.detail),"%s","ble-frame-accepted");
  entry.frameLen=(uint8_t)min(length,sizeof(entry.frame));
  memcpy(entry.frame,frame,entry.frameLen);
  queueEvent(entry);
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
