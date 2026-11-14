# House and Garage WLED controllers

Firmware 3.1.85 adds an optional WLED Wi-Fi connection for each existing light slot.
It supports the SP803E and other controllers running the standard WLED JSON API.
Both slots continue using their saved Bluetooth connections until explicitly changed.
Version 3.1.86 fixes the panel placement in **Settings tab 6 — Controllers**.
The Amazon short link supplied with the order could not be resolved during preparation;
the ordered model has not been independently confirmed.

## When the controllers arrive

1. Connect each controller to the home Wi-Fi network using its WLED setup page.
   Give each a different address; a router DHCP reservation helps keep it stable.
2. Configure the actual light type, output pin, LED count, color order and power
   limit in WLED. Existing ONEOFTEA light protocol and pinout remain unverified.
   Anderson does not guess or change those hardware settings.
3. In Anderson Home, open **Settings → Controllers → Wi-Fi Controllers (WLED)**.
   For **A / House**, select **Wi-Fi (WLED)**, enter that controller's IP address,
   then choose **Save Connection**. Repeat for **B / Garage** using its own address.
4. Confirm each controller reports **Connected** and acknowledges a command.
   Test each string separately, then All Lights: RGB colors, brightness, Solid,
   Jump, Breath, Strobe, ON and OFF. Check the existing scheduled changes too.
5. Check recovery after an ordinary controller disconnect and reconnect.
   Anderson should restore the current requested state, including OFF.

Anderson keeps the saved names, Bluetooth addresses, schedules, presets and colors.
Selecting **Bluetooth** again restores the original transport without re-entering
or replacing the old addresses. A slot can use one transport at a time; there is
no automatic switch to a different controller or address.

## Delivery behavior

The existing Anderson software effects send one uniform RGB color and brightness
to every active WLED segment. The integration does not introduce chasing effects.
It uses `GET /json/si` to identify the controller and its active segment IDs, then
`POST /json/state` to send the complete latest requested state. It does not change
LED outputs, segment bounds, presets, LED count or current limits.

Network requests run in a separate bounded worker, with independent state for each
slot, coalesced effect updates, stale-result rejection and bounded retry backoff.
The latest desired state is retained while a controller is offline. Setup is
restricted to the existing Jason administrator profile. New connection settings
are saved together in a separate atomic NVS record and included in controller
backups. Older backups remain readable.

Official API reference: <https://kno.wled.ge/interfaces/json-api/>.

## Acceptance and rollback

Compilation and protocol regression tests do not verify the physical lights.
`remote-update/hardware-acceptance.json` records the outstanding arrival checks.
Release and build-artifact pruning stays deferred while that record is pending.
After actual Nano and light operation, backup and recovery have been verified,
record the acceptance evidence and set `pending` to `false` before rotating releases.
The signed updater still blocks downgrade; retain the existing protected APP-only
recovery path and prior release as the manual rollback option.
