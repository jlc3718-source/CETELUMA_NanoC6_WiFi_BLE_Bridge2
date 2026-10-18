#pragma once
#include <stdbool.h>
#include <stdint.h>

bool jh2_native_power(bool on);
bool jh2_native_brightness(int level);
bool jh2_native_speed(int value);
bool jh2_native_layout(int code);
bool jh2_native_effect(int id);
bool jh2_native_solid(uint32_t rgb,int brightness);
bool jh2_native_play(uint32_t cid,uint32_t slot);
