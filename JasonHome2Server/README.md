# Jason Home 2

Jason Home 2 is a separate Android package (`com.jasonhome2.app`) and a
hosted web gateway. It reuses the running Oracle scheduler and Eufy transport,
and DOES NOT start a second scheduler.

The gateway runs on loopback port 8081 behind the existing HTTPS nginx server
at `/jason-home-2/`. It uses its own SQLite file for web-only settings.
Browser sessions are stored in a Secure, HttpOnly cookie. The Oracle API key is
checked on first connection and stays on the server; it is never baked into
the APK or downloaded web assets.

Generate web files and catalog with:

```sh
python3 JasonHome2Server/generate_catalog.py
python3 JasonHome2Server/generate_web.py
node --check JasonHome2Server/server.mjs
node --test JasonHome2Server/tests/*.mjs
```

Set `JH2_UPSTREAM_TOKEN` to the existing Oracle controller token,
`JH2_UPSTREAM_URL` to `http://127.0.0.1:8080`, and `JH2_DATA_DIR`
to a private persistent directory. The independent Android build script
requires Android platform 35, build tools 35, and the Jason Home 2 signing
key. Do not place those credentials in the repository.

Legacy Jason Home 5.4.x source remains as a compatibility input for existing preview assets ONLY. Never build or install the original Jason Home as Jason Home 2. Jason Home 2
shares the active Oracle controller for actual device operations. White Override 1
and White Override 2 are scheduled Sunday through Thursday only. Do not use both
interfaces to edit the same event concurrently: edits use Oracle calendar revisions
and stale writes are rejected.

## Oracle controller synchronization

After a controller-only update, redeploy this web gateway so its generated
scheduler resolver records the same live Oracle build SHA. The deployment
verifies `resolverAuthority.inSync` before accepting the gateway as healthy.

## Canonical production identity — DO NOT REPLACE WITH LEGACY PROJECTS

- **Android package:** `com.jasonhome2.app`; v2.0.4 is the frozen, restore-verified baseline; v2.0.5 restores illustrative Curtain effect previews and exact observed E-85–E-87 catalog mappings.
- **Active Android/UI branch:** `jason-home-2-web`, with immutable recovery branch `release/jason-home-2-v2.0.4-baseline-20261010` (SHA `d32967c76c5bee2e3af8482cf74687926122508d`).
- **Production Oracle Eufy controller:** commit `8202a5af4336b9a992feb7e51ebf3dc0acb111b7`, frozen as `release/jason-home-2-oracle-controller-20261010`.
- The older GitHub branch named `jason-home-cloudflare-rebuild` is MISNAMED: it actually holds the latest **Oracle** Eufy controller source. **Do not deploy Cloudflare.** Do not use any APK version 5.4.x or source from `JasonHome` for this Android package.
- Oracle E120/E22 purple and Halloween effect encoding, Factory and AI Event Builder must remain unchanged in Curtain-only releases.
- Restore the live SQLite database and private environment (not contained in GitHub), plus nginx/TLS configuration, from a PRIVATE Oracle snapshot. Source zip plus APK is NOT a complete runtime backup.
- The exact recovery package, signed APK, and restore instructions are filed in the owner's Google Drive: `Jason Home 2/Recovery/v2.0.4/`. DO NOT delete legacy recovery until a private database snapshot and restore rehearsal succeed.
- Curtain E-88 **is not in** the captured 88-entry catalog (E-0–E-87); no BLE command is verified. Flip/rotate opcodes are unverified in the original capture and must not be described as physically verified.

## October 11, 2026 — current release: AI brightness/response repair

- Android package remains **Jason Home 2 `com.jasonhome2.app` v2.0.7**. The AI responsiveness update is served over Oracle HTTPS; installing an old APK or restoring an old branch will roll the interface back.
- Fixed preview buttons that forcibly set AI/saved-event brightness to 100%; the AI tab now has a debounced live brightness slider synchronized with Home. Layer transitions keep per-device manual brightness overrides.
- Oracle Eufy controller source commit: `4d55d618069f35f9ea0df67615aae01183ea404b`; always generate resolver from **live controller /api/health**, not an older pinned resolver. This commit optimizes AI E120 scene acknowledgments and continues strict E22 status verification.
- Restore source archive: `Jason Home 2/Recovery/v2.0.7/Jason-Home-2-CURRENT-AI-SOURCE-RECOVERY.zip` in owner's Google Drive.
- Keep the private SQLite database, Oracle .env, nginx/TLS and encrypted Android release signing backup when cleaning up obsolete installers. The source ZIP alone is not a complete Oracle runtime backup.

## 1.1.4 bridge and Studio maintenance

NanoC6 checks signed firmware updates every 60 seconds when automatic updates are enabled, and its Oracle snapshot/long-poll window is five seconds. The Oracle brightness follower uses the authenticated outbound bridge queue, and the experimental Image/GIF Studio Test Save Override control has been removed without changing established Studio controls. Android 2.0.14 continues using Oracle transport.
