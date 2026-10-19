#pragma once
#include <stdbool.h>
#include <stdint.h>

typedef void (*jh2_asset_ack_fn)(uint64_t id,const char *state,const char *message,bool ble_transmitted);
// Caller validates the SHA, byte count, endpoint and authenticated Oracle
// command identity before starting a transfer.
bool jh2_asset_stream_start(const char *oracle_endpoint,const char *bridge_token,
                            const char *sha256,uint32_t size,uint64_t command_id,
                            jh2_asset_ack_fn callback);
void jh2_asset_stream_stop(void);
bool jh2_asset_stream_active(void);
// Download and verify a bounded native file entirely in volatile RAM.
// Caller owns *out and frees it after the continuous local BLE transfer.
bool jh2_asset_fetch_ram(const char *endpoint,const char *token,
                        const char *sha,uint32_t size,uint8_t **out);

// Usable bytes for the next replacement animation (measured from LittleFS).
uint32_t jh2_asset_local_available_bytes(void);

// Live runtime-only multiplier; 100 keeps stored frame delays unchanged.
bool jh2_asset_stream_set_speed(uint16_t percent);
uint16_t jh2_asset_stream_get_speed(void);
