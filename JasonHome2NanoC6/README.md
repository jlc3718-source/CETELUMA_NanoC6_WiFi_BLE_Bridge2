# Jason Home 2 — NanoC6 installation

This is the **1.0.4 installation candidate for the M5Stack NanoC6, ESP32-C6 with 4 MB flash**. It moves the web interface, calendar resolver and Eufy command transport onto the NanoC6. SmartDawn curtain Bluetooth runs on the NanoC6. Eufy authentication/MQTT and configured Cloudflare AI still require Internet access.

Version 1.0.4 corrects the Eufy key-exchange signature, renews expired imported sessions once using the saved account, and preserves the underlying discovery error. The activation message names the unmet requirement, and the NanoC6 status refreshes automatically. On an existing 1.0.3 controller, use **Check for firmware update → Install verified update** after the signed channel offers 1.0.4. This replaces only the runtime and preserves Wi-Fi, account, settings and schedules. Keep the NanoC6 paused until Eufy reports Ready, the clock is synchronized and Oracle is paused. Live operation on the physical NanoC6 still needs user verification.

Version 1.0.3 repairs Wi-Fi setup and adds browser firmware upload. The runtime mounts the existing `storage` partition explicitly, and a failed save leaves the previous network and PIN intact. For an already flashed 1.0.2 board, first update **both** the boot updater (`0x10000`) and runtime (`0x130000`) by USB; keep the existing partition table and settings filesystem. These changes have not been physically verified on the board.

After this initial USB repair, open **Settings → Upload firmware file**, or `/firmware`. The controller reboots into its small protected updater, accepts a local `jh2-runtime-*.bin` through the browser, validates the ESP32-C6 image and Jason Home 2 product marker, and restarts. Wi-Fi and saved settings are preserved. A failed or interrupted upload stays in the uploader so it can be retried. The uploader is available on the setup access point when home Wi-Fi is unavailable. The existing signed remote-update path remains available.

Your remote address is **http://craumejl.tplinkdns.com**, **TCP port 80**. The local address is **http://jason-home-2.local/**. Use the local address during initial setup and migration. Your router maintains the TP-Link DDNS hostname.

## Before installing

- A NanoC6, a USB-C **data** cable, a computer with Python 3.10 or newer, and your 2.4 GHz Wi-Fi details.
- Extract the entire installation ZIP into one folder. Do not run the installer inside the ZIP.
- Keep the existing Oracle controller running while preparing the NanoC6. The NanoC6 starts **paused** and cannot send Eufy commands until activated. Anderson Home is a separate product and is unaffected.
- Keep both the original Oracle settings snapshot and the converted migration file. The private account file contains credentials; keep it private and import it only on home Wi-Fi.

## 1. Flash the new NanoC6

1. Disconnect USB. Hold the NanoC6's front button, connect USB to the computer, then release the button. This enters download mode.
2. Windows: double-click **install-windows.cmd**. Select the NanoC6 COM port if asked, then type `FLASH`.
3. macOS/Linux, or Windows terminal:

   ```sh
   python3 -m pip install esptool==5.5.0
   python3 flash.py --port /dev/ttyACM0
   ```

   On Windows use `py -3 flash.py --port COM5`; on macOS use the device's `/dev/cu.usbmodem…` port. Replace example ports with the actual port.
4. The script checks every packaged checksum before writing. Disconnect and reconnect USB after completion.

**Full installation clears the NanoC6's settings.** It writes the complete image at address `0x0`. Never flash an app-only runtime BIN at `0x0`.

## 2. Set up Wi-Fi and import settings

1. Join Wi-Fi **Jason-Home-2-Setup-…**, password **JasonHome2**. Open **http://192.168.4.1/setup**.
2. Enter home Wi-Fi and choose the admin PIN. After restart, reconnect the phone/computer to home Wi-Fi.
3. Open **http://jason-home-2.local/**, or the device IP shown in the router. Sign in with the new PIN.
4. In Settings → **Jason Home 2 · NanoC6**, choose **Import migration file** and select `Jason-Home-2-NanoC6-migration.json`. The board remains paused.
5. Import `Jason-Home-2-NanoC6-private-account.json` with the same button if provided, or choose **Connect Eufy account**. Wait for “Ready” and the synchronized clock. Configure the existing Cloudflare Account ID/token in the AI tab when needed.

If making a fresh settings export yourself, use the original Jason Home 2 app: Settings → Backup → create a new complete backup → export portable. In the extracted package run:

```sh
python3 convert_backup.py your-Oracle-backup.json --output Jason-Home-2-NanoC6-migration.json
```

The converter preserves built-in edits, colors, favorite flags, calendar settings, custom and weekly schedules, AI events and referenced factory edits/promotions. It excludes credentials and refuses an oversized or incomplete export instead of truncating it. Phone-local Curtain Studio libraries remain on that phone; changing the controller origin may require reimporting the original JPG/PNG/GIF files.

## 3. Pause Oracle, then activate the NanoC6

Do this only when the board is ready and you can watch the lights.

