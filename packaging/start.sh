#!/usr/bin/env bash
# Mail Manager 便携版启动脚本 (Linux / macOS) —— 使用自带的 Node.js，无需安装
# 数据保存在本脚本旁边的 data/ 目录
set -e
cd "$(dirname "$0")"
APP_VER=$(head -1 VERSION 2>/dev/null | tr -d '\r ' || echo unknown)
NODE="./node/bin/node"

if [ ! -x "$NODE" ]; then
  echo "[!] 找不到 $NODE（或没有执行权限）。请重新完整解压 tar.gz：tar -xzf <文件>.tar.gz" >&2
  exit 1
fi

[ -f .env ] || { cp .env.example .env; echo "[OK] 已从 .env.example 生成 .env"; }
mkdir -p data

PORT_CFG=$(grep -E '^PORT=' .env | tail -1 | cut -d= -f2 | tr -d '\r ')
PORT_CFG=${PORT:-${PORT_CFG:-3000}}

echo "============================================"
echo "  Mail Manager v$APP_VER (portable, node $("$NODE" -v))"
echo "  数据目录 : $(pwd)/data"
echo "  地址     : http://localhost:$PORT_CFG  (Ctrl+C 停止)"
echo "============================================"

if [ -z "$MM_NO_BROWSER" ]; then
  "$NODE" scripts/open-browser.cjs "$PORT_CFG" >/dev/null 2>&1 &
fi
exec "$NODE" server/dist/server.js
