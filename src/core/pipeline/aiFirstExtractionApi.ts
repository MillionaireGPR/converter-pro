/**
 * v23 — Pipeline AI-FIRST: Gemini como extrator PRIMÁRIO de PDFs.
 *
 * MOTIVAÇÃO (decisão aprovada pelo user em 09/06/2026):
 *   Manter 14 parsers regex artesanais = manutenção infinita. Cada mudança
 *   de layout de catálogo quebrava a extração. Spike empírico com DAGIA real
 *   provou: Gemini extraiu 28/28 códigos (100%), 28/28 preços (100%),
 *   5/5 EM BREVE em 45s por ~R$0,25.
 *
 * ARQUITETURA:
 *   PDF → POST /extract_products_ai (Gemini lê o catálogo inteiro)
 *       → polling /extract_products_ai_status/{jobId}
 *       → map produtos JSON → ProdutoBruto[]
 *       → injeta no importPipeline (normalização/validação/dedup reusados)
 *
 *   Fornecedores têm "hints" (3 linhas de prompt no backend) em vez de
 *   parsers regex. Ver SUPPLIER_HINTS em gemini_extractor.py.
 *
 *   FALLBACK AUTOMÁTICO: se a IA falhar (timeout/erro/0 produtos), o
 *   engine cai no pipeline regex existente. Nada quebra.
 *
 * INVARIANTES RESPEITADOS:
 *   IV-07: retry agressivo com backoff exponencial no upload
 *   IV-08: polling com timeout total + MAX_NOT_FOUND + MAX_CONSECUTIVE_ERRORS
 */

import { ProdutoBruto } from '../types/productPipeline';

const BACKEND_URL = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:8000';

/** Produto cru retornado pelo Gemini (schema do EXTRACTION_PROMPT) */
export interface AiProduto {
  codigo: string;
  nome: string;
  preco: number | null;
  precoPromocional?: number | null;
  quantidadeCaixa?: number | null;
  ipi?: number | null;
  ncm?: string | null;
  categoria?: string | null;
  paginaOrigem?: number | null;
  observacoes?: string | null;
  emBreve?: boolean;
  promocional?: boolean;  // item já com desconto aplicado (tag/selo) → bloqueia desconto
}

export interface ResultadoAiExtraction {
  success: boolean;
  model: string;
  produtos: AiProduto[];
  fornecedor_detectado?: string;
  confianca?: number;
  elapsed?: number;
  error?: string | null;
}

/**
 * Catálogos gigantes não passam pela IA (limite de contexto + custo).
 * Goal Kids tem 1042 páginas — continua no pipeline regex/workaround.
 */
export const AI_FIRST_MAX_PAGES = 200;

/**
 * Chama o backend /extract_products_ai (ASSÍNCRONO via polling).
 *
 * Retorna null em falha definitiva — o caller (engine) usa o pipeline
 * regex como fallback.
 */
export const extractProductsViaAI = async (
  file: File,
  supplier: string,
  maxAttempts: number = 5
): Promise<ResultadoAiExtraction | null> => {
  const fileSizeMB = (file.size / 1024 / 1024).toFixed(1);
  console.log(`[AiFirst] Extração AI-first iniciada: ${file.name} (${fileSizeMB}MB, supplier=${supplier})`);

  const jobId = `aifirst_${crypto.randomUUID()}`;

  // ─── FASE 1: POST cria o job (retry agressivo IV-07) ───
  let jobCreated = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('supplier', supplier || '');
      fd.append('jobId', jobId);

      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 180_000); // IV-07: timeout >= 120s

      const response = await fetch(`${BACKEND_URL}/extract_products_ai`, {
        method: 'POST',
        body: fd,
        signal: ctrl.signal,
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(tid);

      if ([502, 503, 504].includes(response.status)) {
        if (attempt < maxAttempts) {
          const backoff = Math.min(3000 * Math.pow(2, attempt - 1), 30_000);
          console.warn(`[AiFirst] HTTP ${response.status} tentativa ${attempt}/${maxAttempts}, retry em ${backoff / 1000}s...`);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
        return null;
      }
      if (!response.ok) {
        console.error(`[AiFirst] HTTP ${response.status} ao criar job AI`);
        return null;
      }

      const created = await response.json();
      if (created.status === 'error') {
        console.error('[AiFirst] Backend recusou job:', created.message);
        return null;
      }
      jobCreated = true;
      console.log(`[AiFirst] ✓ Job criado: ${jobId} (tentativa ${attempt}). Polling...`);
      break;
    } catch (err: any) {
      const msg = err.message || String(err);
      const isTransient =
        err.name === 'AbortError' ||
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
        console.warn(`[AiFirst] Erro transitório tentativa ${attempt}/${maxAttempts}: ${msg.slice(0, 80)}. Retry em ${backoff / 1000}s...`);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      console.error(`[AiFirst] Erro definitivo após ${attempt} tentativa(s):`, err);
      return null;
    }
  }
  if (!jobCreated) return null;

  // ─── FASE 2: Polling até status terminal (IV-08) ───
  // Catálogos grandes (ex: FORTAL 96 págs) usam extração texto-chunked em
  // paralelo (~6-10min). Teto 18min com folga; ainda finito (IV-08).
  const POLL_INTERVAL_MS = 4000;
  const MAX_WAIT_MS = 18 * 60 * 1000;
  const MAX_CONSECUTIVE_ERRORS = 10;
  const MAX_NOT_FOUND_CHECKS = 3;
  const t0 = Date.now();
  let consecutiveErrors = 0;
  let notFoundCount = 0;
  let lastLog = 0;

  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const statusResp = await fetch(`${BACKEND_URL}/extract_products_ai_status/${jobId}`);
      if (!statusResp.ok) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.error(`[AiFirst] Backend HTTP ${statusResp.status} em ${consecutiveErrors} pollings — abortando`);
          return null;
        }
        continue;
      }
      consecutiveErrors = 0;

      const data = await statusResp.json();

      if (data.status === 'not_found') {
        notFoundCount++;
        if (notFoundCount >= MAX_NOT_FOUND_CHECKS) {
          console.error(`[AiFirst] Job perdido (not_found ${notFoundCount}x) — backend reiniciou`);
          return null;
        }
        continue;
      }

      const now = Date.now();
      if (now - lastLog > 15_000) {
        console.log(`[AiFirst] [${((now - t0) / 1000).toFixed(0)}s] status=${data.status} stage=${data.stage || '?'}`);
        lastLog = now;
      }

      if (data.status === 'success' || data.status === 'error') {
        const result: ResultadoAiExtraction = data.ai_result || data;
        if (result.success && Array.isArray(result.produtos)) {
          console.log(
            `[AiFirst] ✓ ${result.produtos.length} produtos extraídos pela IA ` +
            `em ${result.elapsed?.toFixed(1) || '?'}s (${result.model}, confiança ${((result.confianca || 0) * 100).toFixed(0)}%)`
          );
          return result;
        }
        console.warn('[AiFirst] IA retornou sem sucesso:', result.error);
        return null;
      }
      // processing → continua
    } catch (err: any) {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`[AiFirst] Backend não responde após ${consecutiveErrors} pollings: ${err.message}`);
        return null;
      }
    }
  }

  console.error('[AiFirst] Timeout total >8min no polling');
  return null;
};

