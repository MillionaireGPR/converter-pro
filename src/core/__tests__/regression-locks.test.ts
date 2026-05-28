/**
 * 🔒 TESTES DE REGRESSÃO — TRAVAS DOS BUGS CORRIGIDOS EM 27/05/2026
 *
 * Cada teste aqui falharia se um dos bugs reportados pelo usuário em produção
 * voltasse. Se você precisa MODIFICAR algum desses testes, PARE e leia
 * ARCHITECTURE.md primeiro — esses comportamentos foram quebrados em produção
 * e o cliente já está insatisfeito com o tempo gasto.
 *
 * BUGS COBERTOS (sessão de 27/05/2026):
 *   PR #7:  import fitz faltando em gemini_extractor.py
 *   PR #8:  /repair_prices_ai síncrono causava 502 + CORS no Render
 *   PR #8:  OOM 512MB no Render por workers paralelos abrindo cópias do PDF
 *   PR #9:  Stats não recalculados após repair (UI mostrava 91 erros fantasma)
 *   PR #9:  applyRepairedPrices usava esquema legado ('invalido') no V2 ('erro')
 *   PR #10: ERR_HTTP2_PROTOCOL_ERROR sem retry agressivo
 *   PR #11: while(true) infinito no polling de imagens
 *   PR #11: OOM no /process por rasters NumPy acumulados sem gc
 *
 * REGRA DE OURO: Esses testes NUNCA devem ser deletados ou enfraquecidos.
 * Se um teste falhar, é sinal de que um bug VOLTOU. Investigue antes de
 * "consertar" o teste.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { applyRepairedPrices, buildSkusByPageForRepair } from '../pipeline/geminiExtractionApi';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

const read = (relativePath: string): string => {
  const full = join(ROOT, relativePath);
  if (!existsSync(full)) {
    throw new Error(`Arquivo crítico não encontrado: ${relativePath}`);
  }
  return readFileSync(full, 'utf8');
};

// ═══════════════════════════════════════════════════════════════════════════
// 🔒 PR #7 — Bug do `import fitz` faltando em gemini_extractor.py
// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 PR#7: gemini_extractor.py deve importar fitz', () => {
  it('NUNCA REMOVER: import fitz no topo do gemini_extractor.py', () => {
    // Sintoma se removerem: NameError silencioso, Gemini nunca é chamado,
    // response volta com success=true e paginas_processadas=0 em <1ms.
    const content = read('backend/image_extractor/gemini_extractor.py');
    expect(content).toMatch(/^import fitz/m);
  });

  it('NUNCA REMOVER: _render_pages_batch usa fitz.open + fecha doc', () => {
    const content = read('backend/image_extractor/gemini_extractor.py');
    expect(content).toContain('def _render_pages_batch');
    expect(content).toMatch(/fitz\.open\(pdf_path\)/);
    expect(content).toMatch(/doc\.close\(\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔒 PR #8 — /repair_prices_ai deve ser ASSÍNCRONO (retorna jobId imediato)
// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 PR#8: /repair_prices_ai assíncrono', () => {
  it('NUNCA REMOVER: endpoint usa BackgroundTasks + retorna jobId', () => {
    // Sintoma se virar síncrono: 502 Bad Gateway no Render gateway,
    // CORS error fantasma, R$ gastos sem entrega ao usuário.
    const content = read('backend/image_extractor/main.py');
    expect(content).toMatch(/@app\.post\("\/repair_prices_ai"\)/);
    expect(content).toContain('background_tasks: BackgroundTasks');
    expect(content).toContain('background_tasks.add_task(_run_repair_task');
    expect(content).toMatch(/"jobId":\s*job_id/);
  });

  it('NUNCA REMOVER: endpoint /repair_prices_ai_status existe (polling)', () => {
    const content = read('backend/image_extractor/main.py');
    expect(content).toMatch(/@app\.get\("\/repair_prices_ai_status\/\{job_id\}"\)/);
  });

  it('NUNCA REMOVER: max_workers≤3 em repair_prices_for_skus (Render 512MB)', () => {
    // Sintoma se >3: OOM no Render Starter por workers concorrentes
    // alocando rasters PDF de ~12MB cada.
    const content = read('backend/image_extractor/main.py');
    const match = content.match(/repair_prices_for_skus\(pdf_path,\s*skus_map,\s*max_workers\s*=\s*(\d+)\)/);
    expect(match).not.toBeNull();
    const workers = parseInt(match![1], 10);
    expect(workers).toBeLessThanOrEqual(3);
  });

  it('NUNCA REMOVER: pre-render serial em repair_prices_for_skus (não paralelo)', () => {
    // Sintoma se voltar a paralelo: cada worker abre fitz.open separado,
    // PDF carregado N vezes na RAM → OOM 512MB.
    const content = read('backend/image_extractor/gemini_extractor.py');
    expect(content).toContain('def _render_pages_batch');
    expect(content).toContain('_render_pages_batch(pdf_path, pages_to_render');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔒 PR #9 — Stats recalculados + suporte status V2/legado
// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 PR#9: stats e status pós-repair', () => {
  it('NUNCA REMOVER: engine.ts recalcula result.stats após applyRepairedPrices', () => {
    // Sintoma se remover: UI mostra 91 erros mesmo após preços resgatados,
    // porque stats foi calculado pelo pipeline ANTES do repair.
    const content = read('src/core/engine.ts');
    expect(content).toContain('Stats recalculados');
    // O recalc deve estar APÓS applyRepairedPrices
    const applyIdx = content.indexOf('applyRepairedPrices(result.produtosNormalizados');
    const recalcIdx = content.indexOf('result.stats.validos = recalc.validos');
    expect(applyIdx).toBeGreaterThan(-1);
    expect(recalcIdx).toBeGreaterThan(applyIdx);
  });

  it('REGRESSÃO V2: applyRepairedPrices muda status="erro" → "validado"', () => {
    // Bug reportado: pipeline V2 usa 'erro'/'validado', legado usa 'invalido'/'valido'.
    // Implementação tinha if status==='invalido', nunca disparava no V2.
    const produtos = [{
      codigo: 'NX020', preco: 0, precoBase: 0, precoFinal: 0,
      status: 'erro',
      erros: ['Preço não encontrado'],
    }];
    const r = applyRepairedPrices(produtos, { NX020: 5.5 });
    expect(r.applied).toBe(1);
    expect(r.statusUpdated).toBe(1);
    expect(produtos[0].status).toBe('validado');
    expect(produtos[0].erros).toEqual([]);
  });

  it('REGRESSÃO LEGADO: applyRepairedPrices muda status="invalido" → "valido"', () => {
    const produtos = [{
      codigo: 'X', preco: 0, status: 'invalido', erros: ['Preço inválido'],
    }];
    const r = applyRepairedPrices(produtos, { X: 9.99 });
    expect(r.statusUpdated).toBe(1);
    expect(produtos[0].status).toBe('valido');
  });

  it('REGRESSÃO: returns objeto contém statusUpdated (não regredir API)', () => {
    const r = applyRepairedPrices([], {});
    expect(r).toHaveProperty('applied');
    expect(r).toHaveProperty('statusUpdated');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔒 PR #10 — Retry agressivo p/ HTTP/2 reset
// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 PR#10: retry agressivo em uploads grandes', () => {
  it('NUNCA REMOVER: maxAttempts ≥ 5 em repairPricesViaGemini', () => {
    // Sintoma se ≤2: ERR_HTTP2_PROTOCOL_ERROR esporádico do Cloudflare/Render
    // derruba o repair sem chance de retry suficiente.
    const content = read('src/core/pipeline/geminiExtractionApi.ts');
    const match = content.match(/maxAttempts:\s*number\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1], 10)).toBeGreaterThanOrEqual(5);
  });

  it('NUNCA REMOVER: timeout do upload ≥ 120s (PDFs grandes em internet lenta)', () => {
    const content = read('src/core/pipeline/geminiExtractionApi.ts');
    // Procura por setTimeout(..., 120_000) ou maior no AbortController
    const match = content.match(/setTimeout\(\(\)\s*=>\s*ctrl\.abort\(\),\s*([\d_]+)\)/);
    expect(match).not.toBeNull();
    const ms = parseInt(match![1].replace(/_/g, ''), 10);
    expect(ms).toBeGreaterThanOrEqual(120_000);
  });

  it('NUNCA REMOVER: detecção de HTTP2_PROTOCOL_ERROR como transitório', () => {
    const content = read('src/core/pipeline/geminiExtractionApi.ts');
    expect(content).toContain('HTTP2_PROTOCOL_ERROR');
    expect(content).toContain('Failed to fetch');
  });

  it('NUNCA REMOVER: mesmo padrão de retry em imageExtractionApi.ts (/process)', () => {
    const content = read('src/core/images/imageExtractionApi.ts');
    expect(content).toMatch(/MAX_ATTEMPTS\s*=\s*[5-9]\d*/);
    expect(content).toContain('HTTP2_PROTOCOL_ERROR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔒 PR #11 — Polling com timeout + gc no /process
// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 PR#11: polling resiliente + gc em /process', () => {
  it('NUNCA RETORNAR a while(true) infinito em imageExtractionApi', () => {
    // Sintoma se voltar: user vê "Finalizando extração" por 20+ minutos
    // quando Render reinicia (OOM). Frontend faz polling eterno.
    const content = read('src/core/images/imageExtractionApi.ts');
    // Ignora menções em comentários (// ou /*). Garante que NÃO há while(true)
    // como código executável ativo.
    const codeOnly = content
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(codeOnly).not.toMatch(/while\s*\(\s*true\s*\)/);
  });

  it('NUNCA REMOVER: timeout total no polling de /process (MAX_WAIT_MS)', () => {
    const content = read('src/core/images/imageExtractionApi.ts');
    expect(content).toMatch(/MAX_WAIT_MS\s*=\s*\d+\s*\*\s*60\s*\*\s*1000/);
    expect(content).toContain('Date.now() - t0 < MAX_WAIT_MS');
  });

  it('NUNCA REMOVER: tratamento de not_found em polling', () => {
    // Sintoma se remover: quando backend reinicia (OOM), job vira not_found
    // e o frontend antes ignorava e ficava em loop eterno.
    const content = read('src/core/images/imageExtractionApi.ts');
    expect(content).toMatch(/notFoundCount/);
    expect(content).toMatch(/MAX_NOT_FOUND_CHECKS/);

    const geminiContent = read('src/core/pipeline/geminiExtractionApi.ts');
    expect(geminiContent).toMatch(/notFoundCount/);
    expect(geminiContent).toMatch(/MAX_NOT_FOUND_CHECKS/);
  });

  it('NUNCA REMOVER: gc.collect periódico em cv_extractor.py (/process OOM)', () => {
    // Sintoma se remover: rasters NumPy acumulam ~170MB para NIX 51 pgs,
    // Render Starter 512MB estoura → container reinicia → job perdido.
    const content = read('backend/image_extractor/cv_extractor.py');
    expect(content).toContain('import gc');
    expect(content).toMatch(/gc\.collect\(\)/);
    expect(content).toMatch(/del raster/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔒 INVARIANTES GERAIS DA ARQUITETURA
// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 Invariantes gerais da arquitetura', () => {
  it('NUNCA REMOVER: CORS configurado com origens específicas (não wildcard inseguro)', () => {
    const content = read('backend/image_extractor/main.py');
    expect(content).toContain('centraldeconversao.vercel.app');
    expect(content).toContain('allow_origin_regex');
    expect(content).toContain('vercel.app');
  });

  it('NUNCA REMOVER: persistência de status em disco (sobrevive a restart)', () => {
    const content = read('backend/image_extractor/main.py');
    expect(content).toContain('_save_status');
    expect(content).toContain('_load_status');
    expect(content).toMatch(/status\.json/);
  });

  it('NUNCA REMOVER: cadeia de fallback de modelos Gemini (sem gemini-1.5-flash)', () => {
    // Sintoma se voltar gemini-1.5-flash: 404 v1beta (descontinuado em 2025).
    const content = read('backend/image_extractor/gemini_extractor.py');
    expect(content).toContain('gemini-2.5-flash');
    expect(content).not.toMatch(/MODEL_FLASH\s*=\s*["']gemini-1\.5-flash["']/);
  });

  it('NUNCA REMOVER: SERVICE_VERSION no /health (rastreamento de deploy)', () => {
    const content = read('backend/image_extractor/main.py');
    expect(content).toContain('SERVICE_VERSION');
    expect(content).toMatch(/"version":\s*SERVICE_VERSION/);
  });

  it('NUNCA REMOVER: helper buildSkusByPageForRepair com filtros corretos', () => {
    // Comportamento crítico: produtos com preço NÃO entram no payload do repair
    const produtos = [
      { codigo: 'A', preco: 0, paginaOrigem: 1 },
      { codigo: 'B', preco: 10, paginaOrigem: 1 }, // tem preço, ignora
      { codigo: '', preco: 0, paginaOrigem: 1 }, // sem código, ignora
      { codigo: 'C', preco: 0, paginaOrigem: 0 }, // sem página, ignora
    ];
    const result = buildSkusByPageForRepair(produtos);
    expect(result).toEqual({ 1: ['A'] });
  });

  it('NUNCA REMOVER: applyRepairedPrices NÃO sobrescreve preço válido existente', () => {
    // Segurança: preço já bom no pipeline base não pode ser apagado pela AI
    const produtos = [{ codigo: 'A', preco: 99, precoBase: 99, precoFinal: 99 }];
    const r = applyRepairedPrices(produtos, { A: 1 });
    expect(r.applied).toBe(0);
    expect(produtos[0].preco).toBe(99);
  });
});
