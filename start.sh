#!/usr/bin/env bash
# Mail Manager 一键启动 (macOS / Linux)
# 用法: ./start.sh [rebuild]
set -e
cd "$(dirname "$0")"
APP_VER=$(head -1 VERSION 2>/dev/null | tr -d '\r ' || echo unknown)

say()  { printf '\033[1;36m[*]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[OK]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[!]\033[0m %s\n' "$*"; exit 1; }

# 1. Node.js 18+
if ! command -v node >/dev/null 2>&1; then
  if [[ "$OSTYPE" == darwin* ]] && command -v brew >/dev/null 2>&1; then
    say "未检测到 Node.js，正在用 Homebrew 安装..."
    brew install node@22 && brew link --overwrite node@22 || fail "Homebrew 安装失败，请到 https://nodejs.org 安装"
  else
    fail "未检测到 Node.js，请安装 Node 20+ : https://nodejs.org （Linux 可用 nvm: https://github.com/nvm-sh/nvm）"
  fi
fi
NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
[ "$NODE_MAJOR" -ge 20 ] || fail "需要 Node.js 20+，当前 $(node -v)"
ok "Node.js $(node -v)"

# 2. .env
if [ ! -f .env ]; then cp .env.example .env; ok "已从 .env.example 生成 .env"; fi
PORT=$(grep -E '^PORT=' .env | tail -1 | cut -d= -f2 | tr -d '\r ')
PORT=${PORT:-3000}

# 3. 依赖
if [ ! -d node_modules ] || [ ! -d server/node_modules ] || [ ! -d web/node_modules ]; then
  say "安装依赖（首次较慢）..."
  npm run install:all || {
    say "当前镜像安装失败，改用官方源重试..."
    npm_config_registry=https://registry.npmjs.org npm run install:all || {
      say "改用 npmmirror 重试..."
      npm_config_registry=https://registry.npmmirror.com npm run install:all || fail "依赖安装失败，见上方报错"
    }
  }
fi
ok "依赖就绪"

# 4. 前端构建（缺失、源码有更新或传入 rebuild 时）
if [ "$1" = "rebuild" ] || [ ! -f web/dist/index.html ] || [ "$(head -1 web/dist/.version 2>/dev/null | tr -d '\r ')" != "$APP_VER" ] || \
   [ -n "$(find web/src web/index.html web/package.json -newer web/dist/index.html 2>/dev/null | head -1)" ]; then
  say "构建前端..."
  npm run build || fail "前端构建失败"
  [ -f web/dist/.version ] || cp VERSION web/dist/.version
fi
WEB_VER=$(head -1 web/dist/.version 2>/dev/null | tr -d '\r ' || echo none)
ok "前端就绪 (构建版本 v$WEB_VER)"
[ "$WEB_VER" = "$APP_VER" ] || say "警告：前端构建 v$WEB_VER 与应用 v$APP_VER 不一致，请运行 ./start.sh rebuild"

# 5. 就绪后自动打开浏览器
URL="http://localhost:$PORT"
# 端口被旧实例占用时先停止它
OLD=$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$OLD" ]; then
  if ps -o comm= -p $OLD 2>/dev/null | grep -qi node; then say "停止端口 $PORT 上的旧实例 ($OLD)"; kill $OLD 2>/dev/null; sleep 1
  else fail "端口 $PORT 被其他程序占用，请在 .env 中修改 PORT"; fi
fi
(
  for _ in $(seq 1 90); do
    if curl -fs -o /dev/null "$URL" 2>/dev/null; then
      if [[ "$OSTYPE" == darwin* ]]; then open "$URL"
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
      fi
      break
    fi
    sleep 1
  done
) &

echo
echo "============================================"
echo "  应用版本     : v$APP_VER"
echo "  前端构建版本 : v$WEB_VER"
echo "  地址         : $URL  (Ctrl+C 停止)"
echo "============================================"
echo
exec npm start
