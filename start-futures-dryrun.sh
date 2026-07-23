#!/usr/bin/env bash
# Start the isolated OKX futures dry-run bot from the repository root.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USERDIR="$ROOT_DIR/freqtrade_userdir"
CONFIG="$USERDIR/config_okx_futures_dryrun.json"
FREQTRADE_VENV_DIR="${FREQTRADE_VENV_DIR:-$HOME/freqtrade-venv}"
FREQTRADE_BIN="$FREQTRADE_VENV_DIR/bin/freqtrade"

if [[ ! -x "$FREQTRADE_BIN" ]]; then
  echo "Freqtrade virtual environment not found at $FREQTRADE_BIN" >&2
  echo "Run ./install-freqtrade.sh first. The global freqtrade command is intentionally not used." >&2
  exit 1
fi

python3 - "$CONFIG" <<'PY'
import json
import sys
from pathlib import Path

config = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
checks = {
    'dry_run': config.get('dry_run') is True,
    'trading_mode': config.get('trading_mode') == 'futures',
    'margin_mode': config.get('margin_mode') == 'isolated',
    'api_listen': config.get('api_server', {}).get('listen_ip_address') == '127.0.0.1',
}
failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit('Refusing to start: unsafe futures config (' + ', '.join(failed) + ')')
PY

cd "$USERDIR"
if [[ ! -d "$USERDIR/user_data" ]]; then
  echo "Initializing Freqtrade user directory: $USERDIR/user_data"
  mkdir -p "$USERDIR/user_data"
  "$FREQTRADE_BIN" create-userdir --userdir "$USERDIR"
fi
echo "Starting OKX futures dry-run (API: 127.0.0.1:8081)"
exec "$FREQTRADE_BIN" trade \
  --userdir "$USERDIR" \
  --config "$CONFIG" \
  --strategy OkxFuturesMaCross \
  --strategy-path "$USERDIR/strategies"
