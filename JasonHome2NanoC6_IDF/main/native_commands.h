#pragma once
#include <stdbool.h>
#include <stdint.h>

// Use the same manufacturer packet envelope and transaction sequencing as normal commands.
// Only supported non-destructive handshake/catalog opcodes may be sent.
bool jh2_native_read(uint16_t opcode);
// Reboot the paired SmartDawn curtain controller (2599), not the Nano.
// This is an opt-in command and must never be sent automatically.
bool jh2_native_curtain_reboot(void);
bool jh2_native_power(bool on);
bool jh2_native_brightness(int level);
bool jh2_native_speed(int value);
bool jh2_native_layout(int code);
bool jh2_native_effect(int id);
bool jh2_native_solid(uint32_t rgb,int brightness);
bool jh2_native_play(uint32_t cid,uint32_t slot);