1. On the existing Oracle host, from the checked-out source, run:

   ```sh
   python3 JasonHome2NanoC6/tools/cutover.py nano
   ```

   This sets Oracle's existing automation owner to `direct`, which pauses its automation without removing its service, data or web app. It does **not** activate the NanoC6.
2. On the NanoC6 Settings panel, check **I have paused the Oracle scheduler**, then press **Activate NanoC6**.
3. Verify Pool, House, Garage and Shed individually: on/off, brightness, purple and one moving effect. Check both reversed strings (Pool/Shed). Confirm a real device report, not only a queued job.
4. Test a temporary schedule and Resume Schedule. Check civil dawn/dusk, Schedule 2 and white overrides against the original settings.
5. In Curtain, connect the nearby SmartDawn device `DN5E58`. Test on/off, brightness, effect, sequence, JPG/PNG and GIF imports, live playback, and the existing **Test Save Override** flow. Keep the device close enough for reliable Bluetooth.

If any check fails: **Pause NanoC6 first**, then run `python3 JasonHome2NanoC6/tools/cutover.py oracle` on Oracle to resume its scheduler. Do not run both schedulers together. No Oracle cutover is performed by building or downloading this package.

## 4. Remote address and automatic port mapping

After activation, **Automatically map TCP port 80 using UPnP** requests **external TCP 80 → NanoC6 TCP 80**. It discovers the gateway, checks the existing mapping, renews its lease and reads the result back. A conflicting rule for another device is preserved. No alternate external port is selected automatically.

On Deco, enable UPnP in **More → Advanced → NAT Forwarding → UPnP**. Menu wording can vary. Reserve the NanoC6's home IP in the router. Keep `craumejl.tplinkdns.com` assigned to this home's WAN address.

If UPnP is unavailable, use one manual forwarding rule with external/internal **80**, protocol **TCP**, destination the NanoC6's reserved IP. Disable the NanoC6 UPnP checkbox when managing the rule manually. Another device cannot simultaneously own the same WAN TCP port 80. Double NAT, carrier NAT or ISP port-80 blocking require changes upstream; the board cannot remove those restrictions.

Test **http://craumejl.tplinkdns.com** using phone mobile data, with Wi-Fi off. A verified router mapping does not itself prove public reachability. At home, use the local address if the router does not support NAT loopback.

The requested address uses HTTP; browser traffic and the PIN are not encrypted on that connection. Outbound Eufy, AI and firmware downloads use TLS. No incoming MQTT, SSH, UDP or separate updater port is opened.

## 5. Phone app and remote firmware updates

Install the accompanying **Jason Home 2 2.1.0** APK over the existing `com.jasonhome2.app` app only when the release certificate matches the original. It defaults to **http://craumejl.tplinkdns.com/**. Use **Controller address → NanoC6** for home setup, or enter the local IP. The existing Oracle URL can be selected while troubleshooting.

In NanoC6 Settings, use **Check for firmware update** and **Install verified update**. After the physical checks pass, enable automatic signed updates. Enabled controllers check around 20 seconds after startup and every five minutes while online. An update must have the correct product, ECDSA signature, version, source commit, byte count, URL and SHA-256.

The permanent boot app installs into the **one** runtime partition. It keeps Wi-Fi/settings and does not contain the main interface or a duplicate runtime. There is no automatic rollback. Power loss or a failed write can require USB recovery, as requested. The updater itself and the partition layout require USB to change.

## USB recovery

Enter download mode with the front button again. To repair only the runtime while retaining this layout, Wi-Fi and settings:

```sh
python3 flash.py --mode runtime --port /dev/ttyACM0
```

For a full reset use the normal install mode and restore the saved migration file afterward. Use only the files from the same checked package. `python3 flash.py --verify-only` checks the package without connecting a device.

## Flash layout and build

| Component | Address | Allocated bytes |
|---|---:|---:|
| ESP32-C6 bootloader | `0x0` | below `0x8000` |
| Partition table | `0x8000` | `0x1000` |
| NVS / Wi-Fi and pending update data | `0x9000` | `0x5000` |
| App selection | `0xE000` | `0x2000` |
| Minimal permanent updater | `0x10000` | `0x120000` |
| Single runtime | `0x130000` | `0x290000` |
| Settings filesystem | `0x3C0000` | `0x40000` |

Duplicate raw factory response data is omitted from the import; complete native recipes are retained, and the original Oracle export remains intact.

Exact binary sizes, checksums and source revision are in `release.json`. Source is maintained independently on the repository's `jason-home-2-nanoc6` branch. Its signed update channel is `jh2-nanoc6-ota`; the Anderson channel is unchanged.

Rebuild with Python 3.12, Node 24, PlatformIO 6.2.0, esptool 5.5.0 and Pillow:

```sh
python3 JasonHome2NanoC6/tools/prepare.py
python3 -m platformio run -d JasonHome2NanoC6 -e runtime -e boot
python3 -m platformio run -d JasonHome2NanoC6 -e runtime -t buildfs
python3 JasonHome2NanoC6/tools/package.py
```

Hardware reference: https://docs.m5stack.com/en/core/NanoC6

Router reference: https://www.tp-link.com/us/support/faq/4624/
