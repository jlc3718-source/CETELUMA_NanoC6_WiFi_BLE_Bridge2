# Anderson Home v3.1.21

- Emergency recovery for the v3.1.20 browser runtime failure that prevented the remainder of the UI from initializing.
- Preserves the blue interface, four visible Jump/Breath/Strobe/Solid buttons, backup tab, schedules, favorites, calibrated LED payload values, permissions, partition map, protected updates, and Android freeze.
- Synchronizes effect-button highlighting with incoming state without sending unintended control commands.
- Keeps event favorite-color additions removable after the RGB picker is opened.
- Uses semantic color names on built-in and custom schedule surfaces while preserving calibrated LED payloads.
- Preserves exact HEX/RGB tuning values in Live Color Tuning.
- Restricts firmware abort/reboot-sensitive paths to the owning operation and adds bounded automatic-backup failure retry backoff.
- Restores the separate Settings → Backup & Restore tab for weekly user-selected backups, manual backup, and manual restore.
- Moves settings snapshots to verified dual-generation files in the existing SPIFFS partition, preserving the previous good generation until a new one validates and commits.
- Prevalidates complete restores and uses a boot-recoverable rollback journal so a failed or interrupted restore can return to the prior live state.
- Migrates a valid legacy v1 settings backup into the new verified format without changing the partition map.
