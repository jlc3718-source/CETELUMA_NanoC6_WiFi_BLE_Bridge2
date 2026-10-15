# Jason Home 2 NanoC6 — validation and remaining device checks

The release manifest identifies this build as an **installation candidate**. The arriving board, Eufy devices, SmartDawn curtain, home router, and public port 80 cannot be physically verified in the build environment. Keep Oracle available until the installation guide's cutover checks pass. Existing verified production generations are retained.

Automated validation in the dedicated build workflow:

- Compile both ESP32-C6 images with pinned Arduino, library and PlatformIO inputs.
- Compare 5,040 Eufy effect payloads and the complete XOR command envelope against the current Oracle implementation, covering both models, every effect/speed, reverse wiring, patterns and bulb counts.
- Run the SmartDawn portable protocol tests: all 88 effects, packet framing/checksums and validation limits.
- Verify migration preservation and rejection of incomplete input.
- Check the generated mobile interface for JavaScript errors, missing endpoints, NanoC6 settings, Curtain Studio access and horizontal overflow in a mock server. This verifies UI wiring, not real HTTP/BLE/Eufy execution.
- Validate both image headers as ESP32-C6, exact partition addresses, one runtime slot, the app-selection image, slot fit and every delivered checksum.
- Verify the signed Android APK's package/version and original signing certificate.
- Sign the product-bound update manifest, verify it with the firmware's public key, publish the exact binary, and read it back before advancing the independent update channel.

Migration constraints and retained behaviors:

- Internet is still needed for Eufy's cloud/MQTT transport and configured AI services. Scheduling and interface hosting run locally.
- A native animated SmartDawn custom-slot save was not established in the existing project. Live animation and the existing Test Save Override UI are preserved; the prior project's static/first-frame save limitation must not be interpreted as proven persistent native GIF playback.
- Curtain Studio source media and browser-local libraries are not part of an Oracle settings backup. Reimport originals when moving to a different browser origin.
- Native Factory Lab support on E120 remains experimental, as in the source project. Exact live MQTT acknowledgments, account verification requirements and heap behavior require device testing.
- Weekly rows retain their targets and priorities; the initial resolver selects the highest-priority active weekly row. Concurrent, different weekly scenes on multiple individual strings need additional resolver work before using that configuration.
- Local speech synthesis in the Android app avoids buffering an audio reply on the small controller. Native voice capture uses short turns (up to 12 seconds); this changes the voice used for replies from the hosted app.
- The 256 KB settings volume and 60 KB import limit are checked. A very large factory catalog may fail refresh without replacing the previous catalog; it is not silently truncated. Referenced recipes in a valid import remain available.

No live Oracle service, schedule owner, router mapping or Anderson firmware is changed by the build workflow. The separate cutover script is operator-invoked after installation.
# Version 1.0.4 Eufy connection repair

The key-exchange request signs its encrypted public-key value, matching the working Oracle client. Previously it signed the enclosing JSON. A read-only comparison returned HTTP 403 for the old signing method and HTTP 200 / API code 0 for the corrected method. The imported session separately returned HTTP 401 / API code 26085, so the firmware now renews that session once with the saved login and retains specific API errors.

This repair changes no light serial/model checks, Eufy command frames, flash partitions or saved-state formats. The existing signed runtime updater preserves Wi-Fi and settings. Firmware compilation, package verification and publication do not establish successful physical NanoC6 authentication, MQTT operation or light output; check these after installation while Oracle remains paused.
