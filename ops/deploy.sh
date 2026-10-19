#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN_DIR="${NODE_BIN_DIR:-/home/dekunin/.nvm/versions/node/v22.13.1/bin}"
NPM_BIN="${NPM_BIN:-${NODE_BIN_DIR}/npm}"
PM2_BIN="${PM2_BIN:-${NODE_BIN_DIR}/pm2}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.production}"

export PATH="${NODE_BIN_DIR}:${PATH}"
cd "${APP_DIR}"

if [[ -n "$(git status --short)" ]]; then
  echo "Refusing to deploy a dirty checkout." >&2
  exit 1
fi

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

git pull --ff-only origin main
"${NPM_BIN}" ci --no-audit --no-fund
# The production host has fewer CPU cores than developer machines; serialize
# image-heavy visual checks and extend only their execution budget.
"${NPM_BIN}" test -- --maxWorkers=1 --testTimeout=60000
"${NPM_BIN}" run build

mkdir -p "${APP_DIR}/data"
APP_VERSION="$(git rev-parse HEAD)"
export APP_VERSION
"${PM2_BIN}" startOrReload ecosystem.config.cjs --update-env
"${PM2_BIN}" save

for attempt in {1..15}; do
  health="$(curl --fail --silent http://127.0.0.1:4173/healthz 2>/dev/null || true)"
  if [[ "${health}" == *"\"version\":\"${APP_VERSION}\""* ]]; then
    printf '%s\n' "${health}"
    exit 0
  fi
  sleep 1
done

echo "Wildbound did not report revision ${APP_VERSION} within 15 seconds." >&2
exit 1
