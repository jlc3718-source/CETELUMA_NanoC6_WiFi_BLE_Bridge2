#pragma once
#include <stdbool.h>
#include <stddef.h>
#include "cJSON.h"

// Validate the existing trusted signing key and exact release URL.
// Download firmware only to the INACTIVE OTA slot, then boot with rollback.
// The original independent factory rescue partition is preserved.
bool jh2_queue_signed_update(const cJSON *manifest,const char *current_version,
                             char *error,size_t error_capacity);
bool jh2_validate_signed_manifest(const cJSON *manifest,const char *current_version,
                                  char *version,size_t version_capacity,
                                  char *error,size_t error_capacity);

// Two-phase signed OTA: Check verifies manifest and downloads into INACTIVE
// OTA partition. Install only selects the staged, checksum-verified image.
// The factory rescue partition, NVS and LittleFS are never overwritten.
bool jh2_ota_stage_signed(const cJSON *manifest,const char *current_version,
                          char *error,size_t error_capacity);
bool jh2_ota_staged_ready(void);
bool jh2_ota_download_active(void);
bool jh2_ota_install_staged(char *error,size_t error_capacity);
void jh2_ota_status(cJSON *object);
