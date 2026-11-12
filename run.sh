#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

command -v python3 >/dev/null || { echo "Python 3 is required" >&2; exit 1; }
command -v java >/dev/null || { echo "Java 17+ is required" >&2; exit 1; }

python3 --version
java -version 2>&1 | head -n 1

if command -v tsc >/dev/null 2>&1; then
  (cd web && tsc --project tsconfig.json)
elif [[ ! -f web/app.js ]]; then
  echo "TypeScript compiler (tsc) is required, or ship a prebuilt web/app.js." >&2
  exit 1
else
  echo "Using prebuilt web/app.js"
fi

export HISAAB_HTTP_PORT="${HISAAB_HTTP_PORT:-8080}"
export HISAAB_ENGINE_PORT="${HISAAB_ENGINE_PORT:-8081}"
export HISAAB_BIND="${HISAAB_BIND:-0.0.0.0}"
export HISAAB_RATE_LIMIT="${HISAAB_RATE_LIMIT:-60}"

python3 python/engine.py &
PY_PID=$!
JAVA_PID=""

cleanup() {
  [[ -n "$JAVA_PID" ]] && kill "$JAVA_PID" 2>/dev/null || true
  kill "$PY_PID" 2>/dev/null || true
  [[ -n "$JAVA_PID" ]] && wait "$JAVA_PID" 2>/dev/null || true
  wait "$PY_PID" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Wait for engine health before starting gateway
for i in $(seq 1 30); do
  if python3 -c "import socket; s=socket.create_connection(('127.0.0.1', int('${HISAAB_ENGINE_PORT}')), 0.3); s.close()" 2>/dev/null; then
    break
  fi
  sleep 0.2
done

java java/Hisaab.java &
JAVA_PID=$!
wait "$JAVA_PID"
