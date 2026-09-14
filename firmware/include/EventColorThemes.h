#pragma once
#include <Arduino.h>
#include "Types.h"

enum class EventColorTheme : uint8_t { V3028=0, V3029=1 };
const char* eventColorThemeName(EventColorTheme theme);
const char* eventColorThemeId(EventColorTheme theme);
void applyOriginalEventColors(size_t index, Theme& theme);
void applyModernEventColors(Theme& theme);
void loadEventColorPresetOverrides();
size_t eventColorPresetCount(EventColorTheme theme);
const char* eventColorPresetName(size_t index);
uint32_t eventColorPresetValue(size_t index);
uint32_t eventColorPresetDefault(size_t index);
bool saveEventColorPreset(size_t index,uint32_t color);