/**
 * Converte produtos do Gemini → ProdutoBruto[] aceitos pelo importPipeline.
 *
 * As chaves de `campos` usam os nomes canônicos + aliases mais comuns dos
 * adapters ('codigo', 'descricao', 'preco', 'cx', 'ipi', 'ncm') para que
 * o extractor de QUALQUER fornecedor resolva os campos sem mapeamento extra.
 *
 * EM BREVE: seta __emBreve (o extractor propaga para visualCategory
 * 'em-breve' — produto validado sem preço + ***EM BREVE*** no título).
 */
export const mapAiProductsToBrutos = (produtos: AiProduto[]): ProdutoBruto[] => {
  const brutos: ProdutoBruto[] = [];
  for (let i = 0; i < produtos.length; i++) {
    const p = produtos[i];
    const codigo = String(p.codigo || '').trim();
    if (!codigo) continue; // sem código não há produto

    const campos: Record<string, any> = {
      codigo,
      descricao: String(p.nome || '').trim(),
      // Campos vêm prontos da IA — bloqueia heurísticas do extractor
      // (ex: "menor numérico = preço" pegaria IPI/CX como preço em
      // produtos legitimamente sem preço).
      __postProcessed: true,
    };

    // Preço: null/0 + emBreve → sem preço (EM BREVE); senão número
    const preco = p.preco;
    if (preco !== null && preco !== undefined && Number(preco) > 0) {
      campos['preco'] = String(preco);
    }
    if (p.precoPromocional !== null && p.precoPromocional !== undefined && Number(p.precoPromocional) > 0) {
      campos['precopromocional'] = String(p.precoPromocional);
      campos['promo'] = String(p.precoPromocional);
    }

    const qcx = Number(p.quantidadeCaixa || 0);
    if (qcx > 0) {
      // Duas chaves: canônica + alias universal 'cx' (adapters variam)
      campos['quantidadecaixa'] = String(qcx);
      campos['cx'] = String(qcx);
    }

    const ipi = Number(p.ipi || 0);
    if (ipi > 0) campos['ipi'] = String(ipi);
    if (p.ncm) campos['ncm'] = String(p.ncm);
    if (p.categoria) campos['categoria'] = String(p.categoria);
    if (p.observacoes) campos['observacoes'] = String(p.observacoes);

    if (p.emBreve === true) {
      campos['__emBreve'] = true;
      campos['informacoesAdicionais'] = 'EM BREVE';
      // Não deletar preco: EM BREVE pode ter preço visível (ex: DV003 R$37,37).
      // Se Gemini retornou preco=null, o campo já não foi setado na linha acima.
    }

    // PROMOÇÃO: item que já vem com desconto aplicado → bloqueia desconto em massa
    // (extractor vira visualCategory='promocional' + ***PROMOCAO*** + bloqueiaDesconto).
    if (p.promocional === true) {
      campos['__promo'] = true;
    }

    brutos.push({
      campos,
      linhaOrigem: i,
      paginaOrigem: Number(p.paginaOrigem || 0) || 1,
      textoBruto: `${codigo} ${p.nome || ''} [ai-first]`,
    });
  }
  return brutos;
};
