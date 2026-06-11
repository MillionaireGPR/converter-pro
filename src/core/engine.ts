import { ProdutoNormalizado, SupplierConfig } from './types';
import { ProdutoNormalizadoV2, PipelineResult, Inconsistencia, ImportMetadata } from './types/productPipeline';
import { getSupplierConfig } from './rules/suppliers';
import { mapRowToProduto } from './normalizers/utils';
import { validarProduto } from './validators';
import { detectColumnMapping } from './autoMapper';
import { runImportPipeline, PipelineOptions } from './pipeline/importPipeline';
import { getAdapterById } from './supplierRules/registry';

export interface ConversionResult {
  produtos: ProdutoNormalizado[];
  stats: {
    total: number;
    validados: number;
    erros: number;
    pendentes: number;
  };
}

export interface ConversionResultV2 {
  produtos: ProdutoNormalizado[];
  produtosV2: ProdutoNormalizadoV2[];
  metadata: ImportMetadata;
  inconsistencias: Inconsistencia[];
  stats: {
    total: number;
    validados: number;
    erros: number;
    pendentes: number;
    duplicados: number;
  };
  imageResults?: import('./images/imageTypes').ResultadoExtracaoImagens | null;
}

/**
 * Motor V2: Usa o novo pipeline completo.
 * Aceita File diretamente (Excel, CSV ou PDF).
 * Retorna dados no formato antigo (ProdutoNormalizado) para compatibilidade,
 * MAIS os dados V2 e metadados completos.
 */
