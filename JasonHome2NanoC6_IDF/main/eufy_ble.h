#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "cJSON.h"
typedef enum { EUFY_BLE_POWER=1, EUFY_BLE_BRIGHTNESS=2, EUFY_BLE_COLOR=3, EUFY_BLE_PROBE=4 } eufy_ble_op;
typedef struct {
    const char *name;           /* Pool / House / Garage / Shed, validated */
    const char *mac;            /* exact MAC from saved Eufy controller */
    const char *serial;         /* exact factory 16-byte serial */
    const char *account_id;     /* private 40-byte Eufy account identifier */
    eufy_ble_op operation;
    bool on;
    uint8_t brightness, red, green, blue, lamp_count;
} eufy_ble_request;
void jh2_eufy_ble_host_ready(bool ready);
void jh2_eufy_ble_tick(void); /* caller's 1-second main loop, never the NimBLE callback */
bool jh2_eufy_ble_active(void);
/* Only one Eufy command at once. Blocks caller's Oracle bridge task, not BLE host. */
bool jh2_eufy_ble_execute(const eufy_ble_request *request, char *stage, size_t stage_len);
/* Trigger a non-invasive BLE advertisement scan; never touches lamp state. */
bool jh2_eufy_ble_rescan(char *status, size_t max_length);
void jh2_eufy_ble_status(cJSON *object); /* status only, never identity or secrets */
