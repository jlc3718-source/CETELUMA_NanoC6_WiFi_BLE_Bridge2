#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <Update.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <esp_ota_ops.h>
#include <esp_system.h>
#include <mbedtls/base64.h>
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>

static constexpr char VERSION[]="4.0.5";
static constexpr char OTA_MANIFEST_URL[]="https://raw.githubusercontent.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/ota/latest.json";
static constexpr char OTA_RELEASE_PREFIX[]="https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/releases/download/anderson-v";
static constexpr size_t OTA_SLOT_BYTES=0x1E0000;
static constexpr int LED_PIN=7;
static constexpr uint32_t BOOT_VERIFY_DEADLINE_MS=90000UL;
static const char OTA_PUBLIC_KEY[]=R"KEY(-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE3Dw/xqxEPbvkJQAcMeZxBAxwujxN
kuGHPepzClPYMrJ4h5r8iNlyUFpJZcPI/FXe8+atedYKpIZZB5XlOj964Q==
-----END PUBLIC KEY-----
)KEY";

WebServer server(80);
static bool serverStarted=false;
static bool otaPendingVerify=false;
static bool otaValidated=false;
static uint32_t bootStarted=0;
static bool rebootPending=false;
static uint32_t rebootAt=0;
static bool manualUploadOk=false;
static bool manualUploadStarted=false;
static size_t manualUploadBytes=0;
static bool signedInstallRequested=false;
static String lastStatus="Recovery Hub starting";
static String latestVersion="";
static String latestSha="";
static String latestCommit="";
static String latestUrl="";
static size_t latestBytes=0;

struct Manifest {
  String version,sha,commit,url,payload;
  size_t bytes=0;
  bool valid=false;
};

