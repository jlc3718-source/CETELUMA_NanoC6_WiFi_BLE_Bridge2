#pragma once
#include <Arduino.h>

// v2.0.4: signed discovery plus manually-triggered verified remote OTA install.
String remoteUpdateStatusJson(const char* currentVersion);
String remoteUpdateCheckJson(const char* currentVersion);
String remoteUpdateInstallJson(const char* currentVersion);
bool remoteUpdateConsumeRebootRequest();
void remoteUpdateNoteBoot(const char* currentVersion);
