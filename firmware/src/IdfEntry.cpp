#include "Arduino.h"
#include "nvs_flash.h"
#include "esp_log.h"
extern void setup();
extern void loop();
extern "C" void app_main(){
  static const char* TAG="anderson-idf";
  esp_err_t e=nvs_flash_init();
  if(e!=ESP_OK){
    // Never erase the production NVS partition automatically. Existing Wi-Fi,
    // PINs, schedules, controller pairings and customization data take priority
    // over booting a migration image that cannot open the established store.
    ESP_LOGE(TAG,"NVS init failed (%s); refusing destructive auto-repair",esp_err_to_name(e));
    return;
  }
  setup();
  for(;;)loop();
}