static String htmlEscape(const String&s){String o;o.reserve(s.length()+16);for(size_t i=0;i<s.length();i++){char c=s[i];if(c=='&')o+="&amp;";else if(c=='<')o+="&lt;";else if(c=='>')o+="&gt;";else if(c=='\"')o+="&quot;";else o+=c;}return o;}
static String hexBytes(const uint8_t*d,size_t n){static const char h[]="0123456789abcdef";String o;o.reserve(n*2);for(size_t i=0;i<n;i++){o+=h[d[i]>>4];o+=h[d[i]&15];}return o;}
static bool allHex(const String&s,size_t n){if(s.length()!=n)return false;for(size_t i=0;i<s.length();i++){char c=s[i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')||(c>='A'&&c<='F')))return false;}return true;}

struct V{int a=0,b=0,c=0;bool ok=false;};
static V parseV(String s){V v;int p1=s.indexOf('.'),p2=p1<0?-1:s.indexOf('.',p1+1);if(p1<=0||p2<=p1+1)return v;String a=s.substring(0,p1),b=s.substring(p1+1,p2),c=s.substring(p2+1);for(char x:a)if(x<'0'||x>'9')return v;for(char x:b)if(x<'0'||x>'9')return v;for(char x:c)if(x<'0'||x>'9')return v;v.a=a.toInt();v.b=b.toInt();v.c=c.toInt();v.ok=true;return v;}
static int cmpV(const String&a,const String&b){V x=parseV(a),y=parseV(b);if(!x.ok||!y.ok)return 0;if(x.a!=y.a)return x.a>y.a?1:-1;if(x.b!=y.b)return x.b>y.b?1:-1;if(x.c!=y.c)return x.c>y.c?1:-1;return 0;}

static bool verifySignature(const String&payload,const String&sig64){
  uint8_t sig[96];size_t sigLen=0;
  if(mbedtls_base64_decode(sig,sizeof(sig),&sigLen,(const unsigned char*)sig64.c_str(),sig64.length())!=0||!sigLen)return false;
  uint8_t digest[32];
  if(mbedtls_sha256((const unsigned char*)payload.c_str(),payload.length(),digest,0)!=0)return false;
  mbedtls_pk_context pk;mbedtls_pk_init(&pk);
  int rc=mbedtls_pk_parse_public_key(&pk,(const unsigned char*)OTA_PUBLIC_KEY,sizeof(OTA_PUBLIC_KEY));
  if(rc==0)rc=mbedtls_pk_verify(&pk,MBEDTLS_MD_SHA256,digest,sizeof(digest),sig,sigLen);
  mbedtls_pk_free(&pk);return rc==0;
}

static bool parsePayload(const String&payload,Manifest&m){
  bool gv=false,gb=false,gs=false,gc=false,gu=false;int start=0;
  while(start<(int)payload.length()){
    int nl=payload.indexOf('\n',start);if(nl<0)nl=payload.length();String line=payload.substring(start,nl);start=nl+1;if(!line.length())continue;
    int eq=line.indexOf('=');if(eq<=0)return false;String k=line.substring(0,eq),v=line.substring(eq+1);
    if(k=="version"&&!gv){m.version=v;gv=true;}
    else if(k=="bytes"&&!gb){for(char c:v)if(c<'0'||c>'9')return false;m.bytes=(size_t)v.toInt();gb=true;}
    else if(k=="sha256"&&!gs){m.sha=v;m.sha.toLowerCase();gs=true;}
    else if(k=="commit"&&!gc){m.commit=v;m.commit.toLowerCase();gc=true;}
    else if(k=="url"&&!gu){m.url=v;gu=true;}
    else return false;
  }
  if(!gv||!gb||!gs||!gc||!gu||!parseV(m.version).ok||!m.bytes||m.bytes>=OTA_SLOT_BYTES||!allHex(m.sha,64)||!allHex(m.commit,40))return false;
  String expected=String(OTA_RELEASE_PREFIX)+m.version+"/and_"+m.version+".bin";
  return m.url==expected;
}

static bool fetchManifest(Manifest&m,String&why){
  if(WiFi.status()!=WL_CONNECTED){why="Wi-Fi not connected";return false;}
  WiFiClientSecure client;client.setInsecure();client.setHandshakeTimeout(12);
  HTTPClient http;http.setConnectTimeout(7000);http.setTimeout(10000);
  String u=String(OTA_MANIFEST_URL)+"?recovery="+String((uint32_t)esp_random(),HEX)+"-"+String(millis(),HEX);
  if(!http.begin(client,u)){why="Could not open manifest URL";return false;}
  http.addHeader("Cache-Control","no-cache, no-store, max-age=0");
  int code=http.GET();if(code!=HTTP_CODE_OK){why=String("Manifest HTTP ")+code;http.end();return false;}
  String body=http.getString();http.end();if(body.length()==0||body.length()>4096){why="Manifest body invalid";return false;}
  JsonDocument d;if(deserializeJson(d,body)||(d["schema"]|0)!=1){why="Manifest JSON invalid";return false;}
  String payload=d["payload"]|String("");String sig=d["signature"]|String("");
  if(!payload.length()||!sig.length()||!verifySignature(payload,sig)){why="Manifest signature invalid";return false;}
  if(!parsePayload(payload,m)){why="Signed manifest payload invalid";return false;}
  m.payload=payload;m.valid=true;why="Signed manifest verified";return true;
}

static bool loadWiFi(String&ssid,String&pass){Preferences p;if(!p.begin("anderson",true))return false;ssid=p.getString("ssid","");pass=p.getString("pass","");p.end();ssid.trim();return ssid.length()>0;}
static bool connectWiFi(){
  String ssid,pass;if(!loadWiFi(ssid,pass)){lastStatus="No saved Anderson Wi-Fi credentials";return false;}
  WiFi.mode(WIFI_STA);WiFi.setAutoReconnect(true);WiFi.begin(ssid.c_str(),pass.c_str());
  uint32_t start=millis();while(WiFi.status()!=WL_CONNECTED&&millis()-start<30000UL){delay(200);digitalWrite(LED_PIN,!digitalRead(LED_PIN));}
  digitalWrite(LED_PIN,LOW);if(WiFi.status()!=WL_CONNECTED){lastStatus="Saved Wi-Fi connection timed out";return false;}
  lastStatus=String("Wi-Fi connected: ")+WiFi.localIP().toString();return true;
}

static void savePending(const Manifest&m){Preferences p;if(p.begin("anderson-ota",false)){p.putString("pending",m.version);p.putString("sha",m.sha);p.putString("commit",m.commit);p.putString("lastmsg",String("Recovery Hub staged signed ")+m.version);p.end();}}
static void clearRecoveryPending(){Preferences p;if(p.begin("anderson-ota",false)){String pending=p.getString("pending","");if(pending==VERSION){p.putString("lastver",VERSION);p.putString("lastmsg","Recovery Hub 4.0.5 booted and remote recovery is available.");p.remove("pending");p.remove("sha");p.remove("commit");p.remove("hold");p.remove("rejected");}p.end();}}

static bool installManifest(const Manifest&m,String&why){
  WiFiClientSecure client;client.setInsecure();client.setHandshakeTimeout(15);
  HTTPClient http;http.setConnectTimeout(10000);http.setTimeout(15000);http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  if(!http.begin(client,m.url)){why="Could not open firmware URL";return false;}
  int code=http.GET();if(code!=HTTP_CODE_OK){why=String("Firmware HTTP ")+code;http.end();return false;}
  int announced=http.getSize();if(announced>0&&(size_t)announced!=m.bytes){why="Firmware Content-Length mismatch";http.end();return false;}
  if(!Update.begin(m.bytes,U_FLASH)){why=String("Update.begin failed: ")+Update.getError();http.end();return false;}
  mbedtls_sha256_context sha;mbedtls_sha256_init(&sha);if(mbedtls_sha256_starts(&sha,0)!=0){Update.abort();mbedtls_sha256_free(&sha);http.end();why="SHA init failed";return false;}
  WiFiClient*stream=http.getStreamPtr();uint8_t buf[4096];size_t total=0;uint32_t last=millis();bool failed=false;
  while(total<m.bytes){int a=stream->available();if(a>0){size_t want=min((size_t)a,sizeof(buf));want=min(want,m.bytes-total);int got=stream->readBytes(buf,want);if(got>0){if(mbedtls_sha256_update(&sha,buf,(size_t)got)!=0||Update.write(buf,(size_t)got)!=(size_t)got){failed=true;break;}total+=(size_t)got;last=millis();continue;}}if(!stream->connected()&&!stream->available()){failed=true;break;}if(millis()-last>20000UL){failed=true;break;}delay(2);}
  uint8_t digest[32];bool hashOk=!failed&&total==m.bytes&&mbedtls_sha256_finish(&sha,digest)==0;mbedtls_sha256_free(&sha);http.end();
  if(!hashOk){Update.abort();why=String("Firmware download incomplete at ")+total+"/"+m.bytes;return false;}
  String actual=hexBytes(digest,32);if(actual!=m.sha){Update.abort();why="Firmware SHA-256 mismatch";return false;}
  savePending(m);
  if(!Update.end(true)){why=String("Firmware image validation failed: ")+Update.getError();return false;}
  why=String("Signed firmware ")+m.version+" staged; rebooting";rebootPending=true;rebootAt=millis()+1500;return true;
}

static String statusJson(){
  JsonDocument d;d["version"]=VERSION;d["mode"]="Recovery Hub";d["wifiConnected"]=WiFi.status()==WL_CONNECTED;d["ip"]=WiFi.localIP().toString();d["rssi"]=WiFi.status()==WL_CONNECTED?WiFi.RSSI():0;d["otaPendingVerify"]=otaPendingVerify;d["otaValidated"]=otaValidated;d["manualUploadBytes"]=(uint32_t)manualUploadBytes;d["status"]=lastStatus;if(latestVersion.length()){d["latestVersion"]=latestVersion;d["latestBytes"]=(uint32_t)latestBytes;d["latestSha256"]=latestSha;}String out;serializeJson(d,out);return out;
}

static void startServer(){
  server.on("/",HTTP_GET,[](){
    String page="<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'><title>Anderson Recovery Hub</title><style>body{font-family:system-ui;background:#07111f;color:#eaf4ff;max-width:720px;margin:32px auto;padding:20px}section{background:#0d1b2e;border:1px solid #27486f;border-radius:14px;padding:18px;margin:14px 0}button,input{font:inherit;padding:10px;margin:6px 0}button{background:#1877f2;color:white;border:0;border-radius:9px}code{word-break:break-all}</style></head><body><h1>Anderson Recovery Hub 4.0.5</h1><p>This is the remotely recoverable safety firmware.</p><section><b>Status:</b> "+htmlEscape(lastStatus)+"<br><b>IP:</b> "+WiFi.localIP().toString()+"</section><section><h3>Manual firmware flash</h3><form method='POST' action='/api/update' enctype='multipart/form-data'><input type='file' name='firmware' accept='.bin' required><br><button type='submit'>Flash firmware</button></form></section><section><h3>Signed OTA</h3><form method='POST' action='/api/ota/install'><button type='submit'>Install latest signed OTA</button></form><p><a style='color:#6db7ff' href='/api/ota/check'>Check signed OTA</a></p></section><section><a style='color:#6db7ff' href='/api/status'>JSON status</a></section></body></html>";
    server.send(200,"text/html",page);
  });
  server.on("/api/status",HTTP_GET,[](){server.send(200,"application/json",statusJson());});
  server.on("/api/firmware",HTTP_GET,[](){server.send(200,"application/json",String("{\"version\":\"")+VERSION+"\",\"mode\":\"recovery-hub\"}");});
  server.on("/api/ota/check",HTTP_GET,[](){Manifest m;String why;if(fetchManifest(m,why)){latestVersion=m.version;latestBytes=m.bytes;latestSha=m.sha;latestCommit=m.commit;latestUrl=m.url;JsonDocument d;d["ok"]=true;d["currentVersion"]=VERSION;d["availableVersion"]=m.version;d["newer"]=cmpV(m.version,VERSION)>0;d["bytes"]=(uint32_t)m.bytes;d["sha256"]=m.sha;d["commit"]=m.commit;String out;serializeJson(d,out);server.send(200,"application/json",out);}else server.send(502,"application/json",String("{\"ok\":false,\"message\":\"")+htmlEscape(why)+"\"}");});
  server.on("/api/ota/install",HTTP_POST,[](){signedInstallRequested=true;server.send(202,"application/json","{\"ok\":true,\"message\":\"Signed OTA install queued\"}");});
  server.on("/api/update",HTTP_POST,[](){
    if(manualUploadOk){lastStatus=String("Manual firmware staged: ")+manualUploadBytes+" bytes; rebooting";server.send(200,"text/plain","Firmware accepted. Rebooting.");rebootPending=true;rebootAt=millis()+1500;}
    else server.send(500,"text/plain","Firmware upload failed or image validation failed.");
  },[](){
    HTTPUpload&u=server.upload();
    if(u.status==UPLOAD_FILE_START){manualUploadStarted=true;manualUploadOk=false;manualUploadBytes=0;lastStatus="Manual firmware upload started";if(!Update.begin(UPDATE_SIZE_UNKNOWN,U_FLASH)){lastStatus=String("Update.begin failed: ")+Update.getError();}}
    else if(u.status==UPLOAD_FILE_WRITE){if(manualUploadStarted&&u.currentSize){if(Update.write(u.buf,u.currentSize)==u.currentSize)manualUploadBytes+=u.currentSize;else{manualUploadStarted=false;Update.abort();lastStatus=String("Firmware write failed: ")+Update.getError();}}}
    else if(u.status==UPLOAD_FILE_END){if(manualUploadStarted&&Update.end(true)){manualUploadOk=true;lastStatus="Manual firmware image validated";}else{manualUploadOk=false;lastStatus=String("Firmware validation failed: ")+Update.getError();}manualUploadStarted=false;}
    else if(u.status==UPLOAD_FILE_ABORTED){Update.abort();manualUploadStarted=false;manualUploadOk=false;lastStatus="Manual firmware upload aborted";}
  });
  server.onNotFound([](){server.send(404,"text/plain","Anderson Recovery Hub 4.0.5");});
  server.begin();serverStarted=true;
}

static void inspectBootState(){const esp_partition_t*run=esp_ota_get_running_partition();esp_ota_img_states_t st=ESP_OTA_IMG_UNDEFINED;if(run&&esp_ota_get_state_partition(run,&st)==ESP_OK&&st==ESP_OTA_IMG_PENDING_VERIFY)otaPendingVerify=true;}
static void validateWhenSafe(){
  if(!otaPendingVerify||otaValidated)return;
  if(millis()-bootStarted>BOOT_VERIFY_DEADLINE_MS){lastStatus="Recovery Hub could not prove remote health; rebooting without validation for rollback";delay(200);ESP.restart();}
  if(!serverStarted||WiFi.status()!=WL_CONNECTED)return;
  Manifest m;String why;if(!fetchManifest(m,why)){lastStatus=String("Waiting for signed-manifest reachability before validation: ")+why;return;}
  const esp_partition_t*run=esp_ota_get_running_partition();if(run&&esp_ota_mark_app_valid_cancel_rollback()==ESP_OK){otaValidated=true;clearRecoveryPending();lastStatus="Recovery Hub healthy: Wi-Fi, HTTP server, and signed OTA channel verified";}
}

void setup(){
  pinMode(LED_PIN,OUTPUT);digitalWrite(LED_PIN,LOW);Serial.begin(115200);delay(250);bootStarted=millis();inspectBootState();
  if(!connectWiFi()){WiFi.mode(WIFI_AP_STA);WiFi.softAP("Anderson-Recovery-Hub");}
  startServer();
  if(!otaPendingVerify){otaValidated=true;clearRecoveryPending();}
}

void loop(){
  server.handleClient();
  validateWhenSafe();
  if(signedInstallRequested&&!rebootPending){signedInstallRequested=false;Manifest m;String why;lastStatus="Checking signed OTA manifest";if(fetchManifest(m,why)){latestVersion=m.version;latestBytes=m.bytes;latestSha=m.sha;latestCommit=m.commit;latestUrl=m.url;if(cmpV(m.version,VERSION)>0){lastStatus=String("Installing signed ")+m.version;if(!installManifest(m,why))lastStatus=why;}else lastStatus=String("Signed OTA is not newer: ")+m.version;}else lastStatus=why;}
  if(rebootPending&&(int32_t)(millis()-rebootAt)>=0){delay(50);ESP.restart();}
  delay(2);
}
