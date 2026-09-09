# Anderson Home NanoC6 Light Controller

Current firmware: **v1.1.7**.

The repository now builds directly from the canonical `firmware/` source tree. The old sequential overlay pipeline is retired.

- Custom lights and schedules persist directly in NVS and are verified after writes.
- Saved custom lighting shows appear on Home with Preview, Enabled, and Favorite controls; disabling a show pauses its automatic calendar runs without deleting it.
- Optional four-digit Shirley/Jason PINs are verified by the NanoC6 with role-limited API sessions; PIN hashes remain in NVS rather than the UI or repository.
- Routine firmware uploads require Jason's active session when PIN protection is enabled.
- The independent APP-only recovery page accepts Jason's PIN without depending on the main profile interface and disables PIN protection after successful recovery.
- The editable UI is `firmware/web/index.html`; CI gzip-compresses it before compile.
- The proven ELK-BLEDDM / Lotus Lantern BLE implementation and dual-slot OTA layout are preserved.
- PlatformIO and the pioarduino platform revision are pinned.

Normal update: APP-ONLY through Settings → Firmware Update.

Serial recovery only: ALL-IN-ONE at **0x0**, Erase OFF. Do not flash APP-ONLY at 0x0.
