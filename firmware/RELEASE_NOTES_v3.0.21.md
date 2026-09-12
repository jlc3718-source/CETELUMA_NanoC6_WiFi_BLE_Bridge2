# Anderson Home v3.0.21

- Render the nine master Favorite Colors as labeled rectangular color tiles.
- Favorite Colors are firmware-owned and read-only; the UI exposes no add/delete controls.
- `/api/colors` returns the fixed master palette and rejects mutation attempts.
- Changing the master Favorite Color palette requires a new firmware build.
- Set the Home Scene Favorites default to the approved 28-scene list and preserve its exact display order.
- Fix Home Scene Favorites to read the 256-event state store, so favorites above event #64 work correctly.
