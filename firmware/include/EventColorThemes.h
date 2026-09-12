#pragma once
#include <Arduino.h>
#include "Types.h"

enum class EventColorTheme : uint8_t { Original=0, Modern=1 };
const char* eventColorThemeName(EventColorTheme theme);
void applyOriginalEventColors(size_t index, Theme& theme);
