# 🔒 ARQUITETURA — INVARIANTES INTOCÁVEIS

> **Este documento é a fonte da verdade sobre o que NÃO pode mudar no sistema.**
> Antes de modificar qualquer arquivo listado aqui, leia a seção correspondente.
> Cada invariante foi descoberto na dura — quebrou produção, custou tempo do cliente.

**Data da consolidação**: 27/05/2026 (base) · 09/06/2026 (pivô AI-first, IV-15 a IV-20)
**Versão estável**: Render `v26-center-badge`
**Validação base**: NIX HOUSE 285 produtos, 91 preços em 58.8s, R$ 0,65, 0 erros.
**Validação AI-first**: DAGIA 28/28 produtos (códigos/preços/qty caixa/EM BREVE = 100%) + imagens corretas (caixas dos kits, foto dos copos, mugs/xícaras nos produtos certos), aprovado pelo cliente em 09/06/2026.

---

## 📐 Visão arquitetural

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser (Vercel)                                                   │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  engine.ts (processarArquivoV2)                               │  │
│  │   ↓ 1. Pipeline base (runImportPipeline)  ~2s                 │  │
│  │   ↓ 2. AI cirúrgica (repairPricesViaGemini) ~60s              │  │
│  │   ↓ 3. Imagens (runImageExtraction) ~60-120s                  │  │
│  │   ↓ 4. Recalc stats (DEPOIS do repair)                        │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                            ↓ async (POST + polling)
┌─────────────────────────────────────────────────────────────────────┐
│  Render Starter 512MB (FastAPI)                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  /repair_prices_ai (POST) → jobId + BackgroundTask            │  │
│  │  /repair_prices_ai_status/{job_id} (GET) → polling            │  │
│  │  /process (POST) → jobId + BackgroundTask                     │  │
│  │  /status/{job_id} (GET) → polling                             │  │
│  │  /health (GET) → version + status                             │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                            ↓ Google API
┌─────────────────────────────────────────────────────────────────────┐
│  Gemini 2.5 Flash (Vision) — $0.05/catálogo NIX                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🚫 INVARIANTES — NÃO QUEBRAR

