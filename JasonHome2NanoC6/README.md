# Jason Home 2 NanoC6 1.1.16

Use `jh2-runtime-1.1.16.bin` in the Nano's existing Firmware upload page for an ordinary update. This preserves Wi-Fi and Oracle credentials. The full 4 MB `jh2-full-install-1.1.16.bin` is a recovery image flashed at **0x0**; it resets Wi-Fi and Oracle setup.

After a full flash, join the Nano's Jason-Home-2-Setup Wi-Fi and save your home Wi-Fi. Rejoin home Wi-Fi and open `http://jason-home-2.local/`.

On the Nano's Curtain tab, tap **Scan Bluetooth**, choose the curtain by name and address, then **Connect selected**. The selected address is retained after a successful connection. Scanning and connection from the local page run in the BLE worker so the web server can continue answering. The existing synchronous command API remains compatible.

Reopen the APK and go to **Curtain controls → Manual Oracle connection → Create Oracle key → Copy key**. On the Nano, open **Oracle**, paste the complete key, tap **Receive key**, then **Receive commands**. Creating another key replaces the previous key. Opening the APK and pressing curtain command buttons do not run setup or replace that key.

Oracle sends commands through the Nano's authenticated outbound TLS WebSocket on TCP 443. Commands and acknowledgements use the same persistent connection. Local Bluetooth controls work independently. The command socket uses an eight-second TLS handshake limit and delays connection attempts if available RAM is insufficient. Signed firmware and asset downloads retain their existing verification.

Files remain on Oracle. NanoC6 relays image data through two dynamic RAM buffers, up to 35 KiB each, using 80% of the heap above a 48 KiB reserve with the existing smaller-buffer fallback. No animation is stored on Nano flash. Native effects and sequences continue after closing the APK; live image/GIF streaming requires Oracle connectivity.

The 4 MB partition map is unchanged: permanent updater at 0x10000/0x120000; runtime at 0x130000/0x290000; settings filesystem at 0x3C0000/0x40000. There is one runtime slot. Keep the previous runtime and permanent uploader available for recovery.

Build tests and cryptographic image checks do not establish physical BLE output. Confirm the selected curtain responds and Oracle receives its real command acknowledgement after installation.
