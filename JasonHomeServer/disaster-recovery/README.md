# Jason Home 5.4.11 Disaster-Recovery Snapshot

This branch is a frozen recovery checkpoint for **Jason Home 5.4.11 Oracle**.

## Source checkpoint

- Source commit before recovery metadata: `b62b0edca923ca1386289aed0098d291a077b4cf`
- Android application source: `JasonHome/`
- Oracle server source: `JasonHomeServer/`
- Build/deploy workflows: `.github/workflows/`
- Oracle server stack: Node.js + SQLite + Docker Compose + Eufy MQTT
- Scheduler location: ZIP 14772 / America/New_York

The branch itself preserves the complete project source needed to rebuild the Android application and Oracle service. The captured recovery bundle also contains `jason-home-source.bundle`, a verified Git bundle of this frozen branch so recovery does not depend on GitHub remaining available.

## Live Oracle runtime backup

The capture workflow creates a recovery bundle containing:

- `jason-home-source.bundle` — portable Git repository/history backup of this frozen checkpoint.
- `oracle-settings-backup.json` — sanitized, API-restorable calendar, schedules, Factory edits/promotions, and referenced Factory presets.
- `oracle-health.json` — server health/build provenance at capture time.
- `oracle.env.cms` — the production `.env` encrypted with the Jason Home permanent RSA certificate.
- `jason-home.sqlite.cms` — a consistent SQLite backup encrypted with the same certificate.
- `manifest.json` — source SHA, counts, SHA-256 hashes, and encryption metadata.

No Eufy password or Jason Home API token is stored in plaintext in GitHub.

## Decryption key

The encrypted runtime files are recoverable with the **existing permanent Jason Home signing key**:

- Library path: `/JasonHome/Signing/jason-home-release.jks`
- Signing details/password record: `/JasonHome/Signing/SIGNING_INFO.txt`
- Expected certificate SHA-256:
  `76:B2:8E:FD:4F:5D:13:2A:D3:04:8F:19:BA:E6:C3:5A:A5:F8:4C:4A:39:0E:98:C8:0D:EE:EB:C0:C3:E7:3A:E1`

**Never commit the JKS file or its password to this public repository.**

## Full Oracle replacement procedure

1. Create a replacement Linux/ARM64 Oracle VM.
2. Clone this repository and check out this disaster-recovery branch.
3. Obtain the latest recovery bundle and the permanent `jason-home-release.jks`.
4. Run:

   ```bash
   JasonHomeServer/disaster-recovery/decrypt-runtime-backup.sh \
     /path/to/jason-home-release.jks \
     /path/to/recovery-bundle
   ```

5. Copy the recovered files:
   - `.env` → `JasonHomeServer/.env`
   - `jason-home.sqlite` → `JasonHomeServer/data/jason-home.sqlite`
6. Ensure Docker + Docker Compose are installed and start the service from `JasonHomeServer/` with:
   ```bash
   sudo docker compose up -d --build
   ```
7. Verify `http://127.0.0.1:8080/api/health`.
8. If the replacement VM has a different public IP, update the HTTPS/Cloudflare origin before expecting the installed Android app to reach the new server.

The raw encrypted SQLite restore is the most exact recovery. The sanitized JSON backup is also available for settings-only recovery through `POST /api/backup/restore`.

## What is intentionally not in GitHub

The APK signing private key and signing password remain outside the repository. They are the recovery/decryption key and must stay private.
