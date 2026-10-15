#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "ERROR: .env not found"
  exit 1
fi

TOKEN="$(sed -n 's/^JASON_HOME_API_TOKEN=//p' .env)"
if [ -z "$TOKEN" ]; then
  echo "ERROR: API token missing"
  exit 1
fi

call_control() {
  local target="$1" color="$2" label="$3" payload
  echo
  echo "=== $target -> $label ==="
  printf -v payload '{"target":"%s","power":true,"brightness":75,"effect":"Solid / Static","colors":[%s],"speed":3}' "$target" "$color"
  curl -fsS -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    --data "$payload" \
    http://127.0.0.1:8080/api/control | python3 -m json.tool
}

echo
echo "=== JASON HOME FOUR-LIGHT PHYSICAL VALIDATION ==="
echo
echo "This will set:"
echo "  Pool   = RED"
echo "  House  = GREEN"
echo "  Garage = BLUE"
echo "  Shed   = ORANGE"
echo
printf "Type YES to run all four physical tests: "
read -r answer
case "${answer,,}" in
  y|yes) ;;
  *) echo "Test skipped."; exit 0 ;;
esac

call_control "Pool"   16711680 "RED"
sleep 1
call_control "House"  65280    "GREEN"
sleep 1
call_control "Garage" 255      "BLUE"
sleep 1
call_control "Shed"   16753920 "ORANGE"

echo
echo "=== FOUR-LIGHT COMMAND TEST COMPLETE ==="
echo "Visually confirm:"
echo "  Pool RED"
echo "  House GREEN"
echo "  Garage BLUE"
echo "  Shed ORANGE"
echo
echo "No All-target command was used."
