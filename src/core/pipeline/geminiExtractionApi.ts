/**
 * Cliente da extração AI via Gemini (backend Python).
 *
 * ESTRATÉGIA HÍBRIDA:
 *   - Frontend ainda extrai texto via PDF.js (rápido, baseline)
 *   - Em PARALELO, chama o backend /extract_products_ai (Gemini Vision)
 *   - Quando o resultado da AI chega, ENRIQUECE os produtos:
 *     - Preenche campos faltantes (preço zerado → preço real do PDF)
 *     - Corrige códigos truncados
 *     - Adiciona produtos que o pipeline não capturou
 *
 * Reaproveita 100% do código existente (UI, adapters, exportadores,
 * imagens via OpenCV). É um pass de enriquecimento adicional.
 */

const BACKEND_URL = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:8000';

export interface ProdutoAI {
  codigo: string;
  nome: string;
  preco: number;
  precoPromocional: number | null;
  quantidadeCaixa: number;
  ipi: number;
  ncm: string | null;
  categoria: string | null;
  paginaOrigem: number;
  observacoes: string;
}

export interface ResultadoExtracaoAI {
  success: boolean;
  model: string;
  produtos: ProdutoAI[];
  fornecedor_detectado: string;
  total_paginas: number;
  elapsed_seconds?: number;
  elapsed?: number;
  confianca?: number;
  error?: string | null;
}

/**
 * Chama o endpoint AI com ARQUITETURA ASSÍNCRONA (upload + polling).
 *
 * Por que assíncrona:
 *   - PDFs grandes (NIX 12MB / 106 páginas) podem levar 60-180s no Gemini
 *   - Render mata conexões HTTP longas → 502 Bad Gateway
 *   - Polling permite jobs de QUALQUER duração sem timeout HTTP
 *
 * Fluxo:
 *   1. POST /extract_products_ai → retorna {jobId, status: 'processing'} (~5s só upload)
 *   2. GET /extract_products_ai_status/{jobId} a cada 5s (polling)
 *   3. Quando status='success' ou 'error', termina o loop
 */
