#include "Common.h"
#include "FirmwareUpdate.h"
#include "LocalFirmware.h"
static bool attempted=false;
static uint32_t bootStarted=0;
void setup(){startNetwork();localFirmwareBegin();bootStarted=millis();}
void loop(){
  networkLoop();
  if(localFirmwareActive()){localFirmwareLoop();delay(2);return;}
  if(!attempted){
    Preferences n;n.begin("jh2-release",true);String encoded=n.getString("pending","");n.end();
    if(!encoded.length()){
      attempted=true;
      if(selectRuntime()){delay(100);ESP.restart();return;}
      Serial.println("No valid runtime or boot selection failed. Starting local recovery.");
      Preferences recovery;recovery.begin("jh2-release",false);recovery.putBool("local",true);recovery.end();
      ESP.restart();return;
    }
    if(WiFi.status()!=WL_CONNECTED||!timeValid()){
      if(millis()-bootStarted<90000){delay(5);return;}
      attempted=true;Serial.println("OTA timed out waiting for network/time. Returning to previous runtime.");
      recordFirmwareState("failed","Updater waited 90 seconds for network or time synchronization");
      Preferences clear;clear.begin("jh2-release",false);clear.remove("pending");clear.end();
      if(selectRuntime()){delay(100);ESP.restart();}
      else {clear.begin("jh2-release",false);clear.putBool("local",true);clear.end();ESP.restart();}
      return;
    }
    attempted=true;
    if(encoded.length()){
      JsonDocument pending;String error;
      if(deserializeJson(pending,encoded)){error="Invalid pending update";}
      else if(installFirmware(pending.as<JsonVariantConst>(),error)){Serial.println("Verified runtime installed.");delay(200);ESP.restart();}
      Serial.println("Update stopped: "+error);recordFirmwareState("failed",error);
      Preferences clear;clear.begin("jh2-release",false);clear.remove("pending");clear.end();
      if(selectRuntime()){delay(100);ESP.restart();}
      else {clear.begin("jh2-release",false);clear.putBool("local",true);clear.end();ESP.restart();}
    }
  }
  delay(5);
}
