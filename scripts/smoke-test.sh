#!/usr/bin/env bash
# 🔥 SMOKE TEST E2E — Validação pós-deploy em produção
#
# Roda APÓS qualquer deploy para confirmar que invariantes IV-NN não foram quebrados.
# Falha rápido (<60s) se houver regressão crítica.
#
# Uso:
#   bash scripts/smoke-test.sh
#   bash scripts/smoke-test.sh --expect-version v7-cv-low-ram
#
# Exit codes:
#   0 = tudo OK
#   1 = regressão detectada (CRÍTICO — não fazer rollback automaticamente, investigar)

set -uo pipefail

# ─── Config ───
RENDER_URL="${RENDER_URL:-https://converter-pro-image-extractor.onrender.com}"
VERCEL_URL="${VERCEL_URL:-https://centraldeconversao.vercel.app}"
EXPECTED_VERSION="${EXPECTED_VERSION:-}"
FAIL_COUNT=0
PASS_COUNT=0

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --expect-version) EXPECTED_VERSION="$2"; shift 2 ;;
    *) shift ;;
  esac
done

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }
bold()  { printf "\033[1m%s\033[0m\n" "$1"; }

pass() { green "✓ $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { red "✗ $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

bold "═══════════════════════════════════════════════════════════════"
bold "🔥 SMOKE TEST PÓS-DEPLOY"
bold "Render: $RENDER_URL"
bold "Vercel: $VERCEL_URL"
bold "═══════════════════════════════════════════════════════════════"

# ─── Test 1: Render /health responde 200 ───
echo ""
bold "[1/7] Render /health"
HEALTH=$(curl -fsS --max-time 10 "$RENDER_URL/health" 2>&1) || {
  fail "Render /health não responde: $HEALTH"
  exit 1
}
echo "  → $HEALTH"
if [[ "$HEALTH" == *'"status":"healthy"'* ]]; then
  pass "Render online"
else
  fail "Render respondeu mas não está healthy"
fi

# ─── Test 2: SERVICE_VERSION presente (IV-13) ───
echo ""
bold "[2/7] SERVICE_VERSION presente em /health (IV-13)"
if [[ "$HEALTH" == *'"version":"'* ]]; then
  # Extrai sem usar -P (não disponível em todos os greps)
  CURRENT_VERSION=$(echo "$HEALTH" | sed -E 's/.*"version":"([^"]+)".*/\1/')
  pass "Versão exposta: $CURRENT_VERSION"
  if [[ -n "$EXPECTED_VERSION" && "$CURRENT_VERSION" != *"$EXPECTED_VERSION"* ]]; then
    fail "Versão esperada '$EXPECTED_VERSION' mas atual é '$CURRENT_VERSION'"
  fi
else
  fail "SERVICE_VERSION não exposta em /health"
fi

# ─── Test 3: CORS headers para origem Vercel (IV-12) ───
echo ""
bold "[3/7] CORS headers para origem Vercel (IV-12)"
# Usa -D - para imprimir headers ao stdout sem fazer HEAD (compat com FastAPI)
CORS_OUTPUT=$(curl -sS -D - -o /dev/null -X GET \
  -H "Origin: https://centraldeconversao.vercel.app" \
  --max-time 10 "$RENDER_URL/health" 2>&1)
if echo "$CORS_OUTPUT" | grep -qi "access-control-allow-origin"; then
  pass "CORS headers presentes"
else
  fail "CORS header 'access-control-allow-origin' ausente"
  echo "  → headers recebidos:"
  echo "$CORS_OUTPUT" | head -10 | sed 's/^/    /'
fi

# ─── Test 4: /repair_prices_ai_status retorna not_found para uuid inválido (IV-08) ───
echo ""
bold "[4/7] /repair_prices_ai_status com uuid inválido retorna not_found (IV-08)"
NOT_FOUND=$(curl -fsS --max-time 10 "$RENDER_URL/repair_prices_ai_status/00000000-0000-0000-0000-000000000000" 2>&1)
if [[ "$NOT_FOUND" == *'"status":"not_found"'* ]]; then
  pass "not_found tratado corretamente"
else
  fail "Esperado not_found, recebeu: $NOT_FOUND"
fi

# ─── Test 5: /status (legado /process) retorna not_found ───
echo ""
bold "[5/7] /status (endpoint /process) retorna not_found para uuid inválido"
NOT_FOUND2=$(curl -fsS --max-time 10 "$RENDER_URL/status/00000000-0000-0000-0000-000000000000" 2>&1)
if [[ "$NOT_FOUND2" == *'"status":"not_found"'* ]]; then
  pass "Endpoint /status OK"
else
  fail "Endpoint /status falhou: $NOT_FOUND2"
fi

# ─── Test 6: Vercel responde 200 ───
echo ""
bold "[6/7] Vercel serve a aplicação"
VERCEL_STATUS=$(curl -fsS -o /dev/null -w "%{http_code}" --max-time 15 "$VERCEL_URL/conversao" 2>&1) || {
  fail "Vercel não responde"
}
if [[ "$VERCEL_STATUS" == "200" ]]; then
  pass "Vercel HTTP $VERCEL_STATUS"
else
  fail "Vercel retornou HTTP $VERCEL_STATUS (esperado 200)"
fi

# ─── Test 7: Tempo de resposta razoável (sintoma de cold start ou OOM) ───
echo ""
bold "[7/7] Latência do /health < 5s (sintoma de cold start/sobrecarga)"
T0=$(date +%s%N)
curl -fsS --max-time 10 "$RENDER_URL/health" >/dev/null 2>&1
T1=$(date +%s%N)
LATENCY_MS=$(( (T1 - T0) / 1000000 ))
if [[ $LATENCY_MS -lt 5000 ]]; then
  pass "Latência /health: ${LATENCY_MS}ms"
else
  fail "Latência /health alta: ${LATENCY_MS}ms (possível cold start ou sobrecarga)"
fi

# ─── Resumo ───
echo ""
bold "═══════════════════════════════════════════════════════════════"
if [[ $FAIL_COUNT -eq 0 ]]; then
  green "✅ TODOS OS SMOKE TESTS PASSARAM ($PASS_COUNT/$((PASS_COUNT + FAIL_COUNT)))"
  bold "═══════════════════════════════════════════════════════════════"
  exit 0
else
  red "❌ FALHAS DETECTADAS: $FAIL_COUNT (sucesso: $PASS_COUNT)"
  bold "═══════════════════════════════════════════════════════════════"
  red "Investigue ANTES de considerar o deploy bom. Consulte ARCHITECTURE.md"
  exit 1
fi
