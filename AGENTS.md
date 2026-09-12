# Anderson Lights development

Repository: `jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2`.
The canonical source is `firmware/`; the Android app displays its web UI.

## Fast delivery

The user requests minimal time from a change request to a finished BIN and
authorizes routine edits, commits, build branches, builds, artifact downloads,
publishing, signed OTA-channel advancement, and merging verified changes without
repeated confirmation. Make reasonable implementation choices. Deliver the finished
APP-only binary; do not stop after starting a build.

**Standard Anderson process:** once an authorized firmware/UI change starts, carry it straight through editing, focused validation, exact branch build, artifact verification, stable release publication, signed OTA-channel advancement, retention cleanup, merge to `main`, and delivery of the finished BIN without stopping for intermediate approval or status. Stop only for a genuine authorization, safety, or correctness blocker that requires the user.

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
6. Unless the user explicitly says the build is test-only or must not be deployed,
   automatically publish every newly verified firmware BIN as the newest stable
   Anderson GitHub Release and then advance the signed `ota/latest.json` manifest to
   that exact release. Do not wait for a separate request to publish it. Verify the
   public release asset exists and matches the exact version, byte size, SHA-256, and
   build commit before signing or advancing the OTA manifest.
7. Retain exactly two Anderson firmware-build generations in GitHub Actions: the
   current successful firmware build plus the immediately previous successful
   firmware build. Delete older completed production firmware/release workflow runs; their associated
   artifacts are deleted with them. Keep separate Android and test workflow artifacts.
8. Retain exactly two stable Anderson GitHub Releases and BIN assets: the newest
   signed release plus one previous backup release. After a newer stable Anderson
   release is published, automatically delete older Anderson releases/assets while
   leaving Git tags/source history intact. The NanoC6 OTA slots likewise retain
   current firmware plus the immediately previous firmware.
9. Merge the verified change into `main` as part of the same task. If the merge
   changes firmware source, compiler inputs, generated UI inputs, dependencies, or
   other build inputs relative to the verified branch revision, rebuild and verify
   the resulting revision. Otherwise do not repeat an identical build.
10. Save the BIN as a user deliverable. Normal finished firmware is already published
    for automatic OTA installation; mention the manual Settings → Firmware Update path
    only as a recovery/fallback option. Keep completion brief.

Skip optional checks after the changed behavior, successful compile, correct
artifact, OTA fit, stable release publication, and signed OTA-channel advancement
have been established. Do not promise a fixed turnaround; change complexity and the
GitHub runner queue vary.

## Preserve these unless the user requests a change

- Existing Wi-Fi defaults/connection behavior, BLE frames/GATT, and partition map.
- Shirley/Jason independent PINs, access rules, and protected recovery.
- Saved NVS key names and formats, events, colors, names, and effects.
- Effect IDs `Jump=0, Breath=1, Strobe=2, Gradient=3, Solid=4`.
- Software speeds `2000/1000/500/250/100 ms`; Solid holds the first palette color.
- Do not use an unconditional uptime-based maintenance reboot. Reboot at **00:00, 06:00, 12:00, and 18:00 local controller time** when the clock is valid. Each scheduled slot must fire at most once, initialize after boot/time-sync without immediately re-firing an already-passed slot, and defer while firmware update/reboot activity is active. System Monitor must show the next scheduled maintenance reboot and a live countdown. While saved Wi-Fi credentials exist and the controller is disconnected, retry the saved network every 30 seconds; if it remains continuously offline for 10 minutes despite retries, reboot as a last-resort recovery. Reset the offline watchdog immediately after reconnection.
- Successful Wi-Fi recovery must stop fallback AP mode and renew NTP/mDNS. Preserve saved credentials. Do not reboot repeatedly when no credentials are configured.
- v3.0.1 and later use the approved third-reference Anderson Home dashboard as the visual source of truth: illuminated nighttime house/RGB hero, integrated Anderson Home branding, dark translucent glass controls, prominent green ON control, rainbow brightness bar, effect/schedule cards, circular favorite colors, feature tiles, and floating bottom navigation. Do not regress to the generic logo-card/tab-bar layout unless the user explicitly requests it.
- Settings includes the v3.0.16 Live Color Tuning panel: an embedded RGB wheel with an exact live HEX/RGB readout, on-screen color preview, switchable live-to-lights updates, and an explicit Preview on Lights button. Tuning is temporary and must not silently save or rewrite event/theme colors.
- The Android APK is frozen; do not modify or rebuild it unless the user explicitly
  reverses that instruction. Normal Anderson changes belong in the firmware/web UI.
- The profile/login chooser must not show the emergency APP-only firmware recovery uploader; keep firmware recovery available through the existing backend/manual recovery paths only.

## Remote OTA behavior

- v2.0.6 and later periodically check the signed `ota/latest.json` channel after
  startup and every hour while Wi-Fi is available.
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

- v3.0.17 canonical calibrated event palette (exact LED RGB): Red #FF0000; Purple #23018C; Blue #05008A; Cyan #00BD4C; Pink #BF0005; Orange #FF2900; Yellow #FF6E00; Green #4DFF00. Built-in events, event overrides, custom saved lights, and schedules that reference those saved lights use these family codes. Existing Favorite Colors must remain untouched by palette migration. White, black, and intentional autumn browns remain distinct.
