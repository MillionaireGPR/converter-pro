#!/usr/bin/env node
/**
 * 🔒 VERIFICADOR LOCAL DE INVARIANTES — trava anti-regressão self-contained.
 *
 * POR QUE EXISTE (decisão 09/06/2026):
 *   O CI do GitHub Actions exigiria repo público (expõe dados do cliente) ou
 *   plano Pro. Não vamos depender disso. A trava de segurança vive AQUI, no
 *   próprio projeto, e roda LOCALMENTE antes de qualquer push.
 *
 * O QUE FAZ:
 *   1. Checa os invariantes de BACKEND (grep nos arquivos Python) — IV-01..20
 *   2. Roda TypeScript strict (tsc --noEmit)
 *   3. Roda a suite de testes completa (vitest run) — inclui os golden/contract
 *
 * USO:
 *   npm run verify            # valida tudo; sai com código != 0 se algo falhar
 *   node scripts/verify-invariants.mjs --backend-only   # só os greps (rápido)
 *
 * É ISTO que substitui o "CI" pra nós. Qualquer agente/dev: rode ANTES de
 * commitar mudanças que toquem o backend ou o pipeline. Se algo aqui falhar,
 * NÃO ajuste o teste — investigue a regressão (ver ARCHITECTURE.md).
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const backendOnly = process.argv.includes('--backend-only');

let failures = 0;
const ok = (m) => console.log(`\x1b[32m✅ ${m}\x1b[0m`);
const fail = (m) => { console.error(`\x1b[31m❌ ${m}\x1b[0m`); failures++; };

/** Lê arquivo do repo (caminho relativo à raiz). Retorna '' se não existir. */
const read = (rel) => {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
};

/** Invariante: arquivo `rel` deve conter TODOS os padrões. */
function mustContain(iv, rel, patterns) {
  const content = read(rel);
  if (!content) return fail(`${iv}: arquivo ausente ${rel}`);
  for (const pat of patterns) {
    const re = pat instanceof RegExp ? pat : new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!re.test(content)) return fail(`${iv}: padrão ausente em ${rel} → ${pat}`);
  }
  ok(`${iv} ok`);
}

/** Invariante: arquivo `rel` NÃO deve conter o padrão. */
function mustNotContain(iv, rel, pattern, msg) {
  const content = read(rel);
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  if (re.test(content)) return fail(`${iv}: ${msg}`);
  ok(`${iv} ok`);
}

console.log('\n🔒 Invariantes de BACKEND (Python) ─────────────────────────────');

const GE = 'backend/image_extractor/gemini_extractor.py';
const MAIN = 'backend/image_extractor/main.py';
const CV = 'backend/image_extractor/cv_extractor.py';
const PICKER = 'backend/image_extractor/gemini_image_picker.py';

