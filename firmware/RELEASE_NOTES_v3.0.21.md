# Anderson Home v3.0.21

- Render the nine master Favorite Colors as labeled rectangular color tiles.
- Favorite Colors are firmware-owned and read-only; the UI exposes no add/delete controls.
- `/api/colors` returns the fixed master palette and rejects mutation attempts.
- Changing the master Favorite Color palette requires a new firmware build.
