# CETELUMA NanoC6 Wi-Fi → BLE Light Bridge

Target: **M5Stack NanoC6 (ESP32-C6FH4, 4 MB flash)**.

This firmware leaves the existing 24 V CETELUMA installation and BLE controller untouched:

`Phone → 2.4 GHz Wi-Fi → NanoC6 → BLE → existing CETELUMA/LEDBLE controller → lights`

## Included features

- Approved simple dark CETELUMA web dashboard.
- Power, RGB color, brightness, effect/pattern and speed controls.
- Built-in presets plus up to 10 custom presets saved to nonvolatile flash.
- Custom preset recall includes color, brightness, pattern and speed.
- Wi-Fi scan/change from the web interface; no reflash when SSID/password changes.
- Wi-Fi credentials stored in ESP32 Preferences/NVS.
- Setup/recovery AP: `CETELUMA-Bridge-Setup`, password `ceteluma24`.
- Hold the NanoC6 GPIO9 button for ~5 seconds while firmware is running to start recovery setup mode.
- `http://ceteluma.local` on the home LAN when mDNS is available.
- BLE auto-scan/reconnect to compatible controllers advertising `LEDBLE*`, `LEDCAR*`, or `LEDDMX*`.
- FFE0/FFE1 9-byte protocol support for common LEDBLE dialect A and LEDCAR/LEDDMX RGBIC dialect B variants.

## Flash target

The requested delivery file is a **single merged/factory image** named:

`CETELUMA_NanoC6_WiFi_BLE_Bridge.bin`

It should be flashed at address **0x0000**.

## Build

Official M5Stack NanoC6 PlatformIO target:

```ini
board = esp32-c6-devkitc-1
framework = arduino
-D ARDUINO_USB_MODE=1
-D ARDUINO_USB_CDC_ON_BOOT=1
```

Build with PlatformIO, then merge bootloader + partition table + boot_app0 + firmware into one flash image at 0x0000 using the addresses from PlatformIO's generated flash arguments.

## First use

1. Flash the merged `.bin` at `0x0000`.
2. Reboot normally (do not hold GPIO9).
3. If no saved Wi-Fi exists, connect phone to `CETELUMA-Bridge-Setup` using password `ceteluma24`.
4. Open `http://192.168.4.1`.
5. Scan/select your 2.4 GHz Wi-Fi and tap **Save & Connect**.
6. On home Wi-Fi, open `http://ceteluma.local` or the bridge IP shown in your router.
7. The bridge automatically searches for the closest compatible LED controller.

## Important BLE note

The original LEDBLE phone app and this bridge generally should not try to hold the same BLE controller connection simultaneously. Fully close the original app if commands fail.
