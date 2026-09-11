#include "RemoteUpdate.h"
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <Update.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <mbedtls/base64.h>
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>

static constexpr const char* OTA_MANIFEST_URL="https://raw.githubusercontent.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/ota/latest.json";
static constexpr const char* OTA_RELEASE_PREFIX="https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/releases/download/anderson-v";
static constexpr size_t OTA_SLOT_BYTES=0x1E0000;
static constexpr const char* OTA_NVS="anderson-ota";
static constexpr uint32_t OTA_AUTO_FIRST_CHECK_MS=60UL*1000UL;
static constexpr uint32_t OTA_AUTO_INTERVAL_MS=60UL*60UL*1000UL;
static constexpr const char OTA_PUBLIC_KEY[]=R"KEY(-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE3Dw/xqxEPbvkJQAcMeZxBAxwujxN
kuGHPepzClPYMrJ4h5r8iNlyUFpJZcPI/FXe8+atedYKpIZZB5XlOj964Q==
-----END PUBLIC KEY-----
)KEY";

struct RemoteStatus {
  bool checked=false,ok=false,signatureValid=false,updateAvailable=false;
  bool installing=false,installReady=false;
  int httpStatus=0;
  size_t bytes=0,downloadedBytes=0;
  String availableVersion,sha256,commit,url,message="Not checked yet";
};
static RemoteStatus last;
static bool rebootRequested=false;
static String lastInstallMessage;
static bool autoTimerStarted=false;
static uint32_t autoNextCheckAt=0;

static uint32_t autoCheckSecondsRemaining(){
  if(!autoTimerStarted)return (OTA_AUTO_FIRST_CHECK_MS+999UL)/1000UL;
  int32_t remaining=(int32_t)(autoNextCheckAt-millis());
  return remaining>0?(uint32_t)(remaining+999)/1000UL:0UL;
}

