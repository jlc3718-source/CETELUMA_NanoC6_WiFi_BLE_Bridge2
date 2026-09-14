# Anderson Home v3.1.21

- Emergency recovery for the v3.1.20 browser runtime failure that prevented the remainder of the UI from initializing.
- Preserves the blue interface, four visible Jump/Breath/Strobe/Solid buttons, backup tab, schedules, favorites, calibrated LED payload values, permissions, partition map, protected updates, and Android freeze.
- Synchronizes effect-button highlighting with incoming state without sending unintended control commands.
- Keeps event favorite-color additions removable after the RGB picker is opened.
- Uses semantic color names on built-in and custom schedule surfaces while preserving calibrated LED payloads.
- Preserves exact HEX/RGB tuning values in Live Color Tuning.
- Restricts firmware abort/reboot-sensitive paths to the owning operation and adds bounded automatic-backup failure retry backoff.
