#pragma once
#include "native_slot_guard.h"

#define JH2_NATIVE_RAM_LIMIT 131072U
typedef struct {
    void *context;
    bool (*write)(void *context,const uint8_t *packet,size_t len);
    bool (*reply)(void *context,uint16_t opcode,uint8_t id,uint32_t parts,const char **error);
    void (*pace)(void *context);
} jh2_slot_io;

// The whole authenticated file is already in RAM. No network calls occur
// between UploadRequest and the final data packet.
bool jh2_slot_transfer(const uint8_t *file,size_t size,uint8_t id,
    uint32_t now,bool known,unsigned matches,uint16_t slot,
    const jh2_slot_io *io,const char **error);