### IV-01 — `import fitz` em `gemini_extractor.py`
**Arquivo**: `backend/image_extractor/gemini_extractor.py` linha ~18
**Por que existe**: `_render_pages_batch` usa `fitz.open(pdf_path)`. Sem o import, era `NameError` silenciado pelo `except Exception` → função retornava `{}` → Gemini nunca era chamado → bug invisível: response com `success=true` mas `paginas_processadas=0` em 0.0004s.
**Custou ao cliente**: 4 PRs (#7) e várias horas até identificar.
**Travado por**: `regression-locks.test.ts` → "PR#7: gemini_extractor.py deve importar fitz"

### IV-02 — `/repair_prices_ai` é ASSÍNCRONO (BackgroundTask + polling)
**Arquivo**: `backend/image_extractor/main.py` endpoint `/repair_prices_ai`
**Por que existe**: 51 páginas × ~3s = ~150s. Render gateway mata HTTP em 100-300s. Síncrono dava 502 + CORS fantasma + cobrança Gemini sem entrega.
**Como deve funcionar**: POST retorna `{jobId, status: "processing"}` em ~1s. Frontend faz polling em `/repair_prices_ai_status/{jobId}`.
**Travado por**: `regression-locks.test.ts` → "PR#8: /repair_prices_ai assíncrono"

### IV-03 — `max_workers ≤ 3` em `repair_prices_for_skus`
**Arquivo**: `backend/image_extractor/main.py` linha onde chama `repair_prices_for_skus`
**Por que existe**: Render Starter tem 512MB. Cada worker abrindo `fitz.open(pdf_path)` carrega 12MB do PDF na RAM. 6+ workers paralelos = OOM confirmado em produção (Render Dashboard: "Ran out of memory used over 512MB").
**Travado por**: `regression-locks.test.ts` → "max_workers≤3"

### IV-04 — Pre-render SERIAL em `_render_pages_batch`
**Arquivo**: `backend/image_extractor/gemini_extractor.py`
**Por que existe**: UMA única `fitz.open()` para renderizar TODAS as páginas necessárias antes de chamar Gemini. Workers paralelos do Gemini só recebem bytes JPEG já em memória (~150KB cada). Sem isso, OOM 512MB.
**Footprint**: ~12MB (PDF) + ~7.5MB (51 JPEGs) = ~20MB peak vs ~170MB+ antes.
**Travado por**: `regression-locks.test.ts` → "pre-render serial"

### IV-05 — Recalc de `result.stats` APÓS `applyRepairedPrices`
**Arquivo**: `src/core/engine.ts`
**Por que existe**: O pipeline base calcula `result.stats` ANTES do repair. Sem recalcular, UI mostrava 91 erros mesmo com preços resgatados corretamente. Cliente reportou: "Por que os preços estão lá mas o status mostra Erro?"
**Como deve estar**:
```ts
applyRepairedPrices(result.produtosNormalizados, repairResult.precos);
const recalc = result.produtosNormalizados.reduce(...);
result.stats.validos = recalc.validos;
result.stats.comErro = recalc.comErro;
result.stats.comWarning = recalc.comWarning;
```
**Travado por**: `regression-locks.test.ts` → "engine.ts recalcula result.stats"

### IV-06 — `applyRepairedPrices` suporta V2 ('erro'→'validado') E legado ('invalido'→'valido')
**Arquivo**: `src/core/pipeline/geminiExtractionApi.ts`
**Por que existe**: Pipeline V2 (`importPipeline.ts`) usa `'validado'/'pendente'/'erro'`. Código antigo de `applyRepairedPrices` testava `=== 'invalido'`, que nunca disparava no V2. Resultado: produtos com preço aplicado mas status "erro" para sempre.
**Como deve estar**: detectar ambos os esquemas pelo valor anterior do status.
**Travado por**: `regression-locks.test.ts` → "PR#9: status V2 e legado"

### IV-07 — Retry agressivo com backoff exponencial nos uploads
**Arquivo**: `src/core/pipeline/geminiExtractionApi.ts` E `src/core/images/imageExtractionApi.ts`
**Por que existe**: HTTP/2 entre Browser e Cloudflare sofre resets esporádicos em uploads grandes (12+MB). Sintomas: `ERR_HTTP2_PROTOCOL_ERROR`, `Failed to fetch`, CORS fantasma (header não chega quando stream reseta).
**Requisitos mínimos**:
- `maxAttempts ≥ 5`
- backoff exponencial `3s → 6s → 12s → 24s` (cap 30s)
- timeout ≥ 120s por tentativa
- detecção explícita de `HTTP2_PROTOCOL_ERROR`, `Failed to fetch`, `NetworkError`, `ECONNRESET`
**Travado por**: `regression-locks.test.ts` → "PR#10: retry agressivo"

### IV-08 — Polling tem TIMEOUT TOTAL (não `while(true)` infinito)
**Arquivo**: `src/core/images/imageExtractionApi.ts` E `src/core/pipeline/geminiExtractionApi.ts`
**Por que existe**: User reportou ficar 20+ minutos em "Finalizando extração" porque o polling era `while(true)` e `not_found` era silenciosamente ignorado. Quando backend caía (OOM), o frontend nunca abortava.
**Requisitos**:
- `MAX_WAIT_MS` definido (5min para repair, 6min para imagens)
- `MAX_CONSECUTIVE_ERRORS`: tolera N falhas seguidas, depois aborta
- `MAX_NOT_FOUND_CHECKS`: 3 confirmações de `not_found` = job perdido (não loop infinito)
**Travado por**: `regression-locks.test.ts` → "PR#11: polling resiliente"

### IV-09 — `gc.collect()` periódico em `cv_extractor.py`
**Arquivo**: `backend/image_extractor/cv_extractor.py`
**Por que existe**: `/process` renderiza cada página A4 como `np.ndarray` ~3.3MB. Sem `gc`, 51 páginas acumulam ~170MB → Render Starter (512MB) estoura → container reinicia → job perdido → polling do frontend dá `not_found`.
**Requisitos**:
- `import gc` no topo
- `del raster, pix, page_imgs` ao fim de cada iteração de página
- `gc.collect()` a cada 10 páginas
**Travado por**: `regression-locks.test.ts` → "PR#11: gc no /process"

### IV-10 — Cadeia de fallback Gemini SEM `gemini-1.5-flash`
**Arquivo**: `backend/image_extractor/gemini_extractor.py`
**Por que existe**: `gemini-1.5-flash` foi descontinuado pelo Google em 2025 → API retorna 404 v1beta. Cadeia válida em 2026:
- `gemini-2.5-flash` (padrão)
- `gemini-2.0-flash` (estável)
- `gemini-flash-latest` (alias)
- `gemini-2.5-pro` (último recurso)
**Travado por**: `regression-locks.test.ts` → "cadeia de fallback de modelos Gemini"

### IV-11 — Persistência de status em disco (`_save_status`)
**Arquivo**: `backend/image_extractor/main.py`
**Por que existe**: Render reinicia o serviço (OOM, deploy, idle) e zera o dict em memória. Sem persistir em `temp/<jobId>/status.json`, frontend ficava em polling eterno após restart.
**Travado por**: `regression-locks.test.ts` → "persistência de status"

### IV-12 — CORS configurado com origens específicas + regex `vercel.app`
**Arquivo**: `backend/image_extractor/main.py`
**Por que existe**:
- `allow_origins=["*"]` + `allow_credentials=True` é INVÁLIDO pela spec CORS (navegador rejeita).
- Precisamos cobrir tanto `centraldeconversao.vercel.app` quanto previews `https://*.vercel.app`.
**Como deve estar**:
```python
allow_origins=["https://centraldeconversao.vercel.app", "http://localhost:5173", ...],
allow_origin_regex=r"https://.*\.vercel\.app",
allow_credentials=False,
```
**Travado por**: `regression-locks.test.ts` → "CORS configurado"

### IV-13 — `SERVICE_VERSION` no `/health` (rastreamento de deploy)
**Arquivo**: `backend/image_extractor/main.py`
**Por que existe**: Sem isso, impossível saber qual versão o Render está servindo. Já tivemos caso de Render servir código stale por horas — sem o `version` no `/health`, descobriríamos só pelo bug em produção.
**Travado por**: `regression-locks.test.ts` → "SERVICE_VERSION no /health"

### IV-14 — Heurística `_box_score` em DAGIA (FALLBACK do AI Picker)
**Arquivo**: `backend/image_extractor/cv_extractor.py` função `_box_score`
**Status (v26)**: SUPERSEDIDO pelo AI Picker (IV-16/17) como caminho primário do DAGIA. Mantido como FALLBACK quando o AI Picker está desligado (kill-switch) ou não decide um SKU. NÃO remover — é a rede de segurança sem custo de IA.
**Fórmula travada** (não mexer sem novo critério empírico):
```
aspect_score:
  0.65-0.90       → 1.0   (zona ouro da CAIXA)
  0.55-0.65 ou 0.90-1.05 → 0.6 (ambíguo)
  0.40-0.55 ou 1.05-1.30 → 0.3 (improvável)
  outros          → 0.1
score = aspect_score * 0.55 + std_dev_color * 0.30 + size_log * 0.15
filtro: area >= 20000 pixels
```
**Travado por**: `src/core/pipeline/dagia-box-heuristic.test.ts` (6 testes)

### IV-15 — Pipeline AI-FIRST: Gemini é o extrator PRIMÁRIO de PDFs
**Arquivos**: `src/core/engine.ts`, `src/core/pipeline/aiFirstExtractionApi.ts`, `src/core/pipeline/importPipeline.ts` (`PipelineOptions.aiBrutos`), `backend/image_extractor/gemini_extractor.py`, endpoint `/extract_products_ai`
**Por que existe**: 14 parsers regex artesanais = manutenção infinita; cada layout novo quebrava a extração. Spike empírico (DAGIA, 09/06/2026) provou Gemini lendo o catálogo inteiro: 28/28 códigos, 28/28 preços, 5/5 EM BREVE.
**Como deve funcionar**:
- Para PDF, `engine.ts` chama `extractProductsViaAI` ANTES do pipeline regex.
- Sucesso → injeta `options.aiBrutos` → `importPipeline` PULA leitura regex e usa os brutos da IA. Normalização/validação/dedup seguem IGUAIS.
- Falha (timeout/erro/0 produtos) → FALLBACK AUTOMÁTICO para o pipeline regex. Nada quebra.
- **BLOCKLIST** (continuam no regex, NÃO usar IA): `NIX` (caso-bandeira, 285 produtos 0 erros, IVs baseiam-se nele) e `GOAL KIDS` (1042 páginas, excede contexto/custo).
**Travado por**: `src/core/pipeline/ai-first-golden.test.ts` (11 testes, fixture = resposta REAL do Gemini). NÃO enfraquecer a fixture.

### IV-16 — AI Image Picker é MEMORY-SAFE (lição do OOM v21)
**Arquivos**: `backend/image_extractor/gemini_image_picker.py`, bloco AI picker em `cv_extractor.py`
**Por que existe**: v21 derrubou produção (OOM 512MB → 502 → job perdido) porque extraía TODAS as candidatas como arrays RGB + N miniaturas + mandava tudo inline ao Gemini, por página.
**Regras INVioláveis**:
- `pick_images_for_page` recebe RECTS (não arrays RGB) + o raster JÁ renderizado. Manda UMA imagem (a página anotada). NÃO extrai candidatas.
- O caller (`cv_extractor`) extrai APENAS a imagem escolhida, com `del` imediato.
- NUNCA reintroduzir extração de todas as candidatas antes da decisão.
**Validação**: teste local de RSS (mock Gemini + PDF real) → pico ~117-143MB (limite 512MB).
**Custo**: 1 chamada Flash por página com SKUs (~$0.005). DAGIA ≈ $0.09/catálogo.

### IV-17 — Anotação do AI Picker: badge no CENTRO + `allow_fullpage` + prompt anti-"fundo"
**Arquivo**: `backend/image_extractor/gemini_image_picker.py` (`_annotate_page`, `PROMPT_TEMPLATE`), `_get_page_embedded_images(allow_fullpage=True)`
**Por que existe** (validado contra Gemini real, 09/06/2026):
- **Badge no CENTRO** do rect (não no canto). Canto colava badges de imagens sobrepostas → Gemini não associava número à foto. (LX15016 pegava card preto.)
- **`allow_fullpage=True`** só no AI Picker: a foto principal às vezes cobre a página inteira (copos LX15016). O filtro >85% a descartava. Logos recorrentes seguem filtrados por `logo_xrefs`.
- **Prompt anti-"fundo"**: instrução explícita de que foto de produto PODE ocupar a página toda e isso NÃO a torna fundo; rejeitar só cor sólida SEM produto, tags e cards de título.
**Resultado**: LX15016→copos, DXP57→mug limpo, DZ/DXP1→caixas, tags/cards/fundo azul rejeitados.
**Travado por**: `src/core/images/image-picker-contract.test.ts` (contrato do annotation/candidatas).

### IV-18 — `SUPPLIER_HINTS`: fornecedor = hint no prompt, NÃO parser regex
**Arquivo**: `backend/image_extractor/gemini_extractor.py` (`SUPPLIER_HINTS`, `get_supplier_hints`)
**Por que existe**: substituir o ciclo de manutenção de parsers. Ajuste de fornecedor = ~4 linhas de instrução em PT-BR anexadas ao prompt. Layout mudou? Ajusta a frase, não o código.
**Travado por**: lookup tolerante (caixa/acento/parcial) — ver teste em `image-picker-contract.test.ts` / validação manual documentada.

### IV-19 — DAGIA `quantidadeCaixa` exige prefixo `CX`
**Arquivo**: `src/core/pdfTemplates/dagia.template.ts` + hint DAGIA no backend
**Por que existe**: "C/6 Pçs" no NOME do produto NÃO é a caixa de embarque. A caixa real é "CX C/8Jgs". Regex sem `CX` capturava o número errado (LX15016 dava 6 em vez de 8).
**Regra**: `/CX\s*C\/(\d{1,3})\s*(?:Jgs|Jogos|P[cç]s|Pecas|Un)?/i` — `CX` obrigatório.
**Travado por**: `src/core/pdfTemplates/dagia.template.test.ts` (caso real LX15016).

### IV-20 — AI Picker: whitelist DAGIA + kill-switch `AI_PICKER_DISABLED`
**Arquivos**: `src/core/images/imageExtractionApi.ts` (`AI_PICKER_SUPPLIERS`), `main.py`
**Por que existe**: controlar custo e blast-radius. AI Picker roda só para fornecedores na whitelist (`['DAGIA']` hoje) ou via `useAiPicker=true`. `AI_PICKER_DISABLED=1` no Render desliga sem rollback de código (segurança operacional).
**Travado por**: `src/core/images/image-extraction-contract.test.ts`

### IV-21 — Fila/limite de concorrência de jobs pesados (trava anti-OOM)
**Arquivos**: `main.py` (`_HEAVY_SLOT`, `_job_slot`, `MAX_CONCURRENT_JOBS`)
**Por que existe**: Render Starter = 512MB. Jobs pesados (extração de IMAGEM — renderiza páginas em bitmap — e extração de IA) rodando em paralelo estouram a RAM → Render reinicia a instância → jobs em andamento morrem EM SILÊNCIO (comprovado: 6 catálogos simultâneos → 3 sem imagem + 1 travado + e-mail "exceeded its memory limit"). Um semáforo GLOBAL compartilhado pelos dois tipos de job limita a `MAX_CONCURRENT_JOBS` (default 1) simultâneos; o resto fica "na fila" (status=processing, stage=queued — compatível com o polling). Configurável por env `MAX_CONCURRENT_JOBS` (subir só se aumentar a RAM do Render). NÃO remover nem trocar por execução paralela sem upgrade de RAM.
**Travado por**: grep IV-21 em `scripts/verify-invariants.mjs`

### IV-22 — Gate "preço == número do código" no template-synth (anti-dado-errado)
**Arquivos**: `gemini_extractor.py` (`_price_looks_like_code` + gate em `extract_via_template`)
**Por que existe**: catálogos com texto esparso e preços AGRUPADOS no fim da página (ex: DAGIA — 41 págs, 7KB de texto, preços R$ depois de TODOS os códigos) quebram o modelo bloco-por-código do template-synth. Sem R$ dentro do bloco, o PRECO regex sintetizado (frouxo, roda com `re.DOTALL`) captura os DÍGITOS DO PRÓPRIO CÓDIGO como preço: `ES7018→7018,00`, `EY3003→3003,00`, `DV091→91,00`. O gate de cobertura contava qualquer preço não-nulo → via ~100% → NUNCA caía no fallback → entregava preço errado ao cliente (validado deterministicamente: cobertura "100%" enganada vs ~12% real). O gate: se ≥50% dos preços (fmt=BR, inteiros, ≥10) forem iguais a um run de dígitos do código, o template é REJEITADO → cai no `extract_with_fallback_text_chunked` (a IA mapeia os preços posicionalmente). A fração ≥50% é a trava de segurança cross-supplier (FORTAL/GIRA/BM36 têm centavos ou CENTS → fração ~0, nunca disparam). NÃO remover o gate nem o helper, nem contar preço-vindo-do-código como cobertura válida.
**Travado por**: grep IV-22 + smoke comportamental em `scripts/verify-invariants.mjs`

---

## 🎯 Métricas do sistema em produção (baseline)

Após PR #11 (versão `v7-cv-low-ram`), o sistema processa:

| Catálogo | Produtos | Páginas | AI repair | Tempo total | Custo Gemini | RAM peak |
|---|---|---|---|---|---|---|
| **NIX HOUSE** | 285 | 51 | 91 SKUs em 58.8s | <1min | **R$ 0,65** (~$0.13) | ~50MB |

Qualquer regressão nesses números é sinal de alerta.

---

## 🛠 Workflow seguro de modificação

1. **Leia este documento.** Identifique se sua mudança toca um IV-NN.
2. **Crie branch** (não commit em `main`): `git checkout -b feat/<nome>`
3. **Faça TDD**: escreva o teste ANTES da mudança quando possível.
4. **Rode `npm run test -- --run` localmente.** Todos 213+ devem passar.
5. **Rode `npx tsc --noEmit`.** Zero erros.
6. **Abra PR.** O CI valida tudo de novo.
7. **NUNCA bypassa o CI** com `--no-verify` ou desativando workflows.
8. **Após merge**, monitore `/health` no Render até a nova versão aparecer.
9. **Se for fix urgente em produção** que toca IV-NN, marcar no PR claramente e adicionar teste de regressão DENTRO do PR.

---

## 🚨 Como debugar produção em caso de fogo

### Sintoma: usuário relata erros depois de upload

1. **Abra `/health` do Render**: confirme versão esperada.
   ```
   curl https://converter-pro-image-extractor.onrender.com/health
   ```
2. **Cheque Render Dashboard**: procure por "Instance failed: Ran out of memory" ou "Service recovered".
3. **Console do navegador (anônimo)**: procure por padrão de logs:
   - `[GeminiRepair]` → `/repair_prices_ai`
   - `[ImageExtractionApi]` → `/process`
   - `[Engine]` → orchestração
4. **Se `not_found`** → backend reiniciou (OOM provável).
5. **Se `ERR_HTTP2_PROTOCOL_ERROR`** → upload grande dropou (retry deveria recuperar).
6. **Se `success=true` mas `paginas_processadas=0` em <1s** → bug do IV-01 voltou!

### Sintoma: deploy não atualiza

1. Aguarde 2-3min (Render rebuild + warm-up).
2. Force redeploy via Render Dashboard se necessário.
3. Confirmação: `/health` retorna `SERVICE_VERSION` novo.

---

## 📞 Histórico de PRs (sessão de consolidação)

| PR | Bug | Travado em teste |
|---|---|---|
| #7 | `import fitz` faltando | `IV-01` |
| #8 | Síncrono + OOM workers paralelos | `IV-02`, `IV-03`, `IV-04` |
| #9 | Stats não recalculados + status V2 | `IV-05`, `IV-06` |
| #10 | `ERR_HTTP2_PROTOCOL_ERROR` | `IV-07` |
| #11 | Polling infinito + OOM /process | `IV-08`, `IV-09` |

Todos os 24 testes de `regression-locks.test.ts` devem passar em qualquer PR futuro. Se um falhar, **NÃO ajuste o teste** — investigue a regressão.

---

**Última atualização**: 27/05/2026 após validação E2E NIX em produção.
