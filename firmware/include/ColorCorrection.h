#pragma once
#include <Arduino.h>

struct AndersonColorPaletteEntry {
  uint32_t reference;
  uint32_t output;
};

extern const AndersonColorPaletteEntry ANDERSON_COLOR_PALETTE[];
extern const size_t ANDERSON_COLOR_PALETTE_COUNT;

// Maps old named-palette payloads to recognizable named sRGB values; leaves arbitrary RGB untouched.
uint32_t andersonNamedOutputColor(uint32_t color);

// Maps an intended/pre-correction RGB value to the named LED-output palette.
// This is used for one-time saved-data migration, not in the animation loop.
uint32_t andersonCorrectColor(uint32_t original);
String andersonCorrectHex(const String& original);
