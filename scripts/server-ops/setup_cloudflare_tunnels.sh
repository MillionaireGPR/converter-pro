#!/bin/bash
# Corrige o conflito de servico unico do cloudflared: "cloudflared service
# install <token>" so cria UM servico do sistema (mesmo nome). Rodar duas
# vezes -- uma pra cada tunnel -- substitui o primeiro em vez de rodar os
# dois em paralelo (incidente 01/09/2026: instalar o tunnel do
# iqc-digitalcompany derrubou o do converter-pro-backend).
#
# Este script cria dois servicos systemd com nomes distintos, um por
# tunnel, e desativa o servico generico "cloudflared" (fonte do conflito).
#
# Uso: sudo ./setup_cloudflare_tunnels.sh <token_converter_pro> <token_digitalcompany>
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Uso: sudo $0 <token_converter_pro> <token_digitalcompany>"
  exit 1
fi

TOKEN_CONVERTER="$1"
TOKEN_DIGITALCOMPANY="$2"
CLOUDFLARED_BIN="$(command -v cloudflared || echo /usr/local/bin/cloudflared)"

echo "[setup] Desativando o servico generico 'cloudflared' (causa do conflito)..."
systemctl stop cloudflared 2>/dev/null || true
systemctl disable cloudflared 2>/dev/null || true

create_service() {
  local name="$1"
  local token="$2"
  echo "[setup] Criando servico ${name}..."
  tee "/etc/systemd/system/${name}.service" > /dev/null <<EOF
[Unit]
Description=Cloudflare Tunnel - ${name}
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${CLOUDFLARED_BIN} tunnel run --token ${token}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
}

create_service "cloudflared-converter" "$TOKEN_CONVERTER"
create_service "cloudflared-digitalcompany" "$TOKEN_DIGITALCOMPANY"

systemctl daemon-reload
systemctl enable --now cloudflared-converter cloudflared-digitalcompany

echo ""
echo "[setup] Feito. Status dos dois servicos:"
systemctl status cloudflared-converter --no-pager -l | head -6
echo ""
systemctl status cloudflared-digitalcompany --no-pager -l | head -6
