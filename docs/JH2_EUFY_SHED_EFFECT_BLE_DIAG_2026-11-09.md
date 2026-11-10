# JH2 Eufy BLE Shed + animation failure analysis — 2026-11-09

## Verified live results
- Jason Home 2 Oracle app healthy; Nano ESP32-C6 firmware 2.0.20 online, SmartDawn curtain BLE connected.
- Read-only encrypted GATT probe of Shed succeeded (command 27628). Garage comparison also succeeded (command 27629).
- Shed advertisement RSSI approximately -87 dBm at successful probe, earlier -96 dBm. Garage approximately -72 dBm. Lower Shed RF margin is real, but no transport failure occurred in the Shed probes.
- Shed previously returned GATT write ACKs on power (e.g. command 27623); **there is no physical LED-state confirmation**. No observed Shed GATT failure in this snapshot.
- Pool had intermittent cccd_write failure at about -95 dBm; don't attribute this to Shed.
- Eufy cloud authentication failed repeatedly with HTTP 200 and Eufy code 100028. This was present before/after Nano 2.0.20 upgrade.
- Nano local BLE exposes only encrypted power (0x0201), brightness (0x0201), RGB static color (0x0206), and an authenticated no-change probe; no scene/effect command is sent for any light.
- Current local BLE command state "applied" means a GATT write was acknowledged, **not** that a device processed the command or LEDs rendered it.
- Oracle UI updated to say advertisement heard vs BLE session / GATT ACK, display weak RSSI, show per-device failures and effect-cloud limitation. Validated/deployed with automatic backup.

## Research for true BLE effects (do not invent frames)
- Source: https://github.com/SudoSaturn/eufy-local-ha/blob/main/PROTOCOL.md
- Source: https://github.com/SudoSaturn/eufy-local-ha/blob/main/E22SUPPORT.md
- Source: https://github.com/zer0-t/eufylife-api-hacs/blob/main/E10_Animation_Research.md
- E22 T8L02 preset animations are full encrypted 0x020D multi-layer payloads, not an id-only command. Dynamic simple effects can use 0x0206 with a complete speed/palette/segment map. Native E22 device reply 0x0A0D status 0x00 and unsolicited 0x0204 state may distinguish accepted/active from mere GATT ACK.
- Captured per-preset payload tails must be available/validated before claiming E22 factory effects work. E120 T8L00 is not verified using those E22 captures.
- Do not claim scene playback on GATT ACK alone. Require E22 device-level status success plus state report where available; physical observation remains final truth.
- Do not overwrite 2.0.20 until a signed, rollback-enabled next firmware passes ESP-IDF production-flag CI, authorized staged OTA and SmartDawn/Eufy regression tests.
- No lighting state was changed by the diagnostic probes. The source/UI diagnostic changes did not attempt to play any effect.

## Proposed next implementation
1. Add an opt-in E22 read-only encrypted status query (0x0200) with safe state parser for 0x0A00 and unsolicited 0x0204, per-device ACK status; hold the GATT session through reply instead of ending on the write ACK.
2. Validate actual Shed segment count and current scene on its own controller. Never assume 20, 30, 50, or 60 segments from the model name alone.
3. Add an E22-only limited animation test using validated 0x020D data and capture a device-level ACK + state; no E120 effect support until separately validated.
4. Map the existing Jason Home 2 holiday/factory catalog to fully captured E22 payloads, preserving timing, layers, palette and per-target length. Return explicit unsupported results rather than falling through to a failed cloud login.
5. Add user-visible per-device delivery and render-state diagnostics; only enable automation after a visual and telemetry check.
