#!/bin/bash
# =========================================
# OKEX 交易策略 WebUI + 通知服务 部署脚本
# 覆盖：前端构建 + notify-service 后端部署 + Freqtrade bot
# 用法：
#   ./deploy.sh              # 默认 dryrun（模拟盘）
#   MODE=live ./deploy.sh    # 显式切到实盘（真实资金）
# =========================================
set -e

REPO_DIR=/work/ok
WEBUI_DIR="$REPO_DIR/freqtrade-webui"
NOTIFY_DIR="$WEBUI_DIR/notify-service"
USERDIR="$REPO_DIR/freqtrade_userdir"
NGINX_TARGET=/usr/share/nginx/okex
NOTIFY_PORT=3031

# ---------- 模式选择 ----------
# 默认 dryrun：近期连续亏损期间禁止不带 MODE 直接上实盘
MODE="${MODE:-dryrun}"
case "$MODE" in
  dryrun)
    FREQ_CONFIG="$USERDIR/config_okx_futures_dryrun.json"
    FREQ_START="$REPO_DIR/start-futures-dryrun.sh"
    FREQ_SUPERVISOR="$REPO_DIR/run-futures-dryrun-supervisor.sh"
    FREQ_SERVICE="freqtrade-dryrun.service"
    FREQ_LOG="$REPO_DIR/logs/freqtrade-dryrun.log"
    ;;
  live)
    FREQ_CONFIG="$USERDIR/config_okx_futures_live.json"
    FREQ_START="$REPO_DIR/start-futures-live.sh"
    FREQ_SUPERVISOR="$REPO_DIR/run-futures-live-supervisor.sh"
    FREQ_SERVICE="freqtrade-live.service"
    FREQ_LOG="$REPO_DIR/logs/freqtrade-live.log"
    echo "⚠️  MODE=live — REAL MONEY TRADING ENABLED"
    echo "   Freqtrade config: $FREQ_CONFIG"
    if [ ! -f "$FREQ_CONFIG" ]; then
      echo "❌ Live config not found.  Create $FREQ_CONFIG and fill OKX API keys first."
      exit 1
    fi
    ;;
  *)
    echo "Unknown MODE '$MODE'. Use MODE=dryrun (default) or MODE=live."
    exit 1
    ;;
esac

echo "========================================"
echo "OKEX WebUI 部署开始 [MODE=$MODE]"
echo "========================================"

# ---------- 1. 拉取最新代码 ----------
echo ">>> 1. 拉取最新代码"
cd "$REPO_DIR"
git pull

# 确保所有启动脚本有执行权限
chmod +x "$REPO_DIR/start-futures-dryrun.sh"
chmod +x "$REPO_DIR/start-futures-live.sh"
chmod +x "$REPO_DIR/run-futures-dryrun-supervisor.sh"
chmod +x "$REPO_DIR/run-futures-live-supervisor.sh"

# ---------- 2. 检查通知服务 .env ----------
echo ">>> 2. 检查通知服务环境变量文件"
if [ ! -f "$NOTIFY_DIR/.env" ]; then
  if [ -f "$NOTIFY_DIR/.env.example" ]; then
    echo "⚠️  .env 不存在，从 .env.example 复制..."
    cp "$NOTIFY_DIR/.env.example" "$NOTIFY_DIR/.env"
  fi
  echo "⚠️  请编辑 $NOTIFY_DIR/.env 填入真实配置后重新运行部署"
  exit 1
fi

if ! grep -q '^FREQTRADE_API_URL=' "$NOTIFY_DIR/.env" \
  || ! grep -q '^FREQTRADE_API_USER=' "$NOTIFY_DIR/.env" \
  || ! grep -q '^FREQTRADE_API_PASSWORD=' "$NOTIFY_DIR/.env"; then
  echo "WARNING: notify-service/.env 缺少 Freqtrade API credentials，交易控制台将显示断开"
fi

# FREQTRADE_CONFIG 必须指向当前 MODE 的 config，否则白名单会写错文件、
# reload_config 热重载的是另一份配置，表现为"保存成功但不生效"。
if grep -q '^FREQTRADE_CONFIG=' "$NOTIFY_DIR/.env"; then
  CURRENT_FREQ_CONFIG=$(grep '^FREQTRADE_CONFIG=' "$NOTIFY_DIR/.env" | head -1 | cut -d= -f2-)
  if [ "$CURRENT_FREQ_CONFIG" != "$FREQ_CONFIG" ]; then
    echo "⚠️  .env 的 FREQTRADE_CONFIG 与 MODE=$MODE 不一致，自动纠正："
    echo "    旧: $CURRENT_FREQ_CONFIG"
    echo "    新: $FREQ_CONFIG"
    sed -i "s|^FREQTRADE_CONFIG=.*|FREQTRADE_CONFIG=$FREQ_CONFIG|" "$NOTIFY_DIR/.env"
  fi
