#!/usr/bin/env bash
# Build a portable release package (bundled Node.js, compiled server, prod node_modules, prebuilt web).
#
# Usage: scripts/pack-release.sh <target> <node-version>
#   target       : win-x64 | linux-x64 | linux-arm64 | macos-x64 | macos-arm64
#   node-version : e.g. v22.21.0 (must match the ABI the server/node_modules native binary was built for)
#
# Prerequisites (run from repo root):
#   (cd web && npm ci && npm run build)          -> web/dist (with .version)
#   (cd server && npm ci && npm run build)       -> server/dist
#   (cd server && npm ci --omit=dev)             -> production node_modules with the native better-sqlite3 for THIS os/arch
# Env:
#   SERVER_NODE_MODULES : use another node_modules dir instead of server/node_modules (cross-packing)
#   NODE_DIST_MIRROR    : default https://nodejs.org/dist
# Output: release/merged-mail-manager-v<version>-<target>.(zip|tar.gz)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)

TARGET=${1:?target required}
NODE_VER=${2:?node version required (e.g. v22.21.0)}
[[ "$NODE_VER" == v* ]] || NODE_VER="v$NODE_VER"
MIRROR=${NODE_DIST_MIRROR:-https://nodejs.org/dist}
APP_VER=$(head -1 VERSION | tr -d '\r ')
NM_SRC=${SERVER_NODE_MODULES:-server/node_modules}

case "$TARGET" in
  win-x64)     NODE_PKG="node-$NODE_VER-win-x64";     NODE_EXT=zip ;;
  linux-x64)   NODE_PKG="node-$NODE_VER-linux-x64";   NODE_EXT=tar.gz ;;
  linux-arm64) NODE_PKG="node-$NODE_VER-linux-arm64"; NODE_EXT=tar.gz ;;
  macos-x64)   NODE_PKG="node-$NODE_VER-darwin-x64";  NODE_EXT=tar.gz ;;
  macos-arm64) NODE_PKG="node-$NODE_VER-darwin-arm64"; NODE_EXT=tar.gz ;;
  *) echo "unknown target $TARGET" >&2; exit 1 ;;
esac

[ -f web/dist/index.html ] || { echo "web/dist missing - build the web first" >&2; exit 1; }
[ -f server/dist/server.js ] || { echo "server/dist missing - run tsc first" >&2; exit 1; }
[ -f "$NM_SRC/better-sqlite3/build/Release/better_sqlite3.node" ] || { echo "$NM_SRC lacks better-sqlite3 native binary" >&2; exit 1; }
[ -f web/dist/.version ] || cp VERSION web/dist/.version

NAME="merged-mail-manager-v$APP_VER-$TARGET"
OUT="$ROOT/release"
STAGE="$OUT/$NAME"
CACHE="$OUT/.cache"
rm -rf "$STAGE"; mkdir -p "$STAGE" "$CACHE"

# 1. Node runtime
ARCHIVE="$CACHE/$NODE_PKG.$NODE_EXT"
if [ ! -s "$ARCHIVE" ]; then
  echo "[*] downloading $MIRROR/$NODE_VER/$NODE_PKG.$NODE_EXT"
  curl -fsSL --retry 3 -o "$ARCHIVE" "$MIRROR/$NODE_VER/$NODE_PKG.$NODE_EXT"
fi
# verify checksum
curl -fsSL --retry 3 "$MIRROR/$NODE_VER/SHASUMS256.txt" -o "$CACHE/SHASUMS256-$NODE_VER.txt"
EXPECTED=$(grep " $NODE_PKG.$NODE_EXT\$" "$CACHE/SHASUMS256-$NODE_VER.txt" | awk '{print $1}')
if command -v sha256sum >/dev/null 2>&1; then ACTUAL=$(sha256sum "$ARCHIVE" | awk '{print $1}'); else ACTUAL=$(shasum -a 256 "$ARCHIVE" | awk '{print $1}'); fi
[ "$EXPECTED" = "$ACTUAL" ] || { echo "checksum mismatch for $NODE_PKG" >&2; rm -f "$ARCHIVE"; exit 1; }

