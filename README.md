# Anderson Home NanoC6 Light Controller

Current firmware: **v3.0.6**.

Canonical production source is `firmware/`. The Android app is a frozen web shell; normal Anderson changes belong in firmware/web or firmware controller source.

Production guarantees retained:
- NVS-backed settings, custom lights, schedules, event overrides, colors, and Shirley/Jason PIN profiles.
- Proven ELK/Lotus Lantern BLE control and dual-slot APP-only OTA layout.
- Signed remote OTA plus manual APP-only recovery/update paths.
- Approved v3 blue glass dashboard and embedded house artwork.

v3.0.6 is a size-optimization release. It keeps the existing source/API/UI behavior and enables size-focused release compiler/linker options without changing the partition map or saved-data formats.

Release path: update `FIRMWARE_VERSION.txt`, run `python tools/release.py prepare`, then push one `codex/` change branch. CI builds and verifies `and_<version>.bin`; `AGENTS.md` contains the authoritative continuation/release procedure and preserved-behavior requirements.

Normal update: automatic signed OTA or Settings → Firmware Update with the APP-only BIN.
Serial recovery only: full image at **0x0**, Erase OFF. Never flash APP-only at 0x0.
