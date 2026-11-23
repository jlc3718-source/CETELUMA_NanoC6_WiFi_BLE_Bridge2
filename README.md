# Anderson Home NanoC6 Light Controller

Current Anderson firmware source: **v3.1.100**. Restores all 16 original calibrated LED RGB values from v3.1.94; named colors now affect only browser swatches/previews. The firmware keeps the verified security and toolchain fixes from v3.1.95.

v3.1.100: Adds structured GitHub scene snapshots (scene name, source, effect, requested RGB palette, power, brightness, speed, controller target) and exact BLE frames on the existing sampled successful-write events. Existing log codes, frequencies, and uploads remain enabled. Scheduler changes now detect same-name RGB palette updates.

Canonical source: `firmware/`. The frozen Android app displays its web UI.

WLED Wi-Fi controllers are supported per House/Garage slot. Existing Bluetooth setup remains active until explicitly changed. See [WLED setup and arrival checks](docs/WLED_SETUP.md).

- NVS settings, schedules, colors, Shirley/Jason PINs, BLE control, signed OTA, and the dual-slot partition map are preserved.
- Favorite Colors are the firmware-locked sixteen-color master palette. The UI renders them as labeled rectangular color tiles; add/delete controls are intentionally unavailable, and changing the palette requires a new firmware build.
- Home Scene Favorites default to the approved 28-scene list in the configured display order; favorites use the full 256-event state store rather than the legacy 64-bit mask.
- The approved dashboard, system monitor, brightness slider, asynchronous Wi-Fi scan, and independent firmware recovery remain available.
- Reboot once each day at **3:00 PM local controller time** when the clock is valid; the schedule initializes safely after boot so it cannot immediately re-fire in a reboot loop, and it defers during firmware-update/reboot activity. There is no unconditional uptime-based maintenance reboot. While disconnected with saved credentials, retry Wi-Fi every 30 seconds; after 10 continuous offline minutes, reboot as a last-resort recovery. Successful recovery cancels that watchdog, closes the setup AP, and renews time sync/mDNS.
- Signed OTA checks start 20 seconds after boot and repeat hourly. The system monitor displays the remaining time.
- Build-only JS/CSS minification and Zopfli gzip (1000 iterations, unlimited block splitting) compress both embedded pages. Obsolete branding and demo event fallbacks are removed. Editable source, artwork, and size-focused compiler flags are retained.

Build dependencies: `python -m pip install -r tools/requirements-build.txt` and `npm ci --prefix tools --no-audit --no-fund`.

Release path: `python tools/release.py bump`, `python tools/release.py prepare`, `python tools/test_maintenance.py`, then push one `codex/release-current` branch. CI produces `and_<version>.bin` plus exact-commit, checksum, and embedded-page provenance. `AGENTS.md` defines release/OTA verification, Anderson retention and the separate Jason Home 2 housekeeping policy.

Normal update: automatic signed OTA. Manual fallback: Settings → Firmware Update with the APP-only BIN.
Serial recovery only: full image at **0x0**, Erase OFF. Never flash APP-only at 0x0.

## Oracle diagnostics (v3.1.98)

A separate HTTPS diagnostic receiver runs on Oracle at `https://oracle-home-dev.150.136.245.51.sslip.io/anderson-logs/` with its own SQLite database, ingestion credentials and read/export credentials. It does not modify Jason Home 2 or the frozen Android APK. The Nano uses an asynchronous RAM ring of 24 significant events and sends batches over certificate-verified TLS only when an administrator pairs it in Anderson Home → Settings → Oracle Diagnostics. Configure the one-time private ingest token via that panel; it is never returned by the API or written to Git. The receive token resides only in Oracle's root-protected service data directory. Data exports are restricted to the separate admin token; detailed provisioning must be performed through a trusted Oracle administrator session. The release does not automatically enroll a device or claim physical diagnostic delivery before pairing.


## Direct GitHub diagnostics (v3.1.98)

Controller logs upload directly over certificate-validated HTTPS to the **private** `jlc3718-source/anderson-home-diagnostics` repository. No Oracle relay. Settings → GitHub Diagnostics accepts one fine-grained GitHub token with **Contents read/write permission limited to the diagnostics repository**. The token remains in controller NVS and is not included in releases or status JSON. Device uploads time-grouped immutable JSON files under `events/YYYY-MM-DD/` containing command, BLE/WLED outcome, connection, restart, Wi-Fi and status events. The legacy Oracle receiver is unused by this firmware. Authentication must be configured on the controller once; until then no events are uploaded.


## v3.1.99 GitHub HTTPS upload trust fix

Keep verified TLS enabled for direct GitHub logs. Include the current Sectigo Public Server Authentication Root E46 trust certificate (seen on `api.github.com` on 2026-11-23) in addition to the DigiCert trust roots; no changes to gamma calibration, BLE/WLED commands, or authentication permissions.
