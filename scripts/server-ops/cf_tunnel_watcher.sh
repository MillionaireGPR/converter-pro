#!/bin/bash
# Roda o cloudflared (Quick Tunnel) e observa a saida em busca da URL gerada.
# Toda vez que uma URL aparece (inclusive apos um restart, quando ela muda),
# chama update_vercel_backend_url.py pra manter o Vercel sempre apontando
# pro endereco certo -- sem isso, um restart do tunel deixaria o site em
# producao "mudo" ate alguem perceber e atualizar manualmente.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

/usr/local/bin/cloudflared tunnel --url http://localhost:28080 2>&1 | while IFS= read -r line; do
  echo "$line"
  # Bug real (12/08/2026): quando a API do Cloudflare falha em criar o
  # tunel, cloudflared imprime uma linha de ERRO contendo a URL FIXA da
  # API dele mesmo -- "failed to request quick Tunnel: Post
  # \"https://api.trycloudflare.com/tunnel\": ...". O regex antigo casava
  # essa URL como se fosse um tunel real e mandava "api.trycloudflare.com"
  # pro Vercel (nunca é um tunel de verdade -- é o endpoint fixo da API).
  # Dois filtros agora: (1) exclui api.trycloudflare.com explicitamente,
  # (2) exige o caractere "|" da moldura do banner de sucesso real
  # ("Your quick Tunnel has been created!"), que a linha de erro não tem.
  URL=$(echo "$line" | grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' | grep -vx 'https://api\.trycloudflare\.com' | head -n1)
  if [ -n "$URL" ] && echo "$line" | grep -q '|'; then
    echo "[watcher] Nova URL detectada: $URL -- atualizando Vercel..."
    python3 "$SCRIPT_DIR/update_vercel_backend_url.py" "$URL" &
  fi
done
