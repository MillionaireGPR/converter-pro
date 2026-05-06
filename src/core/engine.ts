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

  const result: PipelineResult = await runImportPipeline(file, options);
  
  // Roda a extração de imagens paralelamente/logo após o pipeline base
  let imageResults = null;
  try {
     const { runImageExtraction } = await import('./images/imageExtractionPipeline');
     
     // Timeout de segurança de 300s para PDFs grandes (65+ paginas, upload incluido)
     const TIMEOUT_MS = 300000;
     console.log(`[Engine] Iniciando extração de imagens com timeout de ${TIMEOUT_MS}ms...`);
     
     imageResults = await Promise.race([
       runImageExtraction(file, result.produtosNormalizados, options.supplierName || 'desconhecido'),
       new Promise<null>((resolve) => 
         setTimeout(() => {
           console.warn(`[Engine] Timeout na extração de imagens após ${TIMEOUT_MS}ms`);
           resolve(null);
         }, TIMEOUT_MS)
       )
     ]);
     
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
