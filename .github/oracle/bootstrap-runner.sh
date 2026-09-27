#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2"
RUNNER_DIR="$HOME/actions-runner"
RUNNER_NAME="jason-home-oracle"

echo
echo "=== Jason Home Oracle GitHub Runner Bootstrap ==="
echo

if [ -d "$RUNNER_DIR/.runner" ] || [ -f "$RUNNER_DIR/.runner" ]; then
  echo "A runner is already configured at $RUNNER_DIR."
  echo "Current service status:"
  (cd "$RUNNER_DIR" && sudo ./svc.sh status) || true
  exit 0
fi

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

VERSION="$(python3 - <<'PY'
import json, urllib.request
with urllib.request.urlopen("https://api.github.com/repos/actions/runner/releases/latest", timeout=20) as r:
    print(json.load(r)["tag_name"].lstrip("v"))
PY
)"
PKG="actions-runner-linux-arm64-${VERSION}.tar.gz"
URL="https://github.com/actions/runner/releases/download/v${VERSION}/${PKG}"

echo "Downloading GitHub Actions runner ${VERSION} for Linux ARM64..."
curl -fL --retry 3 -o "$PKG" "$URL"
tar xzf "$PKG"

echo
echo "IMPORTANT: use a FRESH registration token from:"
echo "GitHub repo → Settings → Actions → Runners → New self-hosted runner"
echo
IFS= read -r -s -p "Paste the fresh runner registration token: " RUNNER_TOKEN
echo

./config.sh \
  --url "$REPO_URL" \
  --token "$RUNNER_TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "oracle,jason-home" \
  --work "_work" \
  --unattended \
  --replace

unset RUNNER_TOKEN

echo
echo "Installing runner as an Ubuntu system service..."
sudo ./svc.sh install "$(id -un)"
sudo ./svc.sh start

echo
echo "=== Runner status ==="
sudo ./svc.sh status

echo
echo "Runner bootstrap complete."
echo "GitHub should show: $RUNNER_NAME • Idle"
