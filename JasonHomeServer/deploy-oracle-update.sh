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
echo "8) Preloading Eufy factory catalog..."
TOKEN="$(sed -n 's/^JASON_HOME_API_TOKEN=//p' .env)"
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{}' http://127.0.0.1:8080/api/eufy/factory-presets/refresh >/tmp/jh-factory-refresh.json
for i in $(seq 1 90); do
  CATALOG="$(curl -fsS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:8080/api/eufy/factory-presets" || true)"
  COUNT="$(printf '%s' "$CATALOG" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("totalCount",0))' 2>/dev/null || echo 0)"
  STATE="$(printf '%s' "$CATALOG" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("refresh") or {}).get("state",""))' 2>/dev/null || true)"
  if [ "$COUNT" -gt 0 ] && [ "$STATE" != "running" ]; then
    printf '%s' "$CATALOG" | python3 -m json.tool | head -40
    echo "Factory catalog ready: $COUNT presets."
    break
  fi
  sleep 2
done

echo
echo "=== ORACLE UPDATE COMPLETE ==="
echo "Install/open Jason Home 5.3.7 next."
echo "Holiday scheduling remains on Oracle."
echo "Factory Lab stays isolated in its own tab and sends test presets to all four strings."
