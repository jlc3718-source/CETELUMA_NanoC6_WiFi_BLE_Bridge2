# Anderson Lights development

Repository: `jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2`.
The canonical source is `firmware/`; the Android app displays its web UI.

## Fast delivery

The user requests minimal time from a change request to a finished BIN and
authorizes routine edits, commits, build branches, builds, and downloads without
repeated confirmation. Make reasonable implementation choices. Deliver the
finished APP-only binary; do not stop after starting a build.

1. Reuse the checkout. Fetch `main` once; if resuming an unfinished branch, retain
   that branch and check its relationship to `main`. Read only files relevant to
   the requested change. Avoid rediscovering this project through chat/file searches.
2. Edit, then run `python tools/release.py bump` once per new firmware revision.
3. Run `python tools/release.py prepare`. It checks versions, JavaScript, HTML IDs,
   and OTA layout and generates the compressed UI. Add focused behavior checks only
   for changed logic. Avoid repeated broad reviews or browser work for simple edits.
4. Commit all related edits together to a `codex/` branch. Its push starts the build;
   a PR is not needed just to trigger compilation. Prefer GitHub Actions over a cold
   local PlatformIO setup. The local `payload --base COMMIT` command emits a GitHub
   create-tree payload if only the connected GitHub tools have write access.
5. Follow the run for the exact submitted commit. Once it succeeds, obtain its
   artifact URL and digest. Use `tools/release.py download --url URL --digest DIGEST
   --commit SHA --output DIR`. The ZIP includes the APP-only image and a manifest.
   For this public repo, nightly.link can resolve the GitHub suite/artifact URL
   without browser sign-in; verify the digest returned by GitHub.
6. Save the BIN as a user deliverable and provide its link with the APP-only
   Settings → Firmware Update instruction. The user performs device installation
   unless separately requested. Keep the completion brief.

Skip optional checks after the changed behavior, successful compile, correct
artifact, and OTA fit have been established. Do not promise a fixed turnaround;
change complexity and the GitHub runner queue vary.

## Preserve these unless the user requests a change

- Existing Wi-Fi defaults/connection behavior, BLE frames/GATT, and partition map.
- Shirley/Kelly/Jason independent PINs, access rules, and protected recovery.
- Saved NVS key names and formats, events, colors, names, and effects.
- Effect IDs `Jump=0, Breath=1, Strobe=2, Gradient=3, Solid=4`.
- Software speeds `2000/1000/500/250/100 ms`; Solid holds the first palette color.

## Source map

- `firmware/web/index.html`: interface, previews, controls, profile UI.
- `firmware/src/main.cpp`: API routes, auth, NVS custom data, OTA, main loop.
- `firmware/src/BleController.cpp`: dual-controller BLE and software effects.
- `firmware/src/Scheduler.cpp`, `EventCatalog.cpp`: timing/event resolution.
- `firmware/src/SettingsStore.cpp`: persistent device settings.
- `tools/release.py`, `.github/workflows/compile-anderson-home-multi.yml`: release path.
