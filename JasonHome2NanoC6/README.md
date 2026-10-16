# Jason Home 2 NanoC6 1.1.0 — Oracle curtain relay

Existing APK controls → authenticated Oracle queue → outbound NanoC6 HTTPS → SmartDawn BLE.

Use the runtime BIN through the existing local Firmware upload page to preserve Wi-Fi, pairing and the partition map. A complete 4 MB image flashed at 0x0 replaces NVS and filesystem; it requires Wi-Fi setup and Oracle pairing again. Do not use it as an ordinary update.

In the APK Settings, open NanoC6 curtain relay → Pair NanoC6. Copy the private JSON configuration into the NanoC6 Bridge Settings → Oracle pairing. Do not share this code. Bridge Settings reports connection, BLE identity, last command/ACK, 60-second recovery polling, firmware/flash/RAM use and errors. A long poll provides prompt commands while online. Pairing can be rotated without changing the Oracle API token or Eufy credentials.

Files stay on Oracle. NanoC6 reads 4 KB TLS-protected, digest-checked ranges into RAM and transmits captured SmartDawn packets over BLE. No animation file is written to NanoC6 flash. Oracle validates/prepares the Studio's 40×40 output; existing subject framing, AI service, presets and previews remain in the web application. Native slot installation uses the existing verified 4096-byte CID 83928 procedure and actual curtain notifications. Raw GIF bytes are never uploaded as native effects. The experimental override retains its existing warnings.

Static/GIF relay programs support at most 180 frames and 4 MB of compiled packets. BLE throughput limits frame rate; the programmed hold time is added after transmission. Native effects and sequences run on the NanoC6/curtain after closing the APK. Live GIF relay requires Oracle connectivity. On loss, the curtain retains the last displayed frame or native effect; no offline GIF guarantee is made. Oracle reissues its latest desired scene after NanoC6 restart.

Local Curtain controls use NanoC6 BLE directly. Tests pause Oracle commands for 15 minutes; Return to Oracle ends that pause. Oracle owns curtain event scheduling. No on-device calendar owner, phone Bluetooth, UPnP, DDNS, or inbound port mapping is used.

The 4 MB partition map is unchanged: permanent updater 0x10000/0x120000; runtime 0x130000/0x290000; settings filesystem 0x3C0000/0x40000. The current updater's runtime size guard requires padding small runtime files above 0x120000; the release manifest reports the padded upload file. This padding is not executable code. There is one runtime slot, so automatic rollback is unavailable. The permanent uploader remains the recovery path; use the previous verified runtime BIN if needed.

Build provenance, SHA-256 and chip/partition validation accompany each release. Compilation and automated tests do not prove physical BLE output. Pairing, real curtain output, restart behavior and phone-Bluetooth-off acceptance require hardware verification.
