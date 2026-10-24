#!/usr/bin/env bash
# Smoke-test an unpacked portable package: start it, check /api/version and /, stop it.
# Usage: scripts/smoke-test.sh <unpacked-package-dir> [port]
# Packages are started through their real launcher: start.sh (unix) / start.bat (Windows, via cmd).
set -uo pipefail
DIR=${1:?package dir}
PORT=${2:-3999}
cd "$DIR"
APP_VER=$(head -1 VERSION | tr -d '\r ')
export PORT MM_NO_BROWSER=1
rm -f .env
if [ -f node/node.exe ]; then
  # Windows: go through the real launcher (CI=true makes it skip 'pause')
  export CI=${CI:-true}
  cmd //c start.bat > smoke.log 2>&1 &
else
  ./start.sh > smoke.log 2>&1 &
fi
PID=$!
OK=0
for _ in $(seq 1 60); do
  sleep 1
  BODY=$(curl -fs "http://127.0.0.1:$PORT/api/version" 2>/dev/null) && { OK=1; break; }
done
STATUS=fail
if [ $OK = 1 ]; then
  echo "/api/version -> $BODY"
  ROOT_CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")
  echo "/ -> HTTP $ROOT_CODE"
  if echo "$BODY" | grep -q "\"version\":\"$APP_VER\"" && echo "$BODY" | grep -q '"match":true' && [ "$ROOT_CODE" = 200 ] && [ -f data/outlook.db ]; then
    STATUS=pass
  fi
fi
kill $PID 2>/dev/null; sleep 1; kill -9 $PID 2>/dev/null
if [ -f node/node.exe ] && command -v taskkill >/dev/null 2>&1; then taskkill //F //IM node.exe >/dev/null 2>&1 || true; fi
wait $PID 2>/dev/null
echo "---- server log ----"; cat smoke.log
rm -rf smoke.log data .env
echo "SMOKE $STATUS"
[ $STATUS = pass ]
