# Instruções para Claude (e qualquer agente assistente)

## ⚠️ ANTES DE QUALQUER MUDANÇA — LEIA

Este projeto teve uma sessão difícil de debug em 27/05/2026 que afetou
o cliente (Nunes Representações). Vários bugs em produção foram corrigidos
em sequência (PRs #7 a #11). A entrega NIX HOUSE finalmente funcionou:
285 produtos, 91 preços via Gemini em ~60s, 0 erros, R$ 0,65 de custo.

**Sua MISSÃO PRIMÁRIA**: não quebrar o que está funcionando.

## 🔒 Leitura obrigatória

Antes de tocar qualquer arquivo, leia:

1. **`ARCHITECTURE.md`** — invariantes IV-01 a IV-13 que NÃO podem mudar
2. **`src/core/__tests__/regression-locks.test.ts`** — testes que travam esses invariantes

Se sua mudança vai tocar:
- `backend/image_extractor/gemini_extractor.py` → IV-01, IV-04, IV-10
- `backend/image_extractor/main.py` → IV-02, IV-03, IV-11, IV-12, IV-13
- `backend/image_extractor/cv_extractor.py` → IV-09
- `src/core/engine.ts` → IV-05
- `src/core/pipeline/geminiExtractionApi.ts` → IV-06, IV-07, IV-08
- `src/core/images/imageExtractionApi.ts` → IV-07, IV-08

**Re-leia o IV correspondente em `ARCHITECTURE.md` ANTES.**

## ✅ Workflow obrigatório de qualquer mudança

1. **Crie branch** (nunca commit direto em main):
   ```
   git checkout -b feat/<descrição>
   ```

2. **Faça a mudança**

3. **Rode os checks LOCAIS antes de commitar**:
   ```
   npx tsc --noEmit
   npx vitest run src/core/__tests__/regression-locks.test.ts
   npx vitest run
   ```

4. **Todos 213+ testes devem passar**. Se algum em `regression-locks.test.ts`
   falhar, **NÃO ajuste o teste** — investigue a regressão.

5. **Abra PR** com checklist preenchido (template em `.github/pull_request_template.md`)

6. **CI valida tudo de novo** (`.github/workflows/regression-locks.yml`)

7. **Smoke test em produção pós-deploy** roda automático

## 🚫 O que NUNCA fazer

- ❌ Push direto para `main`
- ❌ `--no-verify` para pular hooks
- ❌ Desativar workflows do CI
- ❌ Deletar/enfraquecer testes em `regression-locks.test.ts`
- ❌ Mudar `max_workers` de Gemini sem ler IV-03
- ❌ Voltar `/repair_prices_ai` para síncrono (IV-02)
- ❌ Remover `gc.collect()` de `cv_extractor.py` (IV-09)
- ❌ Remover `import fitz` de `gemini_extractor.py` (IV-01) — esse já quebrou produção UMA vez

## 🎯 Como diagnosticar problemas em produção

Ler seção "Como debugar produção" em `ARCHITECTURE.md`.

Comandos rápidos:
```bash
# Health do backend
curl https://converter-pro-image-extractor.onrender.com/health

# Smoke test completo (7 checks)
bash scripts/smoke-test.sh --expect-version v7-cv-low-ram
```

## 📞 Padrão de commits

- `fix(<área>): <descrição>` — bug fix
- `feat(<área>): <descrição>` — feature nova
- `chore(<área>): <descrição>` — manutenção
- `docs(<área>): <descrição>` — documentação
- `test(<área>): <descrição>` — testes

Sempre inclua referência ao IV-NN se a mudança o afeta:
> `fix(repair): ajusta retry sem violar IV-07`

## 🆘 Em caso de fogo em produção

1. Consulte `ARCHITECTURE.md` → "Como debugar produção em caso de fogo"
2. Cheque `/health` para versão atual
3. Veja Render Dashboard para OOM/restarts
4. Console do navegador (anônimo) para padrões `[GeminiRepair]` / `[Engine]`
5. **Não faça rollback automático** — investigue antes; pode ser ambiente, não código

---

## Contexto do cliente

- **Cliente**: Nunes Representações
- **Caso de uso crítico**: catálogos PDF → planilhas Mercos/JAWEB
- **Fornecedores em produção**: NIX HOUSE, FOLIA, GIRA, BM36, FREECOM, DAGIA, CLINK, MOMENT, FLASH, NeoFestas, LilaHome, Petrin, Levivan, GoalKids
- **Prazo**: ASAP (entrega em curso)
- **Restrição**: zero/baixo custo — Render Starter $7/mês, Gemini Flash ~$0.05/catálogo

A confiança do cliente já foi afetada por demora. Cada regressão piora isso.
**Velocidade ≠ pressa.** Validar localmente antes de pushar economiza muito tempo.
