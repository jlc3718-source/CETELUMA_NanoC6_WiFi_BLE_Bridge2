#pragma once
#include <Arduino.h>
#include "Types.h"

void customizedSettingsBackupBegin();
bool customizedSettingsBackupCreate(const AppSettings& settings,const char* firmwareVersion,bool automatic,String& error);
bool customizedSettingsBackupRestore(String& error);
String customizedSettingsBackupStatusJson();
void customizedSettingsBackupAutoLoop(const AppSettings& settings,const char* firmwareVersion);