else
  echo "FREQTRADE_CONFIG=$FREQ_CONFIG" >> "$NOTIFY_DIR/.env"
  echo "已写入 FREQTRADE_CONFIG=$FREQ_CONFIG"
fi

# ---------- 3. 构建前端 ----------
echo ">>> 3. 构建前端 (freqtrade-webui)"
cd "$WEBUI_DIR"
yarn install --frozen-lockfile
NODE_OPTIONS="--max-old-space-size=1024" yarn build

# ---------- 4. 部署前端产物 ----------
echo ">>> 4. 部署前端产物"
if [ ! -d "$NGINX_TARGET" ]; then
  sudo mkdir -p "$NGINX_TARGET"
fi
sudo rm -rf "${NGINX_TARGET:?}"/*
sudo cp -r "$WEBUI_DIR/dist/"* "$NGINX_TARGET/"
echo "✅ 前端已部署到 $NGINX_TARGET"

# ---------- 5. 构建 notify-service ----------
echo ">>> 5. 构建通知服务 (notify-service)"
cd "$NOTIFY_DIR"
mkdir -p "$NOTIFY_DIR/data"
npm install
npm run build

# ---------- 6. 重启 notify-service ----------
echo ">>> 6. 重启通知服务"
pkill -f "node dist/index.js" || true
sleep 1
nohup node dist/index.js > /tmp/premium-notifier.log 2>&1 &
sleep 2

# ---------- 7. 安装/重启 Freqtrade ----------
echo ">>> 7. 安装/重启 Freqtrade ($MODE)"
SERVICE_SRC="$REPO_DIR/$FREQ_SERVICE"
SERVICE_DEST="/etc/systemd/system/$FREQ_SERVICE"

# 停掉所有可能冲突的 bot（dryrun 和 live 互相不打架但都占 8091 端口）
systemctl stop freqtrade-dryrun.service 2>/dev/null || true
systemctl stop freqtrade-live.service 2>/dev/null || true
pkill -f '/root/freqtrade-venv/bin/freqtrade trade' || true
pkill -f "$REPO_DIR/run-futures-dryrun-supervisor.sh" || true
pkill -f "$REPO_DIR/run-futures-live-supervisor.sh" || true
pkill -f "$REPO_DIR/start-futures-dryrun.sh" || true
pkill -f "$REPO_DIR/start-futures-live.sh" || true
sleep 1

if command -v systemctl >/dev/null 2>&1; then
  if [ -f "$SERVICE_SRC" ]; then
    cp "$SERVICE_SRC" "$SERVICE_DEST"
    systemctl daemon-reload
    systemctl enable "$FREQ_SERVICE"
    systemctl start "$FREQ_SERVICE"
    sleep 3
  else
    echo "⚠️  $SERVICE_SRC 不存在，跳过 systemd"
  fi
else
  echo "⚠️  systemctl 不可用，回退 nohup"
  mkdir -p "$REPO_DIR/logs"
  nohup bash "$FREQ_SUPERVISOR" > "$FREQ_LOG" 2>&1 &
  sleep 3
fi

# ---------- 8. 验证 ----------
echo ">>> 8. 验证服务"
echo ""
echo "前端产物:       $( [ -d "$WEBUI_DIR/dist" ] && echo '✅' || echo '⚠️' )"
echo "通知服务:       $( pgrep -f 'node dist/index.js' >/dev/null && echo '✅ 运行中' || echo '⚠️ 未运行 — 看 /tmp/premium-notifier.log' )"
FREQ_OK=""
if systemctl is-active --quiet "$FREQ_SERVICE" 2>/dev/null; then
  FREQ_OK="✅ running (systemd)"
elif pgrep -f '/root/freqtrade-venv/bin/freqtrade trade' >/dev/null; then
  FREQ_OK="✅ running (nohup)"
else
  FREQ_OK="❌ not running — 看 $FREQ_LOG"
fi
echo "Freqtrade bot:  $FREQ_OK"
echo ""
echo "Freqtrade API:  $( curl -s http://127.0.0.1:8091/api/v1/ping )"
echo "通知服务 API:   $( curl -s "http://localhost:${NOTIFY_PORT}/api/notify/tasks" | head -c 120 )"
echo ""
echo "========================================"
echo "部署完成 [MODE=$MODE]"
echo "========================================"
echo "WebUI:       $NGINX_TARGET"
echo "notify-svc:  http://localhost:${NOTIFY_PORT}  (log /tmp/premium-notifier.log)"
echo "Freqtrade:   127.0.0.1:8091  (log $FREQ_LOG)"
echo "========================================"
