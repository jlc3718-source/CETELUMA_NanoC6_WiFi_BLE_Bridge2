# Anderson Home 3.1.58 Disaster Recovery

This branch is a frozen disaster-recovery checkpoint for **Anderson Home NanoC6 v3.1.58**.

## Authoritative production point

- Production branch: `main`
- Production commit: `5e08048f80b51ad6fdc0a3fd6c23134eb773671f`
- Stable release/tag: `anderson-v3.1.58`
- Canonical firmware source: `firmware/`
- Build/release tooling: `tools/` and `.github/workflows/`

## What the capture bundle contains

- `anderson-source.bundle` — portable Git bundle of repository refs/history, independent of GitHub availability.
- `production-release/and_3.1.58.bin` — the exact published APP-only production firmware.
- `production-release/release.json` — exact production provenance/hash manifest.
- `production-release/ota-manifest.json` — signed production OTA manifest.
- `live-ota/latest.json` — the live OTA channel at capture time, verified identical to the stable release manifest.
- `and_3.1.58_full.bin` — freshly verified full serial-recovery image built from the exact production source commit.
- `full-recovery-release.json` — manifest for the full recovery build.
- bootloader/partition binaries when emitted by the toolchain.
- `manifest.json` — SHA-256 and size for every packaged recovery component.

The workflow reruns the Anderson maintenance, regression, audit, BLE-recovery, runtime-fix, and event-coverage test suites before producing the full recovery image.

## OTA signing private key

The private Anderson OTA signing key is **not committed to this public repository and is not placed in public GitHub Actions artifacts**.

A separate protected copy already exists in the user's ChatGPT Library as:

`ANDERSON_OTA_SIGNING_KEY_B64.txt`

The final private Library recovery ZIP should contain a copy of that file alongside this public-safe recovery bundle. Protect it: that private key is what allows replacement infrastructure to publish OTA manifests that existing Anderson controllers trust.

## Recovery paths

### Normal firmware recovery

Use the exact published APP-only file:

`production-release/and_3.1.58.bin`

through the existing Anderson Home **Settings → Firmware Update** interface.

### Dead / replaced controller serial recovery

Use:

`and_3.1.58_full.bin`

as the full serial-recovery image at address **0x0** with erase **OFF**, following the existing Anderson recovery procedure.

Do **not** flash the APP-only `and_3.1.58.bin` at 0x0.

### Recreate the Git repository without GitHub

```bash
git clone anderson-source.bundle Anderson-Home-Recovery
cd Anderson-Home-Recovery
git checkout 5e08048f80b51ad6fdc0a3fd6c23134eb773671f
```

## Controller-local NVS data

Source, release firmware, OTA provenance, and signing capability are preserved by this disaster-recovery package. User/runtime state stored only in the physical NanoC6 NVS (for example current saved Wi-Fi credentials or post-firmware user changes) can only be captured from the controller's own Backup & Restore/export path; it is not readable from GitHub. The firmware itself contains the Backup & Restore implementation and preserves its formats.