export const processarArquivoV2 = async (
  file: File,
  supplierId?: string,
  supplierName?: string
): Promise<ConversionResultV2> => {
  const options: PipelineOptions = {
    supplierId,
    supplierName,
    deduplicate: true,
  };

  // Tenta resolver o adapter pelo ID ou nome do fornecedor
  if (supplierId) {
    const adapter = getAdapterById(supplierId);
    if (adapter) options.forceAdapter = adapter;
  }
  if (!options.forceAdapter && supplierName) {
    const adapter = getAdapterById(supplierName);
    if (adapter) options.forceAdapter = adapter;
  }

  // ─── v23 AI-FIRST: Gemini lê o catálogo PDF inteiro como extrator PRIMÁRIO ───
  // Decisão aprovada em 09/06/2026 após spike com DAGIA real: 100% códigos,
  // 100% preços, 5/5 EM BREVE em 45s (~R$0,25). Substitui o ciclo infinito
  // de manutenção de regex por fornecedor.
  //
  // FALLBACK AUTOMÁTICO: qualquer falha da IA (timeout/erro/0 produtos) cai
  // no pipeline regex existente — nada quebra, só fica menos preciso.
  // EXCEÇÕES ao AI-first (não quebrar o que JÁ funciona perfeito):
  //   - NIX HOUSE: caso-bandeira do regex (285 produtos, 0 erros) — IVs baseiam-se nele
  //   - GOAL KIDS: 1042 páginas, excede contexto/custo — mantém workaround próprio
  const AI_FIRST_BLOCKLIST = ['NIX', 'GOAL KIDS', 'GOALKIDS', 'GOAL-KIDS'];
  const supplierUpper = (supplierName || supplierId || '').toUpperCase();
  const isBlocked = AI_FIRST_BLOCKLIST.some(b => supplierUpper.includes(b));

  const isPdfFile = file.name.toLowerCase().endsWith('.pdf');
  if (isPdfFile && isBlocked) {
    console.log(`[Engine] AI-first PULADO para ${supplierUpper} (blocklist — regex já validado)`);
  }
  if (isPdfFile && !isBlocked) {
    try {
      const { extractProductsViaAI, mapAiProductsToBrutos } = await import('./pipeline/aiFirstExtractionApi');
      const aiResult = await extractProductsViaAI(file, supplierName || supplierId || '');
      if (aiResult && aiResult.success && aiResult.produtos.length > 0) {
        const aiBrutos = mapAiProductsToBrutos(aiResult.produtos);
        if (aiBrutos.length > 0) {
          options.aiBrutos = aiBrutos;
          console.log(`[Engine] AI-FIRST ativo: ${aiBrutos.length} produtos extraídos pela IA (${aiResult.model})`);
        }
      } else {
        console.warn('[Engine] AI-first indisponível — fallback para pipeline regex');
      }
    } catch (e) {
      console.warn('[Engine] AI-first falhou (não-crítico, fallback regex):', e);
    }
  }

  // ─── Pipeline base (normalização/validação/dedup) ───
  // Com aiBrutos: pula leitura regex e usa produtos da IA.
  // Sem aiBrutos: caminho regex completo (fallback ou Excel/CSV).
  const result: PipelineResult = await runImportPipeline(file, options);

  // ─── AI CIRÚRGICA: resgata APENAS os preços faltantes ───
  // Pipeline base já tira 285 produtos em 2s. Só ~91 ficam sem preço.
  // Em vez de pedir ao Gemini que refaça TUDO (~10min), pedimos apenas
  // os preços específicos. Backend renderiza apenas as páginas relevantes
  // como JPEG e chama Gemini Flash em PARALELO (6 workers). Tempo: ~30s.
  const isPdf = file.name.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    try {
      const {
        buildSkusByPageForRepair,
        repairPricesViaGemini,
        applyRepairedPrices,
      } = await import('./pipeline/geminiExtractionApi');

      const skusByPage = buildSkusByPageForRepair(result.produtosNormalizados);
      const totalSkus = Object.values(skusByPage).reduce((acc, arr) => acc + arr.length, 0);

      if (totalSkus > 0) {
        console.log(`[Engine] ${totalSkus} produtos sem preço — chamando AI cirúrgica...`);
        const repairResult = await repairPricesViaGemini(file, skusByPage);

        if (repairResult && repairResult.success && Object.keys(repairResult.precos).length > 0) {
          const { applied, statusUpdated } = applyRepairedPrices(result.produtosNormalizados, repairResult.precos);
          console.log(
            `[Engine] ✓ AI repair: ${applied} preços resgatados em ${repairResult.elapsed?.toFixed(1) || '?'}s ` +
            `(modelo ${repairResult.model}) — ${statusUpdated} status atualizados para 'validado'`
          );
          // CRÍTICO: recalcular stats após repair. O result.stats foi calculado
          // pelo pipeline base ANTES dos preços serem aplicados. Sem isso, a UI
          // continua mostrando "91 erros" mesmo com preços resgatados.
          const recalc = result.produtosNormalizados.reduce(
            (acc, p) => {
              if (p.status === 'validado') acc.validos++;
              else if (p.status === 'erro') acc.comErro++;
              else if (p.status === 'pendente') acc.comWarning++;
              return acc;
            },
            { validos: 0, comErro: 0, comWarning: 0 }
          );
          result.stats.validos = recalc.validos;
          result.stats.comErro = recalc.comErro;
          result.stats.comWarning = recalc.comWarning;
          console.log(
            `[Engine] Stats recalculados: ${recalc.validos} válidos, ${recalc.comErro} erros, ${recalc.comWarning} pendentes`
          );
        } else if (repairResult && !repairResult.success) {
          console.warn(`[Engine] AI repair falhou (pipeline base segue): ${repairResult.error}`);
        } else if (!repairResult) {
          console.warn('[Engine] AI repair indisponível (pipeline base segue)');
        }
      } else {
        console.log('[Engine] Pipeline base extraiu todos os preços — AI repair não necessário');
      }
    } catch (e) {
      console.warn('[Engine] AI repair falhou (não-crítico):', e);
    }
  }

  // ─── Extração de imagens (sequencial, depois da AI terminar) ───
  // O backend já está livre da chamada AI, pode processar /process em paz.
  let imageResults = null;
  try {
     const { runImageExtraction } = await import('./images/imageExtractionPipeline');

     console.log(`[Engine] Iniciando extração de imagens (aguardando via Polling)...`);

     imageResults = await runImageExtraction(file, result.produtosNormalizados, options.supplierName || 'desconhecido');

  } catch(e) {
     console.error("[Engine] Erro ao extrair imagens:", e);
  }

  // Converte ProdutoNormalizadoV2 → ProdutoNormalizado (compatibilidade)
  const produtosCompat: ProdutoNormalizado[] = result.produtosNormalizados.map(p => ({
    fornecedor: p.fornecedor,
    fornecedorId: p.fornecedorId,
    codigoOriginal: p.codigoOriginal || p.codigo,
    codigo: p.codigo,
    nome: p.nome,
    descricaoComplementar: p.descricaoComplementar,
    precoBase: p.precoBase,
    descontoPercentual: p.descontoPercentual,
    descontoString: p.descontoString,
    precoFinal: p.precoFinal,
    ipi: p.ipi,
    unidade: p.unidade,
    quantidadeCaixa: p.quantidadeCaixa,
    categoria: p.categoria,
    embalagem: p.embalagem,
    observacoes: p.observacoes,
    status: p.status,
    erros: p.erros,
    imagemUrl: p.imagemUrl,
    temImagem: p.temImagem,
    visualCategory: p.visualCategory,
    isPromotional: p.isPromotional,
    isFixedPrice: p.isFixedPrice,
    informacoesAdicionais: p.informacoesAdicionais,
  }));

  return {
    produtos: produtosCompat,
    produtosV2: result.produtosNormalizados,
    metadata: result.metadata,
    inconsistencias: result.inconsistencias,
    stats: {
      total: result.stats.total,
      validados: result.stats.validos,
      erros: result.stats.comErro,
      pendentes: result.stats.comWarning,
      duplicados: result.stats.duplicados,
    },
    imageResults,
  };
};

