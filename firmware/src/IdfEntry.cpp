#include "Arduino.h"
#include "nvs_flash.h"
extern void setup();
extern void loop();
extern "C" void app_main(){esp_err_t e=nvs_flash_init();if(e==ESP_ERR_NVS_NO_FREE_PAGES||e==ESP_ERR_NVS_NEW_VERSION_FOUND){nvs_flash_erase();nvs_flash_init();}setup();for(;;)loop();}
