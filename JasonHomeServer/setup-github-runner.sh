#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2"
RUNNER_DIR="$HOME/actions-runner"
RUNNER_NAME="jason-home-oracle"
RUNNER_VERSION="2.337.0"
RUNNER_ARCHIVE="actions-runner-linux-arm64-${RUNNER_VERSION}.tar.gz"
RUNNER_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_ARCHIVE}"
RUNNER_SHA256="9b1dc70626422526e3c94767cf024896beb15da5342a3f4819bf2feac13e0393"

echo
echo "=== JASON HOME ORACLE GITHUB RUNNER ==="
echo

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

if [ ! -f ./config.sh ]; then
  echo "Downloading GitHub Actions runner ${RUNNER_VERSION} for ARM64..."
  curl -fL -o "$RUNNER_ARCHIVE" "$RUNNER_URL"
  echo "${RUNNER_SHA256}  ${RUNNER_ARCHIVE}" | sha256sum -c -
  tar xzf "$RUNNER_ARCHIVE"
fi

if [ ! -f .runner ]; then
  echo
  echo "Paste the SHORT-LIVED runner registration token from the GitHub page."
  echo "It will not be displayed while you type."
  IFS= read -r -s -p "Runner token: " RUNNER_TOKEN
  echo
  if [ -z "$RUNNER_TOKEN" ]; then
    echo "ERROR: No runner token entered."
    exit 1
  fi

  ./config.sh \
    --unattended \
    --url "$REPO_URL" \
    --token "$RUNNER_TOKEN" \
    --name "$RUNNER_NAME" \
    --labels "oracle,jason-home,arm64" \
    --work "_work" \
    --replace
  unset RUNNER_TOKEN
else
  echo "Runner is already configured."
fi

echo
echo "Installing runner as a system service..."
sudo ./svc.sh install "$(id -un)" 2>/dev/null || true
sudo ./svc.sh start

echo
echo "=== RUNNER STATUS ==="
sudo ./svc.sh status || true

echo
echo "Runner name: $RUNNER_NAME"
echo "Labels: self-hosted, Linux, ARM64, oracle, jason-home"
echo
echo "You can close Cloud Shell after GitHub shows this runner as Idle."
