# IQC_STATUS_ATUAL.md — MICHELE_CONVERSOR

**Projeto:** MICHELE_CONVERSOR (Converter-Pro / Nunes Representações)
**Atualizado em:** 24/08/2026

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
  - **Primário:** servidor próprio (7,7GB) via **Cloudflare Quick Tunnel** —
    ⚠️ **não puxa do GitHub**, exige `scp` manual a cada correção de backend
  - **Reserva:** Render Starter (512MB) — puxa do `main` sozinho
- **Banco:** Supabase (`suppliers` já tem `column_mappings`,
  `extraction_rules`, `extraction_rules_compiled`)

**Sobre a instabilidade:** boa parte das quedas foi o **túnel gratuito**, que
o próprio Cloudflare avisa não ter garantia de disponibilidade, e cuja URL
muda a cada reinício (há automação que atualiza o Vercel). Do servidor em si,
só 2 incidentes confirmados: fibra rompida (12/08) e bloqueio de segurança
(13/08) — ambos externos e resolvidos pelo Wesley. Decisão do Gabriel: manter
o túnel gratuito até entrarem as primeiras mensalidades.

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
2. **Quick Tunnel continua sem SLA e muda de URL** — migrar para túnel
   nomeado quando houver domínio/orçamento; até lá, manter watcher + Render.
3. **42 imagens sem match** no catálogo Fortal completo (outros layouts;
   `no_img_in_col` 27 + `no_plausible_match` 15). O padrão matriz cor×tamanho
   foi resolvido, esses são casos diferentes.
4. **Gemini:** Google exige migração para pré-pago (prazo deles)

---

## Workflow (não alterar)

Branch → `npm run verify` (392 testes + invariantes IV-01..23) → PR → **merge
só com aprovação do Gabriel**. O pre-push hook bloqueia se algo violar.
Validar com **arquivo real do cliente** sempre que possível
(`scripts/verify-vaeso-real.mjs`, `verify-multisheet-real.mjs`).
