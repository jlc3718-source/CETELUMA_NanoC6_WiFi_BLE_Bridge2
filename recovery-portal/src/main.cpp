#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <Update.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <esp_ota_ops.h>
#include <mbedtls/base64.h>
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>

static constexpr char VERSION[]="4.0.5";
static constexpr char MANIFEST_URL[]="https://raw.githubusercontent.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/ota/latest.json";
static constexpr char RELEASE_PREFIX[]="https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/releases/download/anderson-v";
static constexpr char RECOVERY_KEY[]="R5-7429-AX";
static constexpr size_t OTA_SLOT_BYTES=0x1E0000;
static constexpr uint32_t AUTO_FIRST_MS=90000UL;
static constexpr uint32_t AUTO_INTERVAL_MS=300000UL;
static constexpr char OTA_PUBLIC_KEY[]=R"KEY(-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE3Dw/xqxEPbvkJQAcMeZxBAxwujxN
kuGHPepzClPYMrJ4h5r8iNlyUFpJZcPI/FXe8+atedYKpIZZB5XlOj964Q==
-----END PUBLIC KEY-----
)KEY";

WebServer server(80);
volatile bool selfTestPassed=false;
bool slotValidated=false;
bool uploadOk=false;
bool uploadStarted=false;
uint32_t nextAutoCheck=0;
String lastMessage="Recovery portal starting";
String heldVersion="";

struct Manifest {String version,sha,commit,url;size_t bytes=0;};

