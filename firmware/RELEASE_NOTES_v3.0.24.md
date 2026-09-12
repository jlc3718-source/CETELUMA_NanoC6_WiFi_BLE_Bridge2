# Anderson Home v3.0.24

- Repairs Home Scene Favorites by reseeding the approved 28-scene list directly in event-state storage on upgrade, independent of the custom-storage self-test.
- Moves the independent Schedule 1 and Schedule 2 enable controls into the Scheduling Rules panel as prominent controls.
- Schedule 2 remains 30% brightness from Schedule 1 END until local civil dawn.
- Preserves all five manual speed selections while built-in presets remain no faster than Slow.
- Preserves the 210-event calendar, locked 9-color master palette, Wi-Fi, BLE, PINs, custom lights/schedules, partitions, and signed OTA trust.
- Production build is generated only after both fixes are present in the source revision.
- Temporary patch tooling is removed before the final verified build.
