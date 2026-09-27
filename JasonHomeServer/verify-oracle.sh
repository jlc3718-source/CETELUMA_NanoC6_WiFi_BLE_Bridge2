#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "ERROR: .env not found in $(pwd)"
  exit 1
fi

TOKEN="$(sed -n 's/^JASON_HOME_API_TOKEN=//p' .env)"
if [ -z "$TOKEN" ]; then
  echo "ERROR: JASON_HOME_API_TOKEN missing from .env"
  exit 1
fi

echo
echo "=== JASON HOME ORACLE VALIDATION ==="
echo

echo "1) Container status"
sudo docker compose ps

echo
echo "2) Health"
curl -fsS http://127.0.0.1:8080/api/health | python3 -m json.tool

echo
echo "3) Eufy readiness"
STATUS="$(curl -fsS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:8080/api/status?refresh=1")"
echo "$STATUS" | python3 -m json.tool

python3 - "$STATUS" <<'PY'
import json,sys
d=json.loads(sys.argv[1])
e=d.get("eufy",{})
names=e.get("readyNames",[])
need={"Pool","House","Garage","Shed"}
if not e.get("ready") or set(names)!=need:
    raise SystemExit("FAIL: Eufy is not Ready 4/4")
print("PASS: Eufy Ready 4/4")
PY

echo
echo "4) Safe Pool status-only MQTT probe"
PROBE="$(curl -fsS -X POST   -H "Authorization: Bearer $TOKEN"   -H "Content-Type: application/json"   --data '{"target":"Pool"}'   http://127.0.0.1:8080/api/mqtt-probe)"
echo "$PROBE" | python3 -m json.tool

python3 - "$PROBE" <<'PY'
import json,sys
d=json.loads(sys.argv[1])
if d.get("ok") is not True or d.get("published") != 1:
    raise SystemExit("FAIL: Pool MQTT probe did not pass")
print("PASS: Pool MQTT status probe")
PY

echo
echo "SAFE VALIDATION PASSED."
echo "No light state has been changed."
echo
printf 'Run the first PHYSICAL Pool test now? This will set Pool to solid RED at 75%% brightness. Type YES to continue: '
read -r ANSWER
if [ "$ANSWER" != "YES" ]; then
  echo "Physical test skipped."
  exit 0
fi

echo
echo "5) Physical Pool RED test"
CONTROL="$(curl -fsS -X POST   -H "Authorization: Bearer $TOKEN"   -H "Content-Type: application/json"   --data '{"target":"Pool","power":true,"brightness":75,"effect":"Solid / Static","colors":[16711680],"speed":3}'   http://127.0.0.1:8080/api/control)"
echo "$CONTROL" | python3 -m json.tool

python3 - "$CONTROL" <<'PY'
import json,sys
d=json.loads(sys.argv[1])
if d.get("ok") is not True or int(d.get("updated",0)) < 1:
    raise SystemExit("FAIL: Pool physical command did not complete")
print("PASS: Oracle sent Pool RED command successfully")
PY

echo
echo "=== VALIDATION COMPLETE ==="
echo "Confirm visually whether Pool is RED."
