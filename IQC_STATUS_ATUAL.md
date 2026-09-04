# IQC_STATUS_ATUAL.md — MICHELE_CONVERSOR

**Projeto:** MICHELE_CONVERSOR (Converter-Pro / Nunes Representações)
**Atualizado em:** 04/09/2026

---

## LEIA PRIMEIRO (handoff entre agentes/sessões)

Este arquivo é a fonte única de verdade do estado do projeto. Antes de
qualquer ação: leia até o fim. Depois de qualquer entrega: atualize-o.

- **Não sabe por onde começar?** → seção "Pendência crítica ABERTA" abaixo.
- **Vai tocar no backend/servidor?** → seção "Infraestrutura".
- **Vai mexer no export Mercos/mapeamento de colunas?** → PRs #97-#105 abaixo
  têm os arquivos exatos.
- **Credenciais/tokens NÃO estão aqui** (regra do CLAUDE.md) — estão nos
  painéis: Vercel (env vars do projeto `iqcp/converter-pro`), Supabase
  (projeto `xjznoddaifyxlfbivmau`), GitHub (`MillionaireGPR/converter-pro`).
- **Workflow não muda:** branch → `npm run verify` → PR → merge só com
  aprovação do Gabriel. Não pular isso mesmo em handoff.

## Objetivo desta fase

Tirar o produto da dependência do desenvolvedor. Cada fornecedor novo com
layout próprio exigia editar código + PR + deploy, o que fazia o cliente
(Michele/Josef) reportar a mesma classe de erro sempre e chamar o Gabriel.
Meta: cliente configura sozinho, uma vez por fornecedor.

**Restrição comercial:** plano de R$259/mês (inclui IA + servidor). Não pode
estourar esse escopo e precisa estar 100% funcional.

---

## 🟡 EM HOMOLOGAÇÃO em 04/09 — nova contingência na Integrator ICP

Por causa das novas quedas do servidor do Wesley (em 04/09 o endpoint fixo
retornou HTTP 530 enquanto o Render retornou 200), foi provisionada uma VPS
ICP Core para substituir o Render como reserva depois da homologação.

- **Host:** Integrator LAX-12, IP público `23.80.89.90`, Ubuntu 26.04 LTS,
  4 vCPU, 6 GB RAM e 100 GB NVMe.
- **Segurança aplicada:** SSH por chave; login remoto por senha bloqueado;
  firewall ativo; 2 GB de swap; Fail2ban e atualizações automáticas ativos.
  Portas 22/80/443/2090 preservadas; a porta FTP 21 que veio aberta foi
  fechada porque não havia serviço nela (SFTP continua pela porta 22).
- **Stack do provedor preservada:** ICP ativo em `:2090`; Nginx do ICP roda
  no container `ic-nginx-vH9X`; Docker 29.8.0 e Compose 5.5.1.
- **Backend de homologação:** container `converter-pro-backend` saudável,
  restrito internamente a `127.0.0.1:28081` e publicado somente pelo Nginx em
  `https://conversor-vps.metodoiqc.com.br`, mesma versão
  `2026.08.25-v52-supplier-rules-column-mapping` do Render. O registro A está
  em modo **Somente DNS**, evitando o limite de upload de 100 MB do proxy
  Cloudflare.
- **Proteção do Core:** `MAX_CONCURRENT_JOBS=1`, teto de 5 GB RAM / 6 GB com
  swap, 3,5 vCPU, restart automático, healthcheck e rotação de logs.
- **Persistência:** dados fora do checkout em `/opt/converter-pro/data`;
  `supplier_profiles` nunca entra na limpeza; temporários com mais de 21 dias
  são removidos pelo timer `converter-pro-cleanup.timer`.
- **Validações concluídas:** Supabase e Gemini responderam em leitura;
  OpenAPI contém os endpoints esperados; smoke AI com PDF sintético extraiu
  1/1 produto em 6,24s, confiança 100% e pico de 178,9 MB de RAM; CORS,
  persistência após restart e retorno automático após reboot completo OK.
  O endpoint público redireciona HTTP para HTTPS, apresentou certificado
  válido, retornou `/health` 200 e aceitou o CORS do painel Vercel.
