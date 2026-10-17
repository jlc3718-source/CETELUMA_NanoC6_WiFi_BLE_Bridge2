#pragma once
#include <stddef.h>
#include <stdint.h>

#define JH2_FACTORY_EFFECTS 88
typedef struct {
    uint16_t values[JH2_FACTORY_EFFECTS];
    uint8_t found[JH2_FACTORY_EFFECTS];
    size_t count;
    uint16_t first;
    uint16_t last;
} jh2_catalog_batch;

// Input is a COMPLETE DDP EffectList (0xf0/0xf1, opcode 2904), without
// its four-byte SmartDawn transport envelope. Never writes to the controller.
// Returns zero on valid packet; negative for corrupt/unsupported packet.
int jh2_effectlist_parse(const uint8_t *ddp, size_t len, jh2_catalog_batch *out);