export const extractProductsViaGemini = async (
  file: File,
  fornecedor: string = '',
  maxAttempts: number = 3
): Promise<ResultadoExtracaoAI | null> => {
  console.log('[GeminiAI] Iniciando extração via Gemini Vision (modo assíncrono)...');

  // Gera jobId único do cliente (será reutilizado em polling)
  const jobId = `ai_${crypto.randomUUID()}`;

  // ─── ETAPA 1: Upload do PDF + dispatch da background task ───
  let uploadOk = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('supplier', fornecedor);
      fd.append('jobId', jobId);

      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 120_000); // 2min para upload

      const response = await fetch(`${BACKEND_URL}/extract_products_ai`, {
        method: 'POST',
        body: fd,
        signal: ctrl.signal,
      });
      clearTimeout(tid);

      if ([502, 503, 504].includes(response.status)) {
        console.warn(`[GeminiAI] Upload HTTP ${response.status} tentativa ${attempt}/${maxAttempts}, retry em ${attempt * 3}s...`);
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, attempt * 3000));
          continue;
        }
        return null;
      }

      if (!response.ok) {
        console.error(`[GeminiAI] Upload falhou HTTP ${response.status}`);
        return null;
      }

      const body = await response.json();
      if (body?.status === 'processing' || body?.status === 'success') {
        uploadOk = true;
        break;
      }
      console.error('[GeminiAI] Upload retornou status inesperado:', body);
      return null;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.warn('[GeminiAI] Upload timeout (>2min)');
        return null;
      }
      const transient =
        err.name === 'TypeError' ||
        err.message?.includes('Failed to fetch') ||
        err.message?.includes('HTTP2_PROTOCOL_ERROR');
      if (transient && attempt < maxAttempts) {
        console.warn(`[GeminiAI] Upload erro transitório tentativa ${attempt}/${maxAttempts}: ${err.message}. Retry em ${attempt * 3}s...`);
        await new Promise(r => setTimeout(r, attempt * 3000));
        continue;
      }
      console.error('[GeminiAI] Upload erro definitivo:', err);
      return null;
    }
  }

  if (!uploadOk) return null;

  // ─── ETAPA 2: Polling até status final ───
  console.log(`[GeminiAI] Upload OK (job=${jobId}), aguardando processamento...`);
  const startedAt = Date.now();
  const maxPollMs = 20 * 60 * 1000; // 20min máximo total (catálogos 100+ pgs)
  const pollIntervalMs = 5000;       // poll a cada 5s
  let consecutivePollErrors = 0;
  let lastProgressLog = 0;

  while (Date.now() - startedAt < maxPollMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));

    try {
      const r = await fetch(`${BACKEND_URL}/extract_products_ai_status/${jobId}`);
      if (!r.ok) {
        consecutivePollErrors++;
        if (consecutivePollErrors > 3) {
          console.warn(`[GeminiAI] Polling falhou ${consecutivePollErrors}x consecutivas (HTTP ${r.status}), abortando`);
          return null;
        }
        continue;
      }
      consecutivePollErrors = 0;
      const data = await r.json();

      if (data.status === 'success' && data.ai_result) {
        const result = data.ai_result as ResultadoExtracaoAI;
        console.log(
          `[GeminiAI] ✓ ${result.produtos.length} produtos extraídos | ` +
          `modelo=${result.model} | confiança=${((result.confianca || 0) * 100).toFixed(0)}%`
        );
        return result;
      }
      if (data.status === 'error') {
        console.warn('[GeminiAI] Backend retornou erro:', data.ai_result?.error || data.message);
        return data.ai_result || {
          success: false, model: '', produtos: [],
          fornecedor_detectado: '', total_paginas: 0,
          error: data.message || 'erro no backend',
        };
      }
      // Continua polling: status = 'processing' / outro
      // Log de progresso a cada 30s para o usuário ver que está vivo
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      if (elapsedSec - lastProgressLog >= 30) {
        console.log(`[GeminiAI] Processando há ${elapsedSec}s (Gemini analisando ${file.size > 5_000_000 ? 'catálogo grande' : 'PDF'}...)`);
        lastProgressLog = elapsedSec;
      }
    } catch (err: any) {
      consecutivePollErrors++;
      if (consecutivePollErrors > 3) {
        console.warn(`[GeminiAI] ${consecutivePollErrors} erros consecutivos no polling, abortando`);
        return null;
      }
    }
  }

  console.warn(`[GeminiAI] Polling timeout (>20min)`);
  return null;
};

/**
 * Merge inteligente: enriquece produtos do pipeline atual com dados da AI.
 *
 * REGRAS:
 *   - Match por código (case-insensitive, trim)
 *   - Para CADA produto local sem preço → usa preço da AI
 *   - Para CADA produto local sem quantidadeCaixa válida → usa AI
 *   - Para CADA produto local sem ipi → usa AI
 *   - Para produtos que SÓ existem na AI → adiciona como novos
 *   - Nunca SOBRESCREVE valores que já existem (não derruba o que está OK)
 */
