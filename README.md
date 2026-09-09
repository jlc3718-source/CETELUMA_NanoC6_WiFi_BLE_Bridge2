# Anderson Home NanoC6 Light Controller

Target: **M5Stack NanoC6 / ESP32-C6FH4, 4 MB flash**.

Current production firmware keeps the OTA partition layout intact and supports app-only updates through Settings.

## Current features
- Anderson Home web UI with blue background.
- Two saved ELK-BLEDDM / Lotus Lantern BLE controllers with automatic reconnect.
- Jump, Breath, Strobe, and Gradient effects.
- Custom lights and custom schedules with persistent SPIFFS storage plus NVS mirrors.
- Persistent settings backup outside the OTA app slots.
- Firmware revision displayed in Settings.
- Automatic OTA upload, validation, reboot, reconnect, and detailed update-stage status.

## Updating
Routine releases use the **APP-ONLY** `.bin` from Settings → Firmware Update.

A full merged image is for recovery only and must be flashed at **0x0 with Erase OFF** unless a future release explicitly changes the partition layout.
