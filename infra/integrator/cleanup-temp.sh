#!/usr/bin/env bash
set -Eeuo pipefail

readonly TEMP_DIR="/opt/converter-pro/data/temp"
readonly RETENTION_DAYS="${RETENTION_DAYS:-21}"
readonly MODE="${1:---dry-run}"

resolved_temp="$(realpath -m -- "${TEMP_DIR}")"
if [[ "${resolved_temp}" != "/opt/converter-pro/data/temp" ]]; then
  echo "ERRO: destino inesperado; limpeza cancelada: ${resolved_temp}" >&2
  exit 1
fi

if [[ ! -d "${resolved_temp}" ]]; then
  echo "Diretorio ainda nao existe: ${resolved_temp}"
  exit 0
fi

mapfile -d '' old_entries < <(
  find "${resolved_temp}" -mindepth 1 -maxdepth 1 -mtime "+${RETENTION_DAYS}" -print0
)

if (( ${#old_entries[@]} == 0 )); then
  echo "Nenhum temporario com mais de ${RETENTION_DAYS} dias."
  exit 0
fi

printf 'Temporarios encontrados:\n'
printf '  %s\n' "${old_entries[@]}"

if [[ "${MODE}" != "--apply" ]]; then
  echo "Simulacao apenas. Use --apply para remover."
  exit 0
fi

for entry in "${old_entries[@]}"; do
  case "${entry}" in
    /opt/converter-pro/data/temp/*) rm -rf -- "${entry}" ;;
    *) echo "ERRO: entrada fora do destino permitido: ${entry}" >&2; exit 1 ;;
  esac
done

echo "Limpeza concluida."
