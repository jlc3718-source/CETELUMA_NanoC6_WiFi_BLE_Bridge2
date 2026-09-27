#!/usr/bin/env bash
set -euo pipefail

ROOT="$HOME/repo"
SERVER="$ROOT/JasonHomeServer"

echo
echo "=== JASON HOME ORACLE UPDATE ==="

cd "$ROOT"

echo "1) Backing up SQLite..."
mkdir -p "$SERVER/backups"
if [ -f "$SERVER/data/jason-home.sqlite" ]; then
  cp "$SERVER/data/jason-home.sqlite" "$SERVER/backups/jason-home-$(date +%Y%m%d-%H%M%S).sqlite"
  echo "Backup created."
else
  echo "No existing database yet; skipping backup."
fi

echo
echo "2) Updating repository..."
git pull

cd "$SERVER"

echo
echo "3) Rebuilding server..."
sudo docker compose up -d --build

echo
echo "4) Waiting for health..."
for i in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:8080/api/health >/tmp/jh-update-health.json 2>/dev/null; then
    break
  fi
  sleep 2
done

echo
echo "5) Container status..."
sudo docker compose ps

echo
echo "6) Health..."
python3 -m json.tool </tmp/jh-update-health.json

echo
echo "7) HTTPS..."
curl -fsS --resolve "150.136.245.51:443:127.0.0.1" "https://150.136.245.51/api/health" | python3 -m json.tool

echo
echo "=== ORACLE UPDATE COMPLETE ==="
echo "Install/open Jason Home 5.3.6 next."
echo "The app will automatically sync the complete holiday calendar to Oracle."
