#pragma once
#include <Arduino.h>

// v2.0.3 is discovery-only: verify the signed manifest and report availability.
String remoteUpdateStatusJson(const char* currentVersion);
String remoteUpdateCheckJson(const char* currentVersion);
