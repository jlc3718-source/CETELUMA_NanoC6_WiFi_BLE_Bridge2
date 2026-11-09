#!/usr/bin/env bash
# One-shot, guarded deployment of the reviewed Eufy Mega authentication patch.
# Never calls Eufy or changes light states. Preserves .env, settings and data.
set -Eeuo pipefail
umask 077

REPO=/home/ubuntu/repo
APP="$REPO/JasonHomeServer"
BASE=origin/fix/eufy-auth-100028-backoff-20261108
FIX=origin/fix/eufy-mega-auth-captcha-2fa-session-20261109
SERVICE=jason-home
PORT=8080
REL_SERVER=JasonHomeServer/src/server.ts
REL_CLIENT=JasonHomeServer/src/eufy/client.ts
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$HOME/jason-home-backups/eufy-mega-$STAMP"
PATCH="$BACKUP/eufy-auth.patch"
CHANGED=0
RESTARTED=0
COMPLETED=0
OLD_IMAGE_ID=""
OLD_IMAGE_TAG=""

failed() { echo "STOP: $*" >&2; exit 1; }
rollback() {
  local code=$?
  if [[ $COMPLETED == 1 || $CHANGED != 1 ]]; then return; fi
  set +e
  echo "DEPLOY FAILED: restoring the two prior Eufy source files from backup..."
  cp -a "$BACKUP/client.ts" "$APP/src/eufy/client.ts"
  cp -a "$BACKUP/server.ts" "$APP/src/server.ts"
  git -C "$REPO" reset -q -- "$REL_CLIENT" "$REL_SERVER"
  if [[ $RESTARTED == 1 && -n $OLD_IMAGE_ID && -n $OLD_IMAGE_TAG ]]; then
    echo "Restoring the previously running Docker image..."
    sudo docker image tag "$OLD_IMAGE_ID" "$OLD_IMAGE_TAG"
    (cd "$APP" && sudo docker compose up -d --no-deps --force-recreate "$SERVICE")
  fi
  echo "Previous code restored. SQLite and .env were NOT overwritten. Backup: $BACKUP"
  return "$code"
}
trap rollback EXIT

[[ -d "$REPO/.git" ]] || failed "Oracle Git checkout missing at $REPO"
[[ -f "$APP/docker-compose.yml" && -f "$APP/.env" ]] || failed "Live Compose/.env missing; nothing changed"
[[ -f "$APP/src/server.ts" && -f "$APP/src/eufy/client.ts" ]] || failed "Live source files missing; nothing changed"
[[ -d "$APP/data" && -f "$APP/data/jason-home.sqlite" ]] || failed "Expected live SQLite database missing; nothing changed"
git -C "$REPO" rev-parse --verify "$BASE^{commit}" >/dev/null || failed "Base branch not fetched"
git -C "$REPO" rev-parse --verify "$FIX^{commit}" >/dev/null || failed "Repair branch not fetched"
git -C "$REPO" diff --quiet HEAD -- "$REL_SERVER" "$REL_CLIENT" || failed "Live files contain local changes; cannot apply safely"
git -C "$REPO" diff --cached --quiet -- "$REL_SERVER" "$REL_CLIENT" || failed "Live files are staged; cannot apply safely"
sudo docker inspect "$SERVICE" >/dev/null || failed "Expected Docker container missing"
[[ -n "$(cd "$APP" && sudo docker compose ps -q "$SERVICE")" ]] || failed "Docker Compose service not found"

mkdir -p "$BACKUP"
chmod 700 "$BACKUP"
git -C "$REPO" diff --binary "$BASE" "$FIX" -- "$REL_SERVER" "$REL_CLIENT" > "$PATCH"
[[ -s "$PATCH" ]] || failed "Expected two-file source patch is empty"
# -3way checks for a clean merge against the actual current production files.
git -C "$REPO" apply --3way --check "$PATCH" || failed "Production source diverges from reviewed patch; nothing deployed"
cp -a "$APP/src/eufy/client.ts" "$BACKUP/client.ts"
cp -a "$APP/src/server.ts" "$BACKUP/server.ts"
cp -a "$APP/docker-compose.yml" "$BACKUP/docker-compose.yml"
cp -a "$APP/.env" "$BACKUP/.env"
OLD_IMAGE_ID="$(sudo docker inspect "$SERVICE" --format '{{.Image}}')"
OLD_IMAGE_TAG="$(sudo docker inspect "$SERVICE" --format '{{.Config.Image}}')"
[[ -n $OLD_IMAGE_ID && -n $OLD_IMAGE_TAG ]] || failed "Could not identify current Docker image"
sudo docker image tag "$OLD_IMAGE_ID" "jason-home-eufy-backup:$STAMP"

# Use SQLite's online backup API so the database AND its WAL stay consistent.
sudo python3 - "$APP/data/jason-home.sqlite" "$BACKUP/jason-home.sqlite" <<'PY'
import sqlite3,sys
with sqlite3.connect(sys.argv[1]) as source,sqlite3.connect(sys.argv[2]) as dest:
    source.backup(dest)
    status=dest.execute("PRAGMA quick_check").fetchone()[0]
    if status!="ok":raise RuntimeError("SQLite backup integrity failed: "+str(status))
PY
[[ -s "$BACKUP/jason-home.sqlite" ]] || failed "Database snapshot missing"

# Ensure the backend will never auto-attempt password authentication on startup.
sudo python3 - "$APP/data/jason-home.sqlite" <<'PY'
import sqlite3,sys,time
with sqlite3.connect(sys.argv[1],timeout=20) as db:
    db.execute("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        ("eufy_auto_pause_until_v1",str(int(time.time()*1000)+24*60*60*1000)))
    # Preserve the existing user-requested Eufy scheduler stop across rollback.
    db.execute("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        ("automation_owner","direct"))
PY

echo "Backup verified; applying reviewed authentication-only code patch..."
CHANGED=1
git -C "$REPO" apply --3way "$PATCH"

echo "Building Docker image without stopping the old container..."
(cd "$APP" && sudo docker compose build "$SERVICE")
echo "Replacing only the Eufy backend container..."
RESTARTED=1
(cd "$APP" && sudo docker compose up -d --no-deps --force-recreate "$SERVICE")

HEALTHY=0
for i in $(seq 1 45); do
  if curl --max-time 2 -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then HEALTHY=1; break; fi
  sleep 2
done
[[ $HEALTHY == 1 ]] || failed "Backend did not pass local HTTP health test"

TOKEN="$(sed -n 's/^JASON_HOME_API_TOKEN=//p' "$APP/.env" | head -1)"
[[ -n $TOKEN ]] || failed "Existing local API token missing"
curl --max-time 5 -fsS -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:$PORT/api/eufy/auto-login" |
python3 -c 'import json,sys; s=json.load(sys.stdin); assert s.get("paused") is True, "Automatic Eufy login is not paused"'
unset TOKEN
echo "VERIFIED: backend healthy, automatic Eufy login still paused."
echo "No Eufy sign-in or light command was issued by this deployment script."
echo "Rollback backups preserved in: $BACKUP"
COMPLETED=1
