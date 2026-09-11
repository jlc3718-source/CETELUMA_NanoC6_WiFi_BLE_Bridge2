#pragma once
#include <Arduino.h>
#include <esp_task_wdt.h>

// Watch the application task itself, including waits that leave Wi-Fi/idle tasks
// alive. Feed during real firmware-upload progress, never from the BLE worker.
inline bool beginControllerWatchdog(){
  esp_task_wdt_config_t config{};
  config.timeout_ms=120000;
  config.idle_core_mask=(1U<<portNUM_PROCESSORS)-1U;
  config.trigger_panic=true;
  esp_err_t result=esp_task_wdt_reconfigure(&config);
  if(result==ESP_ERR_INVALID_STATE)result=esp_task_wdt_init(&config);
  if(result!=ESP_OK)return false;
  enableLoopWDT();
  return esp_task_wdt_status(nullptr)==ESP_OK;
}

inline void feedControllerWatchdog(){
  if(esp_task_wdt_status(nullptr)==ESP_OK)esp_task_wdt_reset();
}
