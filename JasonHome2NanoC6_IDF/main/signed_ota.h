#pragma once
#include <stdbool.h>
#include <stddef.h>
#include "cJSON.h"

// Validate the existing trusted signing key and exact channel URL,
// persist a manual install request to the original permanent factory updater.
// Never downloads or writes app images from the running runtime.
bool jh2_queue_signed_update(const cJSON *manifest,const char *current_version,
                             char *error,size_t error_capacity);
bool jh2_validate_signed_manifest(const cJSON *manifest,const char *current_version,
                                  char *version,size_t version_capacity,
                                  char *error,size_t error_capacity);
