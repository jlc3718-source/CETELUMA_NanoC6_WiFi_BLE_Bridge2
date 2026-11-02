#!/usr/bin/env python3
"""Owner-controlled Oracle host diagnostics via GitHub's existing self-hosted runner.

Command inputs are operation names only. This file never invokes a shell,
runs arbitrary user strings, reads secrets/env files, or changes system state.
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REQUEST = Path(".github/jh2-terminal-bridge/requests/active.json")
SAFE_ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C", "LC_ALL": "C"}
# Every command and argument is fixed. No interpolation from GitHub request data.
COMMANDS = {
    "host": [
        ("host_uptime", ["uptime"]),
        ("host_identity", ["id"]),
        ("cpu_mem", ["free", "-m"]),
        ("disk_root", ["df", "-Pm", "/"]),
        ("disk_application", ["df", "-Pm", "/opt/jason-home-2"]),
    ],
    "network": [
        ("listeners", ["ss", "-lnt"]),
        ("ipv4_addresses", ["ip", "-br", "-4", "address", "show"]),
        ("routes", ["ip", "-4", "route", "show"]),
        ("home_ddns", ["getent", "ahostsv4", "craumer.tplinkdns.com"]),
        ("oracle_public", ["curl", "-k", "-sS", "-o", "/dev/null", "-m", "8", "-w", "Oracle HTTPS: %{http_code}\n", "https://150.136.245.51/jason-home-2/api/health"]),
    ],
    "application": [
        ("web_health", ["curl", "-sS", "-o", "/dev/null", "-m", "8", "-w", "Gateway HTTP: %{http_code}\n", "http://127.0.0.1:8081/api/health"]),
        ("controller_health", ["curl", "-sS", "-o", "/dev/null", "-m", "8", "-w", "Controller HTTP: %{http_code}\n", "http://127.0.0.1:8080/api/health"]),
        ("docker_ps", ["sudo", "-n", "docker", "ps", "--format", "{{.Names}} | {{.Status}} | {{.Ports}}"]),
        ("nginx_test", ["sudo", "-n", "nginx", "-t"]),
        ("nginx_active", ["systemctl", "is-active", "nginx"]),
        ("docker_active", ["systemctl", "is-active", "docker"]),
    ],
}
OPERATIONS = {
    "host_health": ("host",),
    "network_diagnostics": ("network",),
    "application_diagnostics": ("application",),
    "full_diagnostics": ("host", "network", "application"),
}
MAX_OUTPUT_PER_COMMAND = 2500

def redact(value):
    value = re.sub(r"(?i)\b(token|api[_-]?key|password|authorization|secret)\b\s*[:=]\s*\S+", r"\1=[REDACTED]", value)
    # Never accidentally print bearer tokens if a tool alters its output.
    value = re.sub(r"\b[0-9a-fA-F]{48,}\b", "[LONG_HEX_REDACTED]", value)
    return value[:MAX_OUTPUT_PER_COMMAND]

def main():
    if len(sys.argv) != 1:
        raise SystemExit("No positional arguments accepted")
    raw = REQUEST.read_bytes()
    if len(raw) > 1024:
        raise SystemExit("Request size limit exceeded")
    data = json.loads(raw)
    if not isinstance(data, dict) or set(data) != {"schema", "operation", "request_id"}:
        raise SystemExit("Invalid request fields")
    if data["schema"] != 1:
        raise SystemExit("Unsupported request schema")
    op = data["operation"]
    rid = data["request_id"]
    if not isinstance(op, str) or op not in OPERATIONS:
        raise SystemExit("Operation is not allowlisted")
    if not isinstance(rid, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", rid):
        raise SystemExit("Invalid request ID")
    print(f"JH2_ORACLE_TERMINAL_BEGIN id={rid} op={op}", flush=True)
    print(f"JH2_ORACLE_TERMINAL_HOST_OS user={os.getuid()} host={os.uname().nodename}", flush=True)
    count = 0
    for section in OPERATIONS[op]:
        for label, argv in COMMANDS[section]:
            started = time.monotonic()
            try:
                p = subprocess.run(argv, shell=False, capture_output=True, text=True,
                                   timeout=10, env=SAFE_ENV, check=False)
                status = f"exit={p.returncode}"
                output = redact((p.stdout or "") + (p.stderr or ""))
            except subprocess.TimeoutExpired:
                status, output = "timeout", "Command exceeded ten seconds."
            except OSError as exc:
                status, output = "unavailable", str(type(exc).__name__)
            print(f"JH2_DIAG {section}/{label} {status} elapsed_ms={round((time.monotonic()-started)*1000)}", flush=True)
            if output.strip():
                print(output.strip(), flush=True)
            count += 1
    print(f"JH2_ORACLE_TERMINAL_DONE id={rid} commands={count} readonly=true", flush=True)

if __name__ == "__main__":
    main()