export const mergeProdutosComAI = <T extends Record<string, any>>(
  produtosLocais: T[],
  produtosAI: ProdutoAI[]
): { merged: T[]; enriched: number; added: number } => {
  if (!produtosAI || produtosAI.length === 0) {
    return { merged: produtosLocais, enriched: 0, added: 0 };
  }

  const normalizeCode = (c: string): string =>
    String(c || '').trim().toUpperCase().replace(/\s+/g, '');

  const aiByCode = new Map<string, ProdutoAI>();
  for (const a of produtosAI) {
    const key = normalizeCode(a.codigo);
    if (key) aiByCode.set(key, a);
  }

  let enriched = 0;
  const merged: T[] = [];
  const usedAIKeys = new Set<string>();

  for (const local of produtosLocais) {
    // Tenta match com QUALQUER um dos códigos disponíveis (codigo/codigoOriginal/sku)
    const candidates = [
      normalizeCode(local.codigo),
      normalizeCode(local.codigoOriginal),
      normalizeCode(local.sku),
    ].filter(Boolean);

    let aiMatch: ProdutoAI | undefined;
    let matchedKey = '';
    for (const cand of candidates) {
      const m = aiByCode.get(cand);
      if (m) {
        aiMatch = m;
        matchedKey = cand;
        break;
      }
    }
    if (!aiMatch) {
      merged.push(local);
      continue;
    }

    usedAIKeys.add(matchedKey);
    const enrichedProd: any = { ...local };
    let wasEnriched = false;

    // Preço: preenche se local está zerado/null
    const localPreco = Number(local.preco || local.precoBase || local.precoFinal || 0);
    if (localPreco <= 0 && aiMatch.preco > 0) {
      enrichedProd.preco = aiMatch.preco;
      enrichedProd.precoBase = aiMatch.preco;
      enrichedProd.precoFinal = aiMatch.preco;
      wasEnriched = true;
    }

    // Preço promocional
    if (!local.precoPromocional && aiMatch.precoPromocional && aiMatch.precoPromocional > 0) {
      enrichedProd.precoPromocional = aiMatch.precoPromocional;
      wasEnriched = true;
    }

    // Quantidade caixa: preenche se local está 0/1 e AI tem > 1
    const localQtd = Number(local.quantidadeCaixa || 0);
    if (localQtd <= 1 && aiMatch.quantidadeCaixa > 1) {
      enrichedProd.quantidadeCaixa = aiMatch.quantidadeCaixa;
      wasEnriched = true;
    }

    // IPI: preenche se ausente
    if ((!local.ipi || local.ipi === 0) && aiMatch.ipi > 0) {
      enrichedProd.ipi = aiMatch.ipi;
      wasEnriched = true;
    }

    // NCM
    if (!local.ncm && aiMatch.ncm) {
      enrichedProd.ncm = aiMatch.ncm;
      wasEnriched = true;
    }

    // Nome: corrige se local está vazio ou muito curto
    const localNome = String(local.nome || local.descricao || '').trim();
    if (localNome.length < 5 && aiMatch.nome && aiMatch.nome.length >= 5) {
      enrichedProd.nome = aiMatch.nome;
      enrichedProd.descricao = aiMatch.nome;
      wasEnriched = true;
    }

    // Limpa erros se enriquecemos campos críticos
    if (wasEnriched && enrichedProd.erros && enrichedProd.erros.length > 0) {
      const novosErros = enrichedProd.erros.filter((e: string) => {
        const lower = String(e).toLowerCase();
        // Remove erros que acabamos de corrigir
        if (enrichedProd.preco > 0 && (lower.includes('preço') || lower.includes('preco'))) {
          return false;
        }
        return true;
      });
      enrichedProd.erros = novosErros;
      // Se zerou erros e havia produto inválido, valida
      if (novosErros.length === 0 && enrichedProd.status === 'invalido') {
        enrichedProd.status = 'valido';
      }
    }

    if (wasEnriched) enriched++;
    merged.push(enrichedProd as T);
  }

  // Produtos que só existem na AI (não capturados pelo pipeline local)
  let added = 0;
  for (const [key, ai] of aiByCode.entries()) {
    if (usedAIKeys.has(key)) continue;
    if (!ai.codigo || !ai.nome) continue;
    // Cria produto novo no shape mínimo compatível
    const novo: any = {
      codigo: ai.codigo,
      codigoOriginal: ai.codigo,
      nome: ai.nome,
      descricao: ai.nome,
      preco: ai.preco || 0,
      precoBase: ai.preco || 0,
      precoFinal: ai.preco || 0,
      precoPromocional: ai.precoPromocional || undefined,
      quantidadeCaixa: ai.quantidadeCaixa || 1,
      ipi: ai.ipi || 0,
      ncm: ai.ncm || '',
      categoria: ai.categoria || '',
      paginaOrigem: ai.paginaOrigem || 0,
      observacoes: ai.observacoes || '',
      unidade: 'UN',
      status: 'valido',
      erros: [],
      warnings: ['Adicionado via AI (não detectado pelo parser tradicional)'],
      confiancaExtracao: 90,
      fornecedor: '', // será preenchido pelo pipeline
    };
    merged.push(novo as T);
    added++;
  }

  console.log(`[GeminiAI Merge] Enriquecidos: ${enriched} | Adicionados: ${added} | Total: ${merged.length}`);
  return { merged, enriched, added };
};
