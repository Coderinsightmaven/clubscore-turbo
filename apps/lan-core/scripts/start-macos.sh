#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAN_CORE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$LAN_CORE_DIR/../.." && pwd)"
SETUP_WEB_DIR="$REPO_ROOT/apps/setup-web"

DEFAULT_DB_PATH="$HOME/Library/Application Support/ClubScore/clubscore.db"
DB_PATH="${CLUBSCORE_DB_PATH:-$DEFAULT_DB_PATH}"
mkdir -p "$(dirname "$DB_PATH")"

if [ ! -f "$SETUP_WEB_DIR/dist/index.html" ]; then
  echo "[clubscore-core] setup-web dist missing, building setup web"
  (cd "$SETUP_WEB_DIR" && bun run build)
fi

if [ ! -f "$LAN_CORE_DIR/dist/server.js" ]; then
  echo "[clubscore-core] lan-core dist missing, building lan core"
  (cd "$LAN_CORE_DIR" && bun run build)
fi

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-7310}"
export CLUBSCORE_DB_PATH="$DB_PATH"
export SETUP_WEB_DIST="${SETUP_WEB_DIST:-$SETUP_WEB_DIR/dist}"

echo "[clubscore-core] host=$HOST port=$PORT"
echo "[clubscore-core] db=$CLUBSCORE_DB_PATH"
echo "[clubscore-core] setup=http://localhost:$PORT/setup"

cd "$LAN_CORE_DIR"
exec node dist/server.js
