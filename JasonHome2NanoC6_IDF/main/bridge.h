#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// A port of the existing outbound-only Oracle control-plane.
// Start only after native BLE accepts incoming read-only catalogs.
// All credentials loaded from the EXISTING non-formatted storage.
void jh2_bridge_start(void);
bool jh2_bridge_ready(void);
