#pragma once
#include <Arduino.h>

// Signed remote-update discovery and manually-triggered verified OTA install.
String remoteUpdateStatusJson(const char* currentVersion);
String remoteUpdateCheckJson(const char* currentVersion);
String remoteUpdateInstallJson(const char* currentVersion);
bool remoteUpdateConsumeRebootRequest();
void remoteUpdateNoteBoot(const char* currentVersion);
