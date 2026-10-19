#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN="wildbound.kunini.ru"
SITE_NAME="${DOMAIN}.conf"
STAGING_DIR="/home/dekunin/nginx-sites"
STAGED_CONFIG="${STAGING_DIR}/${SITE_NAME}"
BOOTSTRAP_CONFIG="${APP_DIR}/ops/nginx/${DOMAIN}.bootstrap.conf"
TLS_CONFIG="${APP_DIR}/ops/nginx/${SITE_NAME}"
APPLY_HELPER="/usr/local/sbin/codex-nginx-apply"
CERTBOT_CONFIG="/home/dekunin/letsencrypt"
CERTBOT_WORK="/home/dekunin/letsencrypt-work"
CERTBOT_LOGS="/home/dekunin/letsencrypt-logs"

if [[ ! -f "${APP_DIR}/dist/index.html" ]]; then
  echo "Build Wildbound before configuring Nginx." >&2
  exit 1
fi

curl --fail --silent http://127.0.0.1:4173/healthz >/dev/null
install -d -m 0755 "${STAGING_DIR}"
install -m 0644 "${BOOTSTRAP_CONFIG}" "${STAGED_CONFIG}"
sudo -n "${APPLY_HELPER}" "${SITE_NAME}"

challenge_dir="${APP_DIR}/dist/.well-known/acme-challenge"
challenge_name="wildbound-preflight-$$"
challenge_value="wildbound-${RANDOM}-${RANDOM}"
install -d -m 0755 "${challenge_dir}"
printf '%s' "${challenge_value}" >"${challenge_dir}/${challenge_name}"
trap 'rm -f "${challenge_dir}/${challenge_name}"' EXIT

served_value="$(curl --fail --silent --max-time 15 "http://${DOMAIN}/.well-known/acme-challenge/${challenge_name}")"
if [[ "${served_value}" != "${challenge_value}" ]]; then
  echo "The public ACME challenge path is not served by this host." >&2
  exit 1
fi

certbot certonly \
  --webroot \
  --webroot-path "${APP_DIR}/dist" \
  --domain "${DOMAIN}" \
  --cert-name "${DOMAIN}" \
  --non-interactive \
  --agree-tos \
  --config-dir "${CERTBOT_CONFIG}" \
  --work-dir "${CERTBOT_WORK}" \
  --logs-dir "${CERTBOT_LOGS}" \
  --deploy-hook "sudo -n ${APPLY_HELPER} ${SITE_NAME}"

install -m 0644 "${TLS_CONFIG}" "${STAGED_CONFIG}"
if ! sudo -n "${APPLY_HELPER}" "${SITE_NAME}"; then
  install -m 0644 "${BOOTSTRAP_CONFIG}" "${STAGED_CONFIG}"
  sudo -n "${APPLY_HELPER}" "${SITE_NAME}"
  echo "TLS config failed validation; restored the HTTP bootstrap config." >&2
  exit 1
fi

"${APP_DIR}/ops/renew-certificate.sh" --dry-run

cron_line="47 4 * * * ${APP_DIR}/ops/renew-certificate.sh"
cron_file="$(mktemp)"
trap 'rm -f "${challenge_dir}/${challenge_name}" "${cron_file}"' EXIT
crontab -l >"${cron_file}" 2>/dev/null || true
if ! grep -Fqx "${cron_line}" "${cron_file}"; then
  printf '%s\n' "${cron_line}" >>"${cron_file}"
  crontab "${cron_file}"
fi

curl --fail --silent "https://${DOMAIN}/healthz"
printf '\nNginx and TLS are ready for %s.\n' "${DOMAIN}"
