#pragma once
#include <Arduino.h>
#include "Types.h"

// Single-copy weekly backup/restore for user-customized Anderson settings.
void customizedSettingsBackupBegin();
bool customizedSettingsBackupCreate(const AppSettings& settings,const char* firmwareVersion,bool automatic,String& error);
bool customizedSettingsBackupRestore(String& error);
String customizedSettingsBackupStatusJson();
void customizedSettingsBackupAutoLoop(const AppSettings& settings,const char* firmwareVersion);