static bool allHex(const String&s,size_t n){if(s.length()!=n)return false;for(size_t i=0;i<s.length();i++){char c=s[i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')||(c>='A'&&c<='F')))return false;}return true;}
static String hexBytes(const uint8_t*data,size_t len){static const char h[]="0123456789abcdef";String out;out.reserve(len*2);for(size_t i=0;i<len;i++){out+=h[data[i]>>4];out+=h[data[i]&15];}return out;}

struct VersionParts{int major=0,minor=0,patch=0;char suffix=0;bool valid=false;};
static VersionParts parseVersion(const String&input){VersionParts v;String s=input;s.trim();int p1=s.indexOf('.'),p2=p1<0?-1:s.indexOf('.',p1+1);if(p1<=0||p2<=p1+1)return v;String a=s.substring(0,p1),b=s.substring(p1+1,p2),c=s.substring(p2+1);if(c.length()&&c[c.length()-1]>='a'&&c[c.length()-1]<='z'){v.suffix=c[c.length()-1];c.remove(c.length()-1);}auto digits=[](const String&x){if(!x.length())return false;for(size_t i=0;i<x.length();i++)if(x[i]<'0'||x[i]>'9')return false;return true;};if(!digits(a)||!digits(b)||!digits(c))return v;v.major=a.toInt();v.minor=b.toInt();v.patch=c.toInt();v.valid=true;return v;}
static int compareVersion(const String&a,const String&b){VersionParts x=parseVersion(a),y=parseVersion(b);if(!x.valid||!y.valid)return 0;if(x.major!=y.major)return x.major>y.major?1:-1;if(x.minor!=y.minor)return x.minor>y.minor?1:-1;if(x.patch!=y.patch)return x.patch>y.patch?1:-1;if(x.suffix==y.suffix)return 0;if(!x.suffix)return 1;if(!y.suffix)return -1;return x.suffix>y.suffix?1:-1;}

static bool verifySignature(const String&payload,const String&sig64){uint8_t sig[96];size_t sigLen=0;if(mbedtls_base64_decode(sig,sizeof(sig),&sigLen,(const unsigned char*)sig64.c_str(),sig64.length())!=0||!sigLen)return false;uint8_t digest[32];if(mbedtls_sha256((const unsigned char*)payload.c_str(),payload.length(),digest,0)!=0)return false;mbedtls_pk_context pk;mbedtls_pk_init(&pk);int rc=mbedtls_pk_parse_public_key(&pk,(const unsigned char*)OTA_PUBLIC_KEY,sizeof(OTA_PUBLIC_KEY));if(rc==0)rc=mbedtls_pk_verify(&pk,MBEDTLS_MD_SHA256,digest,sizeof(digest),sig,sigLen);mbedtls_pk_free(&pk);return rc==0;}

static bool parsePayload(const String&payload,RemoteStatus&out){bool gv=false,gb=false,gs=false,gc=false,gu=false;int start=0;while(start<(int)payload.length()){int nl=payload.indexOf('\n',start);if(nl<0)nl=payload.length();String line=payload.substring(start,nl);start=nl+1;if(!line.length())continue;int eq=line.indexOf('=');if(eq<=0)return false;String k=line.substring(0,eq),v=line.substring(eq+1);if(k=="version"&&!gv){out.availableVersion=v;gv=true;}else if(k=="bytes"&&!gb){if(!v.length())return false;for(size_t i=0;i<v.length();i++)if(v[i]<'0'||v[i]>'9')return false;out.bytes=(size_t)v.toInt();gb=true;}else if(k=="sha256"&&!gs){out.sha256=v;out.sha256.toLowerCase();gs=true;}else if(k=="commit"&&!gc){out.commit=v;out.commit.toLowerCase();gc=true;}else if(k=="url"&&!gu){out.url=v;gu=true;}else return false;}if(!gv||!gb||!gs||!gc||!gu)return false;if(!parseVersion(out.availableVersion).valid||out.bytes==0||out.bytes>=OTA_SLOT_BYTES||!allHex(out.sha256,64)||!allHex(out.commit,40))return false;String expected=String(OTA_RELEASE_PREFIX)+out.availableVersion+"/and_"+out.availableVersion+".bin";return out.url==expected;}

static bool setPending(const RemoteStatus&s){Preferences p;if(!p.begin(OTA_NVS,false))return false;bool ok=p.putString("pending",s.availableVersion)==s.availableVersion.length()&&p.putString("sha",s.sha256)==s.sha256.length()&&p.putString("commit",s.commit)==s.commit.length();if(ok)ok=p.getString("pending","")==s.availableVersion&&p.getString("sha","")==s.sha256&&p.getString("commit","")==s.commit;p.end();return ok;}
static void clearPending(){Preferences p;if(!p.begin(OTA_NVS,false))return;p.remove("pending");p.remove("sha");p.remove("commit");p.end();}
static void saveLastMessage(const String&version,const String&message){Preferences p;if(!p.begin(OTA_NVS,false))return;p.putString("lastver",version);p.putString("lastmsg",message);p.end();lastInstallMessage=message;}

void remoteUpdateNoteBoot(const char*currentVersion){Preferences p;if(!p.begin(OTA_NVS,false))return;String pending=p.getString("pending","");String prior=p.getString("lastmsg","");if(pending.length()){String msg;if(pending==currentVersion){msg=String("Remote update ")+pending+" booted successfully.";p.putString("lastver",pending);}else{msg=String("Remote update ")+pending+" was pending, but the controller is running "+currentVersion+".";}p.putString("lastmsg",msg);p.remove("pending");p.remove("sha");p.remove("commit");lastInstallMessage=msg;}else lastInstallMessage=prior;p.end();}

static String statusJson(const char*current){JsonDocument d;d["checked"]=last.checked;d["ok"]=last.ok;d["signatureValid"]=last.signatureValid;d["currentVersion"]=current;d["updateAvailable"]=last.updateAvailable;d["autoInstall"]=true;d["autoCheckMinutes"]=OTA_AUTO_INTERVAL_MS/60000UL;d["autoCheckSecondsRemaining"]=autoCheckSecondsRemaining();d["downloadEnabled"]=true;d["installEnabled"]=true;d["installing"]=last.installing;d["installReady"]=last.installReady;d["manifestUrl"]=OTA_MANIFEST_URL;d["otaSlotBytes"]=OTA_SLOT_BYTES;d["httpStatus"]=last.httpStatus;d["message"]=last.message;if(last.availableVersion.length())d["availableVersion"]=last.availableVersion;if(last.bytes)d["bytes"]=(uint32_t)last.bytes;if(last.downloadedBytes)d["downloadedBytes"]=(uint32_t)last.downloadedBytes;if(last.sha256.length())d["sha256"]=last.sha256;if(last.commit.length())d["commit"]=last.commit;if(last.url.length())d["url"]=last.url;if(lastInstallMessage.length())d["lastInstallMessage"]=lastInstallMessage;String j;serializeJson(d,j);return j;}

static bool fetchVerifiedManifest(const char*current){last=RemoteStatus();last.checked=true;if(WiFi.status()!=WL_CONNECTED){last.message="Wi-Fi is not connected";return false;}WiFiClientSecure client;client.setInsecure();HTTPClient http;http.setConnectTimeout(6000);http.setTimeout(8000);if(!http.begin(client,OTA_MANIFEST_URL)){last.message="Could not open the remote manifest URL";return false;}last.httpStatus=http.GET();if(last.httpStatus!=HTTP_CODE_OK){last.message=String("Manifest request failed (HTTP ")+String(last.httpStatus)+")";http.end();return false;}String body=http.getString();http.end();if(body.length()==0||body.length()>4096){last.message="Remote manifest size is invalid";return false;}JsonDocument d;if(deserializeJson(d,body)||!d.is<JsonObject>()||(d["schema"]|0)!=1){last.message="Remote manifest format is invalid";return false;}String payload=d["payload"]|String(""),sig=d["signature"]|String("");if(!payload.length()||!sig.length()){last.message="Remote manifest is missing its signed payload";return false;}last.signatureValid=verifySignature(payload,sig);if(!last.signatureValid){last.message="Remote manifest signature is invalid";return false;}if(!parsePayload(payload,last)){last.message="Signed manifest payload is invalid";return false;}int cmp=compareVersion(last.availableVersion,String(current));last.ok=true;last.updateAvailable=cmp>0;if(cmp>0)last.message=String("Verified update available: ")+last.availableVersion;else if(cmp==0)last.message=String("Signed manifest verified. Anderson Home ")+current+" is current.";else last.message=String("Signed manifest verified but advertises older firmware ")+last.availableVersion+"; downgrade is blocked.";return true;}

String remoteUpdateStatusJson(const char*current){return statusJson(current);}
String remoteUpdateCheckJson(const char*current){fetchVerifiedManifest(current);return statusJson(current);}

static bool downloadAndStage(){last.installing=true;last.installReady=false;last.downloadedBytes=0;WiFiClientSecure client;client.setInsecure();HTTPClient http;http.setConnectTimeout(6000);http.setTimeout(12000);http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);if(!http.begin(client,last.url)){last.ok=false;last.installing=false;last.message="Could not open the signed firmware URL";return false;}int code=http.GET();last.httpStatus=code;if(code!=HTTP_CODE_OK){last.ok=false;last.installing=false;last.message=String("Firmware download failed (HTTP ")+String(code)+")";http.end();return false;}int announced=http.getSize();if(announced>0&&(size_t)announced!=last.bytes){last.ok=false;last.installing=false;last.message="Firmware Content-Length does not match the signed manifest";http.end();return false;}if(!Update.begin(last.bytes,U_FLASH)){last.ok=false;last.installing=false;last.message=String("Could not open inactive OTA slot. Error ")+String(Update.getError());http.end();return false;}

mbedtls_sha256_context sha;mbedtls_sha256_init(&sha);if(mbedtls_sha256_starts(&sha,0)!=0){Update.abort();mbedtls_sha256_free(&sha);http.end();last.ok=false;last.installing=false;last.message="Could not start SHA-256 verification";return false;}NetworkClient*stream=http.getStreamPtr();uint8_t buffer[2048];size_t total=0;uint32_t lastData=millis();bool failed=false;String failure;
while(total<last.bytes){int available=stream->available();if(available>0){size_t want=(size_t)available;if(want>sizeof(buffer))want=sizeof(buffer);if(want>last.bytes-total)want=last.bytes-total;int got=stream->read(buffer,want);if(got>0){if(mbedtls_sha256_update(&sha,buffer,(size_t)got)!=0){failed=true;failure="SHA-256 update failed";break;}if(Update.write(buffer,(size_t)got)!=(size_t)got){failed=true;failure=String("Firmware write failed. Error ")+String(Update.getError());break;}total+=(size_t)got;last.downloadedBytes=total;lastData=millis();continue;}}if((uint32_t)(millis()-lastData)>12000UL){failed=true;failure="Firmware download stalled before the signed byte count was received";break;}delay(1);}
uint8_t digest[32];bool hashFinished=!failed&&mbedtls_sha256_finish(&sha,digest)==0;mbedtls_sha256_free(&sha);http.end();if(failed||!hashFinished||total!=last.bytes){Update.abort();last.ok=false;last.installing=false;if(failure.length())last.message=failure;else if(!hashFinished)last.message="Could not finish SHA-256 verification";else last.message="Firmware download ended before the signed byte count";return false;}String actual=hexBytes(digest,sizeof(digest));if(actual!=last.sha256){Update.abort();last.ok=false;last.installing=false;last.message="Downloaded firmware SHA-256 does not match the signed manifest";return false;}if(!setPending(last)){Update.abort();last.ok=false;last.installing=false;last.message="Could not save remote-update recovery status; current firmware was left active";return false;}if(!Update.end(true)){clearPending();last.ok=false;last.installing=false;last.message=String("Firmware validation failed. Error ")+String(Update.getError());return false;}
last.installing=false;last.installReady=true;last.updateAvailable=false;last.ok=true;last.message=String("Remote firmware ")+last.availableVersion+" downloaded, SHA-256 verified, and installed to the inactive OTA slot. Rebooting.";saveLastMessage(last.availableVersion,String("Remote firmware ")+last.availableVersion+" verified and selected for reboot.");rebootRequested=true;return true;}

String remoteUpdateInstallJson(const char*current){rebootRequested=false;if(!fetchVerifiedManifest(current))return statusJson(current);if(!last.updateAvailable){last.ok=false;last.message="No newer signed Anderson firmware is available to install";return statusJson(current);}downloadAndStage();return statusJson(current);}

void remoteUpdateAutoLoop(const char*current){
  if(rebootRequested||last.installing)return;
  uint32_t now=millis();
  if(!autoTimerStarted){autoTimerStarted=true;autoNextCheckAt=now+OTA_AUTO_FIRST_CHECK_MS;return;}
  if((int32_t)(now-autoNextCheckAt)<0)return;
  autoNextCheckAt=now+OTA_AUTO_INTERVAL_MS;
  if(WiFi.status()!=WL_CONNECTED){autoNextCheckAt=now+60000UL;return;}
  if(!fetchVerifiedManifest(current))return;
  if(last.updateAvailable)downloadAndStage();
}

bool remoteUpdateConsumeRebootRequest(){bool r=rebootRequested;rebootRequested=false;return r;}
