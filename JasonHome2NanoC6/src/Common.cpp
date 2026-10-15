#include "Common.h"
#include "Build.h"
#include "Roots.h"
#include "BoundedHttpBody.h"
#include <ESPmDNS.h>
#include <mbedtls/base64.h>

WebServer web(80);
JsonDocument state,secrets;
String apiToken,lastError;
bool activationEnabled=false;
const char* VERSION=JH2_VERSION;
const char* BUILD_SHA=JH2_BUILD_SHA;
static uint32_t retryAt=0,offlineSince=0;
static bool wasOnline=false;
String randomHex(size_t n){Bytes v(n);esp_fill_random(v.data(),n);return hexBytes(v.data(),n);}
String hexBytes(const uint8_t*p,size_t n){String s;s.reserve(n*2);const char*h="0123456789abcdef";for(size_t i=0;i<n;i++){s+=h[p[i]>>4];s+=h[p[i]&15];}return s;}
Bytes fromHex(const String&s){Bytes b;if(s.length()%2)return b;for(size_t i=0;i<s.length();i+=2){char*e;String c=s.substring(i,i+2);auto v=strtoul(c.c_str(),&e,16);if(*e)return {};b.push_back(v);}return b;}
String to64(const uint8_t*p,size_t n){size_t len=0;Bytes out(4*((n+2)/3)+1);if(mbedtls_base64_encode(out.data(),out.size(),&len,p,n))return "";return String((char*)out.data(),len);}
Bytes from64(const String&s){size_t n=0;Bytes out(s.length()*3/4+4);if(mbedtls_base64_decode(out.data(),out.size(),&n,(const uint8_t*)s.c_str(),s.length()))return {};out.resize(n);return out;}
bool saveJson(const char*path,JsonVariantConst v){String tmp=String(path)+".tmp";File f=LittleFS.open(tmp,"w");if(!f)return false;size_t expected=measureJson(v),written=serializeJson(v,f);f.flush();f.close();if(written!=expected){LittleFS.remove(tmp);return false;}return LittleFS.rename(tmp,path);}
bool loadJson(const char*path,JsonDocument&d){File f=LittleFS.open(path,"r");if(!f)return false;bool ok=!deserializeJson(d,f);f.close();return ok;}
void reply(int c,JsonVariantConst v){String s;serializeJson(v,s);web.sendHeader("Cache-Control","no-store");web.send(c,"application/json",s);}
void replyError(int c,const String&s){JsonDocument d;d["ok"]=false;d["error"]=s;reply(c,d.as<JsonVariantConst>());}
bool authorized(){if(web.header("Authorization")=="Bearer "+apiToken||web.header("X-JH2-Token")==apiToken)return true;String cookie=web.header("Cookie");return cookie.indexOf("jh2_session="+apiToken)>=0;}
void trust(WiFiClientSecure&c){c.setCACert(JH2_ROOTS);c.setHandshakeTimeout(10);c.setTimeout(12);}
bool readHttpText(HTTPClient&h,String&data,size_t limit){
  String te=h.header("Transfer-Encoding");bool chunked=te.equalsIgnoreCase("chunked");const char*error=nullptr;data="";
  bool ok=(!te.length()||chunked)&&readBoundedHttpBody(*h.getStreamPtr(),h.getSize(),chunked,limit,[&](const uint8_t*b,size_t n){return data.concat((const char*)b,n);},[](){return millis();},[](){delay(1);},8000,30000,error);
  if(!ok)lastError=error?error:"Unsupported HTTP encoding";return ok;
}
bool httpsJson(const String&url,const String*body,JsonDocument&out,const std::vector<std::pair<String,String>>&headers){
  WiFiClientSecure c;trust(c);HTTPClient h;h.setConnectTimeout(7000);h.setTimeout(url.startsWith("https://api.cloudflare.com/")?60000:12000);h.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  const char*hs[]={"Transfer-Encoding"};h.collectHeaders(hs,1);if(!h.begin(c,url)){lastError="HTTPS open failed";return false;}
  h.addHeader("User-Agent","JasonHome2-NanoC6");for(auto&p:headers)h.addHeader(p.first,p.second);
  if(body)h.addHeader("Content-Type","application/json");int rc=body?h.POST(*body):h.GET();
  if(rc!=200){lastError="HTTPS "+String(rc);h.end();return false;}
  // HTTPClient::writeToStream decodes HTTP chunk framing before JSON parsing.
  String data;bool readOk=readHttpText(h,data);h.end();if(!readOk)return false;
  if(deserializeJson(out,data)){lastError="Malformed cloud response";return false;}return true;
}
bool timeValid(){return time(nullptr)>1735689600;}
void startNetwork(){
  Serial.begin(115200);delay(100);
  // Do not erase a filesystem merely because mounting failed.
  if(!LittleFS.begin(false)){lastError="Storage not initialized; flash the supplied filesystem image";}
  loadJson("/state.json",state);loadJson("/secrets.json",secrets);
  apiToken=secrets["adminToken"]|String("");if(apiToken.length()<32){apiToken=randomHex(24);secrets["adminToken"]=apiToken;saveJson("/secrets.json",secrets.as<JsonVariantConst>());}
  activationEnabled=state["activated"]|false;
  WiFi.persistent(false);WiFi.setSleep(false);WiFi.setHostname("jason-home-2");
  String ssid=secrets["ssid"]|String("");String pw=secrets["wifiPassword"]|String("");
  Preferences net;net.begin("jh2-network",false);net.putString("ssid",ssid);net.putString("password",pw);net.end();
  if(ssid.length()){WiFi.mode(WIFI_STA);WiFi.begin(ssid.c_str(),pw.c_str());}
  else{WiFi.mode(WIFI_AP);String ap="Jason-Home-2-Setup-"+String((uint32_t)ESP.getEfuseMac(),HEX);WiFi.softAP(ap.c_str(),"JasonHome2");}
  setenv("TZ","EST5EDT,M3.2.0/2,M11.1.0/2",1);tzset();
  const char* hdr[]={"Cookie","Authorization","X-JH2-Token","Origin"};web.collectHeaders(hdr,4);
}
void networkLoop(){
  bool online=WiFi.status()==WL_CONNECTED;uint32_t now=millis();
  if(online&&!wasOnline){WiFi.softAPdisconnect(true);WiFi.mode(WIFI_STA);configTzTime("EST5EDT,M3.2.0/2,M11.1.0/2","time.cloudflare.com","pool.ntp.org");MDNS.end();MDNS.begin("jason-home-2");MDNS.addService("http","tcp",80);offlineSince=0;Serial.println("Jason Home 2: http://"+WiFi.localIP().toString()+"/");}
  if(!online&&String(secrets["ssid"]|"").length()&&(int32_t)(now-retryAt)>=0){retryAt=now+30000;WiFi.reconnect();if(!offlineSince)offlineSince=now;}
  if(!online&&offlineSince&&now-offlineSince>60000&&!(WiFi.getMode()&WIFI_AP)){WiFi.mode(WIFI_AP_STA);String name="Jason-Home-2-Setup-"+String((uint32_t)ESP.getEfuseMac(),HEX);WiFi.softAP(name.c_str(),"JasonHome2");}
  wasOnline=online;
}
static const char SETUP[]=R"HTML(<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jason Home 2 setup</title><style>body{font:16px system-ui;background:#081321;color:#eef5ff;margin:24px auto;max-width:560px;padding:15px}label,input,button{display:block;box-sizing:border-box;width:100%;margin:10px 0;padding:12px;border-radius:10px}button{background:#70e0c4;color:#061321;border:0;font-weight:bold}.sub{color:#b0c8dc}a{color:#7ce5cd}</style><h1>Jason Home 2</h1><p>Connect your NanoC6 to 2.4 GHz Wi-Fi.</p><form method="post" action="/setup"><input name="ssid" placeholder="Wi-Fi name" required maxlength="32"><input name="password" type="password" placeholder="Wi-Fi password" maxlength="63"><input name="pin" type="password" pattern="[0-9]{4,12}" placeholder="Choose an admin PIN (4–12 digits)" required><button>Save and restart</button></form><p class="sub">Connect to your normal Wi-Fi after saving, then open <b>http://jason-home-2.local/</b>.</p>)HTML";
void registerSetup(){
  web.on("/setup",HTTP_GET,[]{if(String(secrets["ssid"]|"").length()&&!authorized())return replyError(401,"Sign in first");web.send(200,"text/html",SETUP);});
  web.on("/setup",HTTP_POST,[]{
    if(String(secrets["ssid"]|"").length()&&!authorized())return replyError(401,"Sign in first");
    String pin=web.arg("pin"),ssid=web.arg("ssid");bool valid=pin.length()>=4&&pin.length()<=12;
    for(char c:pin)if(c<'0'||c>'9')valid=false;
    if(!valid||ssid.length()<1||ssid.length()>32)return replyError(400,"Check Wi-Fi and PIN");
    secrets["ssid"]=ssid;secrets["wifiPassword"]=web.arg("password");secrets["pin"]=pin;
    if(!saveJson("/secrets.json",secrets.as<JsonVariantConst>()))return replyError(500,"Settings could not be saved");
    web.send(200,"text/html","<h2>Saved. Rejoin your Wi-Fi and open http://jason-home-2.local/</h2>");delay(500);ESP.restart();
  });
  web.on("/login",HTTP_GET,[]{web.send(200,"text/html","<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><h1>Jason Home 2</h1><form method=post action=/login><input name=pin type=password placeholder='Admin PIN' required><button>Sign in</button></form>");});
  web.on("/login",HTTP_POST,[]{
    static uint32_t next=0;if((int32_t)(millis()-next)<0)return replyError(429,"Wait before trying again");
    if(!String(secrets["pin"]|"").length()||web.arg("pin")!=String(secrets["pin"]|"")){next=millis()+3000;return replyError(401,"Incorrect PIN");}
    web.sendHeader("Set-Cookie","jh2_session="+apiToken+"; HttpOnly; SameSite=Strict; Path=/");web.sendHeader("Location","/");web.send(303);
  });
}
