# Anderson Home NanoC6 Light Controller

Current firmware: **v3.0.27**.

Canonical source: `firmware/`. The frozen Android app displays its web UI.

- NVS settings, schedules, colors, Shirley/Jason PINs, BLE control, signed OTA, and the dual-slot partition map are preserved.
- Favorite Colors are the firmware-locked nine-color master palette. The UI renders them as labeled rectangular color tiles; add/delete controls are intentionally unavailable, and changing the palette requires a new firmware build.
- Home Scene Favorites default to the approved 28-scene list in the configured display order; favorites use the full 256-event state store rather than the legacy 64-bit mask.
- The approved dashboard, system monitor, brightness slider, asynchronous Wi-Fi scan, and independent firmware recovery remain available.
- Reboot once each day at **3:00 PM local controller time** when the clock is valid; the schedule initializes safely after boot so it cannot immediately re-fire in a reboot loop, and it defers during firmware-update/reboot activity. There is no unconditional uptime-based maintenance reboot. While disconnected with saved credentials, retry Wi-Fi every 30 seconds; after 10 continuous offline minutes, reboot as a last-resort recovery. Successful recovery cancels that watchdog, closes the setup AP, and renews time sync/mDNS.
- Signed OTA checks start one minute after boot and repeat hourly. The system monitor displays the remaining time.
- Build-only JS/CSS minification and Zopfli gzip (500 iterations, unlimited block splitting) compress both embedded pages. Obsolete branding and demo event fallbacks are removed. Editable source, artwork, and size-focused compiler flags are retained.

Build dependencies: `python -m pip install -r tools/requirements-build.txt` and `npm ci --prefix tools --no-audit --no-fund`.

Release path: `python tools/release.py bump`, `python tools/release.py prepare`, `python tools/test_maintenance.py`, then push one `codex/` branch. CI produces `and_<version>.bin` plus exact-commit, checksum, and embedded-page provenance. `AGENTS.md` defines release/OTA verification and retention.

Normal update: automatic signed OTA. Manual fallback: Settings → Firmware Update with the APP-only BIN.
Serial recovery only: full image at **0x0**, Erase OFF. Never flash APP-only at 0x0.
