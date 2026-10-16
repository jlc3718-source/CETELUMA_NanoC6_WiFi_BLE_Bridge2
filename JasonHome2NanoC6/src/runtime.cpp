#include "Common.h"
#include "FirmwareUpdate.h"
#include "LocalFirmware.h"
#include "Curtain.h"
#include "WebAssets.h"
#include "BridgePage.h"
#include "OracleRelay.h"
#include "PortMapping.h"
#include <esp_ota_ops.h>
static bool api(const String& path){
 if(!path.startsWith("/api/"))return false;
 bool isAdmin=authorized();
 JsonDocument in,out;bool post=web.method()==HTTP_POST;
 if(post&&web.arg("plain").length()){
  if(web.arg("plain").length()>8192){replyError(413,"Bridge request exceeds 8 KB");return true;}
  if(deserializeJson(in,web.arg("plain"))){replyError(400,"Invalid JSON");return true;}
 }
 bool publicAllowed=publicCurtainRequestAllowed();
 bool publicRead=!post&&(path=="/api/health"||path=="/api/nano/status"||path=="/api/bridge/status");
 String action=in["action"]|String("");
 bool publicControl=post&&path=="/api/curtain/call"&&
  (action=="connect"||action=="disconnect"||action=="power"||action=="solid"||action=="effect"||
   action=="brightness"||action=="speed"||action=="layout");
 if(!isAdmin&&!(publicAllowed&&(publicRead||publicControl))){
  replyError(403,"Public Nano access permits curtain controls only. Use Jason Home 2 Oracle for protected settings.");return true;
 }
 if(path=="/api/health"||path=="/api/nano/status"){
  out["ok"]=true;out["product"]="Jason Home 2 local curtain bridge";out["version"]=VERSION;out["build"]=BUILD_SHA;
  out["stateAuthority"]="oracle";out["wifi"]=WiFi.status()==WL_CONNECTED;out["ip"]=WiFi.localIP().toString();out["setupAP"]=(WiFi.getMode()&WIFI_AP)!=0;
  out["timeValid"]=timeValid();out["uptimeSeconds"]=millis()/1000;out["freeHeap"]=ESP.getFreeHeap();out["largestHeapBlock"]=ESP.getMaxAllocHeap();
  relayDescribe(out["oracle"].to<JsonObject>());out["directEufy"]=false;portMappingStatus(out["portMapping"].to<JsonObject>());JsonDocument curtain;curtainCall("status",in.as<JsonVariantConst>(),curtain);out["curtain"]=curtain.as<JsonVariantConst>();
 }else if(path=="/api/curtain/call"&&post){String action=in["action"]|String("");if(action!="status"&&action!="scan")relayLocalOverride();bool ok=curtainCall(in["action"]|String(""),in["payload"],out);reply(ok?200:400,out.as<JsonVariantConst>());return true;
 }else if(path=="/api/curtain/notifications"&&!post){curtainNotifications(out["notifications"].to<JsonArray>(),strtoul(web.arg("since").c_str(),nullptr,10));
 }else if(path=="/api/bridge/status"&&!post){out["ok"]=true;relayDescribe(out["oracle"].to<JsonObject>());
 }else if(path=="/api/bridge/sync"&&post){relaySyncNow();out["ok"]=true;
 }else if(path=="/api/bridge/resume"&&post){relayLocalOverride(true);out["ok"]=true;
 }else if(path=="/api/bridge/pair"&&post){String error;if(!relayConfigure(in.as<JsonVariantConst>(),error)){replyError(400,error);return true;}out["ok"]=true;
 }else if(path=="/api/bridge/settings"&&post){
  if(!in["autoUpdate"].is<bool>()){replyError(400,"autoUpdate must be boolean");return true;}
  JsonDocument next;next.set(state);next["autoUpdate"]=in["autoUpdate"];
  if(!saveJson("/state.json",next.as<JsonVariantConst>())){replyError(500,"Settings could not be saved");return true;}state.set(next);out["ok"]=true;
 }else if(path=="/api/bridge/reboot"&&post){web.send(202,"application/json","{\"ok\":true}");delay(250);ESP.restart();return true;
 }else{replyError(404,"Eufy, schedules and AI run on Oracle. This device is a local curtain bridge.");return true;}
 reply(200,out.as<JsonVariantConst>());return true;
}
void setup(){
 startNetwork();portMappingRetry();activationEnabled=false;state["activated"]=false;registerSetup();registerFirmware();registerLocalFirmware();curtainBegin();relayBegin();
 auto* p=esp_ota_get_running_partition();if(p&&p->subtype==ESP_PARTITION_SUBTYPE_APP_OTA_0)esp_ota_mark_app_valid_cancel_rollback();
 web.onNotFound([]{
  String path=web.uri();if(path.startsWith("/jason-home-2/"))path=path.substring(13);
  if(api(path))return;
  if(!authorized()&&!(publicCurtainRequestAllowed()&&path=="/"))return replyError(403,"Protected Nano management requires Jason Home 2 Oracle.");
  if(path=="/"){web.sendHeader("Cache-Control","no-store");web.send_P(200,"text/html; charset=utf-8",BRIDGE_PAGE);return;}
  for(auto&a:WEB_ASSETS)if(path==a.path){web.sendHeader("Content-Encoding","gzip");web.sendHeader("Cache-Control","no-store");web.send_P(200,a.type,(const char*)a.data,a.size);return;}
  replyError(404,"Not found");
 });web.begin();
}
void loop(){networkLoop();web.handleClient();curtainLoop();firmwareLoop();delay(2);}
