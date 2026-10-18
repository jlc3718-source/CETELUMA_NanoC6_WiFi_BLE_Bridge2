#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "cJSON.h"

// ESP-IDF native GATT control operations. No native command is accepted unless
// it is a known SmartDawn characteristic and the client is connected.
bool jh2_ble_raw_write(const char *characteristic_uuid,
                       const uint8_t *bytes,size_t len,uint32_t timeout_ms);
void jh2_ble_status(cJSON *obj);
uint32_t jh2_ble_collect_notices(cJSON *array,uint32_t after);
