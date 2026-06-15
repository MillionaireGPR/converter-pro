# ⏳ PENDENTE: grep checks de CI para IV-15 a IV-20

Estes checks de backend foram escritos mas **não puderam ser commitados pelo
agente** (token sem escopo `workflow` do GitHub). A trava principal desses
invariantes JÁ está ativa via testes vitest (`ai-first-golden.test.ts`,
`image-picker-contract.test.ts`, `dagia.template.test.ts`,
`image-extraction-contract.test.ts`) que rodam no job "Suite completa".

Estes grep checks são uma **camada extra** de defesa no nível dos arquivos
Python. Para aplicá-los:

## Como aplicar (GitHub web UI — usa suas credenciais com `workflow` scope)

1. Abra `.github/workflows/regression-locks.yml` no GitHub.
2. No job `backend-invariants`, **logo após o bloco "IV-13 — SERVICE_VERSION"**
   e **antes de** `smoke-test-prod:`, cole os blocos abaixo.
3. Opcional: renomeie `name: 🔒 Testes de Invariantes (IV-01 a IV-13)` →
   `(IV-01 a IV-20)`.

```yaml
      - name: IV-15 — endpoint AI-first existe
        run: |
          grep -q "def extract_with_fallback" backend/image_extractor/gemini_extractor.py || { echo "❌ IV-15: extract_with_fallback ausente"; exit 1; }
          grep -q "/extract_products_ai" backend/image_extractor/main.py || { echo "❌ IV-15: endpoint ausente"; exit 1; }
          echo "✅ IV-15 ok"

      - name: IV-16 — AI picker memory-safe (recebe raster, NÃO extrai todas candidatas)
        run: |
          grep -q "def pick_images_for_page" backend/image_extractor/gemini_image_picker.py || { echo "❌ IV-16: pick_images_for_page ausente"; exit 1; }
          grep -q "raster_rgb" backend/image_extractor/gemini_image_picker.py || { echo "❌ IV-16: deve receber raster_rgb (não arrays por candidata)"; exit 1; }
          echo "✅ IV-16 ok"

      - name: IV-17 — badge no CENTRO + allow_fullpage + prompt anti-fundo
        run: |
          grep -q "def _annotate_page" backend/image_extractor/gemini_image_picker.py || { echo "❌ IV-17: _annotate_page ausente"; exit 1; }
          grep -q "rect.x0 + rect.x1" backend/image_extractor/gemini_image_picker.py || { echo "❌ IV-17: badge deve ser no CENTRO do rect"; exit 1; }
          grep -q "allow_fullpage" backend/image_extractor/cv_extractor.py || { echo "❌ IV-17: allow_fullpage ausente no cv_extractor"; exit 1; }
          echo "✅ IV-17 ok"

      - name: IV-18 — SUPPLIER_HINTS (fornecedor = hint, não parser)
        run: |
          grep -q "SUPPLIER_HINTS" backend/image_extractor/gemini_extractor.py || { echo "❌ IV-18: SUPPLIER_HINTS ausente"; exit 1; }
          grep -q "def get_supplier_hints" backend/image_extractor/gemini_extractor.py || { echo "❌ IV-18: get_supplier_hints ausente"; exit 1; }
          echo "✅ IV-18 ok"

      - name: IV-20 — kill-switch AI_PICKER_DISABLED
        run: |
          grep -q "AI_PICKER_DISABLED" backend/image_extractor/main.py || { echo "❌ IV-20: kill-switch ausente"; exit 1; }
          echo "✅ IV-20 ok"
```

Após aplicar, apague este arquivo.
