# Jason Home 2

Jason Home 2 is a separate Android package (`com.jasonhome2.app`) and a
hosted web gateway. It reuses the running Oracle scheduler and Eufy transport,
so this test installation does not start a second scheduler.

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

The original Android app and server source remain present. Jason Home 2
shares the active Oracle controller for actual device operations. Do not
use both interfaces to edit the same event concurrently: edits use Oracle
calendar revisions and stale writes are rejected.