- **TLS:** Let's Encrypt emitido em 04/09, com renovação automática pelo
  `certbot.timer` e deploy hook `converter-pro-renew-tls`. Foi usado o caminho
  manual porque o hostname do Painel ICP fornecido pelo provedor ainda não
  resolve no DNS. A simulação de renovação e o restart isolado do Nginx foram
  aprovados; o endpoint HTTPS voltou sozinho e saudável.
- **Código:** branch `infra/integrator-vps`; Dockerfile, Compose, deploy,
  limpeza, modelo Nginx e runbook em `infra/integrator/`. `npm run verify`:
  420/420 testes e invariantes IV-01..23 OK.

**Produção não foi alterada.** A infraestrutura está na PR #124, aberta em
04/09 e aguardando aprovação do Gabriel; todos os checks automáticos passaram.
Pendências antes do corte: migrar os perfis Phase 0 da origem mais completa;
testar catálogos reais (inclusive >100 MB) e o failover em preview;
aprovar/mergear a PR; só então trocar o fallback do Vercel. O domínio, TLS,
limite de 300 MB e reboot completo da VPS já foram testados e aprovados.

---

## ✅ ENTREGUE em 28/08–01/09 — domínio na Cloudflare + Tunnel fixo do backend (PR #120)

Resolve de vez a Pendência #2 abaixo (estava aberta desde 25/08). Causa raiz
real das quedas do servidor próprio: o Cloudflare **Quick Tunnel** gera uma
URL aleatória (`*.trycloudflare.com`) diferente a cada restart; um watcher
(`cf_tunnel_watcher.sh`) detectava a URL nova e disparava um **redeploy
completo do site** só pra atualizar `VITE_BACKEND_URL` — cada queda do
túnel virava minutos de cliente parado até o redeploy terminar.

- `metodoiqc.com.br` (Registro.br) migrou nameservers pra Cloudflare
  (`carlos`/`jasmine.ns.cloudflare.com`). Os 5 registros que já existiam
  (MX do Google Workspace, CNAME do Central Pirralhos, CNAME do
  digitalcompany, TXT de verificação do Google) foram replicados na
  Cloudflare via API **antes** do corte de nameserver — nada quebrou.
- Backend próprio trocou o Quick Tunnel por um **Tunnel nomeado**, config
  gerenciada pela própria Cloudflare (sem `config.yml` local), exposto
  permanentemente em `https://conversor-api.metodoiqc.com.br` — reaproveitou
  um subdomínio que já existia com IP morto, em vez de criar nome novo.
  Confirmado via `/health` → `200 OK` real, e o endereço já está assado no
  bundle de produção.
- `VITE_BACKEND_URL_PRIMARY` setado em produção (Vercel) pra esse endereço
  fixo — mecanismo de pin que já existia no código (ver `## Infraestrutura`
  e `backendResolver.ts`), nunca tinha sido usado até agora.
