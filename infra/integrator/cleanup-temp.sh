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

# Sem early-exit daqui pra baixo: a limpeza das sobras de upload (no fim do
# arquivo) precisa rodar mesmo quando nao ha temporario velho de job.
if [[ ! -d "${resolved_temp}" ]]; then
  echo "Diretorio ainda nao existe: ${resolved_temp}"
else
  mapfile -d '' old_entries < <(
    find "${resolved_temp}" -mindepth 1 -maxdepth 1 -mtime "+${RETENTION_DAYS}" -print0
  )

  if (( ${#old_entries[@]} == 0 )); then
    echo "Nenhum temporario com mais de ${RETENTION_DAYS} dias."
  else
    printf 'Temporarios encontrados:\n'
    printf '  %s\n' "${old_entries[@]}"

    if [[ "${MODE}" != "--apply" ]]; then
      echo "Simulacao apenas. Use --apply para remover."
    else
      for entry in "${old_entries[@]}"; do
        case "${entry}" in
          /opt/converter-pro/data/temp/*) rm -rf -- "${entry}" ;;
          *) echo "ERRO: entrada fora do destino permitido: ${entry}" >&2; exit 1 ;;
        esac
      done
      echo "Limpeza concluida."
    fi
  fi
fi

# ── Sobras de upload (TMPDIR do container) ──────────────────────────────
# Vivem fora de data/temp de proposito: a varredura acima apaga entradas na
# profundidade 1, e apagar este diretorio quebraria todo upload seguinte.
# Aqui removemos apenas ARQUIVOS soltos dentro dele: sao temporarios do
# Starlette, apagados sozinhos ao fim de cada request; so sobra algo se o
# processo morrer no meio de um upload. 1 dia ja e folga -- nenhum upload
# legitimo dura tanto -- e sem isso um catalogo de 435MB abandonado fica
# ocupando disco pra sempre.
readonly UPLOADS_TMP="/opt/converter-pro/data/uploads_tmp"
if [[ -d "${UPLOADS_TMP}" ]]; then
  mapfile -d '' stale_uploads < <(
    find "${UPLOADS_TMP}" -mindepth 1 -maxdepth 1 -type f -mtime +1 -print0
  )
  if (( ${#stale_uploads[@]} > 0 )); then
    printf 'Sobras de upload encontradas:\n'
    printf '  %s\n' "${stale_uploads[@]}"
    if [[ "${MODE}" == "--apply" ]]; then
      for entry in "${stale_uploads[@]}"; do
        case "${entry}" in
          "${UPLOADS_TMP}"/*) rm -f -- "${entry}" ;;
          *) echo "ERRO: entrada fora do destino permitido: ${entry}" >&2; exit 1 ;;
        esac
      done
      echo "Sobras de upload removidas."
    else
      echo "Simulacao apenas. Use --apply para remover."
    fi
  else
    echo "Nenhuma sobra de upload."
  fi
fi
