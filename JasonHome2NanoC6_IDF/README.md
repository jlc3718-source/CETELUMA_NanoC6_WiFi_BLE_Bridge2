# Jason Home 2 — native ESP-IDF migration (ESP32-C6)

## Phase 1: controller-inventory acceptance probe

This folder is a **new, isolated native Espressif ESP-IDF 5.5.1 project**.
It is intentionally not integrated into the existing Arduino + Oracle runtime and
**must not replace firmware 1.1.27 on the production NanoC6 yet**.

The user-proven reference is the phone's original Bluetooth HCI capture:
DN5E58, MTU 512, SmartDawn custom service
`00000074-1972-1925-3022-077119514e44`, GATT write
`01020074-1972-1925-3022-077119514e44`, notification
`01010074-1972-1925-3022-077119514e44`; read requests
`205 → 167 → 2904`; five native effect-list replies with
`20+20+20+20+8 = 88` entries. Earlier Nano releases
1.1.24/1.1.26 lost replies 34 and 35; 1.1.27 saw only the final
eight entries in the controlled physical test. These results were
observed on different reads and cannot be taken as permanent
controller loss.

### Implemented

- Bare ESP-IDF 5.5.1 C NimBLE GATT central, no Arduino dependency.
- Active scan for DN5E58, negotiate ATT MTU 517 (accept peer's actual
  negotiated value), discover service/characteristic/CCCD, subscribe.
- Read-only exact native 205, 167, 2904 request sequence, with
  GATT write acknowledgments and all raw notification lengths logged.
- Allocation-free, bounded EffectList field parser, including effect
  ID 0 and duplicate handling.
- Five-batch host test (all 88 effects) and ESP32-C6 build-only CI.
- Configured 544-byte host MSYS-2 receive blocks, while the HCI
  transport fragments stay managed by the ESP-IDF stack.
- No controller erase (2909), file transfer (2930), or playback commands.
- Does **not** erase NVS even on initialization failure.
- No Wi-Fi or Oracle credential handling in this diagnostic.
- No automatic OTA, firmware deployment, or production source changes.

### Acceptance gates (before any replacement on the production board)

1. ESP32-C6 native build and parser tests succeed.
2. On a separate test NanoC6 or during a clearly controlled
   maintenance window with restoration available, observe five complete
   native 2904 notifications, **88 distinct IDs from 0 to 87**, and
   stable BLE link. Repeat at least three reads after cold reconnect.
3. Add the authenticated Oracle outbound bridge and credential migration,
   Wi-Fi connectivity, live animation streaming, command ACK queue, manual
   firmware recovery, and Eufy/scheduler isolation. All must pass regression
   tests before production installation.
4. Retain firmware 1.1.27 and its verified full restore path until the
   IDF-based runtime is functionally equivalent.

### Build

Through the repository GitHub Actions workflow
`.github/workflows/jh2-idf-native-ble-probe.yml`. For local developers
with ESP-IDF 5.5.1 installed:

```bash
cd JasonHome2NanoC6_IDF
idf.py set-target esp32c6
idf.py build
```

The artifact `jh2_native_ble_probe.bin` is a **build-only laboratory
probe**, not an OTA image to install on the user's active Jason Home 2.
It has no Oracle communication or scheduling, so flashing it onto the
production Nano would intentionally interrupt current services.

### Migration design

Keep unchanged: existing Android APK, Oracle Node.js application,
event scheduling, Eufy authentication, image/GIF processing and
controller factory effects.

Replace incrementally: Arduino/NimBLE client → native ESP-IDF BLE
central → measured native notification capture → authenticated outbound
Oracle command relay → verified update/recovery mechanism. Preserve
the current 4 MB flash layout and saved settings in the final
runtime migration. The probe uses a separate build configuration and
**does not assert compatibility with the old Arduino updater**.
