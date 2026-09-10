#pragma once
#include <Arduino.h>

// Signed discovery, verified manual install, and periodic automatic OTA install.
String remoteUpdateStatusJson(const char* currentVersion);
String remoteUpdateCheckJson(const char* currentVersion);
String remoteUpdateInstallJson(const char* currentVersion);
void remoteUpdateAutoLoop(const char* currentVersion);
bool remoteUpdateConsumeRebootRequest();
void remoteUpdateNoteBoot(const char* currentVersion);
