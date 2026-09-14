# Anderson Home v3.1.25 — maximum safe compression

Compression-only production release based on the exact v3.1.24 source.

- Preserves all controller behavior, NVS data, BLE protocol, schedules/events, profiles/PINs, UI behavior, recovery, and signed OTA compatibility.
- Keeps the existing 4 MB flash / dual APP-slot map and APP-only routine update format.
- Keeps `-Oz`, disabled exceptions/RTTI/unwind tables, and linker garbage collection.
- Adds explicit function/data sections, constant merging, and compiler ident suppression so dead sections can be discarded consistently.
- Increases Terser compression analysis from 3 to 10 passes while preserving public/global bindings and function names.
- Increases deterministic Zopfli gzip effort from 50 to 1000 iterations with unlimited block splitting for both embedded web pages.
- LTO and unsafe semantic-changing compiler transforms remain intentionally disabled.
- Production build is intentionally triggered from this exact compressed-source revision so the normal CI verification and signed publish chain can validate it end to end.
