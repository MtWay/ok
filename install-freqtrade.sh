#!/usr/bin/env bash
# Install Freqtrade for this repository's isolated futures dry-run bot.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${FREQTRADE_VENV_DIR:-$HOME/freqtrade-venv}"
BIN_LINK="${FREQTRADE_BIN_LINK:-/usr/local/bin/freqtrade}"

run_privileged() {
  if [[ "${EUID}" -eq 0 ]]; then "$@"; else sudo "$@"; fi
}

install_system_packages() {
  if command -v dnf >/dev/null 2>&1; then
    run_privileged dnf install -y python3 python3-pip python3-devel gcc gcc-c++ make git
  elif command -v apt-get >/dev/null 2>&1; then
    run_privileged apt-get update
    run_privileged apt-get install -y python3 python3-venv python3-pip python3-dev build-essential git
  else
    echo "Unsupported package manager. Install Python 3, pip, venv, gcc, g++, and make manually." >&2
    exit 1
  fi
}

echo "==> Installing system dependencies"
install_system_packages

echo "==> Creating virtual environment at $VENV_DIR"
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --upgrade pip setuptools wheel

echo "==> Installing Freqtrade"
"$VENV_DIR/bin/pip" install --upgrade freqtrade

echo "==> Creating command link at $BIN_LINK"
run_privileged ln -sfn "$VENV_DIR/bin/freqtrade" "$BIN_LINK"

echo "==> Verifying installation"
freqtrade --version

cat <<EOF

Freqtrade is installed.

Before starting the bot:
  1. Edit $ROOT_DIR/freqtrade_userdir/config_okx_futures_dryrun.json
  2. Replace every CHANGE_ME API-server value with a strong private value.
  3. Configure FREQTRADE_API_USER and FREQTRADE_API_PASSWORD in
     $ROOT_DIR/freqtrade-webui/notify-service/.env.

Start the simulated futures bot:
  cd $ROOT_DIR
  yarn futures:dry-run
EOF
