#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo
echo "=== JASON HOME ORACLE SERVER SETUP ==="
echo

echo "Updating repository..."
git -C .. pull

mkdir -p data
rm -f "$HOME/.env" .env

echo
echo "Enter your Eufy credentials."
echo "Your password will NOT appear while typing."
echo

IFS= read -r -p "Eufy email: " EUFY_EMAIL
IFS= read -r -s -p "Eufy password: " EUFY_PASSWORD
echo

TOKEN="$(openssl rand -hex 32)"

umask 077
cat > .env <<EOF
EUFY_EMAIL=$EUFY_EMAIL
EUFY_PASSWORD=$EUFY_PASSWORD
JASON_HOME_API_TOKEN=$TOKEN
HOME_LAT=42.0529
HOME_LON=-79.0576
HOME_TZ=America/New_York
JASON_HOME_DB=/data/jason-home.sqlite
PORT=8080
EOF
chmod 600 .env
unset EUFY_PASSWORD EUFY_EMAIL

echo
echo "Configuration created."
echo "A new Jason Home API token was generated and stored securely in .env."
echo "It will NOT be displayed."
echo

echo "=== STARTING DOCKER ==="
sudo systemctl enable --now docker

echo
echo "=== BUILDING JASON HOME SERVER ==="
sudo docker compose down 2>/dev/null || true
sudo docker compose up -d --build

echo
echo "=== WAITING FOR SERVER ==="
READY=0
for i in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:8080/api/health >/tmp/jh-health.json 2>/dev/null; then
    READY=1
    break
  fi
  sleep 2
done

echo
echo "=== CONTAINER STATUS ==="
sudo docker compose ps

if [ "$READY" -ne 1 ]; then
  echo
  echo "SERVER DID NOT BECOME READY."
  echo "=== LAST SERVER LOGS ==="
  sudo docker compose logs --tail=120
  exit 1
fi

echo
echo "=== HEALTH TEST ==="
python3 -m json.tool </tmp/jh-health.json

echo
echo "=== EUFY LOGIN / DEVICE DISCOVERY TEST ==="
RESULT="$(curl -fsS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:8080/api/status?refresh=1")"
echo "$RESULT" | python3 -m json.tool

echo
echo "=========================================="
echo " JASON HOME ORACLE SETUP FINISHED"
echo "=========================================="
echo
echo 'Look above for: "status": "Ready 4/4"'
echo "and Pool, House, Garage, Shed."
echo
echo "No lights were changed by this test."
echo "API token stored securely in:"
echo "  $(pwd)/.env"
