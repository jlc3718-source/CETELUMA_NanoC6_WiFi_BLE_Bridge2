# Anderson Home NanoC6 Light Controller

Current release: **v1.1.0**

Target: **M5Stack NanoC6 / ESP32-C6FH4, 4 MB flash**.

## Production structure
The repository is intentionally reduced to the current production firmware path. The hardware-proven core is reconstructed from its historical baseline commit, then only the active production overlays are applied.

Active release code:
- `custom_light_schedule.py` — custom light/schedule model and routes.
- `ui_custom_lights.py` — custom light and schedule UI.
- `favorites_speed_schedule_remote.py` — favorites, speed, scheduling, and remote-facing behavior.
- `littlefs_master_storage.py` — master persistent configuration and LittleFS-backed storage.
- `storage_hard_fix.py` — verified custom storage and NVS mirror fallback.
- `auto_ota_reboot.py` — OTA upload, validation, reboot, and reconnect.
- `release_finalize.py` — consolidated release finalization: open-control compatibility, scheduler settings sync, blue UI, hidden Lights tab, and firmware revision display.

Obsolete authentication, red-theme, compatibility-only, no-op storage, duplicate UI-sync, and old workflow code has been removed from the current branch.

## Updating
Routine releases use the **APP-ONLY** `and_<version>.bin` through **Settings → Firmware Update**.

The full merged recovery image is `and_<version>_full.bin` and is only for recovery. Flash the full image at **0x0 with Erase OFF** unless a future release explicitly changes the partition layout.
