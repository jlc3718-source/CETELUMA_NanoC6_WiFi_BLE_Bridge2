# Anderson Home v3.1.0

- Removes unsupported Gradient from the firmware and UI; legacy Gradient/Fade/Rainbow names map safely to Breath.
- Adds Original Colors (v3.0.28) / Modern Colors (v3.0.29) A/B event-color themes with persistent selection and generation-aware manual color overrides.
- Redesigns interactive color controls as square, dimensional Anderson blue-glass tiles.
- Keeps Schedule 1 and Schedule 2 controls under Settings > Schedules while removing their duplicate controls from the Schedules page.
- Removes Enable All and Clear Month and the unused bulk-event API.
- Makes supported calendar rules recur year-to-year and extends table-driven observances through the scheduler look-ahead range.
- Fixes holiday lead/trail windows with civil-date arithmetic across DST boundaries.
- Fixes the live Favorite Colors API to return all 16 locked master colors.
- Rejects over-capacity custom shows/schedules instead of silently deleting the oldest entry and adds checked linked-delete recovery.
- Adds checked/staged settings and event-override persistence, dirty-field protection, stale-search suppression, server-side event search, Wi-Fi reset persistence, safe text rendering, PIN/session bookkeeping fixes, and verified firmware-return reporting.
- Removes obsolete Gradient/bulk-control/polling code and other superseded paths.
- Adds permanent successful-build cleanup that retains the two newest Anderson object/PlatformIO cache generations and removes older matching GitHub Actions caches.
- Preserves the 210-event Modern color assignments, all 16 master colors, Favorites persistence, Jason/Shirley profiles, two-controller BLE, Schedule 2 dawn/30% behavior, partitions, and saved-data compatibility.
- OTA is intentionally not advanced.
