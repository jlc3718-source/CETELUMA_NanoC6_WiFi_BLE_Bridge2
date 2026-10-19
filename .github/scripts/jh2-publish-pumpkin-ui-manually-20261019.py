#!/usr/bin/env python3
"""Targeted production patch for Jason Home 2 Curtain UI with retained rollback.
Uses the existing deployment runner and credentials; does not flash firmware.
Verifies both served tab scripts with disposable pumpkin frames and real BLE ACKs.
"""
import pathlib
import hashlib
import json
import os
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
    scripts = [content] if path.suffix in (".mjs", ".js") else re.findall(
        r"<script(?:\s[^>]*)?>(.*?)</script>", content, re.S)
    assert scripts, "No JavaScript found in " + str(path)
    for i, script in enumerate(scripts):
        if not script.strip():
            continue
        subprocess.run(["docker", "exec", "-i", CONTAINER, "node",
                        "--input-type=module", "--check"], input=script,
                       check=True, text=True, capture_output=True)

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def api(path, token):
    req = urllib.request.Request("http://127.0.0.1:8080" + path,
                                 headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.load(res)

def preserved_state():
    backend = json.loads(run("docker", "inspect", "jason-home").stdout)[0]
    web = json.loads(run("docker", "inspect", CONTAINER).stdout)[0]
    env = dict(v.split("=", 1) for v in backend["Config"]["Env"] if "=" in v)
    state = api("/api/status", env["JASON_HOME_API_TOKEN"])
    return {
        "calendar": {key: state["calendar"][key] for key in ("revision", "eventCount")},
        "automationOwner": state["automationOwner"],
        "eufyReady": sorted(state["eufy"]["readyNames"]),
        "backendConfig": backend["Config"], "webConfig": web["Config"],
        "backendMounts": backend["Mounts"], "webMounts": web["Mounts"],
    }

def health():
    try:
        with urllib.request.urlopen("http://127.0.0.1:8081/api/health", timeout=5) as res:
            return b'"ok":true' in res.read().replace(b" ", b"")
    except Exception:
        return False

def main():
    assert health(), "Existing Jason Home 2 service is not healthy: deployment aborted"
    before = preserved_state()
    # Retain rollback bytes privately on Oracle; never export production source.
    releases = pathlib.Path("/home/ubuntu/jh2-pumpkin-ui-releases")
    releases.mkdir(mode=0o700, exist_ok=True)
    releases.chmod(0o700)
    revision = os.environ.get("GITHUB_SHA", "manual")
    release = releases / (time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + revision[:12])
    release.mkdir(mode=0o700)
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
            target = release / ("backup_" + safe)
            run("docker", "cp", f"{CONTAINER}:/app/{destination}", str(target))
            backups[destination] = target
        # Refuse to overwrite encoder changes absent from this reviewed update.
        encoder = (ROOT / "JasonHome2Server/curtain_asset.mjs").read_text()
        old_encoder = re.sub(r"// Sparse SmartDawn doodle update:.*?(?=export const MAX_ASSET_BYTES)",
                             "", encoder, count=1, flags=re.S)
        old_encoder = old_encoder.replace(
            " if(input?.deltaPixels!==undefined)return compileSparseDelta(input);\n", "", 1)
        assert backups["curtain_asset.mjs"].read_text() in (encoder, old_encoder), \
            "Installed encoder has unrelated changes: refusing to overwrite"
        untouched = ["server.mjs", "curtain_bridge.mjs", "web/curtain_converter.html",
                     "web/anderson_home.html", "web/curtain_remote.js"]
        unchanged = {}
        for name in untouched:
            unchanged[name] = run("docker", "exec", CONTAINER, "sha256sum", "/app/" + name).stdout
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
            for source, destination in FILES.items():
                current = t / ("verify_" + destination.replace("/", "__"))
                run("docker", "cp", f"{CONTAINER}:/app/{destination}", str(current))
                assert digest(current) == digest(ROOT / source), "Deployed source digest differs"
            for name, original in unchanged.items():
                assert run("docker", "exec", CONTAINER, "sha256sum", "/app/" + name).stdout == original, \
                    "Unrelated source changed: " + name
            after = preserved_state()
            assert after == before, "Existing scheduler, Eufy, or container configuration changed"
            smoke = ROOT / ".github/scripts/jh2-pumpkin-local-ui-smoke-20261019.mjs"
            run("docker", "cp", str(smoke), f"{CONTAINER}:/tmp/jh2-pumpkin-local-ui-smoke.mjs")
            try:
                result = run("docker", "exec", CONTAINER, "node",
                             "/tmp/jh2-pumpkin-local-ui-smoke.mjs", "--live")
            except subprocess.CalledProcessError as error:
                print((error.stdout or "")[-3000:], flush=True)
                print((error.stderr or "")[-3000:], flush=True)
                raise
            print(result.stdout, end="", flush=True)
            (release / "verified.json").write_text(json.dumps({
                "source": revision, "healthy": True, "unrelatedFeaturesPreserved": True,
                "rollbackFiles": {key: digest(value) for key, value in backups.items()},
                "files": {key: digest(ROOT / key) for key in FILES},
            }, indent=2) + "\n")
            verified = sorted((p for p in releases.iterdir() if (p / "verified.json").is_file()), reverse=True)
            for obsolete in verified[2:]:
                shutil.rmtree(obsolete)
            print("JH2_PUMPKIN_SPARSE_DELTA_AND_LOCAL_GIF_UI_PUBLISHED_HEALTHY")
        except BaseException:
            for destination, original in backups.items():
                run("docker", "cp", str(original), f"{CONTAINER}:/app/{destination}")
            run("docker", "restart", CONTAINER)
            print("JH2_PRODUCTION_PATCH_ROLLED_BACK")
            raise

if __name__ == "__main__":
    main()
