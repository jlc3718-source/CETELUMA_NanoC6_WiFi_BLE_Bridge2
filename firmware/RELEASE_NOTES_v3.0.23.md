# Anderson Home v3.0.23

- Existing automatic lighting window is named Schedule 1.
- Adds independent Schedule 2: starts at Schedule 1 END, runs the same scheduled scene at exactly 30% brightness, and turns off at locally calculated civil dawn.
- Schedule 1 and Schedule 2 can be enabled or disabled independently.
- Overnight Schedule 2 continues the prior evening's scheduled event/scene through dawn.
- Re-seeds the approved 28 Home Scene Favorites once on upgrade so v3.0.22 installations receive them.
- All 210 built-in event preset speed defaults are Very Slow or Slow; no built-in preset ships faster than Slow. Manual/custom controls still allow all five speed levels.
- Expands firmware GitHub Actions retention to remove old patch/stage/publish/cleanup runs while leaving unrelated workflows alone.
- Preserves the 210-event calendar, locked 9-color master palette, Wi-Fi, BLE, PINs, custom lights/schedules, partitions, and signed OTA trust.
- Build source includes the corrected Arduino-safe dawn calculation constant naming.