// IV-01 — import fitz em gemini_extractor.py
mustContain('IV-01', GE, [/^import fitz/m]);
// IV-02 — /repair_prices_ai assíncrono
mustContain('IV-02', MAIN, ['background_tasks.add_task(_run_repair_task']);
// IV-03 — max_workers <= 3
(() => {
  const m = read(MAIN).match(/repair_prices_for_skus\([^)]*max_workers=(\d+)/);
  if (!m) return fail('IV-03: chamada repair_prices_for_skus(max_workers=) não encontrada');
  Number(m[1]) <= 3 ? ok(`IV-03 ok (max_workers=${m[1]})`) : fail(`IV-03: max_workers=${m[1]} > 3`);
})();
// IV-04 — pre-render serial
mustContain('IV-04', GE, ['def _render_pages_batch']);
// IV-09 — gc.collect + del raster em cv_extractor
mustContain('IV-09', CV, ['gc.collect()', 'del raster']);
// IV-10 — sem gemini-1.5-flash
mustNotContain('IV-10', GE, /MODEL[A-Z_]*\s*=\s*"gemini-1\.5-flash"/, 'gemini-1.5-flash foi descontinuado (2025)');
// IV-12 — CORS específico + regex Vercel
mustContain('IV-12', MAIN, ['centraldeconversao.vercel.app', 'allow_origin_regex']);
// IV-13 — SERVICE_VERSION
mustContain('IV-13', MAIN, ['SERVICE_VERSION']);
// IV-14 — heurística box (fallback) ainda presente
mustContain('IV-14', CV, ['def _box_score']);
// IV-15 — AI-first
mustContain('IV-15', GE, ['def extract_with_fallback']);
mustContain('IV-15b', MAIN, ['/extract_products_ai']);
// IV-16 — picker memory-safe (recebe raster, não arrays por candidata)
mustContain('IV-16', PICKER, ['def pick_images_for_page', 'raster_rgb']);
// IV-17 — badge no CENTRO + allow_fullpage
mustContain('IV-17', PICKER, ['def _annotate_page', /rect\.x0 \+ rect\.x1/]);
mustContain('IV-17b', CV, ['allow_fullpage']);
// IV-18 — SUPPLIER_HINTS
mustContain('IV-18', GE, ['SUPPLIER_HINTS', 'def get_supplier_hints']);
// IV-19 — DAGIA qty caixa exige CX (regex no template começa com CX\s*C\/)
(() => {
  const c = read('src/core/pdfTemplates/dagia.template.ts');
  c.includes('CX\\s*C\\/')
    ? ok('IV-19 ok')
    : fail('IV-19: dagia quantidadeCaixa deve exigir prefixo CX (CX\\s*C\\/)');
})();
// IV-20 — kill-switch
mustContain('IV-20', MAIN, ['AI_PICKER_DISABLED']);

// SMOKE — import real do gemini_extractor (pega NameError/erro de anotação que
// o AST não vê — ex: usar Tuple sem importar). ModuleNotFoundError de dep
// 3rd-party (fitz/google) é SKIP (ambiente sem deps); erro no NOSSO código FALHA.
(() => {
  const r = spawnSync('python', ['-c', "import sys; sys.path.insert(0, 'backend/image_extractor'); import gemini_extractor"], { cwd: ROOT, encoding: 'utf8' });
  if (r.error) { console.log('\x1b[33m⚠️  SMOKE import pulado (python indisponível)\x1b[0m'); return; }
  if (r.status === 0) { ok('SMOKE import gemini_extractor'); return; }
  const err = (r.stderr || '') + (r.stdout || '');
  if (/ModuleNotFoundError/.test(err)) {
    console.log(`\x1b[33m⚠️  SMOKE import pulado (dep ausente): ${(err.match(/ModuleNotFoundError: (.*)/) || [])[1] || ''}\x1b[0m`);
  } else {
    fail(`SMOKE import gemini_extractor falhou:\n${err.split('\n').slice(-6).join('\n')}`);
  }
})();

if (backendOnly) {
  console.log(`\n${failures === 0 ? '\x1b[32m✅ Backend OK\x1b[0m' : `\x1b[31m❌ ${failures} falha(s)\x1b[0m`}`);
  process.exit(failures === 0 ? 0 : 1);
}

console.log('\n📝 TypeScript strict (tsc --noEmit) ────────────────────────────');
try {
  execSync('npx tsc --noEmit', { cwd: ROOT, stdio: 'inherit' });
  ok('TypeScript sem erros');
} catch {
  fail('TypeScript com erros de tipo');
}

console.log('\n🧪 Suite de testes (vitest run) ────────────────────────────────');
try {
  execSync('npx vitest run', { cwd: ROOT, stdio: 'inherit' });
  ok('Todos os testes passaram');
} catch {
  fail('Testes falharam');
}

console.log('\n──────────────────────────────────────────────────────────────');
if (failures === 0) {
  console.log('\x1b[32m✅ TODOS OS INVARIANTES OK — seguro para commit/push\x1b[0m');
  process.exit(0);
} else {
  console.error(`\x1b[31m❌ ${failures} INVARIANTE(S) VIOLADO(S) — NÃO comite. Veja ARCHITECTURE.md\x1b[0m`);
  process.exit(1);
}
