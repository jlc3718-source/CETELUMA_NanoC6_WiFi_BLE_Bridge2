#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// A port of the existing outbound-only Oracle control-plane.
// Start only after native BLE accepts incoming read-only catalogs.
// All credentials loaded from the EXISTING non-formatted storage.
void jh2_bridge_start(void);
bool jh2_bridge_ready(void);

// Query Oracle's existing signed firmware mirror. On install, verify the
// production signing key and then hand off to the permanent factory updater.
// Never download or replace the running OTA0 image in-place.
bool jh2_bridge_signed_firmware(bool install,char *version,size_t version_size,
                                char *error,size_t error_size);
