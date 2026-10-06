#!/usr/bin/env bash
set -euo pipefail
mkdir -p /data/profiles /data/logs
Xvfb :99 -screen 0 1365x900x24 -ac +extension RANDR >/data/logs/xvfb.log 2>&1 &
openbox >/data/logs/openbox.log 2>&1 &
export DISPLAY=:99
exec node /app/src/server.js