- `backendLabel()` atualizado pra reconhecer `metodoiqc.com.br` como
  "próprio" (PR #120, 420 testes OK).

**Limpeza que falta (não bloqueante):** desligar o processo do Quick Tunnel
antigo no servidor próprio e apagar `cf_tunnel_watcher.sh` +
`update_vercel_backend_url.py` do repo — ficaram obsoletos mas ainda não
foram removidos. Ver `guide.md #14.3`.

---

## ✅ ENTREGUE em 27/08 (tarde) — histórico estruturado (PR #119, migration aplicada)

Gabriel notou 2 conversões "render" da VAESO no histórico e perguntou se o
servidor próprio estava com problema (não estava — as 2 aconteceram durante
a queda de túnel do meio-dia, o failover funcionou certo; a 3ª conversão,
"proprio", rodou ANTES do fix #2 de imagem merger, por isso ainda tinha 17
falhas). Pra não precisar cruzar timestamps de PR com histórico toda vez
que isso acontecer de novo, o histórico virou estruturado:

- Colunas novas em `export_history`: servidor usado, duração, parser,
  contagem de imagens (encontradas/associadas/falhas) e o **relatório de
  falhas completo**, persistido como texto — antes só existia na memória
  do navegador que processou, agora dá pra conferir de qualquer máquina.
- Tela `/historico` ganhou badge de servidor (laranja = caiu no Render,
  bater o olho já mostra padrão de instabilidade), contagem de imagens e
  botão de baixar o relatório de falhas direto do banco.
- Retenção automática de 14 dias (catálogo é semanal, histórico não deve
  virar arquivo morto) — `pg_cron` se disponível, fallback garantido via
  limpeza oportunista no frontend.
- Ver `guide.md #16` pro detalhamento técnico e o fallback de schema
  (insert com colunas novas falha graciosamente pro schema antigo
  enquanto a migration não for aplicada).

**✅ Migration aplicada em produção (28/08)** — Gabriel rodou o SQL no editor
do Supabase; achou e corrigiu no caminho um bug real de dollar-quoting
duplicada (`DO $...$` colidindo com o `$...$` do comando do `cron.schedule`)
que quebrava o `DO` block do agendamento de limpeza. PR #119 mergeado, badges
de servidor/imagens já funcionam em produção.

412 → 420 testes (8 novos cobrindo o insert estruturado, o fallback de
schema antigo e a renderização dos badges), `npm run verify` OK.

---

## ✅ ENTREGUE em 27/08 — conversão em paralelo (PR #115)

Gabriel lembrava de ter combinado processamento simultâneo com o Josef,
mas nunca tinha existido no frontend — a tela `/conversao` assumia UM
catálogo por vez (estado global único). Investigação confirmou: só havia
um limitador no BACKEND (`MAX_CONCURRENT_JOBS`, autoajustado por RAM — 3
no servidor do Wesley, 1 no fallback Render), criado 13/08 como proteção
anti-OOM, não como recurso de UX pro cliente. "33 simultâneos" no pedido
original era erro de digitação — correto é **3**.

Agora cada catálogo é um `CatalogJob` independente, um mini-painel por
catálogo na tela. `handleProcessar` dispara o processamento SEM esperar e
limpa o formulário na hora — o cliente configura e adiciona o próximo
catálogo com o anterior ainda rodando. O motor de extração em si (adapters,
backend, Gemini) não mudou nada — só a orquestração da página.

**Limitação conhecida, documentada e deixada de propósito:** a barra de
progresso de cada job é uma estimativa animada (como já era antes), não o
status real do backend — não mostra "na fila" de verdade se o catálogo
esperar vaga além do limite de 3. Corrigir isso exigiria tocar
`aiFirstExtractionApi.ts` (protegido por invariante) — escopo maior,
fica pra depois.

Validado ao vivo em dev local: 5 catálogos disparados em sequência rápida,
painéis isolados e corretos. Achado no caminho: dados de teste com SKU
"fake" (`PAR1-AAA`) batiam 0 produtos — não é bug, é o validador
anti-linha-fantasma do pipeline rejeitando código que não parece SKU real
(ver `guide.md #15` pra não confundir isso com regressão numa próxima
sessão). 412 testes, IV-01..23 OK.

---

## ✅ ENTREGUE em 26-27/08 — configuração completa direto no upload (PRs #111-#113)

Gabriel testou o painel ao vivo com o cliente em mente e achou o gap real:
mapeamento de colunas e particularidades de IA existiam, mas só eram
editáveis numa segunda visita (Fornecedores ou Regras de Colunas), depois
de já ter subido o catálogo.

- **PR #111**: `/conversao` ganhou os campos de configuração no próprio
  upload — fornecedor novo ("+ Novo") ou existente, PDF (particularidades
  em texto livre) ou planilha (mapeamento de colunas via
  `ConferenciaColunas`, já existente desde 19/08). Fornecedor novo ainda
  não tem `id` no banco — mapeamento fica em memória e entra junto no
  `INSERT` que o cria.
- **PR #113**: dois ajustes pedidos pelo Gabriel testando ao vivo — (1)
  legenda explicando qual lado é o campo do Mercos e qual é a coluna da
  planilha do cliente; (2) tabelas de preço extra (VAESO: V50/V250/V.R.)
  agora configuráveis no mesmo painel, com botão que revela um slot por
  vez (até as 19 do modelo Mercos), sem precisar mais ir em Regras de
  Colunas à parte.

Os dois caminhos (PDF e planilha, fornecedor novo e existente) foram
testados ao vivo contra o Supabase real (escrita + confirmação direto no
banco, dado de teste removido depois). 412 testes, IV-01..23 OK em cada PR.

**Achado no caminho (não é bug):** a lista de `/fornecedores` reordena
entre carregamentos e o dropdown de `/conversao` é alfabético — dá
impressão de "regra sumiu" quando na real é outro fornecedor sendo
editado. Vale considerar padronizar a ordem numa próxima passada de UX.

---

## ✅ RESOLVIDO em 24/08 — servidor do Wesley atualizado e promovido

O SSH `187.94.39.160:2531` voltou a responder. Os quatro arquivos previstos
no handoff foram atualizados no servidor próprio a partir do `main`:
`main.py`, `gemini_extractor.py`, `supplier_profile.py` e `cv_extractor.py`.

- backup pré-deploy mantido em
  `/home/invictusos/converter-pro-backend/backups/20260824T210629Z`
- serviço `converter-backend.service` reiniciado normalmente
- `/health` local, proxy `:28080` e túnel público responderam `200`
- OpenAPI público confirmado com `supplierRules` em `extract_products_ai`
- smoke público: CORS, `not_found`, Vercel e latência passaram
- URL atual do túnel:
  `https://aqua-verification-documentary-crowd.trycloudflare.com`

Na promoção foi encontrada e corrigida uma inconsistência: o
`VITE_BACKEND_URL_FALLBACK` ainda apontava para o túnel antigo. Antes de
remover o pin, ele foi alterado para o Render. Configuração final confirmada
no bundle `index-DqKO2cWH.js`:

- `VITE_BACKEND_URL` → túnel atual do servidor do Wesley (primário)
- `VITE_BACKEND_URL_FALLBACK` → Render (reserva)
- `VITE_BACKEND_URL_PRIMARY` → removida

Os dois backends responderam saudáveis após a promoção. O watcher continua
atualizando `VITE_BACKEND_URL` e disparando redeploy quando a URL do Quick
Tunnel muda.

### ⚠️ Reconferido em 25/08 08:22 — túnel já caiu de novo

Validação independente antes deste merge, ~11h depois da promoção:

| checagem | resultado |
|---|---|
| `curl .../health` no túnel acima | `Could not resolve host` (DNS não resolve mais) |
| Mesmo teste pelo Browser (rede diferente) | navegação falhou — confirma que não é problema local |
| SSH `187.94.39.160:2531` | fechada de novo |
| `VITE_BACKEND_URL` no Vercel agora | ainda é a mesma URL morta — o watcher não escreveu uma nova |
| **Cliente afetada?** | **Não** — `pickBackends`/`probe()` (inalterados desde o PR #103,
16 testes cobrindo exatamente "primário some por erro de rede") caem no
Render sozinhos. Confirmado: Render `/health` → 200 |
| `/servidor` (painel admin) | **quebrado agora** — por design (`PainelServidor.tsx`) usa
`VITE_BACKEND_URL` direto, sem passar pelo failover, pra nunca mostrar um
bookmark desatualizado. Enquanto o túnel não voltar, usar o painel do
Render direto ou aguardar |

Ou seja: a promoção de 24/08 foi real e validada no momento — mas o Quick
Tunnel já se comportou exatamente como o risco descrito na pendência #2
abaixo prevê (sem SLA, cai sem aviso). A infraestrutura de failover
absorveu a queda sozinha; ninguém percebeu do lado do cliente.

### ✅ Resolvido em 25/08 12:09 — causa raiz + túnel restabelecido

Causa raiz confirmada por SSH (voltou a responder): o servidor caiu de
madrugada em 24/08 porque o Wesley trocou a placa de vídeo fisicamente.
Ao religar, `cf-tunnel.service` e `converter-backend.service` subiram
como "active" no systemd — mas o processo do `cloudflared` nunca chegou
a reconectar de verdade na Cloudflare (rede provavelmente não estava
pronta no boot). Como o processo não crashava, o systemd nunca o
reiniciou sozinho, e o watcher não tinha nada de novo pra detectar —
local (`localhost:28080/health`) respondia normal o tempo todo, só a
ponta pública é que nunca existiu de fato.

Fix: `sudo systemctl restart cf-tunnel.service`. Log confirmou:
```
[update-vercel] VITE_BACKEND_URL atualizado -> https://testing-ownership-wal-loc.trycloudflare.com
[update-vercel] Redeploy disparado com sucesso
```

Validado de fora, independente do log:

| checagem | resultado |
|---|---|
| `/health` no túnel novo | 200 |
| OpenAPI `extract_products_ai` | `supplierRules` presente |
| `VITE_BACKEND_URL` no Vercel | túnel novo |
| Bundle em produção | `index-BtAO3A8D.js` já com o túnel novo inlinado |

Servidor do Wesley voltou a ser o backend real usado pelas conversões,
Render de volta ao papel de reserva.

**Ainda em aberto:** o Gabriel já tinha comentado com o Wesley (25/08) sobre
migrar pro **túnel nomeado/fixo** — resolve a causa raiz (elimina
o watcher e esse tipo de falha silenciosa de vez). Ver pendência #3.

---

## ✅ RESOLVIDO em 20/08 — produção apontada para o Render

Até hoje a cliente era atendida pelo **servidor próprio, com código antigo**:
todas as correções de 19/08 não valiam para ela. Provado comparando os campos
aceitos em `POST /extract_products_ai`:

| Backend | Campos aceitos |
|---|---|
| Servidor próprio (túnel) | `file`, `jobId`, `supplier` |
| Render | `file`, `jobId`, `supplier`, **`supplierRules`** |

`supplierRules` é o PR #102. O servidor próprio não tem — SSH fechado, sem
como atualizar.

**Feito:** `VITE_BACKEND_URL` → Render, `VITE_BACKEND_URL_FALLBACK` → túnel,
redeploy (`centraldeconversao.vercel.app`, bundle `index-BL7CZqOw.js`).
Validado: `/servidor` no site de produção redireciona para
`converter-pro-image-extractor.onrender.com`, e um job real subiu no Render
(POST `/process` → `processing` → `success`).

**Descoberta importante:** `vercel env add` roda em modo não-interativo com
agentes e IGNORA o stdin — grava valor vazio. Só grava com `--value`. Foi o
que corrompeu `VITE_BACKEND_URL` antes. Variáveis criadas como *sensitive*
também voltam vazias no `env pull`; por isso as três agora são
`--no-sensitive` (são URLs públicas, já visíveis no bundle).

### Risco coberto — PR #103 (MERGEADO em 20/08)

O watcher do túnel (`scripts/server-ops/update_vercel_backend_url.py`)
reescreve `VITE_BACKEND_URL` **e dispara redeploy** a cada reinício do túnel.
Sem proteção, essa troca se desfaz sozinha e a cliente volta ao código antigo
sem ninguém perceber.

PR #103 cria `VITE_BACKEND_URL_PRIMARY`, que o watcher não conhece:
- pin setado → ele é o primário; o que o watcher escreve vira reserva
- reserva nunca pode ser igual ao pin (senão o failover morre em silêncio)
- sem pin, comportamento idêntico ao anterior
- para devolver o servidor próprio a primário: **apagar** a variável

Mergeado e no ar (bundle `index-iq86_Y3C.js`). Validado executando a função
minificada que foi para produção contra 4 cenários reais — inclusive "watcher
reinicia o túnel" e "watcher zera a variável": em todos o primário continua
Render e a reserva nunca é o mesmo servidor. 400 testes, invariantes OK.

**Ainda pendente com o Wesley:** reabrir a porta 2531 (SSH) para subir os 4
arquivos de backend e devolver o servidor próprio ao papel de primário.

---

## Entregue em 19/08 (PRs #97–#102, todos mergeados)

### Os 4 problemas reportados na VAESO
| Problema | Correção | Evidência |
|---|---|---|
| Quantidade da caixa saía 1 | alias `caixamaster` (o match exato/prefixo não alcançava "Caixa master") | agora 24, arquivo real |
| V50/V250/V.R. sem destino | → `Preço de Tabela #1/#2/#3` do Mercos | 11,25 / 10,75 / 9,99 |
| Imagens trocando de linha | matriz COR×TAMANHO: 1 miniatura serve N códigos da mesma linha | pág. 28: 7/14 → **14/14**, cores conferidas visualmente |
| Regras específicas do fornecedor | texto livre do cliente, compilado em regras objetivas | 476 chars de conversa → 4 regras |

### A causa raiz (dependência do dev)
- **Regras de Colunas** (`/regras`): o menu estava escondido e a tela era uma
  casca — 525 linhas de UI que **não faziam nada** (regras só no `useState`,
  sumiam no reload, nunca chegavam ao pipeline). Agora persiste em
  `suppliers.column_mappings` e vence a detecção automática.
- **Conferência no upload** (`ConferenciaColunas`): ao escolher a planilha,
  mostra de qual coluna vem cada campo e permite corrigir ali. Usa a MESMA
  função de match do extractor (`findMatchingKey`) — a tela não pode mostrar
  um mapeamento e a conversão fazer outro.
- **Particularidades do catálogo (PDF)**: campo em Fornecedores onde o
  cliente escreve com as próprias palavras. `compile_client_rules` traduz em
  regras imperativas antes do prompt (evita "devaneio"), **cacheado por hash**
  — recompila só se o texto mudar. É ADITIVO aos `SUPPLIER_HINTS` hardcoded
  (que carregam correções de bugs reais). IV-23 preservado.

### Achados que explicavam erros "aleatórios"
- Código da VAESO **nunca casava por regra** — vinha de heurística frouxa
  ("valor que parece código"), com warning em 100% das 178 linhas.
- Compilação de regras truncava por *thinking tokens* do Gemini 2.5 Flash —
  mesmo problema já enfrentado na Phase 0; resolvido com `_gen_text_json`.

---

## Entregue antes (11–13/08)

- **Timeout do frontend 6min → 25min**: catálogos grandes eram abortados pelo
  site **mesmo com o backend concluindo com sucesso** (DAGIA 106 produtos).
- **Autoria do histórico**: gravava `'Admin'` fixo; agora usa o usuário logado.
- **Failover automático** (`backendResolver`): site testa o primário e cai no
  Render na mesma requisição. Resolve o ciclo de quedas sem intervenção.
- **Painel do servidor** (`/admin/dashboard` + `/servidor`): logs, métricas,
  jobs e **pico de CPU/RAM por conversão**.
- **Concorrência autoajustada por RAM**: ≥2GB libera 3 jobs; abaixo força 1
  (protege o Render sozinho, sem configurar nada).
- **Fortal**: 900+ imagens "fantasma" por página travavam e zeravam a
  extração. Trocado para `get_image_info` + detecção de logo por **conteúdo**
  (a detecção por posição dava falso positivo em grid uniforme).

---

## Infraestrutura

- **Frontend:** Vercel (deploy automático do `main`)
- **Backend:** dois ambientes
  - **Primário:** servidor próprio (7,7GB) via **Cloudflare Tunnel nomeado e
    fixo** (`https://conversor-api.metodoiqc.com.br`, desde 01/09) —
    ⚠️ **não puxa do GitHub**, exige `scp` manual a cada correção de backend
  - **Reserva:** Render Starter (512MB) — puxa do `main` sozinho
- **Banco:** Supabase (`suppliers` já tem `column_mappings`,
  `extraction_rules`, `extraction_rules_compiled`)
- **Domínio:** `metodoiqc.com.br` (Registro.br, nameservers na Cloudflare
  desde 01/09) — zona Cloudflare tem também `pirralhos` (Central Pirralhos),
  `digitalcompany` (GitHub Pages) e o TXT de verificação do Google.

**Sobre a instabilidade (histórico, resolvido em 01/09):** boa parte das
quedas era o **túnel gratuito (Quick Tunnel)**, que o próprio Cloudflare
avisa não ter garantia de disponibilidade e cuja URL mudava a cada
reinício — coberto até então por uma automação que atualizava o Vercel e
disparava redeploy a cada troca. Migrado pro Tunnel nomeado/fixo (ver
entrega de 01/09 acima), que não tem esse problema. Do servidor em si, só 2
incidentes confirmados: fibra rompida (12/08) e bloqueio de segurança
(13/08) — ambos externos e resolvidos pelo Wesley.

---

## Reunião com o Josef — 20/08 (itens e status)

| Item | Status |
|---|---|
| Mapear TODOS os campos do Mercos (não só os obrigatórios) | **#104 MERGEADO** — 14 destinos → 46; tabelas de preço 3 → 19; confirmado no bundle de produção |
| Regra persiste por fornecedor e a nova sobrescreve a antiga | **#104 MERGEADO** — persistência já existia; o "sobrescreve" faltava |
| Tags PROMOCIONAL/OFERTA saindo como foto do produto (GIRA) | **#105 MERGEADO** — filtro de selo por tamanho + sobreposição |
| Validar catálogos grandes | com o Josef |
| Testar fornecedores novos/esporádicos (fallback genérico) | com o Josef |

Detalhe do PR #105: o fix de 22/07 só entrou no caminho de *grid*. O caminho
por proximidade (Lila, BM36, GIRA) não tinha filtro nenhum — era por ali que a
tag passava. Agora os dois usam a mesma função.

Prova do #105 em produção — mesmo PDF, mesma requisição, nos dois servidores:

| servidor | imagem escolhida | |
|---|---|---|
| Render (código novo) | 166x100 px | foto do produto |
| Servidor do Wesley (código antigo) | 51x40 px | **o selo** |

Como a produção está apontada pro Render, a cliente já tem os dois. O servidor
do Wesley segue com o código antigo enquanto o SSH estiver fechado — mais um
motivo pra não apagar `VITE_BACKEND_URL_PRIMARY` antes de atualizá-lo.

---

## Pendências abertas

1. **Servidor não puxa do GitHub** — automatizar quando estabilizar
2. ~~Migrar para túnel nomeado/fixo~~ — **RESOLVIDO 01/09** (ver entrega
   acima). `conversor-api.metodoiqc.com.br` é o endereço fixo definitivo.
3. **42 imagens sem match** no catálogo Fortal completo (outros layouts;
   `no_img_in_col` 27 + `no_plausible_match` 15). O padrão matriz cor×tamanho
   foi resolvido, esses são casos diferentes.
4. **Gemini:** Google exige migração para pré-pago (prazo deles)
5. **Limpeza pós-migração do Tunnel (não bloqueante):** desligar o processo
   do Quick Tunnel antigo no servidor próprio e remover `cf_tunnel_watcher.sh`
   + `update_vercel_backend_url.py` do repo (obsoletos desde 01/09).
6. **Construir subdomínios pros demais sistemas em `metodoiqc.com.br`**
   (Nunê AI, Banknect, Pontual Working, Contacado, StickerOps) — zona já
   está na Cloudflare, falta só criar cada CNAME + registrar no projeto
   Vercel correspondente. Pedido explícito do Gabriel (28/08), ainda não
   escopado por sistema.

---

## Workflow (não alterar)

Branch → `npm run verify` (392 testes + invariantes IV-01..23) → PR → **merge
só com aprovação do Gabriel**. O pre-push hook bloqueia se algo violar.
Validar com **arquivo real do cliente** sempre que possível
(`scripts/verify-vaeso-real.mjs`, `verify-multisheet-real.mjs`).
