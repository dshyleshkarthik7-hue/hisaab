#!/usr/bin/env bash
set -euo pipefail
NAME="hisaab-docker-smoke-${GITHUB_RUN_ID:-local}"
VOLUME="hisaab-docker-smoke-${GITHUB_RUN_ID:-local}"
PORT="${HISAAB_DOCKER_SMOKE_PORT:-18080}"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$VOLUME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker volume create "$VOLUME" >/dev/null
docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:8080" -v "$VOLUME:/var/data" -e HISAAB_ADMIN_TOKEN=docker-smoke-secret hisaab:ci >/dev/null
ready=0
for _ in $(seq 1 45); do
  if curl -fsS "http://127.0.0.1:${PORT}/readyz" >/dev/null; then ready=1; break; fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then docker logs "$NAME"; exit 1; fi
curl -fsS "http://127.0.0.1:${PORT}/" | grep -q HISAAB
code=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/ingestion/status")
test "$code" = 401
curl -fsS -H 'Authorization: Bearer docker-smoke-secret' "http://127.0.0.1:${PORT}/api/ingestion/status" | grep -q candidates
uid=$(docker exec "$NAME" awk '/^Uid:/{print $2}' /proc/1/status)
test "$uid" != 0
docker exec --user hisaab "$NAME" sh -c 'test -w /var/data'
echo "Docker runtime smoke tests passed (readiness, admin auth, persistent-volume write, non-root PID 1)."
