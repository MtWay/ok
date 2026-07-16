#!/bin/bash

# ============================================
# OKEX 交易策略 WebUI + 通知服务 部署脚本
# ============================================

set -e  # 遇到错误立即退出

REPO_DIR=/work/ok  # 请替换为实际的 git 仓库路径
WEBUI_DIR="$REPO_DIR/freqtrade-webui"
NOTIFY_DIR="$WEBUI_DIR/notify-service"
NGINX_TARGET=/usr/share/nginx/okex

echo "========================================"
echo "🚀 开始部署 OKEX WebUI"
echo "========================================"

# 1. 拉取最新代码
echo "📥 拉取最新代码..."
cd "$REPO_DIR"
git pull
echo "✅ 代码更新完成"

# 2. 构建前端 Vue 项目
echo "🏗️  构建前端 (freqtrade-webui)..."
cd "$WEBUI_DIR"
yarn install --frozen-lockfile
yarn build
echo "✅ 前端构建完成"

# 3. 部署前端产物到 nginx 目录
echo "📁 检查目标目录..."
if [ ! -d "$NGINX_TARGET" ]; then
    sudo mkdir -p "$NGINX_TARGET"
    echo "✅ 创建目录 $NGINX_TARGET"
fi

echo "📋 复制前端文件到 nginx 目录..."
sudo rm -rf "${NGINX_TARGET:?}"/*
sudo cp -r "$WEBUI_DIR/dist/"* "$NGINX_TARGET/"
echo "✅ 前端部署完成"

# 4. 构建并（重）启动通知服务后端
echo "🏗️  构建通知服务 (notify-service)..."
cd "$NOTIFY_DIR"

if [ ! -f ".env" ]; then
    echo "⚠️  未找到 $NOTIFY_DIR/.env，请先根据 .env.example 创建并填写 SMTP/代理配置"
    exit 1
fi

npm install
npm run build
echo "✅ 通知服务构建完成"

echo "🔄 使用 PM2 启动/重启通知服务..."
if command -v pm2 >/dev/null 2>&1; then
    if pm2 describe premium-notifier > /dev/null 2>&1; then
        pm2 restart premium-notifier
    else
        pm2 start dist/index.js --name premium-notifier
    fi
    pm2 save
    echo "✅ 通知服务已通过 PM2 启动"
else
    echo "⚠️  未检测到 pm2，请先执行: npm install -g pm2"
    echo "   然后手动执行: pm2 start dist/index.js --name premium-notifier && pm2 save"
    exit 1
fi

echo "========================================"
echo "✅ 部署完成！"
echo "📍 前端文件位置: $NGINX_TARGET"
echo "📍 通知服务: PM2 进程 premium-notifier (端口见 notify-service/.env 的 PORT)"
echo "⚠️  记得在 nginx 配置中把 /api/notify 反代到通知服务端口，"
echo "    并确认前端 .env 中的 VITE_NOTIFY_API_BASE 与之匹配"
echo "========================================"
