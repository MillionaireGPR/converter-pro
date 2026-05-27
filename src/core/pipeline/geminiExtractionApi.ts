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
 * Chama o backend para resgatar preços faltantes (ASSÍNCRONO via polling).
 *
 * Fluxo:
 *   1. POST /repair_prices_ai → retorna jobId imediato (~5-10s upload + ~1s criar job)
 *   2. Polling GET /repair_prices_ai_status/{jobId} a cada 3s
 *   3. Retorna quando status="success" ou "error"
 *
 * Resiliência (resolve ERR_HTTP2_PROTOCOL_ERROR esporádico via Cloudflare/Render):
 *   - maxAttempts default 5 (era 2). Cada retry resfresca conexão HTTP/2.
 *   - Backoff exponencial: 3s, 6s, 12s, 24s
 *   - Timeout do upload: 180s (PDF 13MB em conexão lenta pode levar >60s)
 *   - Erros tratados como transitórios: AbortError, Failed to fetch,
 *     HTTP2_PROTOCOL_ERROR, NetworkError, ECONNRESET
 *
 * @param file - PDF do catálogo
 * @param skusByPage - { numero_pagina: [sku1, sku2, ...] }
 */
export const repairPricesViaGemini = async (
  file: File,
  skusByPage: Record<number, string[]>,
  maxAttempts: number = 5
): Promise<ResultadoRepair | null> => {
  const totalSkus = Object.values(skusByPage).reduce((acc, arr) => acc + arr.length, 0);
  if (totalSkus === 0) {
    return { success: true, model: '', precos: {}, paginas_processadas: 0, elapsed: 0 };
  }

  const fileSizeMB = (file.size / 1024 / 1024).toFixed(1);
  console.log(`[GeminiRepair] Resgatando ${totalSkus} preços em ${Object.keys(skusByPage).length} páginas (PDF ${fileSizeMB}MB, async)...`);

  // ─── FASE 1: POST cria o job (com retry agressivo para HTTP/2 reset) ───
  let jobId: string | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('skus_by_page', JSON.stringify(skusByPage));

      const ctrl = new AbortController();
      // 180s: PDFs de ~13MB em conexão lenta podem levar 60-90s só pra upload
      const tid = setTimeout(() => ctrl.abort(), 180_000);

      const response = await fetch(`${BACKEND_URL}/repair_prices_ai`, {
        method: 'POST',
        body: fd,
        signal: ctrl.signal,
        // Headers explícitos podem ajudar alguns proxies HTTP/2
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(tid);

      if ([502, 503, 504].includes(response.status)) {
        if (attempt < maxAttempts) {
          const backoff = Math.min(3000 * Math.pow(2, attempt - 1), 30_000);
          console.warn(`[GeminiRepair] HTTP ${response.status} tentativa ${attempt}/${maxAttempts}, retry em ${backoff/1000}s...`);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
        return null;
      }

      if (!response.ok) {
        console.error(`[GeminiRepair] HTTP ${response.status} ao criar job`);
        return null;
      }

      const created = await response.json();

      // Job pode já ter retornado completo (early return quando totalSkus=0)
      if (created.status === 'success' && created.precos !== undefined) {
        console.log('[GeminiRepair] ✓ Resposta imediata (nada a processar)');
        return created as ResultadoRepair;
      }

      jobId = created.jobId;
      if (!jobId) {
        console.error('[GeminiRepair] Backend não retornou jobId:', created);
        return null;
      }
      console.log(`[GeminiRepair] ✓ Job criado: ${jobId} (tentativa ${attempt}). Iniciando polling...`);
      break;
    } catch (err: any) {
      const msg = err.message || String(err);
      const isAbort = err.name === 'AbortError';
      const isTransient =
        isAbort ||
        err.name === 'TypeError' ||
        msg.includes('Failed to fetch') ||
        msg.includes('HTTP2_PROTOCOL_ERROR') ||
        msg.includes('HTTP/2') ||
        msg.includes('NetworkError') ||
        msg.includes('ECONNRESET') ||
        msg.includes('socket hang up') ||
        msg.includes('ERR_CONNECTION');

      if (isTransient && attempt < maxAttempts) {
        const backoff = Math.min(3000 * Math.pow(2, attempt - 1), 30_000);
        const kind = isAbort ? 'timeout' : (msg.includes('HTTP2') ? 'HTTP/2 reset' : 'rede');
        console.warn(
          `[GeminiRepair] Erro ${kind} tentativa ${attempt}/${maxAttempts}: ${msg.slice(0, 80)}. ` +
          `Retry em ${backoff/1000}s...`
        );
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      console.error(`[GeminiRepair] Erro definitivo após ${attempt} tentativa(s):`, err);
      return null;
    }
  }

  if (!jobId) return null;

  // ─── FASE 2: Polling até status terminal ───
  // 51 páginas × ~3s / 3 workers = ~60s. Damos margem de 5min total.
  const POLL_INTERVAL_MS = 3000;
  const MAX_WAIT_MS = 5 * 60 * 1000; // 5 min
  const t0 = Date.now();
  let lastLog = 0;

  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const statusResp = await fetch(`${BACKEND_URL}/repair_prices_ai_status/${jobId}`);
      if (!statusResp.ok) {
        console.warn(`[GeminiRepair] Status HTTP ${statusResp.status}, continuando polling...`);
        continue;
      }
      const data = await statusResp.json();

      // Log de progresso a cada 15s
      const now = Date.now();
      if (now - lastLog > 15_000) {
        const elapsed = ((now - t0) / 1000).toFixed(0);
        console.log(`[GeminiRepair] [${elapsed}s] status=${data.status} stage=${data.stage || '?'}`);
        lastLog = now;
      }

      if (data.status === 'success') {
        const pricesCount = data.precos ? Object.keys(data.precos).length : 0;
        console.log(
          `[GeminiRepair] ✓ ${pricesCount}/${totalSkus} preços resgatados ` +
          `em ${data.elapsed?.toFixed(1) || '?'}s (modelo ${data.model || 'flash'})`
        );
        return data as ResultadoRepair;
      }
      if (data.status === 'error') {
        console.warn('[GeminiRepair] Job retornou erro:', data.error || data.message);
        return data as ResultadoRepair;
      }
      // status === 'processing' → continua polling
    } catch (err: any) {
      console.warn('[GeminiRepair] Erro de rede em polling (continua):', err.message);
    }
  }

  console.error('[GeminiRepair] Timeout total >5min em polling');
  return null;
};

