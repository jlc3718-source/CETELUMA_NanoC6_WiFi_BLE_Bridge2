# Jason Home 2 NanoC6 1.0.6 — local curtain bridge

Oracle retains Eufy, schedules, AI and the full app. This firmware only manages local Wi-Fi, SmartDawn BLE, curtain sequences, Image/GIF Studio and updates. No port forwarding, UPnP or DDNS is used.

On home Wi-Fi open http://jason-home-2.local/. If no saved connection works for 60 seconds, connect to Jason-Home-2-Setup-* (password JasonHome2) and open http://192.168.4.1/setup. Local setup does not require an admin PIN.

## Update existing installation
Use Upload runtime BIN and choose jh2-runtime-1.0.6.bin. The permanent updater performs the write; NVS and the settings filesystem are preserved. Or use Check firmware update, then Install verified update. Keep power connected.

## USB recovery
The full image jh2-full-install-1.0.6.bin is flashed at 0x0 on ESP32-C6, 4 MB, DIO, 80 MHz. Full-flash replaces the filesystem and requires restoring settings; do not erase the chip if you want to retain NVS Wi-Fi. Runtime-only USB offset is 0x130000 and requires the existing compatible layout.

| Partition | Offset | Bytes |
|---|---|---|
| NVS | 0x9000 | 0x5000 |
| App selection | 0xE000 | 0x2000 |
| Permanent updater | 0x10000 | 0x120000 |
| One runtime | 0x130000 | 0x290000 |
| Settings filesystem | 0x3C0000 | 0x40000 |

No automatic image rollback exists in this single-runtime layout. Browser recovery or USB recovery is required after a failed write. Keep the prior 1.0.3 full installer. The local bridge interface includes curtain control and Image/GIF Studio; Oracle remote-to-bridge relay pairing still requires integration and hardware verification.