static int cmpVersion(const String&a,const String&b){int av[3]={0},bv[3]={0};if(sscanf(a.c_str(),"%d.%d.%d",&av[0],&av[1],&av[2])!=3)return 0;if(sscanf(b.c_str(),"%d.%d.%d",&bv[0],&bv[1],&bv[2])!=3)return 0;for(int i=0;i<3;i++){if(av[i]!=bv[i])return av[i]>bv[i]?1:-1;}return 0;}
static bool allHex(const String&s,size_t n){if(s.length()!=n)return false;for(char c:s)if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')||(c>='A'&&c<='F')))return false;return true;}
static String hexDigest(const uint8_t*d,size_t n){static const char h[]="0123456789abcdef";String out;out.reserve(n*2);for(size_t i=0;i<n;i++){out+=h[d[i]>>4];out+=h[d[i]&15];}return out;}
static bool keyOk(){return server.arg("key")==RECOVERY_KEY;}

static bool loadWiFi(String&ssid,String&pass){Preferences p;if(!p.begin("anderson",true))return false;ssid=p.getString("ssid","");pass=p.getString("pass","");p.end();ssid.trim();return ssid.length()>0;}
static void connectWiFi(){String ssid,pass;if(!loadWiFi(ssid,pass)){WiFi.mode(WIFI_AP);WiFi.softAP("Anderson-Recovery-405");lastMessage="No saved Wi-Fi; recovery AP active";return;}WiFi.mode(WIFI_STA);WiFi.setAutoReconnect(true);WiFi.begin(ssid.c_str(),pass.c_str());uint32_t s=millis();while(WiFi.status()!=WL_CONNECTED&&millis()-s<30000UL){delay(250);}if(WiFi.status()==WL_CONNECTED)lastMessage="Recovery portal online";else{WiFi.mode(WIFI_AP_STA);WiFi.softAP("Anderson-Recovery-405");lastMessage="Saved Wi-Fi failed; recovery AP active";}}

static void detectRollback(){Preferences p;if(!p.begin("recovery405",false))return;String pending=p.getString("pending","");if(pending.length()&&pending!=VERSION){heldVersion=pending;p.putString("held",pending);p.remove("pending");lastMessage="Previous update rolled back; held "+pending;}else heldVersion=p.getString("held","");p.end();}
static void setPending(const String&v){Preferences p;if(p.begin("recovery405",false)){p.putString("pending",v);p.end();}}
static void clearPending(){Preferences p;if(p.begin("recovery405",false)){p.remove("pending");p.end();}}

static bool verifySignature(const String&payload,const String&sig64){uint8_t sig[96];size_t sigLen=0;if(mbedtls_base64_decode(sig,sizeof(sig),&sigLen,(const unsigned char*)sig64.c_str(),sig64.length())!=0||!sigLen)return false;uint8_t digest[32];if(mbedtls_sha256((const unsigned char*)payload.c_str(),payload.length(),digest,0)!=0)return false;mbedtls_pk_context pk;mbedtls_pk_init(&pk);int rc=mbedtls_pk_parse_public_key(&pk,(const unsigned char*)OTA_PUBLIC_KEY,sizeof(OTA_PUBLIC_KEY));if(rc==0)rc=mbedtls_pk_verify(&pk,MBEDTLS_MD_SHA256,digest,sizeof(digest),sig,sigLen);mbedtls_pk_free(&pk);return rc==0;}
static bool parsePayload(const String&p,Manifest&m){int start=0;bool gv=false,gb=false,gs=false,gc=false,gu=false;while(start<(int)p.length()){int nl=p.indexOf('\n',start);if(nl<0)nl=p.length();String line=p.substring(start,nl);start=nl+1;if(!line.length())continue;int eq=line.indexOf('=');if(eq<=0)return false;String k=line.substring(0,eq),v=line.substring(eq+1);if(k=="version"&&!gv){m.version=v;gv=true;}else if(k=="bytes"&&!gb){m.bytes=(size_t)v.toInt();gb=true;}else if(k=="sha256"&&!gs){m.sha=v;m.sha.toLowerCase();gs=true;}else if(k=="commit"&&!gc){m.commit=v;m.commit.toLowerCase();gc=true;}else if(k=="url"&&!gu){m.url=v;gu=true;}else return false;}if(!gv||!gb||!gs||!gc||!gu||m.bytes==0||m.bytes>=OTA_SLOT_BYTES||!allHex(m.sha,64)||!allHex(m.commit,40))return false;String expected=String(RELEASE_PREFIX)+m.version+"/and_"+m.version+".bin";return m.url==expected;}
static bool fetchManifest(Manifest&m){if(WiFi.status()!=WL_CONNECTED){lastMessage="Wi-Fi unavailable for OTA check";return false;}WiFiClientSecure c;c.setInsecure();HTTPClient h;String u=String(MANIFEST_URL)+"?cb="+String((uint32_t)esp_random(),HEX);if(!h.begin(c,u)){lastMessage="Could not open signed manifest";return false;}h.addHeader("Cache-Control","no-cache");int code=h.GET();if(code!=200){lastMessage="Manifest HTTP "+String(code);h.end();return false;}String body=h.getString();h.end();JsonDocument d;if(deserializeJson(d,body)||(d["schema"]|0)!=1){lastMessage="Manifest format invalid";return false;}String payload=d["payload"]|String("");String sig=d["signature"]|String("");if(!verifySignature(payload,sig)){lastMessage="Manifest signature invalid";return false;}if(!parsePayload(payload,m)){lastMessage="Signed payload invalid";return false;}return true;}

static bool installManifest(const Manifest&m){if(heldVersion.length()&&cmpVersion(m.version,heldVersion)<=0){lastMessage="Held rejected version "+heldVersion;return false;}if(cmpVersion(m.version,VERSION)<=0){lastMessage="Recovery portal is current";return true;}lastMessage="Downloading signed "+m.version;WiFiClientSecure c;c.setInsecure();HTTPClient h;h.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);h.setTimeout(20000);if(!h.begin(c,m.url)){lastMessage="Could not open firmware URL";return false;}int code=h.GET();if(code!=200){lastMessage="Firmware HTTP "+String(code);h.end();return false;}int announced=h.getSize();if(announced>0&&(size_t)announced!=m.bytes){lastMessage="Signed size mismatch";h.end();return false;}if(!Update.begin(m.bytes,U_FLASH)){lastMessage="Could not open inactive OTA slot";h.end();return false;}mbedtls_sha256_context sha;mbedtls_sha256_init(&sha);mbedtls_sha256_starts(&sha,0);WiFiClient* s=h.getStreamPtr();uint8_t buf[4096];size_t total=0;uint32_t last=millis();bool fail=false;while(total<m.bytes){int a=s->available();if(a>0){size_t want=min((size_t)a,sizeof(buf));want=min(want,m.bytes-total);int got=s->readBytes(buf,want);if(got>0){mbedtls_sha256_update(&sha,buf,got);if(Update.write(buf,got)!=(size_t)got){fail=true;break;}total+=got;last=millis();delay(1);continue;}}if(!s->connected()&&!s->available()){fail=true;break;}if(millis()-last>25000UL){fail=true;break;}delay(2);}uint8_t digest[32];bool hashOk=!fail&&total==m.bytes&&mbedtls_sha256_finish(&sha,digest)==0;mbedtls_sha256_free(&sha);h.end();if(!hashOk){Update.abort();lastMessage="Firmware download incomplete";return false;}String actual=hexDigest(digest,32);if(actual!=m.sha){Update.abort();lastMessage="Firmware SHA-256 mismatch";return false;}setPending(m.version);if(!Update.end(true)){clearPending();lastMessage="Firmware validation failed";return false;}lastMessage="Verified "+m.version+"; rebooting";delay(700);ESP.restart();return true;}
static void checkAndInstall(){Manifest m;if(fetchManifest(m))installManifest(m);}

