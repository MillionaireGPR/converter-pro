# 🔒 ARQUITETURA — INVARIANTES INTOCÁVEIS

> **Este documento é a fonte da verdade sobre o que NÃO pode mudar no sistema.**
> Antes de modificar qualquer arquivo listado aqui, leia a seção correspondente.
> Cada invariante foi descoberto na dura — quebrou produção, custou tempo do cliente.

**Data da consolidação**: 27/05/2026
**Versão estável**: Vercel `c0c3c9c` + Render `v7-cv-low-ram`
**Validação**: NIX HOUSE 285 produtos, 91 preços resgatados em 58.8s, R$ 0,65 de custo Gemini, 0 erros na UI.

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
