# Pull Request

## 📋 O que esta PR faz?

<!-- Descreva claramente a mudança em 1-3 frases -->

## 🔒 Toca algum invariante (IV-NN)?

<!-- Consulte ARCHITECTURE.md. Lista de invariantes:
  IV-01: import fitz em gemini_extractor.py
  IV-02: /repair_prices_ai assíncrono
  IV-03: max_workers ≤ 3
  IV-04: pre-render serial _render_pages_batch
  IV-05: recalc result.stats após repair (engine.ts)
  IV-06: applyRepairedPrices suporta V2 e legado
  IV-07: retry agressivo com backoff em uploads
  IV-08: polling com timeout total (não while(true))
  IV-09: gc.collect() em cv_extractor.py
  IV-10: cadeia de fallback Gemini sem 1.5-flash
  IV-11: persistência de status em disco
  IV-12: CORS específico + regex Vercel
  IV-13: SERVICE_VERSION em /health
-->

- [ ] Não toca nenhum IV-NN
- [ ] Toca IV-__ (justificativa abaixo):

<!-- Se tocar algum IV, explique POR QUE e como você garante que o comportamento crítico foi preservado -->

## ✅ Checklist obrigatório

- [ ] Rodei `npx tsc --noEmit` localmente (zero erros)
- [ ] Rodei `npx vitest run` localmente (todos passam, incluindo `regression-locks.test.ts`)
- [ ] Se mudei comportamento, **adicionei novo teste** que falharia se o bug voltasse
- [ ] Li `ARCHITECTURE.md` se a mudança afeta arquivos críticos
- [ ] Para mudanças no backend, validei localmente subindo uvicorn

## 🧪 Como testar manualmente?

<!-- Passos para o reviewer reproduzir -->

## 🚨 Risco de regressão (1-5)

<!-- 1 = mudança isolada em código novo -->
<!-- 5 = toca pipeline crítico em uso por cliente -->

**Nível**: _ / 5

## 📊 Impacto esperado em métricas

<!-- Se aplicável: tempo de processamento, custo Gemini, RAM, etc -->

- Tempo de conversão NIX: ___ s (baseline atual: ~60-80s)
- Custo Gemini por catálogo: R$ ___ (baseline atual: ~R$ 0,65)
- RAM peak no Render: ___ MB (baseline: ~50MB)

## 🔗 Issue/contexto relacionado

<!-- Link para issue, screenshot do erro, etc -->

---

**Lembrete**: o cliente Nunes Representações já foi impactado por bugs em produção.
Validar localmente é mais rápido que descobrir em produção. Vide `CLAUDE.md`.
