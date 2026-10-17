# Jason Home 2 — OTA recovery freeze (2026-10-17)

## Active signed automatic-update target
**1.1.12 only**, as defined by the ECDSA-signed `latest.json` in this branch.
The matching signed APK is **2.0.17**. This branch intentionally has no active firmware source or binaries; the Nano reads only `latest.json`.

## Archived, not authorized for automatic installation
- **1.1.13**: Initial replacement of HTTPS polling/SSE with WSS duplex.
- **1.1.14**: BLE command worker restructuring.
- **1.1.15**: Manual Oracle key controls restored.
- **1.1.16**: Bluetooth scan/select and additional TLS handling; no proven working Oracle channel on the physical Nano.

These versions are preserved **for investigation only**, not as OTA choices.
Exact tagged source snapshots and original install ZIPs, release manifests, and SHA-256 checksums have been copied into Google Drive → My Files → **Jason Home 2 - Archived Firmware 1.1.13-1.1.16**:
https://drive.google.com/drive/folders/1kYc5pQezb5YTBt1-qKmsk-_1dr7zWaBJ

Source tags/releases remain in GitHub for reproducibility; no history has been erased.
The fast OTA publication workflow has been explicitly frozen on both development branches:
- `codex/jh2-command-pipeline-20261016`
- `codex/jh2-70k-buffers-studio-simplify-20261016`

**Do not sign or advance this channel to a later version without explicit user authorization and physical acceptance testing.** Do not confuse Anderson Home's separate OTA channel with Jason Home 2.
