#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2"
RUNNER_DIR="$HOME/actions-runner"
RUNNER_NAME="jason-home-oracle"
RUNNER_LABEL="jason-home-oracle"

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as the ubuntu user, not root."
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) ASSET_ARCH="arm64" ;;
  x86_64|amd64) ASSET_ARCH="x64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

echo
echo "=== JASON HOME ORACLE GITHUB RUNNER SETUP ==="
echo
echo "Repository: $REPO_URL"
echo "Runner:     $RUNNER_NAME"
echo

if [ -f "$RUNNER_DIR/.runner" ]; then
  echo "Runner is already configured."
  cd "$RUNNER_DIR"
  sudo ./svc.sh status || true
  exit 0
fi

IFS= read -r -s -p "Paste the temporary GitHub runner registration token: " RUNNER_TOKEN
echo
if [ -z "$RUNNER_TOKEN" ]; then
  echo "No token entered."
  exit 1
fi

sudo apt update
sudo apt install -y curl ca-certificates tar

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

RELEASE_JSON="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest)"
TAG="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])' <<<"$RELEASE_JSON")"
VERSION="${TAG#v}"
ARCHIVE="actions-runner-linux-${ASSET_ARCH}-${VERSION}.tar.gz"
URL="https://github.com/actions/runner/releases/download/${TAG}/${ARCHIVE}"

echo "Downloading GitHub Actions runner $VERSION for $ASSET_ARCH..."
curl -fL --retry 3 -o "$ARCHIVE" "$URL"
tar xzf "$ARCHIVE"
rm -f "$ARCHIVE"

./config.sh \
  --unattended \
  --replace \
  --url "$REPO_URL" \
  --token "$RUNNER_TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "$RUNNER_LABEL" \
  --work "_work"

unset RUNNER_TOKEN

sudo ./svc.sh install "$(id -un)"
sudo ./svc.sh start

echo
echo "=== RUNNER STATUS ==="
sudo ./svc.sh status
echo
echo "Runner setup complete."
echo "Future JasonHomeServer pushes can now deploy themselves directly to this Oracle VM."
