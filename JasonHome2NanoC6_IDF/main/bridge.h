#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// A port of the existing outbound-only Oracle control-plane.
// Start only after native BLE accepts incoming read-only catalogs.
// All credentials loaded from the EXISTING non-formatted storage.
void jh2_bridge_start(void);
bool jh2_bridge_ready(void);
// Persistent automatic signed OTA preference; verified factory updater only.
bool jh2_bridge_auto_update_enabled(void);
bool jh2_bridge_set_auto_update_enabled(bool enabled);

// Query Oracle's existing signed firmware mirror. On install, verify the
// production signing key and then hand off to the permanent factory updater.
// Never download or replace the running OTA0 image in-place.
bool jh2_bridge_signed_firmware(bool install,char *version,size_t version_size,
                                char *error,size_t error_size);

// Proxy one original manufacturer still thumbnail over the authenticated Oracle
// bridge. Caller owns *out and must free(); never exposes Oracle credentials.
bool jh2_bridge_factory_preview(uint8_t effect,uint8_t **out,size_t *length);
