#include "PortMapping.h"
#ifndef JH2_BOOT
#include <WiFiUdp.h>
#include <HTTPClient.h>
#include <freertos/task.h>
// Only published Nano services are eligible. Never forward arbitrary LAN hosts,
// an ephemeral RPC endpoint, or router configuration/management ports.
static constexpr uint16_t EXTERNAL_HTTP=80,INTERNAL_HTTP=80;
static constexpr uint32_t LEASE=1800;
static SemaphoreHandle_t guard=nullptr;
static TaskHandle_t mapperTask=nullptr;
static String message="Waiting for Deco UPnP gateway";
static bool mapped=false;
static uint32_t lastRenew=0;
static IPAddress lastGateway,lastLocal;
static void report(const String&text,bool active){
 if(guard)xSemaphoreTake(guard,portMAX_DELAY);
 message=text;mapped=active;
 if(active)lastRenew=millis();
 if(guard)xSemaphoreGive(guard);
}
static bool extract(const String&xml,const String&open,const String&close,String&value){
 int i=xml.indexOf(open);if(i<0)return false;i+=open.length();
 int j=xml.indexOf(close,i);if(j<i)return false;value=xml.substring(i,j);value.trim();return value.length()>0;
}
static bool locationOnRouter(const String&url,const IPAddress&gateway,String&base,String&path){
 if(!url.startsWith("http://"))return false;
 int slash=url.indexOf('/',7);
 String hostPort=slash<0?url.substring(7):url.substring(7,slash);
 String host=hostPort;int col=hostPort.indexOf(':');
 if(col>=0)host=hostPort.substring(0,col);
 IPAddress candidate;
 if(!candidate.fromString(host)||candidate!=gateway)return false;
 int port=col<0?80:hostPort.substring(col+1).toInt();
 if(port<1||port>65535)return false;
 base="http://"+host+":"+String(port);
 path=slash<0?"/":url.substring(slash);
 if(path.indexOf('#')>=0||path.indexOf('?')>=0)return false;
 return true;
}
static bool discovery(const IPAddress&gateway,String&base,String&location){
 WiFiUDP udp;if(!udp.begin(0))return false;
 IPAddress multicast(239,255,255,250);
 const String targets[]={"urn:schemas-upnp-org:device:InternetGatewayDevice:1",
                         "urn:schemas-upnp-org:service:WANIPConnection:1"};
 for(auto&target:targets){
  const String payload="M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\n"
      "MAN: \"ssdp:discover\"\r\nMX: 2\r\nST: "+target+"\r\n\r\n";
  if(udp.beginPacket(multicast,1900)){udp.write((const uint8_t*)payload.c_str(),payload.length());udp.endPacket();}
 }
 uint32_t start=millis();
 while(millis()-start<3000){
  int len=udp.parsePacket();
  if(len<=0){vTaskDelay(pdMS_TO_TICKS(30));continue;}
  IPAddress from=udp.remoteIP();String response;response.reserve(1400);
  while(udp.available()&&response.length()<1400)response+=(char)udp.read();
  if(from!=gateway)continue; // Only the Deco gateway may supply IGD services.
  String lower=response;lower.toLowerCase();
  int i=lower.indexOf("\nlocation:");
  if(i<0)continue;i+=10;
  int end=lower.indexOf('\n',i);
  String url=response.substring(i,end<0?response.length():end);url.trim();
  if(locationOnRouter(url,gateway,base,location)){udp.stop();return true;}
 }
 udp.stop();return false;
}
static bool fetchDescription(const String&base,const String&location,String&service,String&control){
 WiFiClient client;HTTPClient http;
 http.setConnectTimeout(1200);http.setTimeout(2200);
 if(!http.begin(client,base+location))return false;
 int rc=http.GET();String xml=rc==200?http.getString():String();http.end();
 if(rc!=200||xml.length()>16000||xml.length()<100)return false;
 int i=0;
 while((i=xml.indexOf("<service>",i))>=0){
  int end=xml.indexOf("</service>",i);if(end<0)break;
  String item=xml.substring(i,end+10);i=end+10;
  if(item.indexOf("WANIPConnection")<0&&item.indexOf("WANPPPConnection")<0)continue;
  if(!extract(item,"<serviceType>","</serviceType>",service)||
     !extract(item,"<controlURL>","</controlURL>",control))continue;
  if(!service.startsWith("urn:schemas-upnp-org:service:WAN"))return false;
  // Relative gateway-only paths; never follow arbitrary URLs or cross-LAN targets.
  if(control.startsWith("http://")||control.startsWith("https://"))return false;
  if(control[0]!='/'){
   int last=location.lastIndexOf('/');
   control=location.substring(0,last+1)+control;
  }
  if(control.indexOf("..")>=0||control.indexOf('?')>=0||control.indexOf('#')>=0)return false;
  return true;
 }
 return false;
}
static bool addMapping(const String&base,const String&control,const String&service,
                       const IPAddress&ip,const uint32_t lease){
 const String body=String("<?xml version=\"1.0\" encoding=\"utf-8\"?>"
 "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">"
 "<s:Body><u:AddPortMapping xmlns:u=\"")+service+"\">"
 "<NewRemoteHost></NewRemoteHost><NewExternalPort>"+String(EXTERNAL_HTTP)+
 "</NewExternalPort><NewProtocol>TCP</NewProtocol><NewInternalPort>"+String(INTERNAL_HTTP)+
 "</NewInternalPort><NewInternalClient>"+ip.toString()+
 "</NewInternalClient><NewEnabled>1</NewEnabled>"
 "<NewPortMappingDescription>Jason Home 2 NanoC6</NewPortMappingDescription>"
 "<NewLeaseDuration>"+String(lease)+"</NewLeaseDuration></u:AddPortMapping></s:Body></s:Envelope>";
 WiFiClient client;HTTPClient http;
 http.setConnectTimeout(1200);http.setTimeout(2500);
 if(!http.begin(client,base+control))return false;
 http.addHeader("Content-Type","text/xml; charset=\"utf-8\"");
 http.addHeader("SOAPAction","\""+service+"#AddPortMapping\"");
 const int status=http.POST(body);http.end();
 return status==200;
}
static void mapper(void*){
 for(;;){
  if(WiFi.status()!=WL_CONNECTED){report("Wi-Fi disconnected; retrying UPnP when reconnected",false);
    vTaskDelay(pdMS_TO_TICKS(4000));continue;}
  IPAddress gateway=WiFi.gatewayIP(),local=WiFi.localIP();
  if(!gateway||!local){report("Waiting for router DHCP/gateway",false);vTaskDelay(pdMS_TO_TICKS(4000));continue;}
  if(lastGateway!=gateway||lastLocal!=local){lastGateway=gateway;lastLocal=local;lastRenew=0;}
  String base,location,service,control;
  if(!discovery(gateway,base,location)){report("Deco UPnP IGD discovery failed; enable UPnP in the Deco app",false);}
  else if(!fetchDescription(base,location,service,control)){report("Deco returned no compatible UPnP WAN connection service",false);}
  else if(!addMapping(base,control,service,local,LEASE)&&!addMapping(base,control,service,local,0)){
    report("Deco refused TCP 80 mapping; check port conflict and UPnP settings",false);
  }else report("Deco accepted TCP 80 -> NanoC6 TCP 80; WAN accessibility not independently verified",true);
  // Renew even an indefinite mapping so router reboot, lease expiry and DHCP
  // address changes never require a manual remap.
  vTaskDelay(pdMS_TO_TICKS(mapped?600000:60000));
 }
}
void portMappingRetry(){
 if(!guard)guard=xSemaphoreCreateMutex();
 if(!mapperTask)xTaskCreate(mapper,"jh2-upnp",8192,nullptr,1,&mapperTask);
}
void portMappingLoop(){} // Background task never blocks WebServer/BLE.
void portMappingStatus(JsonObject out){
 if(guard)xSemaphoreTake(guard,portMAX_DELAY);
 out["enabled"]=true;out["mapped"]=mapped;out["owned"]=mapped;
 out["externalReachabilityVerified"]=false;
 out["status"]=message;out["remoteUrl"]="http://craumer.tplinkdns.com/";
 out["protocol"]="TCP";out["externalPort"]=80;out["internalPort"]=80;
 out["leaseSeconds"]=LEASE;out["lastRenewSecondsAgo"]=lastRenew?(millis()-lastRenew)/1000:-1;
 if(guard)xSemaphoreGive(guard);
}
#endif
