# Anderson Home v3.0.25

- Repairs built-in event Favorite/Enabled persistence by moving event state to valid NVS namespace `anderson-evst` and adds a compile-time 15-character guard.
- Makes the pending legacy calendar migration non-destructive: it no longer clears custom favorites, event overrides, event state, or schedule settings.
- Returns a real HTTP 500 if an event Enabled/Favorite write fails; the UI reloads Events and Home Favorites after a rejected save.
- Optimizes reboot housekeeping: routine reboots use a read-only storage health check instead of writing/deleting a test key every boot.
- Runs the NVS write/read/delete self-test only after a firmware-version change or when the read-only check fails, then records the tested version.
- Adds NVS used/free entry counts and storage-health policy fields to `/api/system`.
- Preserves the 28 approved Scene Favorites, 210-event calendar, locked 9-color palette, independent Schedule 1/2 controls, all five manual speed choices, Wi-Fi, BLE, PINs, custom lights/schedules, partitions, and signed OTA trust.
