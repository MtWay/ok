#!/bin/bash

# ============================================
# OKEX 交易策略 WebUI 部署脚本
# ============================================

set -e  # 遇到错误立即退出

echo "========================================"
echo "🚀 开始部署 OKEX WebUI"
echo "========================================"

# 1. 进入项目目录并拉取最新代码
echo "📥 拉取最新代码..."
cd /work/ok/freqtrade_userdir  # 请替换为实际的 git 仓库路径
git pull    # 或 master，根据你的分支名调整
echo "✅ 代码更新完成"

# 2. 创建目标目录（如果不存在）
echo "📁 检查目标目录..."
if [ ! -d "/usr/share/nginx/okex" ]; then
    sudo mkdir -p /usr/share/nginx/okex
    echo "✅ 创建目录 /usr/share/nginx/okex"
fi

# 3. 复制文件到 nginx 目录
echo "📋 复制文件到 nginx 目录..."
sudo cp freqtrade_userdir/webui/index.html /usr/share/nginx/okex/index.html

echo "========================================"
echo "✅ 部署完成！"
echo "📍 文件位置: /usr/share/nginx/okex/index.html"
echo "========================================"