/**
 * Motor LEGADO (mantido para compatibilidade).
 * Recebe uma lista de objetos (linhas da planilha) e o ID do fornecedor.
 * NOTA: para novos fluxos, usar processarArquivoV2.
 */
export const processarArquivo = (
  rawData: Record<string, any>[],
  supplierId: string,
  supplierName?: string,
  rawRows2D?: any[][]
): ConversionResult => {
  let config = getSupplierConfig(supplierId) || (supplierName ? getSupplierConfig(supplierName) : undefined);
  const headers = rawData.length > 0 ? Object.keys(rawData[0]) : [];
  
  if (!config) {
    console.warn(`[Engine Legacy] Config não encontrada para: ${supplierName || supplierId}. Auto-Mapeamento:`, headers);
    config = detectColumnMapping(headers, supplierId, supplierName || supplierId);
  } else {
    console.log(`[Engine Legacy] Regra '${config.id}' localizada. Headers:`, headers);
  }

  const positionMap: Record<string, number> = {};
  if (rawRows2D && rawRows2D.length > 0) {
    const structuralHeader = rawRows2D[0];
    structuralHeader.forEach((colRawName, idx) => {
      if (typeof colRawName === 'string') {
        const normalized = colRawName.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, "");
        positionMap[normalized] = idx;
      }
    });
  }

  const produtos: ProdutoNormalizado[] = rawData.map((row, index) => {
    const raw2DLine = rawRows2D ? rawRows2D[index + 1] : undefined;
    const produtoBase = mapRowToProduto(row, config!, index, raw2DLine, positionMap);
    return validarProduto(produtoBase);
  });

  const stats = produtos.reduce(
    (acc, p) => {
      acc.total++;
      if (p.status === 'validado') acc.validados++;
      else if (p.status === 'erro') acc.erros++;
      else acc.pendentes++;
      return acc;
    },
    { total: 0, validados: 0, erros: 0, pendentes: 0 }
  );

  return { produtos, stats };
};
