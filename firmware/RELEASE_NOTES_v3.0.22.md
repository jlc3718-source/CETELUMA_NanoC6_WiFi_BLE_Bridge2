# Anderson Home v3.0.22

- Production-safe successor to the briefly published interim v3.0.21, ensuring OTA clients always see a numerically newer version.
- Keeps the complete 210-event master holiday/awareness calendar and scheduled lighting effects.
- Home Scene Favorites default to the approved 28-scene list in the exact requested display order.
- Home Scene Favorites use the full 256-event state store, so scenes above event #64 work correctly.
- Favorite Colors are the nine calibrated master colors rendered as labeled rectangular tiles.
- Favorite Colors are firmware-owned/read-only; they cannot be added, deleted, or replaced without a new firmware build.
- Halloween remains Orange (#FF0D00) + Purple (#5B00E6) only, with no Green.
- Wi-Fi, BLE, PINs, custom lights/schedules, partitions, and the signed OTA trust chain are preserved.
