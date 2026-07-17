#!/bin/bash
# =========================================
# OKEX 交易策略 WebUI + 通知服务 部署脚本
# 覆盖：前端构建 + notify-service 后端部署
# =========================================
set -e

REPO_DIR=/work/ok  # 请替换为实际的 git 仓库路径
WEBUI_DIR="$REPO_DIR/freqtrade-webui"
NOTIFY_DIR="$WEBUI_DIR/notify-service"
NGINX_TARGET=/usr/share/nginx/okex
NOTIFY_PORT=3031  # 需与 notify-service/.env 中的 PORT 一致

echo "========================================"
echo "OKEX WebUI 部署开始"
echo "========================================"

# ---------- 1. 进入项目目录并拉取最新代码 ----------
echo ">>> 1. 拉取最新代码"
cd "$REPO_DIR"
git pull

# ---------- 2. 检查通知服务 .env 文件 ----------
echo ">>> 2. 检查通知服务环境变量文件"
if [ ! -f "$NOTIFY_DIR/.env" ]; then
  if [ -f "$NOTIFY_DIR/.env.example" ]; then
    echo "⚠️  .env 不存在，从 .env.example 复制..."
    cp "$NOTIFY_DIR/.env.example" "$NOTIFY_DIR/.env"
  fi
  echo "⚠️  请编辑 $NOTIFY_DIR/.env 填入真实配置（SMTP、可选 HTTPS_PROXY）后重新运行部署"
  exit 1
fi

# ---------- 3. 构建前端 (Vue) ----------
echo ">>> 3. 构建前端 (freqtrade-webui)"
cd "$WEBUI_DIR"
yarn install --frozen-lockfile
NODE_OPTIONS="--max-old-space-size=1024" yarn build

# ---------- 4. 部署前端产物到 nginx 目录 ----------
echo ">>> 4. 部署前端产物"
if [ ! -d "$NGINX_TARGET" ]; then
  sudo mkdir -p "$NGINX_TARGET"
  echo "✅ 创建目录 $NGINX_TARGET"
fi
sudo rm -rf "${NGINX_TARGET:?}"/*
sudo cp -r "$WEBUI_DIR/dist/"* "$NGINX_TARGET/"
echo "✅ 前端已部署到 $NGINX_TARGET"

# ---------- 5. 构建通知服务后端 ----------
echo ">>> 5. 构建通知服务 (notify-service)"
cd "$NOTIFY_DIR"
mkdir -p "$NOTIFY_DIR/data"
npm install
npm run build

# ---------- 6. 停止并重启通知服务 ----------
echo ">>> 6. 重启通知服务"
echo ">>> 6.1 停止旧进程"
pkill -f "node dist/index.js" || true
sleep 1

echo ">>> 6.2 后台启动通知服务"
nohup node dist/index.js > /tmp/premium-notifier.log 2>&1 &
sleep 2

# ---------- 7. 验证服务 ----------
echo ">>> 7. 验证服务"
sleep 2
echo -n "前端构建产物: "
if [ -d "$WEBUI_DIR/dist" ]; then
  echo "✅ 存在"
else
  echo "⚠️ 缺失，请检查构建日志"
fi

echo -n "通知服务进程: "
if pgrep -f "node dist/index.js" > /dev/null; then
  echo "✅ 运行中"
else
  echo "⚠️ 未运行，请检查 /tmp/premium-notifier.log"
fi

echo -n "通知服务任务列表接口: "
curl -s "http://localhost:${NOTIFY_PORT}/api/notify/tasks" | head -c 200
echo ""

echo ""
echo "========================================"
echo "部署完成！"
echo "========================================"
echo "前端文件位置: $NGINX_TARGET"
echo "通知服务    : http://localhost:${NOTIFY_PORT} (日志: /tmp/premium-notifier.log)"
echo "========================================"
