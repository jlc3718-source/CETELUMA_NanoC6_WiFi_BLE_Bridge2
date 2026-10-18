# Jason Home 2 native ESP-IDF — physical acceptance checkpoint (2026-10-17 EDT)

## Current implementation
- Branch: `codex/jh2-native-espidf-integration-audit-20261017`
- Last compiled code revision: `bb01fa0fecfaa42efd6453273d60e2d8bb88f86b`
- Exact successful GitHub Actions run: https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/actions/runs/39085672095
- Both ESP-IDF v5.5.1 ESP32-C6 matrix builds passed. They are build-only and **not deployed**.
- An in-repo docs-only commit after this revision does not change firmware binaries.
- Production 1.1.27 on existing NanoC6 must be treated as active until physical evidence shows otherwise.

## Acceptance artifact SHA256 (from GitHub Actions build logs)
- Oracle **disabled** serial-only read-only inventory: `9b9c96ac08085d110842fc24cb5551ca4b9306a50e49da212a59e74dc4df99b6`
- Oracle **enabled** read-only inventory with authenticated HTTPS: `fc75df391ab03a12c77c387d7a9e5ed9f278cbc347f279548cb5f8d139424aa6`
- Both extracted app binaries share the filename `jh2_native_ble_probe.bin` — keep them in separate directories.
- Artifact names: `JH2-Native-ESP-IDF-Integration-disabled-BUILD-ONLY`, `JH2-Native-ESP-IDF-Integration-enabled-BUILD-ONLY`.

## Production restoration
- Release: https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/releases/tag/jason-home-2-nanoc6-v1.1.27
- Original app-only `jh2-runtime-1.1.27.bin` SHA256: `be59508504005fa92c8bcf47f10bc163d09072d38f0c8938d9a46387389d9bb7`
- Full 4 MiB recovery `jh2-full-install-1.1.27.bin` is available as a last resort, but wiping/replacing 4 MiB overwrites stored credentials; backup first.
- Partition offsets on original 4 MiB: boot/factory `0x10000`, runtime OTA0 `0x130000` (max size `0x290000`), NVS `0x9000`, storage LittleFS `0x3c0000`.
- **CRITICAL**: ESP-IDF `idf.py flash` generated default flashes to `0x10000` (factory slot). Never run that command for native acceptance.
- For APP-only over USB: `python -m esptool --chip esp32c6 --port COMx write-flash 0x130000 <verified app-only bin>`.
- Before any writes, read out full 4 MiB with `read-flash 0x0 0x400000 <private-backup>`; do not upload the backup because it includes credentials.
- A self-contained Windows PowerShell safe-flash kit with exact SHA256 checks and full backup was created in the ChatGPT conversation, filename `JH2_Native_ESP_IDF_Safe_Field_Test_Kit.zip`. It is NOT hosted in this GitHub repo.

## Test order / pass criteria
1. Verify correct serial COM port, stable data USB connection, and complete private 4 MiB flash backup.
2. First flash **Oracle-disabled** serial-only image to OTA0. Capture USB logs, expect SmartDawn `DN5E58` connection, negotiated MTU >=399 (prefer 512), complete five catalog notifications and **88 unique catalog IDs**, no drops. Repeat three cold reconnects. Do not delete (2909), upload, or write a CID.
3. Only after step 2 passes, flash **Oracle-enabled read-only** image to OTA0. It uses saved Wi-Fi and Oracle credentials but rejects ordinary power/effect/asset/sequence/OTA actions; expect `status.curtain.nativeCatalogUnique`, `nativeCatalogPackets`, `nativeCatalogComplete88` and notifications in existing sync. Temporarily test in a maintenance window to avoid Oracle desired-state interference.
4. Restore 1.1.27 original app-only image after testing until separate hardware write/play and signed manual OTA validation.
5. Do not release signed production v1.1.28 until full BLE/Oracle/40x40 effect/rollback tests pass. Automatic OTA remains disabled.

## Known limitations
- The test uses one physical NanoC6, no spare unit.
- Neither GitHub compilation nor an oracle-enabled status proves the 88 IDs were actually received on physical hardware.
- The first serial-only probe cannot connect to Oracle; recovery requires USB or factory updater.
- Native assets now preverify a full authenticated SHA-256 download before BLE TX, but end-to-end image/GATT/loop cancellation still require hardware testing.
- Native recovery module compiles, but full browser-based updater handoff has **not** been exercised on hardware.
- Project must retain original permanent updater, app recovery and Eufy schedules; do not erase or overwrite curtain factory effects.
