#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <ArduinoJson.h>
#include <time.h>
#include "WebUI.h"
#include "Types.h"
#include "EventCatalog.h"
#include "SettingsStore.h"
#include "BleController.h"
#include "Scheduler.h"

static constexpr int BLUE_LED=7;
static constexpr int USER_BUTTON=9;

WebServer server(80);
SettingsStore store;
BleController ble;
Scheduler* scheduler=nullptr;

bool manualOverride=false,power=true;
uint8_t brightness=75,speedLevel=3;
Theme runningTheme;
uint32_t buttonDown=0,lastScheduleCheck=0;
bool setupAP=false;

static String colorHex(uint32_t c){char b[8];snprintf(b,sizeof(b),"#%06lX",(unsigned long)c);return b;}
static uint16_t parseTime(const String& s,uint16_t def){if(s.length()<5)return def;int h=s.substring(0,2).toInt(),m=s.substring(3,5).toInt();if(h<0||h>23||m<0||m>59)return def;return h*60+m;}
static String fmtTime(uint16_t m){char b[6];snprintf(b,sizeof(b),"%02d:%02d",m/60,m%60);return b;}
static bool timeValid(){return time(nullptr)>1700000000;}

void addTheme(JsonObject o,const Theme&t){o["name"]=t.name;o["effect"]=effectName(t.effect);JsonArray a=o["colors"].to<JsonArray>();for(int i=0;i<t.colorCount;i++)a.add(colorHex(t.colors[i]));}
String stateJson(){
  JsonDocument d;d["power"]=power;d["brightness"]=brightness;d["speed"]=speedLevel;JsonObject r=d["running"].to<JsonObject>();addTheme(r,runningTheme);
  auto&s=store.get();d["scheduleWindow"]="Scheduled "+fmtTime(s.onMinutes)+" – "+fmtTime(s.offMinutes);
  tm l{};if(timeValid()){time_t n=time(nullptr);localtime_r(&n,&l);d["nextEvent"]=scheduler->nextEventLabel(l);}else d["nextEvent"]="Waiting for time sync";
  JsonObject w=d["wifi"].to<JsonObject>();w["ssid"]=WiFi.status()==WL_CONNECTED?WiFi.SSID():"";w["rssi"]=WiFi.status()==WL_CONNECTED?WiFi.RSSI():0;w["ip"]=WiFi.status()==WL_CONNECTED?WiFi.localIP().toString():WiFi.softAPIP().toString();
  JsonObject b=d["ble"].to<JsonObject>();b["connected"]=ble.connected();b["connectedCount"]=ble.connectedCount();b["name"]=ble.name();b["address"]=ble.address();b["protocol"]=ble.protocolName();b["target"]=ble.getTarget();JsonArray ca=b["controllers"].to<JsonArray>();for(uint8_t i=0;i<2;i++){auto si=ble.slotInfo(i);if(!si.address.length())continue;JsonObject c=ca.add<JsonObject>();c["slot"]=i;c["name"]=si.name;c["address"]=si.address;c["protocol"]=si.protocol;c["connected"]=si.connected;}
  d["manualOverride"]=manualOverride;String out;serializeJson(d,out);return out;
}
void sendJson(const String&s,int code=200){server.sendHeader("Cache-Control","no-store");server.send(code,"application/json",s);}
bool body(JsonDocument&d){DeserializationError e=deserializeJson(d,server.arg("plain"));if(e){server.send(400,"text/plain","Invalid JSON");return false;}return true;}

