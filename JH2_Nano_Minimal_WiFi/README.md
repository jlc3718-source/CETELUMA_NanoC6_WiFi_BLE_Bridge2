# Jason Home 2 NanoC6 -- minimal Wi-Fi baseline 1.1.79

This is a standalone Wi-Fi-only diagnostic firmware, **not** the curtain controller or Oracle bridge software.
It deliberately contains **no Bluetooth, Oracle client, saved user secrets, signed OTA updater, or factory recovery loop**.

* Network always advertised: JH2-Nano-Fresh
* New WPA2 setup password: NanoFresh2026!
* Web setup page: http://192.168.4.1
* Web status: http://192.168.4.1/status
* User enters a 2.4 GHz home Wi-Fi SSID and password; settings go to NVS.
* The access point remains online regardless of connection success. No need to reboot to save.
* Runtime is the **same** in dual app slots with valid boot-selection records.
* Full 4 MB binary is flashed at **0x0**. It erases previous Nano settings.
* Normal ESP32-C6 serial logging at 115200 baud.

Before returning to Oracle/BLE service, verify this firmware can retain its setup AP and join home Wi-Fi. The previous SmartDawn features are intentionally not in this baseline.
