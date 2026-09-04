#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_ROOT="/opt/converter-pro"
readonly REPO_DIR="${APP_ROOT}/repo"
readonly CONFIG_FILE="${APP_ROOT}/config/backend.env"
readonly DATA_DIR="${APP_ROOT}/data"
readonly COMPOSE_FILE="${REPO_DIR}/infra/integrator/compose.yaml"

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERRO: execute como root." >&2
  exit 1
fi

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "ERRO: falta ${CONFIG_FILE}. Copie backend.env.example e preencha pelo canal seguro." >&2
  exit 1
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "ERRO: falta ${COMPOSE_FILE}." >&2
  exit 1
fi

install -d -m 0750 "${APP_ROOT}/config" "${DATA_DIR}"
install -d -m 0750 \
  "${DATA_DIR}/temp" \
  "${DATA_DIR}/supplier_profiles"
chown 10001:10001 \
  "${DATA_DIR}/temp" \
  "${DATA_DIR}/supplier_profiles"
chmod 0600 "${CONFIG_FILE}"

export CONVERTER_ENV_FILE="${CONFIG_FILE}"
export CONVERTER_DATA_DIR="${DATA_DIR}"

docker compose -f "${COMPOSE_FILE}" config --quiet
docker compose -f "${COMPOSE_FILE}" build --pull
docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans

for _attempt in $(seq 1 36); do
  if curl --fail --silent --show-error http://127.0.0.1:28081/health; then
    printf '\nBackend saudavel em http://127.0.0.1:28081\n'
    exit 0
  fi
  sleep 5
done

echo "ERRO: backend nao ficou saudavel em 3 minutos." >&2
docker compose -f "${COMPOSE_FILE}" ps
docker compose -f "${COMPOSE_FILE}" logs --tail=120 backend
exit 1
