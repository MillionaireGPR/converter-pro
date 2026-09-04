#!/usr/bin/env bash
set -Eeuo pipefail

readonly DOMAIN="conversor-vps.metodoiqc.com.br"
readonly SOURCE_DIR="/etc/letsencrypt/live/${DOMAIN}"
readonly TARGET_DIR="/etc/icontainer/apps/nginx/nginx/www/sites/${DOMAIN}/ssl"

NGINX_CONTAINER="$(
  docker ps \
    --filter label=com.docker.compose.project=nginx \
    --filter label=com.docker.compose.service=nginx \
    --format '{{.Names}}' \
  | head -n 1
)"
readonly NGINX_CONTAINER

if [[ -z "${NGINX_CONTAINER}" ]]; then
  echo "ERRO: container Nginx do ICP nao encontrado." >&2
  exit 1
fi

install -d -m 0755 "${TARGET_DIR}"
install -m 0644 "${SOURCE_DIR}/fullchain.pem" "${TARGET_DIR}/fullchain.pem"
install -m 0600 "${SOURCE_DIR}/privkey.pem" "${TARGET_DIR}/privkey.pem"

docker exec "${NGINX_CONTAINER}" nginx -t
docker exec "${NGINX_CONTAINER}" nginx -s reload
