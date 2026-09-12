# Anderson Home v3.1.1

- Fixed built-in event customization persistence across firmware updates and Original/Modern palette switching.
- Original Colors and Modern Colors now keep independent per-event colors, effect, and speed in NVS.
- Migrates the v3.1.0 single-slot event override non-destructively into its matching palette.
- Added a checked Favorite control beside every scene on the Favorites page for one-step removal.
- Removed the rainbow Current Effect artwork and deleted the retired v3 hero/rainbow sprite from the firmware build.
- Quick Colors now show color names and use recognizable web/sRGB reference colors while still sending calibrated Anderson LED codes.
- Preserves schedules, event identity, PIN/auth data, Wi-Fi/BLE behavior, custom shows, and OTA partition compatibility.
