#!/usr/bin/env python3
"""One-time, operator-run production patch for Jason Home 2 Curtain UI.
No persistent trigger, no flash/BLE actions, no device commands, no secrets read.
Backs up and rolls back only the three requested UI/encoder assets and cache-bust links.
"""
import pathlib
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTAINER = "jason-home-2-web"
FILES = {
    "JasonHome2Server/curtain_asset.mjs": "curtain_asset.mjs",
    "JasonHome2Server/curtain_native_test.html": "web/curtain_native_test.html",
    "JasonHome2Server/curtain_local_test.html": "web/curtain_local_test.html",
}
ROUTE = "web/curtain.js"

def run(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True)

def validate_js(path, temporary):
    content = path.read_text()
    scripts = [content] if path.suffix == ".mjs" else re.findall(
        r"<script(?:\\s[^>]*)?>(.*?)</script>", content, re.S)
    for i, script in enumerate(scripts):
        if not script.strip():
            continue
        trial = temporary / (path.name + f"-{i}.js")
        trial.write_text(script)
        run("node", "--check", str(trial))

def health():
    try:
        with urllib.request.urlopen("http://127.0.0.1:8081/api/health", timeout=5) as res:
            return b'"ok":true' in res.read().replace(b" ", b"")
    except Exception:
        return False

def main():
    assert health(), "Existing Jason Home 2 service is not healthy: deployment aborted"
    with tempfile.TemporaryDirectory(prefix="jh2-pumpkin-patch-") as temp:
        t = pathlib.Path(temp)
        for source in FILES:
            p = ROOT / source
            assert p.is_file(), source
            validate_js(p, t)
        # Backup every original before writing any production byte.
        backups = {}
        for destination in (*FILES.values(), ROUTE):
            safe = destination.replace("/", "__")
            target = t / ("backup_" + safe)
            run("docker", "cp", f"{CONTAINER}:/app/{destination}", str(target))
            backups[destination] = target
        # Change only the iframe query strings, not the live hosting architecture.
        route = backups[ROUTE].read_text()
        updated = route
        for old, new in (
            ("curtain_native_test.html?v=ram-upload-1.1.49",
             "curtain_native_test.html?v=pumpkin-delta-20261019"),
            ("curtain_local_test.html?v=nano-cache-1",
             "curtain_local_test.html?v=gif-frames-20261019"),
        ):
            if updated.count(old) == 1:
                updated = updated.replace(old, new)
            elif new not in updated:
                raise RuntimeError("Unrecognized live Curtain iframe route: " + old)
        routefile = t / "new_curtain.js"
        routefile.write_text(updated)
        validate_js(routefile, t)
        try:
            for source, destination in FILES.items():
                run("docker", "cp", str(ROOT / source), f"{CONTAINER}:/app/{destination}")
            if updated != route:
                run("docker", "cp", str(routefile), f"{CONTAINER}:/app/{ROUTE}")
            run("docker", "restart", CONTAINER)
            for _ in range(30):
                if health():
                    break
                time.sleep(2)
            else:
                raise RuntimeError("Health check failed following web restart")
            expected = ("deltaPixels", "new ImageDecoder", "send3")
            checks = (
                ("curtain_asset.mjs", expected[0]),
                ("web/curtain_local_test.html", expected[1]),
                ("web/curtain_native_test.html", expected[2]),
            )
            for destination, marker in checks:
                current = run("docker", "exec", CONTAINER, "cat", "/app/" + destination).stdout
                assert marker in current, f"Production verification failed: {destination}"
            print("JH2_PUMPKIN_SPARSE_DELTA_AND_LOCAL_GIF_UI_PUBLISHED_HEALTHY")
        except BaseException:
            for destination, original in backups.items():
                run("docker", "cp", str(original), f"{CONTAINER}:/app/{destination}")
            run("docker", "restart", CONTAINER)
            print("JH2_PRODUCTION_PATCH_ROLLED_BACK")
            raise

if __name__ == "__main__":
    main()