void applyRunning(bool force=false){
  if(!power){ble.setPower(false);return;}
  ble.applyTheme(runningTheme,brightness,speedLevel,millis(),force);
}
void evaluateSchedule(bool force=false){
  if(manualOverride||!timeValid())return;tm l{};time_t n=time(nullptr);localtime_r(&n,&l);
  ble.setTarget(0);bool should=scheduler->inRunWindow(l)&&store.get().schedulerEnabled;if(!should){if(power){power=false;ble.setPower(false);}return;}
  Theme t=scheduler->resolve(l);bool changed=!power||runningTheme.name!=t.name||runningTheme.effect!=t.effect;power=true;runningTheme=t;if(changed||force)applyRunning(true);
}
void startAP(){
  WiFi.mode(WIFI_AP_STA);WiFi.softAP("AndersonHome-Setup","andersonhome");setupAP=true;Serial.printf("Setup AP: http://%s\n",WiFi.softAPIP().toString().c_str());
}
void connectWiFi(){
  auto&s=store.get();WiFi.mode(WIFI_STA);WiFi.setSleep(false);
  if(!s.ssid.length()){startAP();return;}WiFi.begin(s.ssid.c_str(),s.password.c_str());Serial.printf("Connecting to %s",s.ssid.c_str());
  uint32_t start=millis();while(WiFi.status()!=WL_CONNECTED && millis()-start<18000){delay(250);Serial.print(".");}
  if(WiFi.status()==WL_CONNECTED){Serial.printf("\nWi-Fi: %s\n",WiFi.localIP().toString().c_str());setupAP=false;configTzTime(s.tz.c_str(),"pool.ntp.org","time.nist.gov");}
  else{Serial.println("\nWi-Fi failed; starting recovery AP");startAP();}
}
void setupMdns(){
  if(MDNS.begin("anderson-home")){MDNS.setInstanceName("Anderson Home");MDNS.addService("http","tcp",80);}
}
void setupRoutes(){
  server.on("/",HTTP_GET,[]{server.send_P(200,"text/html",WEB_UI);});
  server.on("/api/state",HTTP_GET,[]{sendJson(stateJson());});
  server.on("/api/resume",HTTP_POST,[]{manualOverride=false;power=true;evaluateSchedule(true);sendJson(stateJson());});

  server.on("/api/control",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;manualOverride=true;
    if(!d["power"].isNull())power=d["power"].as<bool>();
    if(!d["brightness"].isNull())brightness=constrain(d["brightness"].as<int>(),1,100);
    if(!d["speed"].isNull())speedLevel=constrain(d["speed"].as<int>(),1,5);
    if(!d["name"].isNull())runningTheme.name=d["name"].as<String>();
    if(!d["effect"].isNull())runningTheme.effect=effectFromString(d["effect"].as<String>());
    if(d["colors"].is<JsonArray>()){JsonArray a=d["colors"].as<JsonArray>();runningTheme.colorCount=0;for(JsonVariant v:a){if(runningTheme.colorCount>=8)break;String s=v.as<String>();if(s.startsWith("#"))s.remove(0,1);runningTheme.colors[runningTheme.colorCount++]=strtoul(s.c_str(),nullptr,16);}if(runningTheme.colorCount==0){runningTheme.colors[0]=0xFFF1C7;runningTheme.colorCount=1;}}
    applyRunning(true);sendJson(stateJson());
  });

  server.on("/api/events",HTTP_GET,[]{
    int year=server.arg("year").toInt(),month=server.arg("month").toInt();if(year<2020)year=2026;if(month<1||month>12)month=1;
    JsonDocument d;JsonArray arr=d["events"].to<JsonArray>();auto&s=store.get();int monthly=0;
    for(size_t i=0;i<EVENT_COUNT;i++){if(!eventOccursInMonth(i,year,month))continue;JsonObject e=arr.add<JsonObject>();e["id"]=EVENTS[i].id;e["name"]=EVENTS[i].name;e["kind"]=kindName(EVENTS[i].kind);e["when"]=eventWhen(i,year);e["effect"]=effectName(EVENTS[i].effect);e["enabled"]=i<64?((s.enabledMask>>i)&1ULL):true;e["favorite"]=i<64?((s.favoriteMask>>i)&1ULL):false;JsonArray c=e["colors"].to<JsonArray>();for(int j=0;j<EVENTS[i].colorCount;j++)c.add(colorHex(EVENTS[i].colors[j]));if(EVENTS[i].rule==RuleType::Month&&EVENTS[i].kind==EventKind::Awareness&&e["enabled"].as<bool>())monthly++;}
    d["overlap"]=monthly>1?String(monthly)+" month-long events enabled — overlap rule applies.":(monthly==1?"1 month-long event enabled.":"No month-long awareness themes enabled.");
    String out;serializeJson(d,out);sendJson(out);
  });
  server.on("/api/favorites",HTTP_GET,[]{
    JsonDocument d;JsonArray arr=d["events"].to<JsonArray>();auto&s=store.get();
    for(size_t i=0;i<EVENT_COUNT&&i<64;i++){if(!((s.favoriteMask>>i)&1ULL))continue;JsonObject e=arr.add<JsonObject>();e["id"]=EVENTS[i].id;e["name"]=EVENTS[i].name;e["effect"]=effectName(EVENTS[i].effect);JsonArray c=e["colors"].to<JsonArray>();for(int j=0;j<EVENTS[i].colorCount;j++)c.add(colorHex(EVENTS[i].colors[j]));}
    String out;serializeJson(d,out);sendJson(out);
  });
  server.on("/api/event",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;String id=d["id"].as<String>();int i=eventIndexById(id);if(i<0||i>=64){server.send(404,"text/plain","Unknown event");return;}auto&s=store.get();
    if(!d["enabled"].isNull()){if(d["enabled"].as<bool>())s.enabledMask|=(1ULL<<i);else s.enabledMask&=~(1ULL<<i);}
    if(!d["favorite"].isNull()){if(d["favorite"].as<bool>())s.favoriteMask|=(1ULL<<i);else s.favoriteMask&=~(1ULL<<i);}
    store.saveAll();server.send(204);
  });
  server.on("/api/events/bulk",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;int y=d["year"]|2026,m=d["month"]|1;bool en=d["enabled"]|false;auto&s=store.get();for(size_t i=0;i<EVENT_COUNT&&i<64;i++)if(eventOccursInMonth(i,y,m)){if(en)s.enabledMask|=(1ULL<<i);else s.enabledMask&=~(1ULL<<i);}store.saveAll();server.send(204);
  });

  server.on("/api/settings",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;auto&s=store.get();
    if(!d["overlap"].isNull()){String v=d["overlap"].as<String>();s.overlap=v=="split"?1:(v=="combine"?2:0);}
    if(!d["on"].isNull())s.onMinutes=parseTime(d["on"].as<String>(),s.onMinutes);if(!d["off"].isNull())s.offMinutes=parseTime(d["off"].as<String>(),s.offMinutes);
    if(!d["lead"].isNull())s.leadDays=constrain(d["lead"].as<int>(),0,14);if(!d["trail"].isNull())s.trailDays=constrain(d["trail"].as<int>(),0,7);
    if(!d["tz"].isNull()){s.tz=d["tz"].as<String>();configTzTime(s.tz.c_str(),"pool.ntp.org","time.nist.gov");}
    if(!d["bleProtocol"].isNull())s.bleProtocol=constrain(d["bleProtocol"].as<int>(),0,4);if(!d["scheduler"].isNull())s.schedulerEnabled=d["scheduler"].as<bool>();
    store.saveAll();sendJson(stateJson());
  });

  server.on("/api/preset",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;
    Preferences p;p.begin("anderson-preset",false);
    String existing=p.getString("custom","[]");
    JsonDocument list;
    if(deserializeJson(list,existing)) list.to<JsonArray>();
    JsonArray arr=list.as<JsonArray>();
    if(arr.size()>=12) arr.remove(0);
    JsonObject o=arr.add<JsonObject>();
    o["name"]=d["name"]|String("Custom");
    o["effect"]=d["effect"]|String("Solid");
    JsonArray colors=o["colors"].to<JsonArray>();
    if(d["colors"].is<JsonArray>()) for(JsonVariant v:d["colors"].as<JsonArray>()) colors.add(v.as<String>());
    String out;serializeJson(list,out);p.putString("custom",out);p.end();
    sendJson("{\"ok\":true}");
  });

  server.on("/api/wifi/scan",HTTP_GET,[]{
    if(setupAP) WiFi.mode(WIFI_AP_STA); else WiFi.mode(WIFI_STA);WiFi.setSleep(false);WiFi.scanDelete();delay(150);int n=WiFi.scanNetworks(false,true,false,500);JsonDocument d;JsonArray a=d["networks"].to<JsonArray>();if(n>0){for(int i=0;i<n;i++){String ssid=WiFi.SSID(i);if(!ssid.length())continue;bool duplicate=false;for(JsonObject x:a){if(x["ssid"].as<String>()==ssid){duplicate=true;break;}}if(duplicate)continue;JsonObject x=a.add<JsonObject>();x["ssid"]=ssid;x["rssi"]=WiFi.RSSI(i);}}WiFi.scanDelete();String out;serializeJson(d,out);sendJson(out);
  });
  server.on("/api/wifi",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;String ssid=d["ssid"].as<String>(),pass=d["password"].as<String>();if(!ssid.length()){server.send(400,"text/plain","SSID required");return;}store.saveWiFi(ssid,pass);sendJson("{\"ok\":true}");delay(300);ESP.restart();
  });

  server.on("/api/ble/scan",HTTP_GET,[]{
    auto found=ble.scan();JsonDocument d;JsonArray a=d["devices"].to<JsonArray>();for(auto&f:found){JsonObject x=a.add<JsonObject>();x["name"]=f.name;x["address"]=f.address;x["rssi"]=f.rssi;}String out;serializeJson(d,out);sendJson(out);
  });
  server.on("/api/ble/select",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;String addr=d["address"].as<String>();uint8_t p=d["protocol"]|0;bool ok=ble.selectAndConnect(addr,p);if(ok){store.saveAll();ble.setTarget(0);applyRunning(true);}sendJson(stateJson(),ok?200:500);
  });
  server.on("/api/ble/remove",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;int slot=d["slot"]|-1;if(slot<0||slot>1){server.send(400,"text/plain","Invalid slot");return;}ble.removeController(slot);store.saveAll();ble.setTarget(0);sendJson(stateJson());
  });
  server.on("/api/ble/target",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;int t=d["target"]|0;if(t<0||t>2)t=0;ble.setTarget(t);applyRunning(true);sendJson(stateJson());
  });
  server.onNotFound([](){server.send(404,"text/plain","Not found");});
}

void setup(){
  Serial.begin(115200);delay(500);pinMode(BLUE_LED,OUTPUT);pinMode(USER_BUTTON,INPUT_PULLUP);digitalWrite(BLUE_LED,HIGH);
  store.begin();scheduler=new Scheduler(&store.get());connectWiFi();setupMdns();ble.begin(&store.get());
  runningTheme.name="Warm White";runningTheme.effect=Effect::Solid;runningTheme.colors[0]=0xFFF1C7;runningTheme.colorCount=1;
  setupRoutes();server.begin();evaluateSchedule(true);digitalWrite(BLUE_LED,LOW);
}
void loop(){
  server.handleClient();ble.loop();
  if(millis()-lastScheduleCheck>15000){lastScheduleCheck=millis();evaluateSchedule();}
  if(power)applyRunning(false);
  bool pressed=digitalRead(USER_BUTTON)==LOW;if(pressed && !buttonDown)buttonDown=millis();if(!pressed)buttonDown=0;
  if(buttonDown && millis()-buttonDown>5000){buttonDown=0;store.clearWiFi();digitalWrite(BLUE_LED,HIGH);delay(500);ESP.restart();}
  delay(2);
}
