/* Eufy E120/T8L00 and E22/T8L02 E10 packet codec, for ESP-IDF Nano C6.
 * Transport and secure credential provisioning are handled by caller.
 * DO NOT embed account IDs, MAC addresses, or session keys in firmware source.
 */
#ifndef JH2_EUFY_E10_H
#define JH2_EUFY_E10_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#define EUFY_E10_FRAME_MAX 320
#define EUFY_E10_GATT_SERVICE "8c850001-0302-41c5-b46e-cf057c562025"
#define EUFY_E10_GATT_WRITE   "8c850002-0302-41c5-b46e-cf057c562025"
#define EUFY_E10_GATT_NOTIFY  "8c850003-0302-41c5-b46e-cf057c562025"
typedef struct {
    uint8_t serial_iv[16], account_id[40], initial_key[16], session_key[16];
    uint16_t sequence;
    bool session_valid;
    bool state_valid,state_has_power,state_has_brightness,state_has_segments,
         state_has_effect,state_has_cloud_effect,state_has_mode;
    bool state_power;
    uint8_t state_brightness,state_mode;
    uint16_t state_segments;
    uint32_t state_effect_id,state_cloud_effect_id;
    uint16_t last_ack_opcode;
    int8_t last_ack_result; /* -1 unknown, 0 accepted, >0 rejected */
    uint32_t state_generation,ack_generation;
} eufy_e10_t;
bool eufy_e10_init(eufy_e10_t *ctx, const char *serial16, const char *account40);
void eufy_e10_clear(eufy_e10_t *ctx);
int eufy_e10_handshake(eufy_e10_t *ctx, int step, uint32_t epoch_seconds,
                       uint8_t *out, size_t out_cap);
int eufy_e10_notification(eufy_e10_t *ctx, const uint8_t *input, size_t len);
int eufy_e10_power(eufy_e10_t *ctx, uint32_t epoch_seconds, bool on,
                   uint8_t *out, size_t cap);
int eufy_e10_brightness(eufy_e10_t *ctx, uint32_t epoch_seconds, uint8_t percent,
                        uint8_t *out, size_t cap);
/* -1 invalid, 0 handshake, 1 session key, 2 device ACK,
 * 3 unsolicited state report, 4 requested status response. */
int eufy_e10_read_status(eufy_e10_t *ctx,uint32_t epoch_seconds,uint8_t *out,size_t cap);
int eufy_e10_preset(eufy_e10_t *ctx,uint32_t epoch_seconds,
                    const uint8_t *tail,size_t tail_len,uint8_t *out,size_t cap);
int eufy_e10_dynamic(eufy_e10_t *ctx,uint32_t epoch_seconds,bool is_e22,
                     uint16_t effect_id,uint8_t speed,
                     uint8_t red,uint8_t green,uint8_t blue,
                     uint8_t lamps,uint8_t *out,size_t cap);
int eufy_e10_color(eufy_e10_t *ctx, uint32_t epoch_seconds, bool is_e22,
                   uint8_t red, uint8_t green, uint8_t blue, uint8_t lamps,
                   uint8_t *out, size_t cap);
#endif
