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
 * Chama o endpoint AI do backend Python.
 * Timeout generoso (5min) pois catálogos grandes podem demorar.
 */
export const extractProductsViaGemini = async (
  file: File,
  fornecedor: string = ''
): Promise<ResultadoExtracaoAI | null> => {
  try {
    console.log('[GeminiAI] Iniciando extração via Gemini Vision...');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('supplier', fornecedor);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300_000); // 5min

    const response = await fetch(`${BACKEND_URL}/extract_products_ai`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const txt = await response.text();
      console.error(`[GeminiAI] HTTP ${response.status}:`, txt);
      return {
        success: false,
        model: '',
        produtos: [],
        fornecedor_detectado: '',
        total_paginas: 0,
        error: `Backend retornou ${response.status}`,
      };
    }

    const result = (await response.json()) as ResultadoExtracaoAI;
    if (result.success) {
      console.log(
        `[GeminiAI] ✓ ${result.produtos.length} produtos extraídos | ` +
        `modelo=${result.model} | confiança=${((result.confianca || 0) * 100).toFixed(0)}%`
      );
    } else {
      console.warn('[GeminiAI] Backend retornou falha:', result.error);
    }
    return result;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn('[GeminiAI] Timeout na extração AI (>5min)');
    } else {
      console.error('[GeminiAI] Erro na chamada AI:', err);
    }
    return null;
  }
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
