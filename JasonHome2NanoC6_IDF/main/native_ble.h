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

// Channel 0 = SmartDawn command, channel 1 = GATT write-without-response.
bool jh2_ble_asset_packet(uint8_t channel,const uint8_t *bytes,size_t len);

// Restored local Bluetooth scan/select tools. Selected MAC is persisted in
// its own NVS namespace; other network/Oracle settings are untouched.
// A finite full scan lists advertisements without auto-connecting to a target.
// Previously selected devices are retained in nonvolatile memory.
bool jh2_ble_full_scan(void);
// Reconnect only the most recently selected Bluetooth controller.
bool jh2_ble_reconnect_last(void);
bool jh2_ble_scan_start(void);
bool jh2_ble_select_target(const char *mac);
bool jh2_ble_disconnect(void);
bool jh2_ble_target_slot_seen(uint16_t slot);

// A fresh terminal 80..N catalog page covers all custom test effects even
// when unrelated 40..79 factory pages are missing from the BLE receive path.
void jh2_ble_catalog_begin_read(void);
void jh2_ble_target_invalidate(void);
bool jh2_ble_target_section(unsigned *matches, uint16_t *slot);
// Per-CID inventory check for manufacturer-assigned SmartDawn animations.
// Returns false unless full factory coverage and a fresh terminal custom page exist.
bool jh2_ble_catalog_cid(uint32_t cid, unsigned *matches, uint16_t *slot);
uint32_t jh2_ble_notice_cursor(void);
bool jh2_ble_upload_reply(uint32_t *cursor,uint16_t opcode,uint8_t session,
                         uint32_t parts,uint32_t timeout_ms,const char **error);
// Throttle file packets against real 2933 controller receive progress.
bool jh2_ble_upload_progress(uint32_t *cursor,uint32_t parts,uint32_t min_completed,
                            uint32_t timeout_ms,const char **error);

// Read-only, controller-originated SmartDawn PlayProgressNotify (2630).
void jh2_ble_playback_status(cJSON *status);