/**
 * Aplica preços resgatados aos produtos locais.
 * Match por código (case-insensitive, trim). Só preenche preço se local
 * estiver zerado/inválido (não sobrescreve dados bons).
 *
 * Também LIMPA o erro "Preço não encontrado" e re-valida o status:
 *   - Pipeline V2 usa: 'validado' | 'pendente' | 'erro' (NÃO 'valido'/'invalido')
 *   - Quando preço é aplicado E não sobra nenhum erro → status='validado'
 *   - Quando preço é aplicado E sobra warning/erro não-preço → mantém status original
 */
export const applyRepairedPrices = <T extends Record<string, any>>(
  produtos: T[],
  precos: Record<string, number>
): { applied: number; statusUpdated: number } => {
  if (!precos || Object.keys(precos).length === 0) {
    return { applied: 0, statusUpdated: 0 };
  }
  const normalize = (s: string) => String(s || '').trim().toUpperCase();
  const precosNorm: Record<string, number> = {};
  for (const [k, v] of Object.entries(precos)) {
    precosNorm[normalize(k)] = v;
  }

  // Detecta se uma string de erro é sobre preço (em qualquer variação)
  const isPriceError = (e: string): boolean => {
    const lower = String(e).toLowerCase();
    return lower.includes('preço') || lower.includes('preco') || lower.includes('price');
  };

  let applied = 0;
  let statusUpdated = 0;
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

    // Limpa erros relacionados a preço (qualquer variação)
    if (Array.isArray((prod as any).erros)) {
      (prod as any).erros = (prod as any).erros.filter((e: string) => !isPriceError(e));
    }

    // Re-valida status. Pipeline V2 status: 'validado' | 'pendente' | 'erro'.
    // Pipeline legado status: 'valido' | 'invalido'. Suportamos os dois.
    const remainingErros = Array.isArray((prod as any).erros) ? (prod as any).erros : [];
    const remainingWarnings = Array.isArray((prod as any).warnings) ? (prod as any).warnings : [];

    const prevStatus = (prod as any).status;
    if (remainingErros.length === 0) {
      let newStatus: string;
      if (remainingWarnings.length > 0) {
        newStatus = 'pendente';
      } else {
        // Tipo V2: 'validado'. Tipo legado: 'valido'. Detecta pelo valor anterior.
        newStatus = prevStatus === 'invalido' || prevStatus === 'valido' ? 'valido' : 'validado';
      }
      if (prevStatus !== newStatus) {
        (prod as any).status = newStatus;
        statusUpdated++;
      }
    }
  }

  console.log(`[GeminiRepair Apply] ${applied} preços aplicados, ${statusUpdated} status atualizados`);
  return { applied, statusUpdated };
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
