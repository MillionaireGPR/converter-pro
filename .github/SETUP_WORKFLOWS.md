# 🔒 Setup dos Workflows de Proteção (manual)

Este repositório usa GitHub Actions para travar invariantes. Por restrição
do token OAuth do Claude (sem `workflow` scope), os arquivos YAML não são
comitados automaticamente. Adicione manualmente seguindo os passos:

## Passo 1 — Criar `.github/workflows/regression-locks.yml`

Cole o conteúdo abaixo:

````yaml
name: 🔒 Regression Locks - Travas Anti-Regressão

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  regression-tests:
    name: 🔒 Testes de Invariantes (IV-01 a IV-13)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - name: 🔒 regression-locks.test.ts (CRÍTICO)
        run: npx vitest run src/core/__tests__/regression-locks.test.ts --reporter=verbose
      - name: 🧪 Suite completa
        run: npx vitest run
      - name: 📝 TypeScript strict
        run: npx tsc --noEmit

  build:
    name: 📦 Build do frontend
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build

  backend-invariants:
    name: 🐍 Invariantes do backend (Python)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: IV-01 — gemini_extractor.py importa fitz
        run: |
          if ! grep -q "^import fitz" backend/image_extractor/gemini_extractor.py; then
            echo "❌ IV-01 violado. Veja ARCHITECTURE.md → IV-01"
            exit 1
          fi
          echo "✅ IV-01 ok"

      - name: IV-02 — /repair_prices_ai é async (BackgroundTasks)
        run: |
          grep -q "background_tasks.add_task(_run_repair_task" backend/image_extractor/main.py || {
            echo "❌ IV-02 violado: /repair_prices_ai não é mais assíncrono"
            exit 1
          }
          echo "✅ IV-02 ok"

      - name: IV-03 — max_workers ≤ 3
        run: |
          MATCH=$(grep -oE "repair_prices_for_skus\(pdf_path, skus_map, max_workers=[0-9]+\)" backend/image_extractor/main.py || true)
          [ -n "$MATCH" ] || { echo "❌ IV-03: chamada não encontrada"; exit 1; }
          WORKERS=$(echo "$MATCH" | grep -oE "max_workers=[0-9]+" | grep -oE "[0-9]+")
          [ "$WORKERS" -le 3 ] || { echo "❌ IV-03 violado: max_workers=$WORKERS > 3"; exit 1; }
          echo "✅ IV-03 ok (max_workers=$WORKERS)"

      - name: IV-04 — pre-render serial existe
        run: |
          grep -q "def _render_pages_batch" backend/image_extractor/gemini_extractor.py || {
            echo "❌ IV-04: _render_pages_batch ausente"; exit 1
          }
          echo "✅ IV-04 ok"

      - name: IV-09 — gc.collect() em cv_extractor.py
        run: |
          grep -q "gc.collect()" backend/image_extractor/cv_extractor.py || { echo "❌ IV-09: gc.collect() ausente"; exit 1; }
          grep -q "del raster" backend/image_extractor/cv_extractor.py || { echo "❌ IV-09: 'del raster' ausente"; exit 1; }
          echo "✅ IV-09 ok"

      - name: IV-10 — sem gemini-1.5-flash
        run: |
          if grep -E 'MODEL[A-Z_]*\s*=\s*"gemini-1\.5-flash"' backend/image_extractor/gemini_extractor.py; then
            echo "❌ IV-10: gemini-1.5-flash descontinuado em 2025"; exit 1
          fi
          echo "✅ IV-10 ok"

      - name: IV-12 — CORS específico + regex Vercel
        run: |
          grep -q "centraldeconversao.vercel.app" backend/image_extractor/main.py || { echo "❌ IV-12: origem prod ausente"; exit 1; }
          grep -q "allow_origin_regex" backend/image_extractor/main.py || { echo "❌ IV-12: regex ausente"; exit 1; }
          echo "✅ IV-12 ok"

      - name: IV-13 — SERVICE_VERSION em /health
        run: |
          grep -q "SERVICE_VERSION" backend/image_extractor/main.py || { echo "❌ IV-13"; exit 1; }
          echo "✅ IV-13 ok"

  smoke-test-prod:
    name: 🔥 Smoke test em produção
    runs-on: ubuntu-latest
    needs: [regression-tests, backend-invariants, build]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - name: Aguardar deploy Render (60s)
        run: sleep 60
      - name: Smoke test contra produção
        run: bash scripts/smoke-test.sh
````

## Passo 2 — Configurar Branch Protection para `main`

1. Vá em **Settings → Branches → Add branch protection rule**
2. Branch name pattern: `main`
3. Marque:
   - ☑ **Require a pull request before merging** (1 approval)
   - ☑ **Require status checks to pass before merging**
     - Required checks: `🔒 Testes de Invariantes (IV-01 a IV-13)`, `📦 Build do frontend`, `🐍 Invariantes do backend (Python)`
   - ☑ **Require branches to be up to date before merging**
   - ☑ **Do not allow bypassing the above settings** (proteção contra force push)

## Passo 3 — Validar localmente antes de pushar

```bash
npx tsc --noEmit                                              # zero erros
npx vitest run src/core/__tests__/regression-locks.test.ts    # 24/24 passa
npx vitest run                                                # 213/213 passa
bash scripts/smoke-test.sh                                    # 7/7 passa
```

## Por que não fui eu (Claude) que adicionei o workflow?

Token OAuth do Claude Code não tem `workflow` scope por padrão para
mitigar risco de modificação não autorizada de pipelines. Esse é o
comportamento correto e SEGURO. Você (com permissão de owner) é quem
deve adicionar o workflow.

Após adicionar, qualquer PR futuro que violar invariante será **bloqueado**
automaticamente.
