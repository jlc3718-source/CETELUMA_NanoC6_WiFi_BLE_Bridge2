#!/usr/bin/env bash
set -euo pipefail
mkdir -p /data/profiles /data/logs

# Wide desktop used by automated Playwright runs.
Xvfb :99 -screen 0 1024x768x24 -ac +extension RANDR >/data/logs/xvfb.log 2>&1 &
DISPLAY=:99 openbox >/data/logs/openbox.log 2>&1 &

# Large desktop for manual phone logins; noVNC scales it to the handset while preserving full browser workspace.
Xvfb :100 -screen 0 1920x1080x24 -ac +extension RANDR >/data/logs/xvfb-login.log 2>&1 &
DISPLAY=:100 openbox >/data/logs/openbox-login.log 2>&1 &

x11vnc -display :100 -forever -shared -nopw -rfbport 5900 -listen 127.0.0.1 >/data/logs/x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc/ 6080 127.0.0.1:5900 >/data/logs/websockify.log 2>&1 &

export DISPLAY=:99
export LOGIN_DISPLAY=:100
exec node /app/src/server.js
