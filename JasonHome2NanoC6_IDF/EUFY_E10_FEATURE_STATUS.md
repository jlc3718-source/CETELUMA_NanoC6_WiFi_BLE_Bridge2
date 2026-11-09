# Nano C6 — local Eufy BLE E10 implementation (in progress)

This branch is based on the **v2.0.10 native ESP-IDF source tag**, not the currently connected Nano v2.0.14. **Do not flash this branch over the working Nano.**

## Implemented and tested
- Eufy E120/T8L00 and E22/T8L02 GATT UUIDs.
- Strict 16-byte serial / 40-byte account-ID validation (no account ID in source).
- All five E10 handshake frames, corrected `A1 04 <time LE> A2 28 <40-byte account ID>` layout, sequence, XOR checksum and encrypted final handshake.
- AES-128-CBC session reply decryption and session-key capture only after validated `0x4822` notification.
- Encrypted E10 power ON/OFF (`0x0201`), brightness (`0x0201`), and solid RGB (`0x0206`) payloads, with E120 RGBW/E22 RGBCW distinction.
- Host unit tests using synthetic credentials and session key; no real account ID or keys stored.

Host test:
```sh
gcc -std=gnu11 -Wall -Wextra -Werror -DEUFY_E10_HOST_TEST \
  -I JasonHome2NanoC6_IDF/main \
  JasonHome2NanoC6_IDF/main/eufy_e10.c \
  JasonHome2NanoC6_IDF/tests/test_eufy_e10.c -lcrypto -o /tmp/e10-test
/tmp/e10-test
```

## NOT YET IMPLEMENTED — required before live control
1. Locate exact **Nano v2.0.14 production source**; do not regress BLE curtain streaming, local web, signed OTA, secure setup, network recovery or Oracle pairing by building older firmware.
2. Integrate a second NimBLE GATT connection path using `8c850001` service and `8c850002` write / `8c850003` notify. Subscribe CCCD and negotiate MTU before the E10 handshake; do not share SmartDawn `01020074` command characteristic with Eufy.
3. Add an isolated serialized Eufy command queue and explicit transport result ACK, with no repeated authentication attempts on failure. Prefer one Eufy connection at a time in addition to SmartDawn. Confirm ESP-IDF `CONFIG_BT_NIMBLE_MAX_CONNECTIONS` and available RAM.
4. Provision the existing 40-character Eufy account identifier securely from the authorized Oracle-side controller state, not via public JSON, firmware constants, logs or GitHub.
5. Add an authenticated Oracle → Nano command type, then Devices-tab controls with `BLE local / cloud fallback / unavailable` states, and preserve existing schedule/white-override authority.
6. Hardware-test Pool E120 ON/OFF first, then House E120, Garage E22, Shed E22; verify curtain remains connected and streaming. Verify color, brightness and command acknowledgements on physical LEDs.
7. Create a verified signed v2.0.15-or-later OTA using the **current** production source and production signer; install through the existing manual OTA path only after validation.

**Status:** Native encrypted Eufy frame codec implemented; GATT worker, live bridge integration and firmware deployment are not complete. This branch is intentionally non-deployable to production.
