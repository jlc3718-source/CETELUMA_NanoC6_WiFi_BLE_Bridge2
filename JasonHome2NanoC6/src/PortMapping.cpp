#include "PortMapping.h"
#include <WiFiUdp.h>

// UPnP IGD: one external TCP 80 -> this controller's TCP 80. Never replace
// another client's mapping. Firmware downloads and Eufy need no incoming ports.
static WiFiUDP ssdp;
static String controlUrl,serviceType,description,statusText="Waiting for activation",mappedIp;
static bool discovering=false,mapped=false,owned=false;
static uint32_t nextAttempt=0,discoveryUntil=0;
static const char* REMOTE="http://craumejl.tplinkdns.com";
static String tag(const String&xml,const String&name){
  // Accept the normal unprefixed tags and namespace-prefixed SOAP replies.
  int pos=0;while((pos=xml.indexOf('<',pos))>=0){int end=xml.indexOf('>',pos);if(end<0)return "";
    String n=xml.substring(pos+1,end);int space=n.indexOf(' ');if(space>=0)n=n.substring(0,space);int colon=n.indexOf(':');String local=colon>=0?n.substring(colon+1):n;
    if(local==name){int close=xml.indexOf("</"+n+">",end+1);if(close<0)return "";String value=xml.substring(end+1,close);value.trim();return value;}pos=end+1;
  }return "";
}
static bool gatewayUrl(const String&url){
  if(!url.startsWith("http://"))return false;
  String authority=url.substring(7);int slash=authority.indexOf('/');if(slash>=0)authority=authority.substring(0,slash);
  int colon=authority.indexOf(':');String host=colon>=0?authority.substring(0,colon):authority;
  if(host!=WiFi.gatewayIP().toString())return false;
  if(colon>=0){String port=authority.substring(colon+1);if(!port.length()||port.toInt()<1||port.toInt()>65535)return false;for(char c:port)if(c<'0'||c>'9')return false;}
  return true;
}
static bool getXml(const String&url,String&xml){
  if(!gatewayUrl(url))return false;NetworkClient client;HTTPClient http;http.setTimeout(2500);http.setConnectTimeout(1500);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  const char*hs[]={"Transfer-Encoding"};http.collectHeaders(hs,1);if(!http.begin(client,url))return false;int code=http.GET();bool ok=code==200&&readHttpText(http,xml,16384);http.end();return ok;
}
static int soap(const String&action,const String&args,String&xml){
  if(!gatewayUrl(controlUrl))return -1;NetworkClient client;HTTPClient http;http.setTimeout(2500);http.setConnectTimeout(1500);
  if(!http.begin(client,controlUrl))return -1;http.addHeader("Content-Type","text/xml; charset=\"utf-8\"");http.addHeader("SOAPAction","\""+serviceType+"#"+action+"\"");
  String body="<?xml version=\"1.0\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:"+action+" xmlns:u=\""+serviceType+"\">"+args+"</u:"+action+"></s:Body></s:Envelope>";
  const char*hs[]={"Transfer-Encoding"};http.collectHeaders(hs,1);int code=http.POST(body);xml="";bool readOk=code>0&&readHttpText(http,xml,8192);http.end();if(!readOk)return -1;
  if(code==200)return 0;int fault=tag(xml,"errorCode").toInt();return fault?fault:-1;
}
static String key(){return "<NewRemoteHost></NewRemoteHost><NewExternalPort>80</NewExternalPort><NewProtocol>TCP</NewProtocol>";}
static bool ours(const String&xml){return tag(xml,"NewPortMappingDescription")==description&&tag(xml,"NewInternalPort")=="80";}
static void mapPort(){
  String xml;int result=soap("GetSpecificPortMappingEntry",key(),xml);String ip=WiFi.localIP().toString();
  if(result==0){
    bool correct=tag(xml,"NewInternalClient")==ip&&tag(xml,"NewInternalPort")=="80"&&tag(xml,"NewEnabled")=="1";
    if(!ours(xml)&&!correct){mapped=false;owned=false;statusText="TCP port 80 is already assigned to another device. Existing mapping preserved.";return;}
    if(correct&&!ours(xml)){mapped=true;owned=false;mappedIp=ip;statusText="Existing TCP 80 mapping points to this NanoC6";return;}
  }else if(result!=714){mapped=false;statusText="Router could not check TCP 80 (UPnP "+String(result)+"). Use manual port forwarding.";return;}
  String args=key()+"<NewInternalPort>80</NewInternalPort><NewInternalClient>"+ip+"</NewInternalClient><NewEnabled>1</NewEnabled><NewPortMappingDescription>"+description+"</NewPortMappingDescription><NewLeaseDuration>3600</NewLeaseDuration>";
  result=soap("AddPortMapping",args,xml);if(result==725){args.replace(">3600<",">0<");result=soap("AddPortMapping",args,xml);}
  if(result!=0){mapped=false;owned=false;statusText=result==718?"Router reports TCP 80 is occupied. Existing mapping preserved.":"UPnP mapping failed ("+String(result)+"). Use manual forwarding for TCP 80.";return;}
  // Read back the rule before calling it mapped.
  result=soap("GetSpecificPortMappingEntry",key(),xml);mapped=result==0&&tag(xml,"NewInternalClient")==ip&&tag(xml,"NewInternalPort")=="80"&&tag(xml,"NewEnabled")=="1";
  owned=mapped&&ours(xml);mappedIp=ip;statusText=mapped?"Router mapping verified: TCP 80 → "+ip+":80. Test the public address using mobile data.":"Router accepted the request, but mapping readback failed";
}
static bool describeGateway(const String&url){
  String xml;if(!getXml(url,xml))return false;String base=tag(xml,"URLBase");if(!gatewayUrl(base))base=url;
  int pos=0;while((pos=xml.indexOf("<service>",pos))>=0){int end=xml.indexOf("</service>",pos);if(end<0)break;String entry=xml.substring(pos,end+10);pos=end+10;String type=tag(entry,"serviceType");
    if(type!="urn:schemas-upnp-org:service:WANIPConnection:1"&&type!="urn:schemas-upnp-org:service:WANIPConnection:2"&&type!="urn:schemas-upnp-org:service:WANPPPConnection:1")continue;
    String path=tag(entry,"controlURL"),full=path;if(!path.startsWith("http://")){int root=base.indexOf('/',7);String origin=root>=0?base.substring(0,root):base;if(path.startsWith("/"))full=origin+path;else{int slash=base.lastIndexOf('/');full=(slash>=7?base.substring(0,slash+1):origin+"/")+path;}}
    if(!gatewayUrl(full))continue;serviceType=type;controlUrl=full;return true;
  }return false;
}
void portMappingRetry(){nextAttempt=0;}
void portMappingStatus(JsonObject out){out["enabled"]=state["upnpEnabled"]|true;out["port"]=80;out["protocol"]="TCP";out["mapped"]=mapped;out["owned"]=owned;out["remoteUrl"]=REMOTE;out["status"]=statusText;out["externalReachabilityVerified"]=false;}
void portMappingLoop(){
  if(!description.length())description="JasonHome2-"+String((uint32_t)ESP.getEfuseMac(),HEX);
  bool enabled=activationEnabled&&(state["upnpEnabled"]|true)&&WiFi.status()==WL_CONNECTED;
  if(!enabled){
    if(discovering){ssdp.stop();discovering=false;}
    if(owned&&WiFi.status()==WL_CONNECTED){String xml;if(soap("GetSpecificPortMappingEntry",key(),xml)==0&&ours(xml))soap("DeletePortMapping",key(),xml);}
    mapped=false;owned=false;statusText=activationEnabled?"Automatic port mapping disabled":"Waiting for NanoC6 activation";return;
  }
  if(mapped&&mappedIp!=WiFi.localIP().toString()){mapped=false;nextAttempt=0;}
  if(discovering){
    int length=ssdp.parsePacket();if(length>0&&length<=2048){String response;while(ssdp.available())response+=(char)ssdp.read();String lower=response;lower.toLowerCase();int p=lower.indexOf("\r\nlocation:");if(p>=0){p+=11;int end=response.indexOf('\r',p);String location=response.substring(p,end);location.trim();if(describeGateway(location)){ssdp.stop();discovering=false;mapPort();nextAttempt=millis()+900000;return;}}}
    if((int32_t)(millis()-discoveryUntil)>=0){ssdp.stop();discovering=false;statusText="No UPnP gateway found. Enable UPnP on the router or forward TCP 80 manually.";nextAttempt=millis()+300000;}return;
  }
  if(nextAttempt&&(int32_t)(millis()-nextAttempt)<0)return;
  if(controlUrl.length()&&gatewayUrl(controlUrl)){mapPort();nextAttempt=millis()+900000;return;}
  if(!ssdp.begin(0)){statusText="UPnP discovery socket unavailable";nextAttempt=millis()+60000;return;}
  ssdp.beginPacket(IPAddress(239,255,255,250),1900);ssdp.print("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n\r\n");ssdp.endPacket();discovering=true;discoveryUntil=millis()+3000;statusText="Discovering router UPnP service…";
}
