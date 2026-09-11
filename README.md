# Anderson Home NanoC6 Light Controller

Current firmware: **v3.0.4**.

The repository now builds directly from the canonical `firmware/` source tree. The old sequential overlay pipeline is retired.

- Custom lights and schedules persist directly in NVS and are verified after writes.
- Saved custom lighting shows appear on Home with Preview, Enabled, and Favorite controls; disabling a show pauses its automatic calendar runs without deleting it.
- v2.0 resets the Home favorites baseline once on upgrade so every built-in Holiday is favorited and Awareness/Seasonal/custom-show favorites are cleared; favorites remain user-editable afterward.
- v2.0.0a trims production-only debug/diagnostic code and legacy non-ELK BLE command families while preserving the Anderson ELK/Lotus Lantern control path and saved-data keys.
- Optional, independent four-digit Shirley/Jason PINs are verified by the NanoC6 with role-limited API sessions; Shirley receives Home/Events access while Jason retains all controls.
- Routine firmware uploads require Jason's active session when PIN protection is enabled.
- The independent APP-only recovery page accepts Jason's PIN without depending on the main profile interface and disables PIN protection after successful recovery.
- The interface combines `firmware/web/index.html`, `v3_mockup.css`, `v3_mockup.js`, and the embedded reference artwork; CI composes and compresses the exact page before compilation.
- v3.0.4 places the live animated house beside Current Effect, moves Schedule into a full-width glass panel below, and removes the larger lower preview. The animation continues to use the running theme, power, brightness, and speed.
- v3.0.3 recomposes the reference house/logo artwork, blue glass dashboard, profile chooser, effect/schedule cards, favorite colors, and bottom navigation. Shirley sees Home and Schedules only; Jason reaches Wi-Fi through Settings.
- Software-effect speed levels use exact 2000/1000/500/250/100 ms logical intervals from Very Slow through Very Fast.
- Solid / Static is a true non-animated software effect and can be applied to the currently running theme from Home.
- The proven ELK-BLEDDM / Lotus Lantern BLE implementation and dual-slot OTA layout are preserved.
- PlatformIO and the pioarduino platform revision are pinned.

Development: `python tools/release.py bump`, edit the requested feature, then
`python tools/release.py prepare`. Push a `codex/` branch to build automatically.
CI caches dependencies and compiled objects and exports `and_<version>.bin` with
an exact-commit/checksum manifest. Same-repository PRs do not duplicate push builds.
Manual workflow dispatch can include a full serial-recovery image when needed.

The interface shares its speed-control code, skips unchanged/hidden animation
updates, and combines overlapping state requests. Storage uses NVS directly;
obsolete master-backup shims are removed.

Normal update: APP-ONLY through Settings → Firmware Update.

Serial recovery only: ALL-IN-ONE at **0x0**, Erase OFF. Do not flash APP-ONLY at 0x0.
