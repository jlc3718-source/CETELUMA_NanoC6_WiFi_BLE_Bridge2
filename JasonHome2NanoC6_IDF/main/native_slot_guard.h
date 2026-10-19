#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define JH2_TEST_CID 83929U
#define JH2_SLOT_COMMAND_UUID "01020074-1972-1925-3022-077119514e44"
#define JH2_SLOT_UPLOAD_UUID "27923001-2072-1925-3022-077119514e44"
typedef struct {
    uint32_t size, parts, next, last_ms;
    uint8_t id, type;
    bool active;
} jh2_slot_session;

// Validate on a COPY; commit that copy only after the GATT write succeeds.
// This accepts only the disposable test CID, never arbitrary storage writes.
bool jh2_slot_validate(jh2_slot_session *session, const char *uuid,
    const uint8_t *bytes, size_t len, uint32_t now_ms,
    bool target_section_known, unsigned matches, uint16_t target_slot,
    bool read_only, const char **error);
uint16_t jh2_slot_command_opcode(const uint8_t *bytes, size_t len);
