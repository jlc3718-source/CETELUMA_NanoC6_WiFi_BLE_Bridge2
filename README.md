# Anderson Home NanoC6 Light Controller

Current firmware: **v1.1.4**.

The repository now builds directly from the canonical `firmware/` source tree. The old sequential overlay pipeline is retired.

- Custom lights and schedules persist directly in NVS and are verified after writes.
- The editable UI is `firmware/web/index.html`; CI gzip-compresses it before compile.
- The proven ELK-BLEDDM / Lotus Lantern BLE implementation and dual-slot OTA layout are preserved.
- PlatformIO and the pioarduino platform revision are pinned.

Normal update: APP-ONLY through Settings → Firmware Update.

Serial recovery only: ALL-IN-ONE at **0x0**, Erase OFF. Do not flash APP-ONLY at 0x0.
