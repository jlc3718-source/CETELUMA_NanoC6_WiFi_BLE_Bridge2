#!/usr/bin/env python3
"""Dedicated SD300 cinematic Agnes batch generator; no credentials in GitHub."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path("/home/ubuntu/agnes-sd300-remake")
CONFIG = ROOT / "sd300-cinematic-batch-v3.json"
STATE = ROOT / "batch-v3-state.json"
KEY = Path("/home/ubuntu/agnes-sd300/key")
API = "https://apihub.agnes-ai.com/v1/videos"
POLL = "https://apihub.agnes-ai.com/agnesapi"
PUBLIC = Path("/var/www/agnes-public/videos")
VOICE = ROOT / "SD300_original_approved_voiceover.m4a"
LOG_PREFIX = "SD300_BATCH_V3"

def log(*args):
    print(LOG_PREFIX, *args, flush=True)

def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)

def read_json(path, default):
    return json.loads(path.read_text()) if path.is_file() else default

def get_data(obj):
    if not isinstance(obj, dict):
        return {}
    for k in ("data", "result", "task"):
        if isinstance(obj.get(k), dict):
            return obj[k]
    return obj

def error_text(obj):
    if not isinstance(obj, dict):
        return "invalid response"
    v = obj.get("error") or obj.get("message") or obj.get("detail") or ""
    if isinstance(v, dict):
        v = v.get("message") or v.get("code") or "API error"
    return str(v)[:260]

def request(url, token, payload=None, timeout=55):
    headers = {"Authorization": "Bearer " + token,
               "Content-Type": "application/json",
               "Accept": "application/json",
               "User-Agent": "SD300-cinematic-batch/3"}
    raw = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(url, data=raw, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read(250000)
            code, head = resp.status, resp.headers
    except urllib.error.HTTPError as err:
        data = err.read(250000)
        code, head = err.code, err.headers
    try:
        obj = json.loads(data)
    except (ValueError, UnicodeDecodeError):
        obj = {"error": "Unparseable API response"}
    return code, obj, head

def retry_delay(headers, failures):
    value = str(headers.get("Retry-After", "")).strip() if headers else ""
    if value:
        try:
            return max(1, min(3600, int(float(value))))
        except (TypeError, ValueError):
            try:
                parsed = parsedate_to_datetime(value)
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                return max(1, min(3600, int(parsed.timestamp() - time.time()) + 1))
            except (TypeError, ValueError, OverflowError):
                pass
    return min(900, 15 * 2 ** min(failures - 1, 6))

def find_video_url(obj):
    if not isinstance(obj, dict):
        return None
    d = get_data(obj)
    for v in (d, obj):
        if not isinstance(v, dict):
            continue
        for field in ("url", "video_url"):
            u = v.get(field)
            if isinstance(u, str) and u.startswith("https://"):
                return u
        for field in ("metadata", "output"):
            item = v.get(field)
            if isinstance(item, dict):
                u = item.get("url") or item.get("video_url")
                if isinstance(u, str) and u.startswith("https://"):
                    return u
            if isinstance(item, list):
                for item0 in item:
                    if isinstance(item0, dict) and isinstance(item0.get("url"), str):
                        return item0["url"]
                    if isinstance(item0, str) and item0.startswith("https://"):
                        return item0
    return None

def probe_video(path):
    command = ["ffprobe", "-v", "error", "-show_streams", "-show_format",
               "-of", "json", str(path)]
    p = subprocess.run(command, check=True, text=True, capture_output=True, timeout=35)
    v = json.loads(p.stdout)
    info = next((s for s in v.get("streams", []) if s.get("codec_type") == "video"), None)
    if not info:
        raise ValueError("No video stream: " + str(path))
    duration = float(v["format"].get("duration", 0))
    if duration < 3 or duration > 30:
        raise ValueError("Unexpected generated duration")
    if int(info.get("width") or 0) < 300 or int(info.get("height") or 0) < 500:
        raise ValueError("Generated resolution is unusable")
    return {"duration": duration, "width": int(info["width"]), "height": int(info["height"])}

def valid_video(path):
    try:
        return path.is_file() and path.stat().st_size > 50000 and bool(probe_video(path))
    except (OSError, ValueError, subprocess.SubprocessError, KeyError):
        return False

def update_item(state, scene_id, **kwargs):
    x = state.setdefault("scenes", {}).setdefault(scene_id, {})
    x.update(kwargs)
    state["updated_utc"] = datetime.now(timezone.utc).isoformat()
    atomic_json(STATE, state)
    return x

def publish_status(state):
    # Best-effort public status: no keys or input credentials.
    try:
        clean = {
            "revision": state.get("revision"),
            "updated_utc": state.get("updated_utc"),
            "assemble_status": state.get("assemble_status", "not_started"),
            "final_name": state.get("final_name"),
            "scenes": [{
                "id": scene.get("id"),
                "status": state.get("scenes", {}).get(scene["id"], {}).get("status", "waiting"),
                "http": state.get("scenes", {}).get(scene["id"], {}).get("http"),
                "attempts": state.get("scenes", {}).get(scene["id"], {}).get("attempts", 0),
                "job_assigned": bool(state.get("scenes", {}).get(scene["id"], {}).get("job_id")),
                "file_bytes": state.get("scenes", {}).get(scene["id"], {}).get("file_bytes")
            } for scene in read_json(CONFIG, {}).get("scenes", [])]
        }
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as out:
            json.dump(clean, out, indent=2)
            tmp = out.name
        try:
            subprocess.run(["sudo", "-n", "install", "-m", "644", tmp,
                            str(PUBLIC / "SD300_Cinematic_AI_Batch_Status.json")],
                           check=True, capture_output=True, timeout=20)
        finally:
            os.unlink(tmp)
    except (OSError, subprocess.SubprocessError):
        pass

def download_video(scene_id, url):
    if not isinstance(url, str) or not url.startswith("https://"):
        raise ValueError("No valid HTTPS video URL")
    req = urllib.request.Request(url, headers={"User-Agent": "SD300-batch/3"})
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = resp.read(90000001)
    if len(data) <= 50000 or len(data) > 90000000 or b"ftyp" not in data[:64]:
        raise ValueError("Not a valid MP4 or file too large")
    dest = ROOT / (scene_id + ".mp4")
    temp = dest.with_suffix(".download")
    with temp.open("wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    if not valid_video(temp):
        temp.unlink(missing_ok=True)
        raise ValueError("Downloaded video failed ffprobe")
    os.replace(temp, dest)
    return dest

def submit(scene, cfg, state, key):
    scene_id = scene["id"]
    item = state.setdefault("scenes", {}).setdefault(scene_id, {})
    if item.get("job_id"):
        log("RESUMING_ACCEPTED_JOB", scene_id)
        return item["job_id"]
    payload = {
        "model": cfg["model"], "mode": cfg["mode"],
        "seconds": cfg["seconds"], "size": cfg["size"],
        "aspect_ratio": cfg["aspect_ratio"], "n": 1,
        "images": scene["reference_images"], "prompt": scene["prompt"]
    }
    failures, queue_attempts = 0, int(item.get("attempts", 0))
    while True:
        if (ROOT / "STOP").exists():
            raise SystemExit("SD300 batch stopped by STOP flag")
        try:
            code, obj, headers = request(API, key, payload)
        except (OSError, TimeoutError) as error:
            failures += 1
            delay = min(120, 2 ** min(failures, 7))
            update_item(state, scene_id, status="network_retry", error=type(error).__name__)
            time.sleep(delay)
            continue
        info = get_data(obj)
        job = info.get("id") or info.get("video_id") or info.get("task_id")
        if code in (200, 201, 202) and job:
            update_item(state, scene_id, status="queued", http=code,
                        job_id=str(job), attempts=queue_attempts, error="")
            log("ACCEPTED", scene_id, "after", queue_attempts, "queue_busy_checks")
            publish_status(state)
            return str(job)
        if code == 503:
            queue_attempts += 1
            if queue_attempts == 1 or queue_attempts % 30 == 0:
                update_item(state, scene_id, status="queue_full_retrying",
                            http=503, attempts=queue_attempts, error=error_text(obj))
                publish_status(state)
                log("QUEUE_FULL", scene_id, "attempts", queue_attempts, "retry_seconds", 1)
            time.sleep(cfg.get("retry_seconds_queue_full", 1))
            continue
        if code == 429:
            failures += 1
            delay = retry_delay(headers, failures)
            update_item(state, scene_id, status="rate_limited", http=429,
                        attempts=queue_attempts, retry_seconds=delay)
            publish_status(state)
            log("RATE_LIMITED", scene_id, "delay_seconds", delay)
            time.sleep(delay)
            continue
        if code in (400, 401, 403, 422):
            update_item(state, scene_id, status="blocked", http=code,
                        error=error_text(obj))
            publish_status(state)
            raise RuntimeError("Provider rejected " + scene_id + " with HTTP " +
                               str(code) + ": " + error_text(obj))
        failures += 1
        delay = min(120, 3 * failures)
        update_item(state, scene_id, status="submit_retry", http=code,
                    error=error_text(obj))
        time.sleep(delay)

def poll(scene, cfg, state, key, job):
    scene_id = scene["id"]
    failures = 0
    while True:
        if (ROOT / "STOP").exists():
            raise SystemExit("SD300 batch stopped by STOP flag")
        try:
            url = API + "/" + urllib.parse.quote(job, safe="")
            code, obj, headers = request(url, key)
            if code == 404:
                args = urllib.parse.urlencode({"video_id": job, "model_name": cfg["model"]})
                code, obj, headers = request(POLL + "?" + args, key)
        except (OSError, TimeoutError) as error:
            failures += 1
            update_item(state, scene_id, status="poll_network_retry",
                        error=type(error).__name__)
            time.sleep(min(90, 3 * failures))
            continue
        if code in (429, 503):
            delay = retry_delay(headers, failures + 1) if code == 429 else 5
            failures += 1
            update_item(state, scene_id, status="poll_wait", http=code)
            time.sleep(delay)
            continue
        if code in (400, 401, 403, 422):
            update_item(state, scene_id, status="blocked", http=code,
                        error=error_text(obj))
            raise RuntimeError("Polling denied HTTP " + str(code))
        if code >= 400:
            time.sleep(10)
            continue
        info = get_data(obj)
        status = str(info.get("status") or obj.get("status") or "pending").lower()
        if status in ("completed", "succeeded", "success", "done"):
            video_url = find_video_url(obj)
            if not video_url:
                update_item(state, scene_id, status="completed_no_url")
                log("MISSING_OUTPUT_URL", scene_id)
                time.sleep(10)
                continue
            try:
                path = download_video(scene_id, video_url)
            except (OSError, ValueError, urllib.error.URLError, subprocess.SubprocessError) as error:
                failures += 1
                update_item(state, scene_id, status="download_retry", error=type(error).__name__)
                time.sleep(min(90, failures * 3))
                continue
            file_hash = hashlib.sha256(path.read_bytes()).hexdigest()
            meta = probe_video(path)
            update_item(state, scene_id, status="downloaded", http=200,
                        file_bytes=path.stat().st_size, sha256=file_hash,
                        duration=meta["duration"], error="")
            publish_status(state)
            log("DOWNLOADED", scene_id, path.stat().st_size, meta["duration"])
            return
        if status in ("failed", "error", "cancelled", "canceled"):
            update_item(state, scene_id, status="generation_failed",
                        error=error_text(obj), job_id=None)
            log("GENERATION_FAILED_RETRY", scene_id)
            return
        update_item(state, scene_id, status=status, http=code)
        if int(time.time()) % 60 < 16:
            publish_status(state)
        time.sleep(15)

def ensure_voice(cfg):
    if VOICE.is_file() and hashlib.sha256(VOICE.read_bytes()).hexdigest() == cfg["voiceover_sha256"]:
        return
    req = urllib.request.Request(cfg["voiceover_url"], headers={"User-Agent": "SD300-batch/3"})
    with urllib.request.urlopen(req, timeout=100) as resp:
        data = resp.read(15000000)
    if hashlib.sha256(data).hexdigest() != cfg["voiceover_sha256"]:
        raise ValueError("Approved original audio checksum differs; refusing assembly")
    tmp = VOICE.with_suffix(".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, VOICE)

def normalize(scene, src, dest):
    seconds = float(scene["target_seconds"])
    frames = round(seconds * 30)
    filters = (
        "fps=30,scale=720:1280:force_original_aspect_ratio=decrease:"
        "flags=lanczos,pad=720:1280:(ow-iw)/2:(oh-ih)/2,"
        "tpad=stop_mode=clone:stop_duration=10,"
        "trim=duration=" + str(seconds) + ",setpts=PTS-STARTPTS,format=yuv420p"
    )
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
               "-i", str(src), "-map", "0:v:0", "-an", "-vf", filters,
               "-frames:v", str(frames), "-c:v", "libx264", "-preset", "veryfast",
               "-crf", "17", "-pix_fmt", "yuv420p", "-r", "30",
               "-video_track_timescale", "30000", "-movflags", "+faststart", str(dest)]
    subprocess.run(command, check=True, timeout=900)
    if not valid_video(dest):
        raise RuntimeError("Normalized video invalid " + scene["id"])

def assemble(cfg, state):
    ensure_voice(cfg)
    dest = ROOT / cfg["output_name"]
    if dest.is_file() and dest.stat().st_size > 10000000:
        log("ALREADY_ASSEMBLED", dest)
        return
    norm_dir = ROOT / "normalized-v3"
    norm_dir.mkdir(exist_ok=True)
    paths = []
    for i, scene in enumerate(cfg["scenes"]):
        src = ROOT / (scene["source_file"] if scene.get("approved") else scene["id"] + ".mp4")
        if not valid_video(src):
            raise RuntimeError("Cannot assemble: missing source " + str(src))
        out = norm_dir / (scene["id"] + ".mp4")
        if not valid_video(out):
            log("NORMALIZING", i + 1, "of", len(cfg["scenes"]), scene["id"])
            normalize(scene, src, out)
        paths.append(out)
    listing = ROOT / "batch-v3-concat.txt"
    listing.write_text("".join("file '" + str(p) + "'\n" for p in paths))
    video = ROOT / "batch-v3-joined-video.mp4"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
                    "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
                    "-map", "0:v:0", "-c", "copy", "-movflags", "+faststart", str(video)],
                   check=True, timeout=600)
    temp = ROOT / (cfg["output_name"] + ".tmp.mp4")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
                    "-y", "-i", str(video), "-i", str(VOICE),
                    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy",
                    "-t", str(cfg.get("voiceover_seconds", 103.2)),
                    "-movflags", "+faststart", str(temp)], check=True, timeout=600)
    data = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                           "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
                           str(temp)], check=True, capture_output=True, text=True)
    duration = float(data.stdout.strip())
    if not (103.0 <= duration <= 103.35):
        raise RuntimeError("Final runtime mismatch " + str(duration))
    if temp.stat().st_size < 10000000:
        raise RuntimeError("Final filesize implausibly small")
    os.replace(temp, dest)
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
                    "-i", str(dest), "-map", "0:v:0", "-f", "null", "-"],
                   check=True, timeout=900)
    subprocess.run(["sudo", "-n", "install", "-m", "644", str(dest),
                    str(PUBLIC / dest.name)], check=True, timeout=60)
    state["assemble_status"] = "completed"
    state["final_name"] = dest.name
    state["final_bytes"] = dest.stat().st_size
    state["final_duration"] = duration
    atomic_json(STATE, state)
    publish_status(state)
    log("ASSEMBLED_COMPLETE", dest, "duration", duration, "bytes", dest.stat().st_size)

def main():
    cfg = read_json(CONFIG, {})
    assert cfg.get("model") == "agnes-video-2.5-flash"
    assert cfg.get("size") == "720P" and int(cfg.get("seconds", 0)) == 12
    assert len(cfg.get("scenes", [])) == 11
    assert cfg["scenes"][0]["approved"] is True
    assert abs(sum(float(s["target_seconds"]) for s in cfg["scenes"]) - 103.2) < 0.01
    assert cfg["retry_seconds_queue_full"] == 1
    if not valid_video(ROOT / cfg["scenes"][0]["source_file"]):
        raise RuntimeError("User-approved cinematic Part 1 missing or invalid")
    if not KEY.is_file():
        raise RuntimeError("Private Agnes credential missing on Oracle")
    token = KEY.read_text().strip()
    if not token:
        raise RuntimeError("Empty Agnes credential")
    state = read_json(STATE, {})
    if state.get("revision") not in (None, cfg["revision"]):
        raise RuntimeError("Existing state revision differs; refuse to overwrite")
    state["revision"] = cfg["revision"]
    state.setdefault("scenes", {})
    state.setdefault("assemble_status", "not_started")
    update_item(state, cfg["scenes"][0]["id"], status="approved",
                file_bytes=(ROOT / cfg["scenes"][0]["source_file"]).stat().st_size)
    publish_status(state)
    ensure_voice(cfg)
    for scene in cfg["scenes"][1:]:
        sid = scene["id"]
        path = ROOT / (sid + ".mp4")
        if valid_video(path):
            update_item(state, sid, status="downloaded",
                        file_bytes=path.stat().st_size)
            continue
        while not valid_video(path):
            job = submit(scene, cfg, state, token)
            poll(scene, cfg, state, token, job)
    state["assemble_status"] = "assembling"
    atomic_json(STATE, state)
    publish_status(state)
    assemble(cfg, state)

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log("FATAL", type(error).__name__, str(error)[:400])
        raise
