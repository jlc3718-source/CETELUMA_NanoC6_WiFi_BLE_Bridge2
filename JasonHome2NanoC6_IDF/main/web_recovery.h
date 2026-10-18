#pragma once
#include <stdbool.h>
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
// Starts always: LAN web OTA, Setup AP, mDNS and shared Wi-Fi.
// The web portal survives any failure of Oracle or Bluetooth.
bool jh2_web_start(void);
EventGroupHandle_t jh2_web_wifi_group(void);
bool jh2_web_has_oracle_credentials(void);
void jh2_web_request_recovery(void);
bool jh2_web_recovery_requested(void);
