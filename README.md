# Anderson Home NanoC6 Light Controller

Current firmware: **v1.1.6**.

The repository now builds directly from the canonical `firmware/` source tree. The old sequential overlay pipeline is retired.

- Custom lights and schedules persist directly in NVS and are verified after writes.
- Optional four-digit Shirley/Jason PINs are verified by the NanoC6 with role-limited API sessions; PIN hashes remain in NVS rather than the UI or repository.
- Lockout-safe APP-only recovery remains available before profile selection and disables PIN protection when used.
- The editable UI is `firmware/web/index.html`; CI gzip-compresses it before compile.
- The proven ELK-BLEDDM / Lotus Lantern BLE implementation and dual-slot OTA layout are preserved.
- PlatformIO and the pioarduino platform revision are pinned.

Normal update: APP-ONLY through Settings → Firmware Update.

Serial recovery only: ALL-IN-ONE at **0x0**, Erase OFF. Do not flash APP-ONLY at 0x0.
