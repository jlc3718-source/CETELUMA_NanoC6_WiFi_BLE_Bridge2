// Shared implementation compiled once through FirmwareUpdate.cpp in both apps.
#include "Common.h"
#include "LocalFirmware.h"
#include "RuntimeUploadProbe.h"
#include "FirmwareUpdate.h"
#include <esp_ota_ops.h>

#ifdef JH2_BOOT
#include "BoundedHttpBody.h"
#include <NetworkServer.h>
static NetworkServer uploadServer(80);
static bool recovery=false;
static String recoveryToken,recoveryPin;
static const char UPLOAD_PAGE[]=R"HTML(<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Jason Home 2 firmware</title><style>body{font:16px system-ui;background:#081321;color:#eef5ff;max-width:560px;margin:24px auto;padding:16px}input,button{box-sizing:border-box;width:100%;padding:12px;margin:10px 0;border-radius:10px}button{background:#70e0c4;border:0;font-weight:bold}progress{width:100%}</style><h1>Jason Home 2</h1><h2>Upload firmware</h2><p>The controller is ready for a runtime BIN. Keep power connected until verification finishes.</p><form id=f><input id=bin type=file accept=".bin,application/octet-stream" required><input id=pin type=password inputmode=numeric placeholder="Admin PIN, if requested" autocomplete=current-password><button id=go>Upload, verify and restart</button></form><progress id=p max=100 value=0></progress><p id=s>Choose jh2-runtime firmware. Settings and Wi-Fi are preserved.</p><script>
const $=id=>document.getElementById(id);$('f').onsubmit=async e=>{e.preventDefault();const file=$('bin').files[0];if(!file)return;
const data=new Uint8Array(await file.arrayBuffer()),marker=new TextEncoder().encode('jason-home-2-nanoc6-runtime-v1');let found=false;
for(let i=0;i<=data.length-marker.length;i++){if(data[i]!==marker[0])continue;let j=1;while(j<marker.length&&data[i+j]===marker[j])j++;if(j===marker.length){found=true;break;}}
if(data.length<=0x120000||data.length>0x290000||data[0]!==0xe9||data[12]!==13||data[13]!==0||!found){$('s').textContent='Choose a Jason Home 2 NanoC6 runtime BIN, version 1.0.3 or later.';return;}
const x=new XMLHttpRequest();x.open('POST','/firmware/upload');x.setRequestHeader('Content-Type','application/octet-stream');if($('pin').value)x.setRequestHeader('X-JH2-PIN',$('pin').value);x.timeout=240000;$('go').disabled=true;
x.upload.onprogress=e=>{if(e.lengthComputable){$('p').value=Math.round(e.loaded*100/e.total);$('s').textContent=$('p').value<100?'Uploading: '+$('p').value+'%':'Verifying firmware…';}};
x.onload=()=>{if(x.status===200){$('p').value=100;$('s').textContent='Firmware verified. Restarting; reopen the controller after it returns.';}else{$('go').disabled=false;$('s').textContent=x.responseText||'Upload failed. Retry here.';}};
x.onerror=x.ontimeout=()=>{$('go').disabled=false;$('s').textContent='Connection interrupted. Reconnect to the controller and retry this page.';};x.send(file);};
</script>)HTML";
static void sendResponse(NetworkClient&c,int code,const char*type,const String&body){
  c.printf("HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %u\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",code,code==200?"OK":"Error",type,(unsigned)body.length());c.print(body);
}
static bool readLine(NetworkClient&c,String&line,uint32_t started){
  line="";uint32_t idle=millis();while(c.connected()||c.available()){
    if(millis()-started>10000||millis()-idle>5000||line.length()>2048)return false;
    if(!c.available()){delay(1);continue;}int b=c.read();idle=millis();if(b=='\n'){line.trim();return true;}if(b!='\r')line+=(char)b;
  }return false;
}
static bool sessionCookie(const String&cookie){
  if(recoveryToken.length()<32)return false;int start=0;
  while(start<(int)cookie.length()){int end=cookie.indexOf(';',start);if(end<0)end=cookie.length();String part=cookie.substring(start,end);part.trim();if(part=="jh2_session="+recoveryToken)return true;start=end+1;}return false;
}
void localFirmwareBegin(){
  Preferences n;n.begin("jh2-release",true);recovery=n.getBool("local",false)||!runtimeValid();recoveryToken=n.getString("recoverToken","");recoveryPin=n.getString("recoverPin","");n.end();
  if(!recovery)return;WiFi.mode(WIFI_AP_STA);String ap="Jason-Home-2-Setup-"+String((uint32_t)ESP.getEfuseMac(),HEX);WiFi.softAP(ap.c_str(),"JasonHome2");uploadServer.begin();Serial.println("Jason Home 2 browser recovery: http://192.168.4.1/firmware");
}
bool localFirmwareActive(){return recovery;}
void localFirmwareLoop(){
  NetworkClient c=uploadServer.accept();if(!c)return;c.setTimeout(5);uint32_t started=millis();String first,line,cookie,pin;size_t length=0,totalHeaders=0;bool hasLength=false,bad=false,headersComplete=false;
  if(!readLine(c,first,started)){c.stop();return;}
  while(readLine(c,line,started)){
    if(!line.length()){headersComplete=true;break;}
    totalHeaders+=line.length();if(totalHeaders>8192){bad=true;break;}int colon=line.indexOf(':');if(colon<1){bad=true;break;}String key=line.substring(0,colon),value=line.substring(colon+1);key.toLowerCase();value.trim();
    if(key=="content-length"){if(hasLength||!value.length()){bad=true;break;}hasLength=true;for(char ch:value)if(ch<'0'||ch>'9')bad=true;length=strtoul(value.c_str(),nullptr,10);}
    else if(key=="transfer-encoding")bad=true;else if(key=="cookie")cookie=value;else if(key=="x-jh2-pin")pin=value;
  }
  if(bad||!headersComplete){sendResponse(c,400,"text/plain","Invalid upload headers");c.stop();return;}
  if(first=="GET /firmware/status HTTP/1.1"){sendResponse(c,200,"application/json","{\"mode\":\"recovery\"}");c.stop();return;}
  if(first.startsWith("GET ")){sendResponse(c,200,"text/html",UPLOAD_PAGE);c.stop();return;}
  if(first!="POST /firmware/upload HTTP/1.1"){sendResponse(c,404,"text/plain","Upload through /firmware");c.stop();return;}
  bool onSetupAp=c.localIP()==WiFi.softAPIP();
  if(!sessionCookie(cookie)&&!(recoveryPin.length()&&pin==recoveryPin)&&!(!recoveryPin.length()&&!recoveryToken.length()&&onSetupAp)){sendResponse(c,401,"text/plain","Enter the controller admin PIN and retry.");c.stop();return;}
  auto*part=esp_partition_find_first(ESP_PARTITION_TYPE_APP,ESP_PARTITION_SUBTYPE_APP_OTA_0,"runtime");
  if(!hasLength||!validRuntimeUploadSize(length)||!part||part->address!=0x130000||part->size!=0x290000||length>part->size||esp_ota_get_running_partition()->subtype!=ESP_PARTITION_SUBTYPE_APP_FACTORY){sendResponse(c,400,"text/plain","Wrong runtime size or flash layout");c.stop();return;}
  esp_ota_handle_t handle=0;bool opened=false;RuntimeUploadProbe probe;size_t total=0;const char*why=nullptr;
  bool ok=readBoundedHttpBody(c,(int)length,false,length,[&](const uint8_t*b,size_t size){
    size_t before=probe.headerSize(),received=size;probe.feed(b,size);
    if(!opened){if(!probe.headerComplete()){total+=received;return true;}if(!probe.validHeader())return false;if(esp_ota_begin(part,length,&handle)!=ESP_OK)return false;opened=true;
      if(esp_ota_write(handle,probe.header(),24)!=ESP_OK)return false;size_t consumed=24-before;b+=consumed;size-=consumed;
    }
    if(size&&esp_ota_write(handle,b,size)!=ESP_OK)return false;total+=received;return true;
  },[](){return millis();},[](){delay(1);},10000,240000,why);
  if(!ok||!probe.productFound()||total!=length){if(opened)esp_ota_abort(handle);sendResponse(c,400,"text/plain","Firmware upload incomplete or wrong product. Retry the correct runtime BIN here.");c.stop();return;}
  if(esp_ota_end(handle)!=ESP_OK||!selectRuntime()){sendResponse(c,400,"text/plain","ESP32-C6 firmware validation failed. Retry here.");c.stop();return;}
  Preferences n;n.begin("jh2-release",false);n.remove("local");n.remove("pending");n.remove("recoverToken");n.remove("recoverPin");n.end();sendResponse(c,200,"text/plain","Firmware verified. Restarting.");c.flush();c.stop();delay(300);ESP.restart();
}
#else
static bool firmwareAccess(){return authorized()||(!String(secrets["ssid"]|"").length()&&!String(secrets["pin"]|"").length()&&web.client().localIP()==WiFi.softAPIP());}
void registerLocalFirmware(){
  Serial.println(JH2_RUNTIME_MARKER);
  auto page=[](){if(!firmwareAccess())return replyError(401,"Sign in at /login first");web.send(200,"text/html",R"HTML(<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Jason Home 2 firmware</title><style>body{font:16px system-ui;background:#081321;color:#eef5ff;max-width:560px;margin:24px auto;padding:16px}button{width:100%;padding:14px;background:#70e0c4;border:0;border-radius:10px;font-weight:bold}a{color:#70e0c4}</style><h1>Jason Home 2</h1><h2>Firmware upload</h2><p>Open the protected uploader, then choose a Jason Home 2 NanoC6 runtime BIN. Wi-Fi and saved settings are preserved.</p><button id=go>Open firmware uploader</button><p id=s></p><a href="/">Back to controller</a><script>document.getElementById('go').onclick=async()=>{const s=document.getElementById('s');try{const r=await fetch('/firmware/recovery',{method:'POST'});if(!r.ok)throw Error(await r.text());document.getElementById('go').disabled=true;s.textContent='Restarting into the uploader. Stay on this Wi-Fi; reconnect to the setup network if needed.';let n=0;const poll=async()=>{try{const r=await fetch('/firmware/status',{cache:'no-store'});if(r.ok&&(await r.json()).mode==='recovery'){location.reload();return;}}catch{}if(++n<90)setTimeout(poll,1000);else s.textContent='Reconnect to the controller and reopen /firmware.';};setTimeout(poll,2000);}catch(e){s.textContent=e.message;}};</script>)HTML");};
  web.on("/firmware",HTTP_GET,page);web.on("/recovery",HTTP_GET,page);
  web.on("/jason-home-2/firmware",HTTP_GET,page);web.on("/jason-home-2/recovery",HTTP_GET,page);
  web.on("/firmware/recovery",HTTP_POST,[]{
    if(!firmwareAccess())return replyError(401,"Sign in first");auto*boot=esp_partition_find_first(ESP_PARTITION_TYPE_APP,ESP_PARTITION_SUBTYPE_APP_FACTORY,"boot");
    if(!boot||boot->address!=0x10000||boot->size!=0x120000)return replyError(500,"Wrong updater partition");
    Preferences n;if(!n.begin("jh2-release",false))return replyError(500,"Updater request could not be saved");
    bool saved=n.putString("recoverToken",apiToken)==apiToken.length();String pin=secrets["pin"]|String("");if(pin.length())saved=n.putString("recoverPin",pin)==pin.length()&&saved;else n.remove("recoverPin");
    n.remove("pending");saved=n.putBool("local",true)>0&&saved;n.end();
    if(!saved||esp_ota_set_boot_partition(boot)!=ESP_OK)return replyError(500,"Could not start browser uploader");
    web.sendHeader("Set-Cookie","jh2_session="+apiToken+"; HttpOnly; SameSite=Strict; Path=/");web.send(202,"application/json","{\"ok\":true,\"rebootingToUploader\":true}");delay(400);ESP.restart();
  });
}
#endif
