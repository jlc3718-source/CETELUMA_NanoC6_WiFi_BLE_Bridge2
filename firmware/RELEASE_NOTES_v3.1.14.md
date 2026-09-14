# Anderson Home v3.1.14

- Removes the shared BLE write timer that forced controller B to trail controller A.
- Preserves the 18 ms safety gap independently on each controller.
- Prefers BLE write-without-response when supported so paired commands can be queued back-to-back.
- Keeps reliable reassert/retry behavior for dropped frames.
