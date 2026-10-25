#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define JH2_TEST_CID 83928U
#define JH2_SLOT_COMMAND_UUID "01020074-1972-1925-3022-077119514e44"
#define JH2_SLOT_UPLOAD_UUID "27923001-2072-1925-3022-077119514e44"
typedef struct {
    uint32_t size, parts, next, last_ms;
    uint8_t id, type;
    uint32_t cid;
    bool active;
} jh2_slot_session;

// Validate on a COPY; commit that copy only after the GATT write succeeds.
// For assigned CIDs, the caller supplies a fresh, per-CID controller-inventory result.
// Never authorize factory effect deletion or a duplicate stored CID.
bool jh2_slot_validate(jh2_slot_session *session, const char *uuid,
    const uint8_t *bytes, size_t len, uint32_t now_ms,
    bool target_section_known, unsigned matches, uint16_t target_slot,
    bool read_only, const char **error);
uint16_t jh2_slot_command_opcode(const uint8_t *bytes, size_t len);
// Discover the CID for a command, native upload header, or active data packet.
// The caller must cross-check it against a fresh controller inventory before writing.
uint32_t jh2_slot_packet_cid(const jh2_slot_session *session, const char *uuid,
    const uint8_t *bytes, size_t len);
