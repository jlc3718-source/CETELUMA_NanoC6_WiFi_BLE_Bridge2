# Anderson Home v3.1.23

- Makes fast OTA discovery permanent: the NanoC6 now checks GitHub's latest stable Release API first and downloads the exact signed `ota-manifest.json` asset attached to that release. The existing signed raw `ota` manifest remains a fallback only.
- Keeps all signature, version, SHA-256, byte-count, commit, downgrade, rollback-hold, and inactive-slot protections.
- Restores the working v3.1.19-style independent **Settings → Backup & Restore** tab. Removes the duplicate v3.1.21/3.1.22 static backup panel that prevented the real tab from being built.
- Backup & Restore again lets Jason select Scheduling & timezone, Light controllers, Custom shows & schedules, Favorite colors, and Events & favorites; save the selection; run a manual backup; and restore the last verified backup. Wi-Fi passwords and profile PINs remain intentionally excluded.
- Weekly automatic backup remains enabled for the selected categories, using the transactional dual-generation backup backend and restore rollback protection introduced in v3.1.21.
- Preserves the v3.1.22 recovery button, four animated effect buttons including Breath, semantic color names, schedules, favorites, event fairness, and protected OTA layout.
