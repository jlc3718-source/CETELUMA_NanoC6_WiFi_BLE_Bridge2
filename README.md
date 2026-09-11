# Anderson Home NanoC6 Light Controller

Current firmware: **v3.0.11**.

Canonical source: `firmware/`. The frozen Android app displays its web UI.

- NVS settings, schedules, colors, Shirley/Jason PINs, BLE control, signed OTA, and the dual-slot partition map are preserved.
- The approved dashboard, system monitor, brightness slider, asynchronous Wi-Fi scan, and independent firmware recovery remain available.
- While disconnected, retry saved Wi-Fi every 30 minutes; successful recovery closes the setup AP and renews time sync/mDNS. Restart after 1 hour of uptime, deferring during firmware updates. A restart ends PIN sessions and returns manual lighting to the saved schedule.
- Signed OTA checks start one minute after boot and repeat hourly. The system monitor displays the remaining time.
- Build-only JS/CSS minification and Zopfli gzip (500 iterations, unlimited block splitting) compress both embedded pages. Obsolete branding and demo event fallbacks are removed. Editable source, artwork, and size-focused compiler flags are retained.

Build dependencies: `python -m pip install -r tools/requirements-build.txt` and `npm ci --prefix tools --no-audit --no-fund`.

Release path: `python tools/release.py bump`, `python tools/release.py prepare`, `python tools/test_maintenance.py`, then push one `codex/` branch. CI produces `and_<version>.bin` plus exact-commit, checksum, and embedded-page provenance. `AGENTS.md` defines release/OTA verification and retention.

Normal update: automatic signed OTA. Manual fallback: Settings → Firmware Update with the APP-only BIN.
Serial recovery only: full image at **0x0**, Erase OFF. Never flash APP-only at 0x0.
