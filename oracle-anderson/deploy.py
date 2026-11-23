#!/usr/bin/env python3
"""Deploy a *separate* Anderson Home log receiver on Oracle.

Changes: one new unprivileged systemd service plus a scoped nginx location on
Oracle Home Development's existing TLS vhost. No Jason Home 2 app/DB changes.
Back up every replaced file and automatically roll back deployment failures.
"""
import datetime
import json
import os
import pathlib
import pwd
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

HOSTNAME = "oracle-home-dev.150.136.245.51.sslip.io"
SITE = pathlib.Path("/etc/nginx/sites-enabled/oracle-home-development")
SOURCE = pathlib.Path(__file__).with_name("receiver.py")
INSTALLED = pathlib.Path("/opt/anderson-logs/receiver.py")
UNIT = pathlib.Path("/etc/systemd/system/anderson-logs.service")
DATA = pathlib.Path("/var/lib/anderson-logs")
BACKUPS = pathlib.Path("/var/backups/anderson-logs")
USER = "anderson-logs"
ROUTE = "location ^~ /anderson-logs/"

SERVICE = """[Unit]
Description=Anderson Home isolated diagnostics ingestion service
After=network-online.target

[Service]
Type=simple
User=anderson-logs
Group=anderson-logs
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart=/usr/bin/python3 -I /opt/anderson-logs/receiver.py
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/anderson-logs
LimitNOFILE=128

[Install]
WantedBy=multi-user.target
"""
LOCATION = """
    # Anderson Home diagnostics: independent loopback service, no JH2 forwarding.
    location ^~ /anderson-logs/ {
        proxy_pass http://127.0.0.1:8973/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_connect_timeout 3s;
        proxy_read_timeout 6s;
        client_max_body_size 12k;
    }
"""

def cmd(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True, timeout=25)

def get(url, timeout=4):
    with urllib.request.urlopen(url, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError("Health endpoint did not return 200")
        obj = json.load(response)
        if not obj.get("ok") or obj.get("service") != "anderson-logs":
            raise RuntimeError("Unexpected diagnostics service response")
        return obj

def write_atomic(path, text, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".anderson-stage")
    with open(tmp, "w", encoding="utf-8") as output:
        output.write(text)
        output.flush()
        os.fsync(output.fileno())
    tmp.chmod(mode)
    os.replace(tmp, path)

def ensure_user():
    try: u = pwd.getpwnam(USER)
    except KeyError:
        cmd("useradd", "--system", "--home-dir", str(DATA), "--shell",
            "/usr/sbin/nologin", "--user-group", USER)
        u = pwd.getpwnam(USER)
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    DATA.chmod(0o700)
    os.chown(DATA, u.pw_uid, u.pw_gid)

def check_tls_config(site):
    if "server_name " + HOSTNAME not in site or "listen 443 ssl" not in site:
        raise RuntimeError("Expected TLS site was not found; refusing nginx edit")
    idx = site.index("listen 443 ssl")
    ssl_part = site[idx:]
    m = re.search(r"ssl_certificate\s+([^;\n]+);", ssl_part)
    if not m:
        raise RuntimeError("TLS certificate not found in selected site")
    certificate = m.group(1).strip()
    if certificate.startswith("$") or not pathlib.Path(certificate).is_file():
        raise RuntimeError("TLS certificate path unavailable")
    result = cmd("openssl", "x509", "-in", certificate, "-noout",
                 "-checkhost", HOSTNAME)
    if "does match certificate" not in result.stdout:
        raise RuntimeError("Certificate does not cover Anderson logs endpoint")
    return idx

def site_with_route(site):
    idx = check_tls_config(site)
    if ROUTE in site:
        if site.count(ROUTE) != 1:
            raise RuntimeError("Multiple Anderson diagnostic nginx routes found")
        return site
    # Insert into only the selected Oracle Home Development 443 server.
    at = site.find("location /", idx)
    if at < 0:
        raise RuntimeError("No safe nginx insert point found")
    # The next 443 server must not begin before the intended location.
    next_server = site.find("server {", idx)
    if next_server >= 0 and next_server < at:
        raise RuntimeError("Could not identify selected TLS server block")
    return site[:at] + LOCATION + "    " + site[at:]

def backup_file(path, root):
    target = root / path.name
    if path.exists():
        shutil.copy2(path, target)
        return target
    return None

def restore_file(path, backup):
    if backup is None:
        path.unlink(missing_ok=True)
    else:
        shutil.copy2(backup, path)

def main():
    if os.geteuid() != 0:
        raise SystemExit("Deploy requires root via sudo")
    if not SITE.is_file() or not SOURCE.is_file():
        raise SystemExit("Oracle route or receiver source not found")
    original = SITE.read_text(encoding="utf-8")
    proposed = site_with_route(original)  # preflight before any edits
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    BACKUPS.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup_dir = BACKUPS / stamp
    backup_dir.mkdir(mode=0o700)
    before = {p:backup_file(p, backup_dir) for p in (SITE, INSTALLED, UNIT)}
    old_service = UNIT.exists()
    try:
        ensure_user()
        INSTALLED.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        write_atomic(INSTALLED, SOURCE.read_text(encoding="utf-8"))
        write_atomic(UNIT, SERVICE)
        cmd("systemctl", "daemon-reload")
        cmd("systemctl", "enable", "--now", "anderson-logs.service")
        cmd("systemctl", "restart", "anderson-logs.service")
        for attempt in range(25):
            try:
                get("http://127.0.0.1:8973/health")
                break
            except Exception:
                if attempt == 24:
                    raise RuntimeError("Receiver failed local health check")
                time.sleep(0.5)
        # The proxy is installed only after tests and the local receiver pass.
        if proposed != original:
            write_atomic(SITE, proposed)
            cmd("nginx", "-t")
            cmd("systemctl", "reload", "nginx")
        # Require end-to-end verified HTTPS; no insecure TLS bypass.
        for attempt in range(8):
            try:
                get("https://" + HOSTNAME + "/anderson-logs/health")
                break
            except Exception:
                if attempt == 7:
                    raise RuntimeError("Public TLS diagnostics health check failed")
                time.sleep(1)
        if not (DATA/"ingest.token").is_file() or not (DATA/"admin.token").is_file():
            raise RuntimeError("Receiver authentication credentials missing")
        print(json.dumps({"deployed":True,
              "service":"anderson-logs",
              "public_url":"https://"+HOSTNAME+"/anderson-logs/",
              "health":True,"separate_database":str(DATA/"events.sqlite3"),
              "retention_days":90,"auth_tokens_present":True,
              "token_values_disclosed":False,
              "nginx_backup":str(before[SITE]),"backup_dir":str(backup_dir)}))
    except Exception:
        # Restore *only* files this deployment may have changed.
        for path in (SITE, INSTALLED, UNIT):
            restore_file(path, before[path])
        try:
            cmd("nginx", "-t")
            cmd("systemctl", "reload", "nginx")
        except Exception: pass
        try:
            cmd("systemctl", "daemon-reload")
            if old_service: cmd("systemctl", "restart", "anderson-logs.service")
            else: cmd("systemctl", "disable", "--now", "anderson-logs.service")
        except Exception: pass
        raise

if __name__ == "__main__":
    main()
