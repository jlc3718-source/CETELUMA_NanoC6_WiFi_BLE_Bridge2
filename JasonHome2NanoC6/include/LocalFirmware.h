#pragma once
// Browser uploads run from the permanent updater, never from the runtime being replaced.
inline constexpr char JH2_RUNTIME_MARKER[]="jason-home-2-nanoc6-runtime-v1";
void registerLocalFirmware();
void localFirmwareBegin();
bool localFirmwareActive();
void localFirmwareLoop();
