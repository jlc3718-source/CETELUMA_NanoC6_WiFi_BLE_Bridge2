#include "Common.h"
#include "FirmwareUpdate.h"
#include "LocalFirmware.h"
static bool attempted=false;
void setup(){startNetwork();localFirmwareBegin();}
void loop(){
  networkLoop();
  if(localFirmwareActive()){localFirmwareLoop();delay(2);return;}
  if(!attempted&&WiFi.status()==WL_CONNECTED&&timeValid()){
    attempted=true;Preferences n;n.begin("jh2-release",true);String encoded=n.getString("pending","");n.end();
    if(encoded.length()){
      JsonDocument pending;String error;
      if(deserializeJson(pending,encoded))Serial.println("Invalid pending update; use USB installer.");
      else if(installFirmware(pending.as<JsonVariantConst>(),error)){Serial.println("Verified runtime installed.");delay(200);ESP.restart();}
      else Serial.println("Update stopped: "+error+". Reflash by USB if needed.");
    }else if(selectRuntime()){delay(100);ESP.restart();}
    else Serial.println("No valid runtime. Flash the full Jason Home 2 installer by USB.");
  }
  delay(5);
}
