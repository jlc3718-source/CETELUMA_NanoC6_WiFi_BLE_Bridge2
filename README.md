# Anderson Home NanoC6 Light Controller

Current target: **M5Stack NanoC6 / ESP32-C6FH4 / 4 MB flash**.

The NanoC6 hosts the Anderson Home web interface and bridges Wi-Fi commands to the two existing ELK-BLEDDM / Lotus Lantern light controllers over BLE.

## Current architecture

- Two-controller BLE support with automatic reconnect after reboot.
- ELK-BLEDDM / Lotus Lantern FFF0 / FFF3 protocol support.
- Effects limited to Jump, Breath, Strobe, and Gradient.
- Events, favorites, custom lights, custom schedules, Wi-Fi settings, and controller identities persist across APP-ONLY OTA updates.
- Persistent custom-light and schedule data is stored in the dedicated SPIFFS data partition with an NVS mirror.
- Recovery AP remains `AndersonHome-Setup`.
- OTA firmware updates are available from **Settings → Firmware Update**.
- Firmware revision is tracked in `FIRMWARE_VERSION.txt` and displayed in the Settings tab.

## Flashing

Routine updates use the **APP-ONLY** binary through the Anderson Home firmware updater. No flash address is used for OTA updates.

For recovery or partition-layout migration only, use the **ALL-IN-ONE** image at:

`0x0000`

Do not flash an APP-ONLY image at `0x0000`.

## Repository layout

- `.github/workflows/compile-anderson-home-multi.yml` — current NanoC6 firmware build.
- `.github/workflows/build-anderson-home-app-v8-ddns-only.yml` — current Android DDNS wrapper build.
- `multi_overlay/` — only the current firmware transforms used by the active build.
- `android_overlay/` — Android wrapper helpers retained for future app updates.
- `Anderson_Home_Complete_Project.zip` — base project retained for Android builds.
- `FIRMWARE_VERSION.txt` — current firmware revision.