static String page(){String s=F"<!doctype html><html><meta name=viewport content='width=device-width,initial-scale=1'><style>body{font-family:system-ui;background:#08111f;color:#eef6ff;max-width:700px;margin:40px auto;padding:20px}section{background:#111f33;padding:22px;border-radius:18px;margin:16px 0}button,input{font-size:16px;padding:12px;margin:6px 0;width:100%;box-sizing:border-box}button{background:#2678ff;color:white;border:0;border-radius:10px}code{word-break:break-all}</style><h1>Anderson Recovery 4.0.5</h1><section><b>Status</b><p>"+lastMessage+F"</p><p>IP: "+WiFi.localIP().toString()+F"</p><p>This recovery firmware keeps a signed-manifest escape path and manual firmware upload.</p></section><section><h2>Signed OTA</h2><form action='/check' method='post'><input name='key' placeholder='Recovery key'><button>Check signed OTA now</button></form></section><section><h2>Manual firmware flash</h2><form method='POST' action='/flash' enctype='multipart/form-data'><input name='key' placeholder='Recovery key'><input type='file' name='firmware' accept='.bin' required><button>Upload firmware</button></form></section></html>";return s;}

static void selfTestTask(void*){delay(1500);for(int i=0;i<10&&!selfTestPassed;i++){if(WiFi.status()==WL_CONNECTED){WiFiClient c;if(c.connect(WiFi.localIP(),80)){c.print("GET /api/health HTTP/1.1\r\nHost: local\r\nConnection: close\r\n\r\n");uint32_t t=millis();String r;while(millis()-t<1500){while(c.available())r+=(char)c.read();if(r.indexOf("R5OK")>=0){selfTestPassed=true;break;}delay(10);}c.stop();}}delay(500);}vTaskDelete(nullptr);}

void setup(){Serial.begin(115200);delay(200);detectRollback();connectWiFi();server.on("/",HTTP_GET,[]{selfTestPassed=true;server.send(200,"text/html",page());});server.on("/api/health",HTTP_GET,[]{server.send(200,"text/plain","R5OK");});server.on("/api/firmware",HTTP_GET,[]{server.send(200,"application/json",String("{\"version\":\"")+VERSION+"\",\"recovery\":true}");});server.on("/check",HTTP_POST,[]{if(!keyOk()){server.send(403,"text/plain","Bad recovery key");return;}server.send(202,"text/plain","Signed OTA check started");xTaskCreate([](void*){delay(200);checkAndInstall();vTaskDelete(nullptr);},"ota-check",8192,nullptr,1,nullptr);});server.on("/flash",HTTP_POST,[]{if(!keyOk()){server.send(403,"text/plain","Bad recovery key");return;}server.send(uploadOk?200:500,"text/plain",uploadOk?"Firmware accepted; rebooting":"Firmware upload failed");if(uploadOk){delay(700);ESP.restart();}},[]{if(!keyOk())return;HTTPUpload&u=server.upload();if(u.status==UPLOAD_FILE_START){uploadStarted=true;uploadOk=Update.begin(UPDATE_SIZE_UNKNOWN,U_FLASH);}else if(u.status==UPLOAD_FILE_WRITE&&uploadOk){uploadOk=Update.write(u.buf,u.currentSize)==u.currentSize;}else if(u.status==UPLOAD_FILE_END&&uploadOk){uploadOk=Update.end(true);}else if(u.status==UPLOAD_FILE_ABORTED){Update.abort();uploadOk=false;}});server.begin();xTaskCreate(selfTestTask,"selftest",4096,nullptr,1,nullptr);nextAutoCheck=millis()+AUTO_FIRST_MS;}

void loop(){server.handleClient();if(!slotValidated&&selfTestPassed){const esp_partition_t*r=esp_ota_get_running_partition();esp_ota_img_states_t st=ESP_OTA_IMG_UNDEFINED;if(r&&esp_ota_get_state_partition(r,&st)==ESP_OK&&st==ESP_OTA_IMG_PENDING_VERIFY)esp_ota_mark_app_valid_cancel_rollback();slotValidated=true;lastMessage="Recovery portal healthy and rollback-safe";}if(WiFi.getMode()!=WIFI_AP&&WiFi.status()!=WL_CONNECTED){static uint32_t last=0;if(millis()-last>15000){last=millis();String s,p;if(loadWiFi(s,p))WiFi.begin(s.c_str(),p.c_str());}}if((int32_t)(millis()-nextAutoCheck)>=0&&WiFi.status()==WL_CONNECTED&&!Update.isRunning()){nextAutoCheck=millis()+AUTO_INTERVAL_MS;checkAndInstall();}delay(2);}
