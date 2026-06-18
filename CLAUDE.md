# Instruções para Claude (e qualquer agente assistente)

## ⚠️ ANTES DE QUALQUER MUDANÇA — LEIA

Este projeto teve uma sessão difícil de debug em 27/05/2026 que afetou
o cliente (Nunes Representações). Vários bugs em produção foram corrigidos
em sequência (PRs #7 a #11). A entrega NIX HOUSE finalmente funcionou:
285 produtos, 91 preços via Gemini em ~60s, 0 erros, R$ 0,65 de custo.

**Sua MISSÃO PRIMÁRIA**: não quebrar o que está funcionando.

## 🔒 Leitura obrigatória

Antes de tocar qualquer arquivo, leia:

1. **`ARCHITECTURE.md`** — invariantes IV-01 a IV-20 que NÃO podem mudar
2. **`scripts/verify-invariants.mjs`** — o verificador LOCAL (`npm run verify`) que trava tudo
3. **`src/core/__tests__/regression-locks.test.ts`** — testes que travam esses invariantes

Se sua mudança vai tocar:
- `backend/image_extractor/gemini_extractor.py` → IV-01, IV-04, IV-10, IV-15, IV-18
- `backend/image_extractor/main.py` → IV-02, IV-03, IV-11, IV-12, IV-13, IV-20
- `backend/image_extractor/cv_extractor.py` → IV-09, IV-14, IV-16, IV-17
- `backend/image_extractor/gemini_image_picker.py` → IV-16, IV-17
- `src/core/engine.ts` → IV-05, IV-15
- `src/core/pipeline/geminiExtractionApi.ts` → IV-06, IV-07, IV-08
- `src/core/pipeline/aiFirstExtractionApi.ts` → IV-15
- `src/core/pipeline/importPipeline.ts` (`aiBrutos`) → IV-15
- `src/core/images/imageExtractionApi.ts` → IV-07, IV-08, IV-20

**Re-leia o IV correspondente em `ARCHITECTURE.md` ANTES.**

### 🤖 Arquitetura AI-FIRST (v23+) — leitura essencial

O sistema mudou de "14 parsers regex" para **Gemini lê o catálogo PDF inteiro**
(IV-15) + **Gemini escolhe a imagem do produto** (IV-16/17). Consequências:
- Para AJUSTAR um fornecedor, edite o `SUPPLIER_HINTS` (3-4 linhas de prompt
  em `gemini_extractor.py`), **NÃO** crie/edite parser regex. (IV-18)
- O regex continua como FALLBACK automático se a IA falhar. NÃO o remova.
- `NIX` e `GOAL KIDS` estão na BLOCKLIST do AI-first (continuam no regex). (IV-15)
- Imagens: o AI Picker é **memory-safe** — manda 1 página anotada, extrai só a
  escolhida. **NUNCA** volte a extrair todas as candidatas antes da decisão
  (foi o que causou o OOM do v21). (IV-16)

### 🔑 Iteração local rápida (imagens / prompts Gemini)

Existe `GEMINI_API_KEY` no `.env` local (gitignored). Para iterar decisões do
Gemini SEM ciclo deploy→spike (~5min cada), escreva um script local que carrega
`from dotenv import load_dotenv` e chama o picker/extractor direto. **NUNCA**
imprima o valor da key nem a commite. Valide contra o catálogo real, depois
deploye 1× só. (Foi assim que v26 resolveu LX15016/DXP57 em minutos.)

## ✅ Workflow obrigatório de qualquer mudança

1. **Crie branch** (nunca commit direto em main):
   ```
   git checkout -b feat/<descrição>
   ```

2. **Faça a mudança**

3. **Rode o PORTÃO LOCAL antes de commitar/pushar** (substitui o CI):
   ```
   npm run verify
   ```
   Isso roda: 17 checks de invariante backend (IV-01..20) + `tsc --noEmit` +
   suite completa (`vitest run`, 311+ testes, inclui golden/contract).
   Atalho só dos greps de backend (rápido): `npm run verify:backend`.

4. **Tudo deve passar**. Se um invariante/teste falhar, **NÃO ajuste o teste**
   — investigue a regressão (ver `ARCHITECTURE.md`).

5. **Pre-push hook automático**: `.githooks/pre-push` roda `npm run verify`
   antes de todo `git push` e BLOQUEIA se algo violar. Ative uma vez por clone
   com `npm run setup-hooks` (o `prepare` do npm install já faz isso).

> ⚠️ **A trava NÃO depende do GitHub** (repo é privado p/ proteger dados do
> cliente; não usamos GitHub Actions/Pro). A segurança vive AQUI, no projeto,
> via `npm run verify` + o pre-push hook. Validar local é o portão oficial.

## 🚫 O que NUNCA fazer

- ❌ Push direto para `main`
- ❌ `--no-verify` para pular hooks
- ❌ Desativar workflows do CI
- ❌ Deletar/enfraquecer testes em `regression-locks.test.ts`
- ❌ Mudar `max_workers` de Gemini sem ler IV-03
- ❌ Voltar `/repair_prices_ai` para síncrono (IV-02)
- ❌ Remover `gc.collect()` de `cv_extractor.py` (IV-09)
- ❌ Remover `import fitz` de `gemini_extractor.py` (IV-01) — esse já quebrou produção UMA vez
- ❌ Fazer o AI Picker extrair TODAS as candidatas como arrays antes de decidir — causou OOM no v21 (IV-16)
- ❌ Voltar o badge do AI Picker pro canto da imagem (IV-17) — confunde imagens sobrepostas
- ❌ Tirar `NIX`/`GOAL KIDS` da BLOCKLIST do AI-first (IV-15)
- ❌ Criar parser regex novo para um fornecedor quando um `SUPPLIER_HINTS` resolve (IV-18)
- ❌ Enfraquecer/editar a fixture `ai-first-golden.test.ts` (IV-15)

## 🎯 Como diagnosticar problemas em produção

Ler seção "Como debugar produção" em `ARCHITECTURE.md`.

Comandos rápidos:
```bash
# Health do backend
curl https://converter-pro-image-extractor.onrender.com/health

# Smoke test completo (7 checks) — ajuste a versão esperada à atual em /health
bash scripts/smoke-test.sh --expect-version v26-center-badge
```

## 📞 Padrão de commits

- `fix(<área>): <descrição>` — bug fix
- `feat(<área>): <descrição>` — feature nova
- `chore(<área>): <descrição>` — manutenção
- `docs(<área>): <descrição>` — documentação
- `test(<área>): <descrição>` — testes

Sempre inclua referência ao IV-NN se a mudança o afeta:
> `fix(repair): ajusta retry sem violar IV-07`

## 🗣️ Comunicação com o Gabriel (OBRIGATÓRIO)

O Gabriel toca 4-5 projetos em paralelo e o contexto desta sessão é caro
(estourar limite trava o trabalho). Portanto:

- **Uma frase por passo.** Nada de parágrafos descrevendo cada ação. Diga o
  que foi feito (ou o resultado) em 1 linha; o detalhe fica no log/PR/commit.
- **Resumo final lido em ≤20s.** Use a tabela curta "o que mudou | versão |
  resultado". Sem passo a passo minucioso.
- **Vá direto ao COMO ficou e ao RESULTADO**, não ao processo.
- **Não repita** o que já está no `ARCHITECTURE.md`/PR/commit — esses são a
  fonte do detalhe. Aqui é só o essencial acionável.
- Pergunta/decisão: objetiva, com a recomendação primeiro.

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
