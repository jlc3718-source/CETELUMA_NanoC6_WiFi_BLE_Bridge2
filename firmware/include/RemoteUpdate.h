#pragma once
#include <Arduino.h>
String remoteUpdateStatusJson(const char* currentVersion);
String remoteUpdateCheckJson(const char* currentVersion);
String remoteUpdateInstallJson(const char* currentVersion);
String remoteUpdateResumeJson(const char* currentVersion);
void remoteUpdateAutoLoop(const char* currentVersion);
bool remoteUpdateBootCheck(const char* currentVersion,void (*idle)());
bool remoteUpdateConsumeRebootRequest();
void remoteUpdateNoteBoot(const char* currentVersion,const char* buildCommit);
bool remoteUpdateOperationBusy();
bool remoteUpdateTryClaimExternalOperation();
void remoteUpdateReleaseExternalOperation();
bool remoteUpdateSetRollbackHold(const char* rejectedVersion);
void remoteUpdateClearHold();
