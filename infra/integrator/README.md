# VPS Integrator — operacao do backend

Esta pasta empacota o backend atual sem alterar a logica das conversoes.

## Layout no servidor

- `/opt/converter-pro/repo`: copia do codigo (`backend/` e `infra/`). NAO e um
  checkout do Git -- nao existe `.git` ali, entao `git pull` falha com
  "not a git repository". A atualizacao e por copia de arquivo; ver
  "Atualizacao" abaixo.
- `/opt/converter-pro/config/backend.env`: segredos, fora do Git e modo 600.
- `/opt/converter-pro/data/temp`: jobs temporarios.
- `/opt/converter-pro/data/supplier_profiles`: perfis Phase 0 persistentes.
- `/opt/converter-pro/data/uploads_tmp`: `TMPDIR` do container (upload em disco).
  Fica FORA de `data/temp` de proposito -- a limpeza de 21 dias varre `data/temp`
  na profundidade 1 e apagaria este diretorio, quebrando todo upload seguinte.
- `127.0.0.1:28081`: backend local, publicado somente pelo Nginx/ICP.

## Primeira instalacao

1. Criar os diretorios em `/opt/converter-pro`.
2. Colocar o repo em `/opt/converter-pro/repo`.
3. Copiar `backend.env.example` para `/opt/converter-pro/config/backend.env`.
4. Preencher os quatro segredos por canal seguro.
5. Executar `infra/integrator/deploy.sh` como root.
6. Instalar e ativar o timer de limpeza.
7. Criar o dominio no ICP e aplicar os timeouts/limite de upload do modelo Nginx.
8. Se o painel ICP estiver indisponivel, emitir o certificado com Certbot em
   modo webroot e instalar `renew-tls.sh` como deploy hook. O script copia o
   certificado renovado para o volume do Nginx e recarrega o proxy.

## Limites seguros do Core

- `MAX_CONCURRENT_JOBS=1` durante toda a homologacao.
- Container limitado a 5 GB de RAM, 6 GB contando swap e 3,5 vCPU.
- Upload publicado pelo proxy: ate 600 MB (`client_max_body_size`). Subiu de
  300 MB em 10/09/2026 por causa do catalogo TUKA TOYS, de 435,7 MB.
  **Tem que andar junto com `MAX_UPLOAD_MB`** em
  `src/core/pipeline/aiFirstExtractionApi.ts`: se o front achar que cabe e o
  proxy recusar, o cliente cai no leitor regex sem IA e sem imagem.
- Temporarios removidos depois de 21 dias; `supplier_profiles` nunca entra nessa
  limpeza. Sobras em `uploads_tmp` (so acontecem se o processo morrer no meio de
  um upload) saem depois de 1 dia.

### Por que `TMPDIR` aponta pra disco

`/tmp` do container e um **tmpfs de 256 MB (RAM)**. O Starlette grava o corpo do
upload num arquivo temporario, entao qualquer catalogo acima de ~256 MB morria
com `400 There was an error parsing the body` no meio do envio -- a IA nunca
rodava e o cliente recebia o resultado do regex, sem imagens e sem aviso alugm.
Achado real em 10/09/2026 com o TUKA TOYS: o upload parava em ~272 MB.

`TMPDIR=/app/uploads_tmp` (volume em disco, 87 GB livres) resolve sem gastar o
limite de 5 GB de RAM do container. Nao troque por um tmpfs maior: seriam
centenas de MB de RAM por upload simultaneo.

## TLS sem o painel ICP

Usar somente se o hostname do painel ICP estiver indisponivel. Antes, o DNS A
de `conversor-vps.metodoiqc.com.br` deve apontar para a VPS em modo Somente DNS.

```bash
apt-get update
apt-get install -y certbot
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
install -m 0755 infra/integrator/renew-tls.sh \
  /usr/local/sbin/converter-pro-renew-tls
install -m 0755 infra/integrator/renew-tls.sh \
  /etc/letsencrypt/renewal-hooks/deploy/converter-pro-renew-tls
certbot certonly --webroot \
  -w /etc/icontainer/apps/nginx/nginx/root \
  -d conversor-vps.metodoiqc.com.br \
  --non-interactive --agree-tos --register-unsafely-without-email
/usr/local/sbin/converter-pro-renew-tls
```

Depois, instalar `nginx/converter-pro.conf.example` no `conf.d` do Nginx ICP,
validar com `nginx -t` dentro do container e recarregar o Nginx. O timer do
Certbot renova o certificado; o deploy hook copia os arquivos para o volume do
ICP e recarrega o proxy. Quando o painel ICP voltar, cadastrar o dominio nele e
confirmar que a configuracao manual nao foi sobrescrita.

## Atualizacao

Sempre atualizar por branch e PR. Depois do merge aprovado, copie os arquivos
alterados da maquina local para o servidor e recrie o container:

```bash
scp -i ~/.ssh/converter_pro_integrator_ed25519 \
  backend/image_extractor/*.py \
  root@23.80.89.90:/opt/converter-pro/repo/backend/image_extractor/
```

```bash
ssh -i ~/.ssh/converter_pro_integrator_ed25519 root@23.80.89.90 \
  "cd /opt/converter-pro/repo/backend/image_extractor && sed -i 's/\r$//' *.py"
```

O `sed` e obrigatorio: o Git desta maquina faz checkout com CRLF e um shell
script copiado assim morre com `env: bash\r: No such file or directory`.

```bash
ssh -i ~/.ssh/converter_pro_integrator_ed25519 root@23.80.89.90 \
  "cd /opt/converter-pro/repo && CONVERTER_DATA_DIR=/opt/converter-pro/data \
   docker compose -f infra/integrator/compose.yaml \
   --env-file /opt/converter-pro/config/backend.env up -d --build"
```

O deploy recria apenas o container; os dados ficam fora da copia do codigo.

## Detalhes dos servidores no painel central

Os cartões Integrator, Wesley e Render funcionam como abas. A Integrator é
local e sempre mostra métricas, histórico de jobs e logs. Para habilitar os
detalhes de um servidor remoto, grave a credencial administrativa exclusiva
dele em um destes arquivos, nunca no Git:

- `/opt/converter-pro/config/admin/monitor_wesley_token`
- `/opt/converter-pro/config/admin/monitor_render_token`

Os arquivos devem pertencer ao UID/GID `10001:10001` e usar permissão `0600`.
A senha usada para entrar no painel da Integrator não é reutilizada nem enviada
aos servidores remotos.

## Rollback

Voltar o checkout para um commit previamente aprovado e executar novamente
`deploy.sh`. Nunca apagar `/opt/converter-pro/data` durante rollback.
