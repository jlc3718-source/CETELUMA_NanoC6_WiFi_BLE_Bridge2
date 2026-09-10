# Anderson Lights development

Repository: `jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2`.
The canonical source is `firmware/`; the Android app displays its web UI.

## Fast delivery

The user requests minimal time from a change request to a finished BIN and
authorizes routine edits, commits, build branches, builds, artifact downloads,
and merging verified changes without repeated confirmation. Make reasonable
implementation choices. Deliver the finished APP-only binary; do not stop after
starting a build.

1. Start from the latest `main` source. Reuse the current handoff and this file,
   and read only files relevant to the requested change. Put the requested change
   set together on one `codex/` branch. Avoid reconstructing project history.
2. Keep changes focused. Run `python tools/release.py bump` once unless the user
   supplied a version, then `python tools/release.py prepare` plus focused checks
   for the changed behavior. Do not add unrelated refactors or dependency changes.
3. Push the exact change branch once the focused checks pass. Its push starts the
   cached GitHub Actions firmware build. Avoid duplicate builds and do not clear a
   working dependency/object cache.
4. Follow the build for the exact submitted revision. Verify the artifact manifest,
   version, SHA-256/digest, embedded UI/source provenance, and OTA-slot fit.
5. As soon as that exact branch build succeeds, download and give the user the
   verified APP-only BIN immediately. Do not wait for an identical `main` rebuild.
6. Retain exactly two Anderson firmware-build generations in GitHub Actions: the
   current successful firmware build plus the immediately previous successful
   firmware build. Delete all older completed workflow runs; their associated
   artifacts are deleted with them.
7. Retain exactly two stable Anderson GitHub Releases and BIN assets: the newest
   signed release plus one previous backup release. After a newer stable Anderson
   release is published, automatically delete older Anderson releases/assets while
   leaving Git tags/source history intact. The NanoC6 OTA slots likewise retain
   current firmware plus the immediately previous firmware.
8. Merge the verified change into `main` as part of the same task. If the merge
   changes firmware source, compiler inputs, generated UI inputs, dependencies, or
   other build inputs relative to the verified branch revision, rebuild and verify
   the resulting revision. Otherwise do not repeat an identical build.
9. Save the BIN as a user deliverable and provide the Settings → Firmware Update
   instruction unless remote installation is explicitly part of the requested task.
   Keep completion brief.

Skip optional checks after the changed behavior, successful compile, correct
artifact, and OTA fit have been established. Do not promise a fixed turnaround;
change complexity and the GitHub runner queue vary.

## Preserve these unless the user requests a change

- Existing Wi-Fi defaults/connection behavior, BLE frames/GATT, and partition map.
- Shirley/Kelly/Jason independent PINs, access rules, and protected recovery.
- Saved NVS key names and formats, events, colors, names, and effects.
- Effect IDs `Jump=0, Breath=1, Strobe=2, Gradient=3, Solid=4`.
- Software speeds `2000/1000/500/250/100 ms`; Solid holds the first palette color.

## Remote OTA behavior

- v2.0.6 and later periodically check the signed `ota/latest.json` channel after
  startup and every 15 minutes while Wi-Fi is available.
- A newer release is installed automatically only after the existing ECDSA manifest
  verification, version/URL/size checks, exact streamed SHA-256 verification, and
  successful write to the inactive OTA slot. Downgrades remain blocked.
- Keep the manual `Check for Remote Update`, `Install Verified Remote Update`, and
  local APP-only upload controls as recovery/fallback paths unless explicitly changed.
- Publish the exact verified branch artifact before advancing the signed OTA manifest;
  never advertise a BIN in `latest.json` before that release asset exists.
- Built-in event palettes are editable through saved per-event overrides. The UI must
  allow visible removal as well as addition of colors while keeping at least one color;
  preserve event identity, ordering, schedules, and unrelated event settings.

## Source map

- `firmware/web/index.html`: interface, previews, controls, profile UI.
- `firmware/src/main.cpp`: API routes, auth, NVS custom data, OTA, main loop.
- `firmware/src/RemoteUpdate.cpp`: signed remote-update discovery/download/install.
- `firmware/src/BleController.cpp`: dual-controller BLE and software effects.
- `firmware/src/Scheduler.cpp`, `EventCatalog.cpp`: timing/event resolution.
- `firmware/src/SettingsStore.cpp`: persistent device settings.
- `tools/release.py`, `.github/workflows/compile-anderson-home-multi.yml`: release path.
- `.github/scripts/anderson-retention.sh`, `.github/workflows/anderson-retention.yml`:
  current-plus-one build/release retention policy.
