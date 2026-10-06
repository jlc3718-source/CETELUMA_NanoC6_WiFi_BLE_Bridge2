#!/usr/bin/env bash
set -euo pipefail
mkdir -p /data/profiles /data/logs
Xvfb :99 -screen 0 1365x900x24 -ac +extension RANDR >/data/logs/xvfb.log 2>&1 &
openbox >/data/logs/openbox.log 2>&1 &
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -listen 127.0.0.1 >/data/logs/x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc/ 6080 127.0.0.1:5900 >/data/logs/websockify.log 2>&1 &
export DISPLAY=:99
exec node /app/src/server.js