TMPX="$CACHE/x-$TARGET"; rm -rf "$TMPX"; mkdir -p "$TMPX"
mkdir -p "$STAGE/node"
if [ "$NODE_EXT" = zip ]; then
  if command -v unzip >/dev/null 2>&1; then unzip -q "$ARCHIVE" "$NODE_PKG/node.exe" "$NODE_PKG/LICENSE" -d "$TMPX"
  else 7z x -y -o"$TMPX" "$ARCHIVE" "$NODE_PKG/node.exe" "$NODE_PKG/LICENSE" >/dev/null; fi
  cp "$TMPX/$NODE_PKG/node.exe" "$STAGE/node/node.exe"
else
  tar -xzf "$ARCHIVE" -C "$TMPX" "$NODE_PKG/bin/node" "$NODE_PKG/LICENSE"
  mkdir -p "$STAGE/node/bin"
  cp "$TMPX/$NODE_PKG/bin/node" "$STAGE/node/bin/node"
  chmod 755 "$STAGE/node/bin/node"
fi
cp "$TMPX/$NODE_PKG/LICENSE" "$STAGE/node/LICENSE"
echo "$NODE_VER" > "$STAGE/node/VERSION"
rm -rf "$TMPX"

# 2. Server (compiled JS + production deps)
mkdir -p "$STAGE/server"
cp -R server/dist "$STAGE/server/dist"
find "$STAGE/server/dist" -name '*.d.ts' -delete -o -name '*.d.ts.map' -delete
cp server/package.json "$STAGE/server/package.json"
[ -f server/package-lock.json ] && cp server/package-lock.json "$STAGE/server/package-lock.json"
cp -R "$NM_SRC" "$STAGE/server/node_modules"
# strip build-only parts of better-sqlite3 (keep the .node binary)
B="$STAGE/server/node_modules/better-sqlite3"
rm -rf "$B/deps" "$B/src" "$B/build/Release/obj" "$B/build/Release/obj.target" "$B/build/Release/.deps" "$B/build/deps" \
       "$B/build/Release/test_extension.node" "$B/build/node_gyp_bins"
find "$B/build" -type f ! -name '*.node' ! -name 'config.gypi' -delete 2>/dev/null || true
rm -rf "$STAGE/server/node_modules/.bin" "$STAGE/server/node_modules/.package-lock.json"

# sanity: no other native modules
OTHER=$(find "$STAGE/server/node_modules" -name '*.node' ! -path '*/better-sqlite3/*' || true)
[ -z "$OTHER" ] || { echo "unexpected native modules:"; echo "$OTHER"; exit 1; }

# 3. Web
mkdir -p "$STAGE/web"
cp -R web/dist "$STAGE/web/dist"

# 4. Top-level files
cp LICENSE VERSION "$STAGE/"
cp packaging/README.md "$STAGE/README.md"
mkdir -p "$STAGE/scripts" "$STAGE/data"
cp scripts/open-browser.cjs "$STAGE/scripts/"
# portable .env.example: database in ./data next to the launcher
sed -e 's|^# 数据库路径.*|# 数据库路径（相对于 server/ 目录；便携版默认保存在启动脚本旁的 data/ 文件夹）|' \
    -e 's|^DB_PATH=.*|DB_PATH=../data/outlook.db|' .env.example > "$STAGE/.env.example"
grep -q '^DB_PATH=../data/outlook.db' "$STAGE/.env.example" || { echo "DB_PATH rewrite failed" >&2; exit 1; }

if [ "$TARGET" = win-x64 ]; then
  cp packaging/start.bat "$STAGE/start.bat"
  cp packaging/zh-start.bat "$STAGE/启动.bat"
  # README / .env.example with CRLF for Notepad users
  for f in README.md .env.example; do sed -i.bak 's/\r\{0,1\}$/\r/' "$STAGE/$f" && rm -f "$STAGE/$f.bak"; done
else
  cp packaging/start.sh "$STAGE/start.sh"; chmod 755 "$STAGE/start.sh"
  if [[ "$TARGET" == macos-* ]]; then cp packaging/start.command "$STAGE/start.command"; chmod 755 "$STAGE/start.command"; fi
fi

# 5. Archive
cd "$OUT"
if [ "$TARGET" = win-x64 ]; then
  rm -f "$NAME.zip"
  if command -v 7z >/dev/null 2>&1; then 7z a -tzip -mx=9 -mcu=on "$NAME.zip" "$NAME" >/dev/null
  else zip -qr9 "$NAME.zip" "$NAME"; fi
  ls -l "$NAME.zip"
else
  rm -f "$NAME.tar.gz"
  tar -czf "$NAME.tar.gz" "$NAME"
  ls -l "$NAME.tar.gz"
fi
echo "[OK] $OUT/$NAME"
