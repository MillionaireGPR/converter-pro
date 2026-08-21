#!/usr/bin/env python3
"""
Atualiza a variável de ambiente VITE_BACKEND_URL no Vercel e dispara um
redeploy, sempre que o Cloudflare Tunnel gerar uma URL nova (acontece só
quando o serviço reinicia -- queda, reinício do servidor, etc; enquanto
fica rodando, a URL não muda).

Sem isso, um restart do túnel trocaria a URL e o site em produção pararia
de falar com o backend até alguém perceber e atualizar manualmente.

Zero custo -- só precisa de um token de API do Vercel (gratuito) e o
Project ID, configurados em vercel_automation.env (não versionado, vive
só no servidor).

Uso: python3 update_vercel_backend_url.py <nova_url>
"""
import sys
import os
import json
import urllib.request
import urllib.error

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(SCRIPT_DIR, "vercel_automation.env")

ENV_VAR_NAME = "VITE_BACKEND_URL"


def _load_env_file(path: str) -> dict:
    values = {}
    if not os.path.isfile(path):
        return values
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            values[key.strip()] = val.strip().strip('"').strip("'")
    return values


def _api_request(token: str, team_id: str, method: str, path: str, body: dict = None):
    url = f"https://api.vercel.com{path}"
    if team_id:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}teamId={team_id}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}


def main():
    if len(sys.argv) < 2:
        print("Uso: update_vercel_backend_url.py <nova_url>")
        sys.exit(1)
    new_url = sys.argv[1].rstrip("/")

    cfg = {**_load_env_file(ENV_FILE), **os.environ}
    token = cfg.get("VERCEL_API_TOKEN")
    project_id = cfg.get("VERCEL_PROJECT_ID")
    team_id = cfg.get("VERCEL_TEAM_ID", "")
    deploy_hook = cfg.get("VERCEL_DEPLOY_HOOK_URL")

    if not token or not project_id:
        print(f"[update-vercel] ERRO: VERCEL_API_TOKEN/VERCEL_PROJECT_ID ausentes em {ENV_FILE} -- abortando")
        sys.exit(1)

    try:
        # 1. Acha a env var existente (produção) pra saber se cria ou atualiza
        envs = _api_request(token, team_id, "GET", f"/v9/projects/{project_id}/env")
        target = next(
            (e for e in envs.get("envs", [])
             if e.get("key") == ENV_VAR_NAME and "production" in (e.get("target") or [])),
            None,
        )

        if target:
            _api_request(token, team_id, "PATCH",
                         f"/v9/projects/{project_id}/env/{target['id']}",
                         {"value": new_url})
            print(f"[update-vercel] {ENV_VAR_NAME} atualizado -> {new_url}")
        else:
            _api_request(token, team_id, "POST", f"/v10/projects/{project_id}/env", {
                "key": ENV_VAR_NAME, "value": new_url,
                "type": "plain", "target": ["production"],
            })
            print(f"[update-vercel] {ENV_VAR_NAME} criado -> {new_url}")

    except urllib.error.HTTPError as e:
        print(f"[update-vercel] ERRO na API do Vercel ({e.code}): {e.read().decode(errors='replace')}")
        sys.exit(1)

    # 2. Dispara redeploy -- env var de build (Vite) só aplica em build novo
    if deploy_hook:
        try:
            req = urllib.request.Request(deploy_hook, method="POST")
            urllib.request.urlopen(req, timeout=15)
            print("[update-vercel] Redeploy disparado com sucesso")
        except Exception as e:
            print(f"[update-vercel] ERRO ao disparar redeploy: {e}")
            sys.exit(1)
    else:
        print("[update-vercel] AVISO: VERCEL_DEPLOY_HOOK_URL não configurado -- redeploy NÃO disparado")


if __name__ == "__main__":
    main()
