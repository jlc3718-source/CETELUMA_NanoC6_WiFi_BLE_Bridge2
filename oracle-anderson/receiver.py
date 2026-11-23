#!/usr/bin/env python3
"""Separate Oracle receiver for Anderson Home controller diagnostics.

No dependency on Jason Home 2 application state, credentials, or databases.
All endpoints are served on loopback; public TLS is terminated by nginx.
"""
import csv
import io
import json
import os
import pathlib
import re
import secrets
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

DATA_DIR = pathlib.Path(os.environ.get("ANDERSON_LOG_DATA", "/var/lib/anderson-logs"))
HOST = "127.0.0.1"
PORT = 8973
MAX_BODY = 12288
MAX_EVENTS = 32
RETENTION_SECONDS = 90 * 86400
KINDS = ("boot", "wifi_change", "scan_start", "scan_complete",
         "ble_connect_attempt", "ble_connected", "ble_connect_failure",
         "ble_write_ok", "ble_write_failed", "wled_ack", "wled_failed",
         "control_command", "schedule_change", "status", "dropped",
         "wled_probe", "wled_online", "wled_offline", "maintenance",
         "upload_retry")

class ValidationError(Exception):
    pass

class Store:
    def __init__(self, directory=DATA_DIR):
        self.directory = pathlib.Path(directory)
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.directory.chmod(0o700)
        self.ingest_token = self._token("ingest.token")
        self.admin_token = self._token("admin.token")
        self.db = self.directory / "events.sqlite3"
        self.lock = threading.Lock()
        self.last_prune = 0
        with self._connect() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS events(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    received INTEGER NOT NULL,
                    device TEXT NOT NULL,
                    boot TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    utc INTEGER,
                    uptime_ms INTEGER NOT NULL,
                    code INTEGER NOT NULL,
                    slot INTEGER NOT NULL,
                    value INTEGER NOT NULL,
                    detail TEXT NOT NULL,
                    UNIQUE(device,boot,seq)
                );
                CREATE INDEX IF NOT EXISTS idx_events_received ON events(received);
            """)

    def _token(self, filename):
        path = self.directory / filename
        if not path.exists():
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            try:
                os.write(fd, secrets.token_urlsafe(40).encode("ascii"))
            finally:
                os.close(fd)
        path.chmod(0o600)
        token = path.read_text().strip()
        if len(token) < 40:
            raise RuntimeError("Refusing a weak log authentication token")
        return token

    def _connect(self):
        con = sqlite3.connect(self.db, timeout=4)
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("PRAGMA busy_timeout=4000")
        con.execute("PRAGMA journal_size_limit=1048576")
        return con

    @staticmethod
    def validate(packet):
        if not isinstance(packet, dict) or packet.get("schema") != 1:
            raise ValidationError("Unsupported diagnostics schema")
        if packet.get("device") != "anderson-nanoc6":
            raise ValidationError("Invalid device")
        boot = packet.get("boot")
        if not isinstance(boot, str) or not re.fullmatch(r"[0-9a-fA-F]{8,16}", boot):
            raise ValidationError("Invalid boot identity")
        events = packet.get("events")
        if not isinstance(events, list) or not 1 <= len(events) <= MAX_EVENTS:
            raise ValidationError("Expected 1-32 diagnostic events")
        rows = []
        for e in events:
            if not isinstance(e, dict):
                raise ValidationError("Invalid diagnostic event")
            seq, up, ts = e.get("seq"), e.get("u"), e.get("ts", 0)
            code, slot, value = e.get("code"), e.get("slot", -1), e.get("value", 0)
            detail = e.get("detail", "")
            if any(type(v) is not int for v in (seq, up, ts, code, slot, value)):
                raise ValidationError("Invalid numeric event field")
            if not (0 <= seq <= 4294967295 and 0 <= up <= 4294967295
                    and 0 <= ts <= 4102444800 and 0 <= code < len(KINDS)
                    and -1 <= slot <= 1 and -2147483648 <= value <= 2147483647):
                raise ValidationError("Event field outside supported range")
            if not isinstance(detail, str) or len(detail) > 192 or any(ord(c) < 32 for c in detail):
                raise ValidationError("Invalid event detail")
            rows.append((boot.upper(), seq, ts, up, code, slot, value, detail))
        return rows

    def ingest(self, packet):
        rows = self.validate(packet)
        now = int(time.time())
        with self.lock, self._connect() as conn:
            for boot, seq, ts, up, code, slot, value, detail in rows:
                conn.execute("""INSERT OR IGNORE INTO events
                    (received,device,boot,seq,utc,uptime_ms,code,slot,value,detail)
                    VALUES(?,?,?,?,?,?,?,?,?,?)""",
                    (now, "anderson-nanoc6", boot, seq, ts or None, up,
                     code, slot, value, detail))
            if now - self.last_prune > 3600:
                conn.execute("DELETE FROM events WHERE received<?", (now-RETENTION_SECONDS,))
                self.last_prune = now
        # Ack IDs even on duplicate receipt: retrying a lost HTTP response is safe.
        return {"ok": True, "accepted": len(rows), "ack": rows[-1][1]}

    def events(self, limit=100):
        with self._connect() as conn:
            rows = conn.execute("""SELECT received,device,boot,seq,utc,uptime_ms,
                code,slot,value,detail FROM events ORDER BY id DESC LIMIT ?""",
                (max(1, min(int(limit), 5000)),)).fetchall()
        return [{"received":r[0],"device":r[1],"boot":r[2],
                 "seq":r[3],"utc":r[4],"uptime_ms":r[5],
                 "code":r[6],"kind":KINDS[r[6]],"slot":r[7],
                 "value":r[8],"detail":r[9]} for r in rows]

def handler_class(store):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        def log_message(self, fmt, *args):
            # Do not log bearer tokens, query strings or individual device payloads.
            return

        def reply(self, status, body, content_type="application/json"):
            if isinstance(body, (dict, list)):
                body = json.dumps(body, separators=(",", ":"))
            raw = body.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def authorized(self, admin=False):
            header = self.headers.get("Authorization", "")
            expected = store.admin_token if admin else store.ingest_token
            return header.startswith("Bearer ") and secrets.compare_digest(header[7:], expected)

        def do_POST(self):
            if urlsplit(self.path).path != "/v1/events":
                return self.reply(404, {"ok": False})
            if not self.authorized():
                return self.reply(401, {"ok": False, "error": "Unauthorized"})
            try:
                length = int(self.headers.get("Content-Length", "-1"))
                if length < 1 or length > MAX_BODY:
                    return self.reply(413, {"ok": False, "error": "Invalid body size"})
                packet = json.loads(self.rfile.read(length))
                answer = store.ingest(packet)
            except (ValueError, UnicodeError, json.JSONDecodeError, ValidationError) as exc:
                return self.reply(400, {"ok": False, "error": str(exc)[:120]})
            except Exception:
                return self.reply(500, {"ok": False, "error": "Storage unavailable"})
            self.reply(200, answer)

        def do_GET(self):
            url = urlsplit(self.path)
            if url.path == "/health":
                return self.reply(200, {"ok": True, "service": "anderson-logs", "schema": 1})
            if url.path not in ("/v1/events", "/v1/export.csv"):
                return self.reply(404, {"ok": False})
            if not self.authorized(admin=True):
                return self.reply(401, {"ok": False, "error": "Unauthorized"})
            try:
                q = parse_qs(url.query)
                n = min(5000, max(1, int(q.get("limit", ["200"])[0])))
                rows = store.events(n)
                if url.path == "/v1/events":
                    return self.reply(200, {"ok": True, "events": rows})
                output = io.StringIO()
                cols = ("received", "device", "boot", "seq", "utc", "uptime_ms",
                        "code", "kind", "slot", "value", "detail")
                writer = csv.DictWriter(output, fieldnames=cols)
                writer.writeheader()
                for row in rows:
                    # Avoid CSV formula injection in user-provided diagnostic details.
                    row = dict(row)
                    if row["detail"].startswith(("=", "+", "-", "@")):
                        row["detail"] = "'" + row["detail"]
                    writer.writerow(row)
                return self.reply(200, output.getvalue(), "text/csv; charset=utf-8")
            except (ValueError, TypeError):
                return self.reply(400, {"ok": False})
            except Exception:
                return self.reply(500, {"ok": False, "error": "Query failed"})
    return Handler

def main():
    store = Store()
    http = ThreadingHTTPServer((HOST, PORT), handler_class(store))
    http.daemon_threads = True
    http.serve_forever(poll_interval=0.5)

if __name__ == "__main__":
    main()
