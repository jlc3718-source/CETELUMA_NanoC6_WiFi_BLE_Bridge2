#pragma once
#include <Arduino.h>

// Automatic one-time migration of pre-correction saved lighting colors.
bool runPaletteColorMigration();

// Admin recovery helpers. Original pre-migration colors stay backed up so the
// migration can be reversed or reapplied without compounding the correction.
bool restoreOriginalPaletteColors();
bool reapplyCorrectedPaletteColors();
String paletteColorMigrationStatusJson();
