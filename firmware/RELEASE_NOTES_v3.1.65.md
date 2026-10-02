# Anderson Home 3.1.65

- Ignore stale responses from prior profile sessions; cancelled PIN submissions cannot log in the wrong profile. A fresh login starts its own state refresh.
- Order manual controls, cancel delayed previews when switching profiles or turning OFF, and discard older targeted BLE color/brightness frames before sending OFF.
- Check for a newer signed firmware release before BLE/event initialization and full dashboard startup. Keep a small status/recovery page responsive while verification and installation run; resume startup after a failed or current-version check.
- After three consecutive short boots, keep the controller in minimal recovery mode so signed updates and the protected APP-only recovery uploader can remain available.

Reboot-cause investigation remains deferred as requested. The existing signed-manifest, SHA-256, URL, version, inactive-slot, PIN, settings, and APP-only protections remain in place.
