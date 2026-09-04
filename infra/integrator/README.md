# VPS Integrator — operacao do backend

Esta pasta empacota o backend atual sem alterar a logica das conversoes.

## Layout no servidor

- `/opt/converter-pro/repo`: checkout do Git.
- `/opt/converter-pro/config/backend.env`: segredos, fora do Git e modo 600.
- `/opt/converter-pro/data/temp`: jobs temporarios.
- `/opt/converter-pro/data/supplier_profiles`: perfis Phase 0 persistentes.
- `127.0.0.1:28081`: backend local, publicado somente pelo Nginx/ICP.

## Primeira instalacao

1. Criar os diretorios em `/opt/converter-pro`.
2. Colocar o repo em `/opt/converter-pro/repo`.
3. Copiar `backend.env.example` para `/opt/converter-pro/config/backend.env`.
4. Preencher os quatro segredos por canal seguro.
5. Executar `infra/integrator/deploy.sh` como root.
6. Instalar e ativar o timer de limpeza.
7. Criar o dominio no ICP e aplicar os timeouts/limite de upload do modelo Nginx.

## Limites seguros do Core

- `MAX_CONCURRENT_JOBS=1` durante toda a homologacao.
- Container limitado a 5 GB de RAM, 6 GB contando swap e 3,5 vCPU.
- Upload publicado pelo proxy: ate 300 MB.
- Temporarios removidos depois de 21 dias; `supplier_profiles` nunca entra nessa limpeza.

## Atualizacao

Sempre atualizar por branch e PR. Depois do merge aprovado:

```bash
cd /opt/converter-pro/repo
git pull --ff-only origin main
./infra/integrator/deploy.sh
```

O deploy recria apenas o container; os dados ficam fora do checkout.

## Rollback

Voltar o checkout para um commit previamente aprovado e executar novamente
`deploy.sh`. Nunca apagar `/opt/converter-pro/data` durante rollback.
