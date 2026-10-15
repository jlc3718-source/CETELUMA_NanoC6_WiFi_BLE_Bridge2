#include "Common.h"
#include "FirmwareUpdate.h"
#include "LocalFirmware.h"
#include "EufyCloud.h"
#include "LocalScheduler.h"
#include "Curtain.h"
#include "Catalog.h"
#include "WebAssets.h"
#include "Ai.h"
#include "Factory.h"
#include "PortMapping.h"
#include <freertos/queue.h>
#include <algorithm>

static JsonDocument running,manual,previewProgram;
static time_t previewStarted=0;
static String previewKey;
static QueueHandle_t commandQueue;
static SemaphoreHandle_t resultLock;
static String jobResult,jobId,lastScheduleKey;
static volatile bool commandBusy=false;
static volatile bool commandFailed=false;
static uint32_t nextResolve=0,nextPrepare=0;
static time_t manualUntil=0;
struct Job{char id[25];char payload[4096];};
static void commandWorker(void*){
  Job job;for(;;){if(xQueueReceive(commandQueue,&job,portMAX_DELAY)!=pdTRUE)continue;commandBusy=true;JsonDocument request,result;
    bool parsed=!deserializeJson(request,job.payload);bool ok=parsed&&((request["_factoryRefresh"]|false)?refreshFactoryCatalog():eufy.control(request.as<JsonVariantConst>(),result));result["ok"]=ok;result["jobId"]=job.id;result["done"]=true;result["state"]=ok?"complete":"failed";if(!ok)result["error"]=eufy.error;
    auto r=result["result"].to<JsonObject>();r["results"]=result["devices"];r["attempted"]=result["devices"].size();int sent=0;for(auto d:result["devices"].as<JsonArrayConst>())if(d["ok"]|false)sent++;r["sent"]=sent;r["mode"]=request["mode"]|"native";
    String text;serializeJson(result,text);xSemaphoreTake(resultLock,portMAX_DELAY);jobId=job.id;jobResult=text;xSemaphoreGive(resultLock);if(!ok)commandFailed=true;commandBusy=false;
  }
}
static bool queueControl(JsonVariantConst request,String&id){
  if(!activationEnabled&&!(request["_factoryRefresh"]|false)){lastError="Activate NanoC6 after pausing Oracle";return false;}
  if(measureJson(request)>=4096){lastError="Control recipe exceeds 4 KB";return false;}
  JsonDocument snapshot;snapshot.set(request);snapshot["_brightnessOnly"]=request["brightness"].is<int>()&&request.size()<=2;snapshot["_brightnessOverrides"]=state["brightnessOverrides"];snapshot["_lampCounts"]=state["lampCounts"];if(measureJson(snapshot)>=4096){lastError="Control recipe and configuration exceed 4 KB";return false;}
  Job job{};id=randomHex(8);strlcpy(job.id,id.c_str(),sizeof(job.id));serializeJson(snapshot,job.payload,sizeof(job.payload));
  if(xQueueSend(commandQueue,&job,0)!=pdTRUE){lastError="Controller command queue is full";return false;}return true;
}
bool queueLocalControl(JsonVariantConst request,String&id){return queueControl(request,id);}
extern void renderEventScene(JsonVariantConst,int,int,JsonObject);
bool startPreview(JsonVariantConst event,String&id){
  JsonDocument scene;renderEventScene(event,event["brightness"]|100,0,scene.to<JsonObject>());scene["target"]="All";
  if(!queueControl(scene.as<JsonVariantConst>(),id))return false;manual.set(scene);previewProgram.set(event);previewStarted=time(nullptr);manualUntil=time(nullptr)+7200;previewKey="";return true;
}
void endPreview(){previewProgram.clear();manual.clear();manualUntil=0;nextResolve=0;}
static String colorHex(uint32_t color){char b[8];snprintf(b,sizeof(b),"#%06X",(unsigned)(color&0xffffff));return b;}
static void displayColors(JsonVariant source,JsonVariantConst colors){auto a=source.to<JsonArray>();for(auto c:colors.as<JsonArrayConst>())a.add(c.is<String>()?c.as<String>():colorHex(c.as<uint32_t>()));}
static String ymd(time_t at){tm t{};localtime_r(&at,&t);char b[12];strftime(b,sizeof(b),"%Y-%m-%d",&t);return b;}
static time_t boundary(time_t now){
  tm day{};localtime_r(&now,&day);time_t best=now+86400;int dawn,dusk;solarTimes(now,dawn,dusk);auto s=state["settings"];
  int mins[]={(s["startAtDusk"]|true)?dusk:s["on"]|1020,s["off"]|1380,(s["schedule2EndAtDawn"]|true)?dawn:s["schedule2End"]|360,1260,1320,360,std::min(450,dawn)};
  for(int delta=0;delta<=1;delta++)for(int n:mins){tm probe=day;probe.tm_mday+=delta;probe.tm_hour=n/60;probe.tm_min=n%60;probe.tm_sec=0;probe.tm_isdst=-1;time_t at=mktime(&probe);if(at>now&&at<best)best=at;}return best;
}
static void currentScene(JsonDocument&scene){if(manualUntil>time(nullptr)&&!manual.isNull())scene.set(manual);else if(running["scene"].is<JsonObject>())scene.set(running["scene"]);else{scene["power"]=false;scene["brightness"]=75;scene["speed"]=3;scene["effect"]="Static";scene["colors"].to<JsonArray>().add(0xffffff);}}
static void stateResponse(JsonDocument&out){
  JsonDocument scene;currentScene(scene);auto settings=state["settings"];time_t now=time(nullptr);int dawn,dusk;solarTimes(now,dawn,dusk);bool overridden=manualUntil>now;
  out["firmwareVersion"]=String("Jason Home 2 NanoC6 ")+VERSION;out["power"]=scene["power"];out["brightness"]=scene["brightness"];out["speed"]=scene["speed"];out["stateAuthority"]=activationEnabled?"nanoc6":"paused";out["manualOverride"]=overridden;
  String name=overridden?manual["name"]|String("Manual override"):running["name"]|String("No scheduled scene running");
  auto r=out["running"].to<JsonObject>();r["name"]=name;r["effect"]=scene["effect"];displayColors(r["colors"],scene["colors"]);
  auto rn=out["runningNow"].to<JsonObject>();rn["id"]=overridden?"manual-override":running["id"]|"";rn["name"]=name;rn["effect"]=scene["effect"];rn["brightness"]=scene["brightness"];rn["phase"]=overridden?"Manual override":(running["schedule2"]|false)?"Schedule 2":"Schedule 1";
  auto sc=out["settings"].to<JsonObject>();for(JsonPairConst p:settings.as<JsonObjectConst>())sc[p.key()]=p.value();
  auto hh=[](int n){char s[8];snprintf(s,sizeof(s),"%02d:%02d",n/60,n%60);return String(s);};sc["on"]=hh(settings["on"]|1020);sc["off"]=hh(settings["off"]|1380);sc["schedule2End"]=hh(settings["schedule2End"]|360);sc["scheduler"]=settings["enabled"]|false;sc["scheduler2"]=settings["schedule2Enabled"]|true;sc["schedule1StartAtDusk"]=settings["startAtDusk"]|true;sc["whiteOverride1"]=settings["whiteOverride1Enabled"]|true;sc["whiteOverride2"]=settings["whiteOverride2Enabled"]|true;sc["dawn"]=clockLabel(dawn);sc["dusk"]=clockLabel(dusk);sc["tz"]="America/New_York";
  out["scheduleWindow"]="NanoC6 Schedule 1 "+clockLabel(settings["on"]|1020)+" – "+clockLabel(settings["off"]|1380);out["nextEvent"]="Next schedule boundary";
  auto nx=out["nextChange"].to<JsonObject>();nx["name"]="Next schedule change";nx["at"]=(int64_t)boundary(now)*1000;
  auto se=out["scheduledEvent"].to<JsonObject>();se["id"]=running["id"]|"";se["name"]=running["name"]|"No scheduled scene running";se["enabled"]=settings["enabled"]|false;se["toggleable"]=String(running["id"]|"").startsWith("evt");auto ev=se["events"].to<JsonArray>();if(!running.isNull()){auto item=ev.add<JsonObject>();item["id"]=running["id"];item["name"]=running["name"];displayColors(item["colors"],scene["colors"]);}
  auto b=out["ble"].to<JsonObject>();b["ready"]=eufy.ready;b["connected"]=eufy.ready;b["connectedCount"]=eufy.ready?4:0;b["knownCount"]=4;b["seenCount"]=eufy.ready?4:0;b["busy"]=commandBusy;b["name"]="Saved Eufy lights";b["protocol"]="NanoC6 + Eufy MQTT";b["connectionMode"]="Local NanoC6";b["target"]=state["target"]|0;b["status"]=eufy.error;b["transportStatus"]="NanoC6 → Eufy MQTT";eufy.describe(b["controllers"].to<JsonArray>());
  auto resolver=out["resolverAuthority"].to<JsonObject>();resolver["inSync"]=true;resolver["oracleBuild"]="local";resolver["resolverBuild"]=BUILD_SHA;
  tm today{};localtime_r(&now,&today);auto td=out["localToday"].to<JsonObject>();td["year"]=today.tm_year+1900;td["month"]=today.tm_mon+1;td["day"]=today.tm_mday;
}
static bool persist(){return saveJson("/state.json",state.as<JsonVariantConst>());}
static void ok(){web.send(200,"application/json","{\"ok\":true}");}
static void eventView(JsonDocument&e){
  JsonDocument copy;copy.set(e);auto colors=e["colors"].to<JsonArray>();for(auto c:copy["colors"].as<JsonArrayConst>())colors.add(c.is<String>()?c.as<String>():colorHex(c.as<uint32_t>()));
  JsonDocument meta;deserializeJson(meta,CATALOG_META);int ci=e["categoryIndex"]|0;auto cat=meta["categories"][ci];e["categoryId"]=cat["id"];e["categoryName"]=cat["name"];e["categoryColor"]=cat["color"];
  e["when"]=String(e["rule"]|"")+" · "+String(e["month"]|1)+"/"+String(e["day"]|1);e["customized"]=state["overrides"][String(e["id"]|"")].size()>0;
  auto o=e["scheduleOverride"];auto schedule=e["schedule"].to<JsonObject>();schedule["mode"]=o["mode"]|"default";schedule["annual"]=o["annual"]|true;schedule["year"]=o["year"]|2026;schedule["startMonth"]=o["startMonth"]|e["month"]|1;schedule["startDay"]=o["startDay"]|e["day"]|1;schedule["endMonth"]=o["endMonth"]|e["month"]|1;schedule["endDay"]=o["endDay"]|e["day"]|1;schedule["customTime"]=o["customTime"]|false;auto clock=[](int n){char b[6];snprintf(b,sizeof(b),"%02d:%02d",n/60,n%60);return String(b);};schedule["start"]=clock(o["start"]|1020);schedule["end"]=clock(o["end"]|1380);
  defaultLayers(copy.as<JsonVariantConst>(),e["layers"].to<JsonArray>());e["layerCount"]=e["layers"].size();
}
static bool handleApi(const String&path){
  if(!path.startsWith("/api/"))return false;
  if(!authorized()){replyError(401,"Sign in first");return true;}
  bool post=web.method()==HTTP_POST;JsonDocument in,out;String importBuffer;
  if(post&&web.arg("plain").length()){
    bool importPath=path=="/api/nano/import"||path=="/api/backup/import-portable"||path=="/api/backup/restore";
    if(web.arg("plain").length()>65536){replyError(400,"Request exceeds 64 KB");return true;}
    DeserializationError error;if(importPath){importBuffer=web.arg("plain");error=deserializeJson(in,importBuffer.begin());}else error=deserializeJson(in,web.arg("plain"));
    if(error){replyError(400,"Invalid JSON or insufficient memory");return true;}
  }
  if(post&&commandBusy&&path!="/api/curtain/call"){replyError(409,"Wait for the current lighting command to finish");return true;}
  if(handleAiApi(path,in.as<JsonVariantConst>(),post))return true;
  if(handleFactoryApi(path,in.as<JsonVariantConst>(),post,commandBusy))return true;
  if(path=="/api/state"){stateResponse(out);reply(200,out.as<JsonVariantConst>());return true;}
  if(path=="/api/nanoc6/sync"){out["enabled"]=false;out["configured"]=true;out["online"]=true;out["note"]="NanoC6 is the local controller; a separate brightness follower is unnecessary.";reply(200,out.as<JsonVariantConst>());return true;}
  if(path=="/api/night-calendar"){
    time_t ts=time(nullptr);tm now{};localtime_r(&ts,&now);int year=web.arg("year").toInt(),month=web.arg("month").toInt();if(!year)year=now.tm_year+1900;if(!month)month=now.tm_mon+1;if(year<2020||year>2100||month<1||month>12){replyError(400,"Invalid month");return true;}
    out["year"]=year;out["month"]=month;auto days=out["days"].to<JsonArray>();
    for(int day=1;day<=31;day++){tm t{};t.tm_year=year-1900;t.tm_mon=month-1;t.tm_mday=day;t.tm_hour=12;t.tm_isdst=-1;time_t at=mktime(&t);if(t.tm_mon!=month-1)break;JsonDocument candidates;localNightCandidates(at,candidates.to<JsonArray>());auto row=days.add<JsonObject>();row["day"]=day;auto events=row["events"].to<JsonArray>();for(JsonVariantConst c:candidates.as<JsonArrayConst>()){auto e=events.add<JsonObject>();e["id"]=c["id"];e["name"]=c["name"];e["type"]=c["type"];e["effect"]=c["event"]["effect"]|"Static";e["speed"]=c["event"]["speed"]|1;displayColors(e["colors"],c["colors"]);}}
    reply(200,out.as<JsonVariantConst>());return true;
  }
  if(path=="/api/tonight-options"){
    time_t at=time(nullptr);tm day{};localtime_r(&at,&day);int dawn,dusk;solarTimes(at,dawn,dusk);if(day.tm_hour*60+day.tm_min<dawn)at-=86400;
    JsonDocument candidates;localNightCandidates(at,candidates.to<JsonArray>());auto options=out["options"].to<JsonArray>();bool selected=false;
    for(JsonVariantConst c:candidates.as<JsonArrayConst>()){
      if(post&&String(c["id"]|"")==String(in["id"]|"")){String id;if(!startPreview(c["event"],id)){replyError(409,lastError);return true;}manualUntil=boundary(time(nullptr));manual["name"]=c["name"];manual["_eventId"]=c["id"];selected=true;out["jobId"]=id;}
      auto o=options.add<JsonObject>();o["id"]=c["id"];o["name"]=c["name"];o["type"]=c["type"];o["effect"]=c["event"]["effect"]|"Static";o["speed"]=c["event"]["speed"]|1;displayColors(o["colors"],c["colors"]);
    }if(post&&!selected){replyError(409,"That event does not qualify for tonight");return true;}out["ok"]=true;reply(post?202:200,out.as<JsonVariantConst>());return true;
  }
  if(path=="/api/nano/status"){
    out["ok"]=true;out["version"]=VERSION;out["build"]=BUILD_SHA;out["activated"]=activationEnabled;out["timeValid"]=timeValid();out["wifi"]=WiFi.status()==WL_CONNECTED;out["ip"]=WiFi.localIP().toString();out["freeHeap"]=ESP.getFreeHeap();out["largestHeapBlock"]=ESP.getMaxAllocHeap();out["storageFree"]=LittleFS.totalBytes()-LittleFS.usedBytes();out["eufyReady"]=eufy.ready;out["eufyStatus"]=eufy.error;out["oracleRetired"]=state["oraclePaused"]|false;reply(200,out.as<JsonVariantConst>());return true;
  }
  if(path=="/api/nano/activate"&&post){
    bool enable=in["enabled"]|false;
    if(enable&&!(in["oraclePaused"]|false)){replyError(409,"Check the confirmation that the Oracle scheduler is paused");return true;}
    if(enable&&!timeValid()){replyError(409,"Waiting for clock synchronization");return true;}
    if(enable&&!eufy.ready){replyError(409,"Eufy is not ready: "+eufy.error);return true;}
    state["activated"]=enable;state["oraclePaused"]=in["oraclePaused"]|false;activationEnabled=enable;persist();nextResolve=0;ok();return true;
  }
  if(path=="/api/eufy/login"&&post){
    if(commandBusy){replyError(409,"A lighting command is running");return true;}bool ready=eufy.login(in["email"]|String(""),in["password"]|String(""));if(ready)ok();else replyError(502,eufy.error);return true;
  }
  if(path=="/api/nano/private"&&post){
    IPAddress remote=web.client().remoteIP();uint32_t mask=(uint32_t)WiFi.subnetMask();
    if(activationEnabled||((uint32_t)remote&mask)!=((uint32_t)WiFi.localIP()&mask)){replyError(403,"Pause NanoC6 and import private account settings on home Wi-Fi");return true;}
    if(String(in["product"]|"")!="jason-home-2-nanoc6-private"||!in["eufyEmail"].is<String>()||!in["eufyPassword"].is<String>()){replyError(400,"Wrong private account file");return true;}
    for(auto key:{"eufyEmail","eufyPassword","eufyInstall","cfAccount","cfToken"})if(in[key].is<String>())secrets[key]=in[key];secrets.remove("eufySession");if(in["eufySession"].is<JsonObjectConst>()&&in["eufySession"]["token"].is<String>())secrets["eufySession"]=in["eufySession"];saveJson("/secrets.json",secrets.as<JsonVariantConst>());eufy.ready=false;eufy.begin();nextPrepare=0;ok();return true;
  }
  if(path=="/api/nano/import"&&post){
    if(activationEnabled){replyError(409,"Pause NanoC6 before importing");return true;}
    if(String(in["product"]|"")!="jason-home-2-nanoc6"||(in["schema"]|0)!=1||!in["state"]["settings"].is<JsonObjectConst>()){replyError(400,"Use the supplied migration converter or NanoC6 export");return true;}
    auto candidate=in["state"].as<JsonObject>();candidate["activated"]=false;candidate["autoUpdate"]=false;candidate["oraclePaused"]=false;
    if(!saveJson("/state.json",candidate)){replyError(500,"Import could not be saved");return true;}
    // Release the decoded upload and its linked strings before loading owned
    // settings from flash. Never keep pointers into the temporary HTTP body.
    in.clear();importBuffer="";state.clear();if(!loadJson("/state.json",state)){replyError(500,"Saved settings could not be loaded");return true;}
    schedulerBegin();manual.clear();manualUntil=0;nextResolve=0;ok();return true;
  }
  if(path=="/api/network/upnp"){if(post){if(in["enabled"].is<bool>())state["upnpEnabled"]=in["enabled"];persist();portMappingRetry();}portMappingStatus(out.to<JsonObject>());reply(200,out.as<JsonVariantConst>());return true;}
  if(path=="/api/nano/config"&&post){if(in["autoUpdate"].is<bool>())state["autoUpdate"]=in["autoUpdate"];if(in["lampCounts"].is<JsonObjectConst>()){for(auto name:{"Pool","House","Garage","Shed"}){int n=in["lampCounts"][name]|0;if(n>=1&&n<=120)state["lampCounts"][name]=n;}}persist();ok();return true;}
  if(path=="/api/curtain/call"&&post){bool yes=curtainCall(in["action"]|String(""),in["payload"],out);reply(yes?200:400,out.as<JsonVariantConst>());return true;}
  if(path=="/api/curtain/notifications"){curtainNotifications(out["notifications"].to<JsonArray>(),strtoul(web.arg("since").c_str(),nullptr,10));reply(200,out.as<JsonVariantConst>());return true;}
  if(path=="/api/control"&&post){
    JsonDocument request;currentScene(request);for(JsonPairConst p:in.as<JsonObjectConst>())request[p.key()]=p.value();
    const char*names[]={"All","Pool","House","Garage","Shed"};if(!in["target"].is<String>())request["target"]=names[constrain(state["target"]|0,0,4)];
    bool onlyBrightness=in["brightness"].is<int>()&&in.size()<=2&&!in["power"].is<bool>();JsonDocument just;if(onlyBrightness){just["target"]=request["target"];just["brightness"]=in["brightness"];}
    String id;if(!queueControl(onlyBrightness?just.as<JsonVariantConst>():request.as<JsonVariantConst>(),id)){replyError(409,lastError);return true;}
    if(onlyBrightness){String target=request["target"]|String("All");for(auto name:{"Pool","House","Garage","Shed"})if(target=="All"||target==name)state["brightnessOverrides"][name]=in["brightness"];if(!manual.isNull())manual["brightness"]=in["brightness"];}
    else{previewProgram.clear();manual.set(request);manualUntil=boundary(time(nullptr));state["manual"]=manual.as<JsonVariantConst>();state["manualUntil"]=(int64_t)manualUntil;}
    persist();out["ok"]=true;out["queued"]=true;out["jobId"]=id;out["physicalStateConfirmed"]=false;reply(202,out.as<JsonVariantConst>());return true;
  }
  if(path=="/api/jobs"||path=="/api/eufy/factory-test"){
    xSemaphoreTake(resultLock,portMAX_DELAY);String text=jobResult;xSemaphoreGive(resultLock);if(text.length())web.send(200,"application/json",text);else web.send(200,"application/json","{\"ok\":true,\"done\":false}");return true;
  }
  if(path=="/api/resume"||path=="/api/reconcile"){endPreview();state.remove("manual");state.remove("manualUntil");persist();nextResolve=0;stateResponse(out);reply(200,out.as<JsonVariantConst>());return true;}
  if(path=="/api/reconnect"&&post){if(commandBusy)replyError(409,"Controller is busy");else if(eufy.prepare())ok();else replyError(502,eufy.error);return true;}
  if(path=="/api/cloud/config"){out["ok"]=true;out["configured"]=true;out["mode"]="cloud";out["endpoint"]="http://"+WiFi.localIP().toString();out["automationOwner"]="nanoc6";out["directReady"]=eufy.ready;out["directStatus"]=eufy.error;reply(200,out.as<JsonVariantConst>());return true;}
  if(path=="/api/cloud/test"){stateResponse(out);out["ok"]=eufy.ready;reply(200,out.as<JsonVariantConst>());return true;}
  if(path=="/api/ble/scan"){eufy.describe(out["devices"].to<JsonArray>());reply(200,out.as<JsonVariantConst>());return true;}
  if(path=="/api/ble/target"&&post){state["target"]=constrain(in["target"]|0,0,4);persist();ok();return true;}
  if(path=="/api/settings"&&post){
    auto s=state["settings"].as<JsonObject>();for(JsonPairConst p:in.as<JsonObjectConst>()){
      String k=p.key().c_str();if(k=="scheduler")k="enabled";if(k=="scheduler2")k="schedule2Enabled";if(k=="schedule1StartAtDusk")k="startAtDusk";if(k=="whiteOverride1")k="whiteOverride1Enabled";if(k=="whiteOverride2")k="whiteOverride2Enabled";
      if(k=="on"||k=="off"||k=="schedule2End"){if(p.value().is<String>()){int h=0,m=0;if(sscanf(p.value().as<const char*>(),"%d:%d",&h,&m)==2&&h>=0&&h<=23&&m>=0&&m<=59)s[k]=h*60+m;}else s[k]=constrain(p.value().as<int>(),0,1439);}else s[k]=p.value();
    }persist();nextResolve=0;stateResponse(out);reply(200,out.as<JsonVariantConst>());return true;
  }
  if(path=="/api/events"||path=="/api/events/search"||path=="/api/favorites"){
    auto a=out["events"].to<JsonArray>();String q=web.arg("q");q.toLowerCase();int month=web.arg("month").toInt();for(size_t i=0;i<eventCount();i++){
      JsonDocument e;eventAt(i,e);if(path=="/api/favorites"&&!(e["favorite"]|false))continue;String n=e["name"]|String("");n.toLowerCase();if(q.length()&&n.indexOf(q)<0)continue;if(month&&month!=int(e["month"]|0))continue;eventView(e);a.add(e.as<JsonVariantConst>());if(a.size()>=96)break;
    }if(path=="/api/favorites")for(JsonVariantConst p:state["presets"].as<JsonArrayConst>())if(p["favorite"]|false){auto c=a.add<JsonObject>();c.set(p);c["custom"]=true;}out["truncated"]=a.size()>=96;reply(200,out.as<JsonVariantConst>());return true;
  }
  if(path=="/api/event"&&post){
    String id=in["id"]|String("");if(eventIndex(id)<0){replyError(404,"Unknown event");return true;}
    if(in["resetAll"]|false)state["overrides"].remove(id);
    else{if(!state["overrides"][id].is<JsonObject>())state["overrides"][id].to<JsonObject>();auto o=state["overrides"][id].as<JsonObject>();for(auto k:{"enabled","favorite","effect","speed","colors","brightness"})if(!in[k].isNull())o[k]=in[k];if(in["layers"].is<JsonArrayConst>())o["creativePhases"]=in["layers"];if(in["schedule"].is<JsonObjectConst>()){o["scheduleOverride"]=in["schedule"];for(auto key:{"start","end"})if(o["scheduleOverride"][key].is<String>()){int h=0,m=0;if(sscanf(o["scheduleOverride"][key].as<const char*>(),"%d:%d",&h,&m)==2)o["scheduleOverride"][key]=constrain(h*60+m,0,1439);}}if(in["resetSchedule"]|false)o.remove("scheduleOverride");}
    persist();nextResolve=0;ok();return true;
  }
  if(path=="/api/event-categories"||path=="/api/event-color-theme"||path=="/api/colors"){
    JsonDocument meta;deserializeJson(meta,CATALOG_META);
    if(path=="/api/colors"){
      int index=in["index"]|-1;if(post&&index>=0&&index<(int)meta["palette"].size()){if(in["reset"]|false)state["palette"].remove(String(index));else state["palette"][String(index)]=in["color"];persist();}
      auto a=out["presets"].to<JsonArray>();for(JsonVariantConst p:meta["palette"].as<JsonArrayConst>()){auto c=a.add<JsonObject>();c.set(p);String key=String(p["index"]|0);c["color"]=state["palette"][key]|p["default"]|String("#FFFFFF");c["customized"]=!state["palette"][key].isNull();}
    }else if(path=="/api/event-color-theme"){
      String theme=in["theme"]|String("");if(post){state["settings"]["mode"]=theme=="1"?0:theme=="3.0.28"?1:2;persist();}int mode=state["settings"]["mode"]|2;out["theme"]=mode==0?"1":mode==1?"3.0.28":"3.0.29";out["name"]=mode==0?"Favorites":mode==1?"Basic colors":"Expanded colors";
    }else{
      int mask=state["settings"]["categoryMask"]|32767,index=in["index"]|-1;if(post&&index>=0&&index<15){if(in["enabled"]|false)mask|=1<<index;else mask&=~(1<<index);state["settings"]["categoryMask"]=mask;persist();}out["mask"]=mask;out["expanded"]=(state["settings"]["mode"]|2)!=0;auto a=out["categories"].to<JsonArray>();for(JsonVariantConst cat:meta["categories"].as<JsonArrayConst>()){auto c=a.add<JsonObject>();c.set(cat);c["enabled"]=(mask&(1<<int(cat["index"]|0)))!=0;}
    }reply(200,out.as<JsonVariantConst>());return true;
  }
  if(path=="/api/custom-schedules/group"&&post){for(auto e:state["customSchedules"].as<JsonArray>())e["enabled"]=in["enabled"]|false;persist();ok();return true;}
  if(path=="/api/presets"||path=="/api/custom-schedules"||path=="/api/preset"){
    bool preset=path=="/api/presets"||path=="/api/preset";const char*key=preset?"presets":"customSchedules";auto a=state[key].as<JsonArray>();
    if(post){String id=in["deleteId"]|in["id"]|String("");bool remove=(in["delete"]|false)||(in["remove"]|false)||in["deleteId"].is<String>();JsonVariant item;
      for(size_t i=0;i<a.size();i++)if(String(a[i]["id"]|"")==id){if(remove)a.remove(i);else item=a[i];break;}
      if(!remove){if(item.isNull()){
        if(!preset){String presetId=in["presetId"]|String("");JsonVariantConst source;for(JsonVariantConst p:state["presets"].as<JsonArrayConst>())if(String(p["id"]|"")==presetId){source=p;break;}if(source.isNull()){replyError(404,"Custom light not found");return true;}item=a.add<JsonObject>();item.set(source);item["presetId"]=presetId;item["enabled"]=true;}
        else{if(!String(in["name"]|"").length()){replyError(400,"Give this custom light a name");return true;}item=a.add<JsonObject>();item["enabled"]=true;item["favorite"]=false;}
        id=(preset?"custom-":"schedule-")+randomHex(6);item["id"]=id;
      }for(JsonPairConst p:in.as<JsonObjectConst>())if(String(p.key().c_str())!="id")item[p.key()]=p.value();
      if(preset&&in["enabled"].is<bool>())for(auto row:state["customSchedules"].as<JsonArray>())if(String(row["presetId"]|"")==id)row["enabled"]=in["enabled"];
      }persist();nextResolve=0;out["ok"]=true;out["id"]=id;reply(200,out.as<JsonVariantConst>());
    }else{auto items=out[preset?"presets":"items"].to<JsonArray>();int month=web.arg("month").toInt(),year=web.arg("year").toInt();for(JsonVariantConst p:a)if(preset||!month||((p["month"]|0)==month&&((p["annual"]|false)||!year||(p["year"]|0)==year)))items.add(p);reply(200,out.as<JsonVariantConst>());}return true;
  }
  if(path=="/api/backup/status"){out["hasBackup"]=LittleFS.exists("/backup.json");out["lastOk"]=LittleFS.exists("/backup.json");out["lastBackup"]=state["backupTime"]|0;out["mode"]="NanoC6 settings";reply(200,out.as<JsonVariantConst>());return true;}
  if(path=="/api/backup/manual"){state["backupTime"]=(int64_t)time(nullptr);persist();JsonDocument b;b["schema"]=1;b["product"]="jason-home-2-nanoc6";b["state"]=state.as<JsonVariantConst>();if(!saveJson("/backup.json",b.as<JsonVariantConst>())){replyError(500,"Backup could not be saved");return true;}ok();return true;}
  if(path=="/api/backup/export-portable"||path=="/api/nano/export"){out["ok"]=true;out["containsCredentials"]=false;auto b=out["backup"].to<JsonObject>();b["schema"]=1;b["product"]="jason-home-2-nanoc6";b["state"]=state.as<JsonVariantConst>();reply(200,out.as<JsonVariantConst>());return true;}
  if((path=="/api/backup/import-portable"||path=="/api/backup/restore")&&post){
    JsonDocument saved;if(path.endsWith("restore")&&in["backup"].isNull())loadJson("/backup.json",saved);JsonVariantConst b=in["backup"].isNull()?saved.as<JsonVariantConst>():in["backup"].as<JsonVariantConst>();
    if(String(b["product"]|"")!="jason-home-2-nanoc6"||!b["state"]["settings"].is<JsonObjectConst>()){replyError(400,"Convert Oracle backups with the supplied migration tool, then use Import migration file");return true;}if(activationEnabled){replyError(409,"Pause NanoC6 before restoring settings");return true;}JsonObject next=in["backup"]["state"].is<JsonObject>()?in["backup"]["state"].as<JsonObject>():saved["state"].as<JsonObject>();next["activated"]=false;next["autoUpdate"]=false;if(!saveJson("/state.json",next)){replyError(500,"Restore could not be saved");return true;}in.clear();saved.clear();importBuffer="";state.clear();if(!loadJson("/state.json",state)){replyError(500,"Saved settings could not be loaded");return true;}schedulerBegin();endPreview();ok();return true;
  }
  return false;
}
void setup(){
  startNetwork();schedulerBegin();registerSetup();registerFirmware();registerLocalFirmware();eufy.begin();curtainBegin();
  manualUntil=state["manualUntil"]|0LL;if(manualUntil>time(nullptr))manual.set(state["manual"]);
  resultLock=xSemaphoreCreateMutex();commandQueue=xQueueCreate(3,sizeof(Job));xTaskCreate(commandWorker,"jh2-eufy",12288,nullptr,1,nullptr);
  web.onNotFound([]{
    String path=web.uri();if(path.startsWith("/jason-home-2/"))path=path.substring(13);
    if(!String(secrets["ssid"]|"").length()){web.sendHeader("Location","/setup");web.send(303);return;}
    if(path.startsWith("/api/")&&handleApi(path))return;
    if(path.startsWith("/api/")){replyError(501,"This capability is not implemented in this NanoC6 candidate");return;}
    if(!authorized()){web.sendHeader("Location","/login");web.send(303);return;}
    if(path=="/")path="/anderson_home.html";
    for(auto&a:WEB_ASSETS)if(path==a.path){web.sendHeader("Content-Encoding","gzip");web.sendHeader("Cache-Control","no-store");web.send_P(200,a.type,(const char*)a.data,a.size);return;}
    replyError(404,"File not found");
  });web.begin();
}
void loop(){
  networkLoop();web.handleClient();curtainLoop();uint32_t now=millis();if(commandFailed){commandFailed=false;lastScheduleKey="";}
  if(!commandBusy&&WiFi.status()==WL_CONNECTED&&uxQueueMessagesWaiting(commandQueue)==0&&timeValid()&&!eufy.ready&&(int32_t)(now-nextPrepare)>=0){nextPrepare=now+60000;eufy.prepare();}
  if(!commandBusy&&timeValid()&&(int32_t)(now-nextResolve)>=0){
    nextResolve=now+30000;String oldId=running["id"]|String("");resolveSchedule(time(nullptr),running);if(oldId.length()&&oldId!=String(running["id"]|"")){state.remove("brightnessOverrides");persist();}
    if(manualUntil&&manualUntil<=time(nullptr)){manualUntil=0;manual.clear();previewProgram.clear();lastScheduleKey="";state.remove("manual");state.remove("manualUntil");persist();}
    if(activationEnabled&&manualUntil>time(nullptr)&&!previewProgram.isNull()){
      JsonDocument scene;renderEventScene(previewProgram.as<JsonVariantConst>(),manual["brightness"]|100,(time(nullptr)-previewStarted)/60,scene.to<JsonObject>());scene["target"]="All";String key;serializeJson(scene,key);if(key!=previewKey){String id;if(queueControl(scene.as<JsonVariantConst>(),id)){previewKey=key;manual.set(scene);}}
    }
    if(activationEnabled&&(manualUntil<=time(nullptr)||String(manual["target"]|"All")!="All")){
      JsonDocument scene;if(running["scene"].is<JsonObject>())scene.set(running["scene"]);else scene["power"]=false;if(scene["target"].isNull())scene["target"]="All";scene["_scheduled"]=true;if(manualUntil>time(nullptr))scene["_skipTarget"]=manual["target"];
      String key;serializeJson(scene,key);if(key!=lastScheduleKey){String id;if(queueControl(scene.as<JsonVariantConst>(),id))lastScheduleKey=key;}
    }
  }
  if(!commandBusy){firmwareLoop();portMappingLoop();}delay(2);
}
