#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <esp_system.h>

static WebServer server(80);
static esp_ota_handle_t otaHandle=0;
static const esp_partition_t* otaPartition=nullptr;
static bool otaStarted=false, otaOk=false, rebootPending=false;
static String otaError;
static uint32_t rebootAt=0;

static const char PAGE[] PROGMEM = R"HTML(<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Anderson OTA Bridge</title><style>body{font-family:system-ui;background:#06111d;color:#fff;max-width:620px;margin:30px auto;padding:18px}.card{background:#101b29;border:1px solid #2d5c82;border-radius:16px;padding:18px}input,button{width:100%;box-sizing:border-box;margin-top:12px;padding:14px;border-radius:10px}button{background:#168ee0;color:#fff;border:0;font-weight:700}.small{color:#a8b8c9;font-size:13px}</style></head><body><div class="card"><h2>Anderson OTA Bridge</h2><p>This bridge uses the ESP-IDF native OTA writer and does not use Arduino Update.end().</p><p class="small">Select the APP-only Anderson firmware BIN.</p><form method="POST" action="/update" enctype="multipart/form-data"><input type="file" name="firmware" accept=".bin,application/octet-stream" required><button type="submit">Install Firmware & Reboot</button></form><p><a style="color:#55baff" href="/status">Bridge status</a></p></div></body></html>)HTML";

static String errText(esp_err_t e){ char b[24]; snprintf(b,sizeof(b),"0x%08lX",(unsigned long)e); return String(b); }

static void connectNetwork(){
  Preferences p;
  String ssid,pass;
  if(p.begin("anderson",true)){ssid=p.getString("ssid","");pass=p.getString("pass","");p.end();}
  if(ssid.length()){
    WiFi.mode(WIFI_STA); WiFi.setSleep(false); WiFi.begin(ssid.c_str(),pass.c_str());
    uint32_t start=millis(); while(WiFi.status()!=WL_CONNECTED && millis()-start<15000){delay(200);}
  }
  if(WiFi.status()!=WL_CONNECTED){WiFi.mode(WIFI_AP_STA);WiFi.softAP("Anderson-OTA-Bridge","andersonhome");}
}

static void setupRoutes(){
  server.on("/",HTTP_GET,[]{server.sendHeader("Cache-Control","no-store");server.send_P(200,"text/html",PAGE);});
  server.on("/status",HTTP_GET,[]{
    const esp_partition_t* running=esp_ota_get_running_partition();
    String j="{\"bridge\":true,\"running\":\""+String(running?running->label:"unknown")+"\",\"ip\":\""+(WiFi.status()==WL_CONNECTED?WiFi.localIP().toString():WiFi.softAPIP().toString())+"\",\"otaStarted\":"+(otaStarted?"true":"false")+",\"otaOk\":"+(otaOk?"true":"false")+",\"error\":\""+otaError+"\"}";
    server.sendHeader("Cache-Control","no-store");server.send(200,"application/json",j);
  });
  server.on("/update",HTTP_POST,[]{
    if(otaOk){server.send(200,"text/html","<h2>Firmware installed successfully.</h2><p>Rebooting into the new Anderson firmware...</p>");rebootPending=true;rebootAt=millis()+1200;}
    else server.send(500,"text/plain",otaError.length()?otaError:"OTA failed");
  },[]{
    HTTPUpload& u=server.upload();
    if(u.status==UPLOAD_FILE_START){
      otaStarted=false;otaOk=false;otaError="";otaHandle=0;otaPartition=esp_ota_get_next_update_partition(nullptr);
      if(!otaPartition){otaError="No inactive OTA partition";return;}
      esp_err_t e=esp_ota_begin(otaPartition,OTA_SIZE_UNKNOWN,&otaHandle);
      if(e!=ESP_OK){otaError="esp_ota_begin failed: "+errText(e);return;}
      otaStarted=true;
    }else if(u.status==UPLOAD_FILE_WRITE){
      if(!otaStarted||otaError.length())return;
      esp_err_t e=esp_ota_write(otaHandle,u.buf,u.currentSize);
      if(e!=ESP_OK){otaError="esp_ota_write failed: "+errText(e);esp_ota_abort(otaHandle);otaStarted=false;}
    }else if(u.status==UPLOAD_FILE_END){
      if(!otaStarted||otaError.length())return;
      esp_err_t e=esp_ota_end(otaHandle);
      otaStarted=false;
      if(e!=ESP_OK){otaError="esp_ota_end failed: "+errText(e);return;}
      e=esp_ota_set_boot_partition(otaPartition);
      if(e!=ESP_OK){otaError="esp_ota_set_boot_partition failed: "+errText(e);return;}
      otaOk=true;
    }else if(u.status==UPLOAD_FILE_ABORTED){
      if(otaStarted)esp_ota_abort(otaHandle);otaStarted=false;otaError="Upload aborted";
    }
  });
  server.begin();
}

void setup(){
  Serial.begin(115200);delay(100);
  connectNetwork();
  setupRoutes();
}

void loop(){
  server.handleClient();
  if(rebootPending && (int32_t)(millis()-rebootAt)>=0){delay(50);ESP.restart();}
  delay(1);
}
