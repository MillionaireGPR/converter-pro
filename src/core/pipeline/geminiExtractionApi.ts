/**
 * Cliente da AI cirúrgica: resgata APENAS os preços que o pipeline base
 * não conseguiu extrair, NÃO refaz o trabalho todo.
 *
 * Velocidade: ~10-30s para 91 produtos vs ~10min do approach anterior.
 * Custo: ~$0.03 por catálogo NIX (30-50 chamadas Flash em paralelo).
 *
 * Estratégia:
 *   1. Pipeline base extrai 285 produtos em 2s (já funciona)
 *   2. Identifica produtos com preço zerado/inválido
 *   3. Agrupa por página de origem
 *   4. Chama backend /repair_prices_ai com SKUs por página
 *   5. Backend renderiza CADA página como JPEG e chama Gemini em paralelo
 *   6. Merge dos preços de volta no resultado
 */

const BACKEND_URL = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:8000';

export interface ResultadoRepair {
  success: boolean;
  model: string;
  precos: Record<string, number>;
  paginas_processadas: number;
  elapsed: number;
  error?: string | null;
}

/**
 * Chama o backend para resgatar preços faltantes.
 *
 * @param file - PDF do catálogo
 * @param skusByPage - { numero_pagina: [sku1, sku2, ...] }
 */
export const repairPricesViaGemini = async (
  file: File,
  skusByPage: Record<number, string[]>,
  maxAttempts: number = 2
): Promise<ResultadoRepair | null> => {
  const totalSkus = Object.values(skusByPage).reduce((acc, arr) => acc + arr.length, 0);
  if (totalSkus === 0) {
    return { success: true, model: '', precos: {}, paginas_processadas: 0, elapsed: 0 };
  }

  console.log(`[GeminiRepair] Resgatando ${totalSkus} preços em ${Object.keys(skusByPage).length} páginas...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('skus_by_page', JSON.stringify(skusByPage));

      const ctrl = new AbortController();
      // 2min: catálogo NIX (91 produtos em ~40 pgs) leva ~30-60s no Gemini paralelo
      const tid = setTimeout(() => ctrl.abort(), 120_000);

      const response = await fetch(`${BACKEND_URL}/repair_prices_ai`, {
        method: 'POST',
        body: fd,
        signal: ctrl.signal,
      });
      clearTimeout(tid);

      // Retry em transitórios
      if ([502, 503, 504].includes(response.status)) {
        if (attempt < maxAttempts) {
          console.warn(`[GeminiRepair] HTTP ${response.status} tentativa ${attempt}, retry em 3s...`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        return null;
      }

      if (!response.ok) {
        console.error(`[GeminiRepair] HTTP ${response.status}`);
        return null;
      }

      const result = (await response.json()) as ResultadoRepair;
      if (result.success) {
        console.log(
          `[GeminiRepair] ✓ ${Object.keys(result.precos).length}/${totalSkus} preços resgatados ` +
          `em ${result.elapsed?.toFixed(1) || '?'}s (modelo ${result.model || 'flash'})`
        );
      } else {
        console.warn('[GeminiRepair] Falha:', result.error);
      }
      return result;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.warn('[GeminiRepair] Timeout (>2min)');
        return null;
      }
      const transient =
        err.name === 'TypeError' ||
        err.message?.includes('Failed to fetch') ||
        err.message?.includes('HTTP2_PROTOCOL_ERROR');
      if (transient && attempt < maxAttempts) {
        console.warn(`[GeminiRepair] Erro transitório tentativa ${attempt}: ${err.message}. Retry em 3s...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      console.error('[GeminiRepair] Erro definitivo:', err);
      return null;
    }
  }
  return null;
};

/**
 * Aplica preços resgatados aos produtos locais.
 * Match por código (case-insensitive, trim). Só preenche preço se local
 * estiver zerado/inválido (não sobrescreve dados bons).
 *
 * Também LIMPA o erro "Preço não encontrado" e marca status='valido'.
 */
export const applyRepairedPrices = <T extends Record<string, any>>(
  produtos: T[],
  precos: Record<string, number>
): { applied: number } => {
  if (!precos || Object.keys(precos).length === 0) {
    return { applied: 0 };
  }
  const normalize = (s: string) => String(s || '').trim().toUpperCase();
  const precosNorm: Record<string, number> = {};
  for (const [k, v] of Object.entries(precos)) {
    precosNorm[normalize(k)] = v;
  }

  let applied = 0;
  for (const prod of produtos) {
    const candidates = [
      normalize(prod.codigo),
      normalize(prod.codigoOriginal),
      normalize(prod.sku),
    ].filter(Boolean);

    let matchedPrice: number | undefined;
    for (const c of candidates) {
      if (precosNorm[c] !== undefined) {
        matchedPrice = precosNorm[c];
        break;
      }
    }
    if (matchedPrice === undefined) continue;

    const localPreco = Number(prod.preco || prod.precoBase || prod.precoFinal || 0);
    if (localPreco > 0) continue; // já tem preço, não sobrescreve

    (prod as any).preco = matchedPrice;
    (prod as any).precoBase = matchedPrice;
    (prod as any).precoFinal = matchedPrice;
    applied++;

    // Limpa erro de "Preço não encontrado" e valida o produto
    if (Array.isArray((prod as any).erros)) {
      (prod as any).erros = (prod as any).erros.filter((e: string) => {
        const lower = String(e).toLowerCase();
        return !lower.includes('preço') && !lower.includes('preco');
      });
      if ((prod as any).erros.length === 0 && (prod as any).status === 'invalido') {
        (prod as any).status = 'valido';
      }
    }
  }

  console.log(`[GeminiRepair Apply] ${applied} preços aplicados aos produtos locais`);
  return { applied };
};

/**
 * Helper: identifica produtos sem preço e agrupa por página de origem.
 * Usado pelo engine para montar o input do repair.
 */
export const buildSkusByPageForRepair = <T extends Record<string, any>>(
  produtos: T[]
): Record<number, string[]> => {
  const result: Record<number, string[]> = {};
  for (const p of produtos) {
    const preco = Number(p.preco || p.precoBase || p.precoFinal || 0);
    if (preco > 0) continue;
    const codigo = String(p.codigo || p.codigoOriginal || '').trim();
    if (!codigo) continue;
    const pagina = Number(p.paginaOrigem || 0);
    if (pagina < 1) continue;
    if (!result[pagina]) result[pagina] = [];
    result[pagina].push(codigo);
  }
  return result;
};
