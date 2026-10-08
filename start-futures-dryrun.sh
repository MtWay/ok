#!/usr/bin/env bash
# Start the OKX futures dry-run bot (cross or isolated margin) from the repository root.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USERDIR="$ROOT_DIR/freqtrade_userdir"
CONFIG="$USERDIR/config_okx_futures_dryrun.json"
FREQTRADE_VENV_DIR="${FREQTRADE_VENV_DIR:-$HOME/freqtrade-venv}"
FREQTRADE_BIN="$FREQTRADE_VENV_DIR/bin/freqtrade"

export HTTP_PROXY="${HTTP_PROXY:-http://127.0.0.1:7890}"
export HTTPS_PROXY="${HTTPS_PROXY:-http://127.0.0.1:7890}"
export ALL_PROXY="${ALL_PROXY:-http://127.0.0.1:7890}"
export NO_PROXY="${NO_PROXY:-127.0.0.1,localhost}"

# --- 从 notify-service/.env 同步 API 凭证到本次加载的 config ---
# notify-service 用同一份 .env 凭证访问 Freqtrade API；启动时写进 config，
# dryrun/live 切换后不会再出现 401。白名单功能本来就会重写该文件
#（setWhitelist 原地改 pair_whitelist 后整体写回），二者兼容。
NOTIFY_ENV_FILE="${NOTIFY_ENV_FILE:-$ROOT_DIR/freqtrade-webui/notify-service/.env}"
python3 - "$CONFIG" "$NOTIFY_ENV_FILE" <<'PY'
import json
import os
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
env_file = Path(sys.argv[2])

MAPPING = {
    'FREQTRADE_API_USER': 'username',
    'FREQTRADE_API_PASSWORD': 'password',
    'FREQTRADE_JWT_SECRET_KEY': 'jwt_secret_key',
    'FREQTRADE_WS_TOKEN': 'ws_token',
}

env = {}
if env_file.is_file():
    for line in env_file.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, _, value = line.partition('=')
        env[key.strip()] = value.strip().strip('"').strip("'")

config = json.loads(config_path.read_text(encoding='utf-8'))
api = config.setdefault('api_server', {})
changed = []
for env_key, conf_key in MAPPING.items():
    value = env.get(env_key)
    if value and api.get(conf_key) != value:
        api[conf_key] = value
        changed.append(conf_key)

if changed:
    tmp = config_path.with_name(config_path.name + '.tmp')
    tmp.write_text(json.dumps(config, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    os.replace(tmp, config_path)
    # 只打印字段名，绝不打印值
    print('Synced api_server fields from .env: ' + ', '.join(changed))
PY

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
    'margin_mode': config.get('margin_mode') in ('isolated', 'cross'),
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
echo "Starting OKX futures dry-run (API: 127.0.0.1:8091)"
exec "$FREQTRADE_BIN" trade \
  --userdir "$USERDIR" \
  --config "$CONFIG" \
  --strategy OkxFuturesMaCross \
  --strategy-path "$USERDIR/strategies"
