#!/usr/bin/env python3
"""Safe SD300 per-scene QC approval/rejection. Executed by trusted GitHub Actions on Oracle."""
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path("/home/ubuntu/agnes-sd300")
PUBLIC = Path("/var/www/agnes-public/videos")
SERVICE = "agnes-sd300.service"
IDS = {"01_electrician", "02_gear", "03_setup", "04_running", "05_boot",
       "06_night", "07_morning", "08_morning_detail", "09_ready_for_work"}

def cmd(*args, check=True):
    return subprocess.run(args, text=True, check=check, capture_output=True, timeout=65)

def atomic_state(path, data):
    st = path.stat()
    tmp = path.with_name(path.name + ".review-" + uuid.uuid4().hex + ".tmp")
    try:
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, st.st_mode & 0o777)
        os.chown(tmp, st.st_uid, st.st_gid)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)

def main():
    if os.geteuid() != 0:
        raise SystemExit("Requires sudo -n")
    scene = os.environ.get("SD300_SCENE", "")
    decision = os.environ.get("SD300_DECISION", "")
    reason = os.environ.get("SD300_REASON", "Quality control review")[:350]
    if scene not in IDS or decision not in ("approve", "reject"):
        raise SystemExit("Invalid review decision or scene")
    if not (ROOT / "key").is_file():
        raise SystemExit("Existing Agnes runner not detected; abort")
    was_active = cmd("systemctl", "is-active", "--quiet", SERVICE, check=False).returncode == 0
    # Stop the writer so we cannot race a state.json change or partial MP4 rename.
    cmd("systemctl", "stop", SERVICE)
    try:
        cfg = json.loads((ROOT / "scene-manifest.json").read_text())
        state_path = ROOT / "state.json"
        state = json.loads(state_path.read_text())
        if scene not in {s["id"] for s in cfg.get("scenes", [])}:
            raise RuntimeError("Scene not present in current manifest")
        x = state.get(scene, {})
        if x.get("revision") != cfg["revision"]:
            raise RuntimeError("Clip belongs to an older revision; refusing review")
        mp4 = ROOT / (scene + ".mp4")
        if x.get("status") != "downloaded" or not mp4.is_file() or mp4.stat().st_size < 2000:
            raise RuntimeError("Only a fully downloaded current-revision MP4 can be reviewed")
        sha256 = hashlib.sha256(mp4.read_bytes()).hexdigest()
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
        folder = ROOT / "managed-reviews" / (stamp + "-" + uuid.uuid4().hex[:8])
        folder.mkdir(parents=True, exist_ok=False)
        shutil.copy2(state_path, folder / "state.json.before-review")
        meta = {"scene": scene, "decision": decision, "reason": reason,
                "revision": cfg["revision"], "sha256": sha256, "utc": stamp}
        (folder / "decision.json").write_text(json.dumps(meta, indent=2) + "\n")
        if decision == "approve":
            x["approved"] = True
            x["review_status"] = "approved"
            x["approved_sha256"] = sha256
            x["reviewed_at_utc"] = stamp
            x["review_reason"] = reason
            print("SCENE_APPROVED", scene, sha256, flush=True)
        else:
            # Never discard a rejected video. Move it into the private dated review backup.
            shutil.move(str(mp4), str(folder / (scene + ".rejected.mp4")))
            pub = PUBLIC / (scene + ".mp4")
            if pub.is_file():
                shutil.move(str(pub), str(folder / (scene + ".published-rejected.mp4")))
            attempts = int(x.get("review_attempts", 0)) + 1
            x.update({"id": None, "status": "retrying" if attempts < 5 else "failed",
                      "approved": False, "review_status": "rejected",
                      "approved_sha256": None, "review_attempts": attempts,
                      "reviewed_at_utc": stamp, "review_reason": reason,
                      "http": None,
                      "error": "Visual QC rejected; regeneration pending" if attempts < 5
                              else "QC failed five times; paused for manual inspection"})
            print("SCENE_REJECTED", scene, "attempts", attempts, "retrying", attempts < 5, flush=True)
        state[scene] = x
        atomic_state(state_path, state)
        print("REVIEW_APPLIED", cfg["revision"], scene, decision, flush=True)
    finally:
        if was_active:
            cmd("systemctl", "start", SERVICE)

if __name__ == "__main__":
    main()
