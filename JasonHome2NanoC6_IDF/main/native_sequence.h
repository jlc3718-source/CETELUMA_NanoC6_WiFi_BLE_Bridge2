#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

bool jh2_native_sequence_start(const uint8_t *effects,size_t count,uint32_t interval_seconds);
void jh2_native_sequence_stop(void);
bool jh2_native_sequence_running(void);
