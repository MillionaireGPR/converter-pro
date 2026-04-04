// ===================================================================
// PIPELINE PRINCIPAL DE IMPORTAÇÃO
// Orquestra: detecção → leitura → extração → normalização → validação
// ===================================================================

import * as XLSX from 'xlsx';
import {
  TipoArquivo,
  ImportMetadata,
  ProdutoBruto,
  ProdutoExtraido,
  ProdutoNormalizadoV2,
  PipelineResult,
  Inconsistencia,
  ParserStrategy,
} from '../types/productPipeline';
import { detectFileType, classifyPDF } from './fileDetector';
import { extractTextFromPDF, scorePdfPages, splitIntoProductBlocks, parseTabularPDF } from './pdfParser';
import { detectTemplate } from '../pdfTemplates/templateRegistry';
import { interpretPdfSemantically } from './smartPdfInterpreter';
import { findHeaderRowIndex } from '../autoMapper';
import { SupplierAdapter } from '../supplierRules/types';
import { getAdapterById, getGenericAdapter, detectSupplier } from '../supplierRules/registry';
import { extractProducts } from '../supplierRules/extractor';
import {
  deduplicateByCodigo,
  extractPrice,
  cleanDescription,
  sanitizeForExport,
  normalizeSpaces,
} from '../normalizers/cleaners';

// ===================================================================
// LEITURA DE EXCEL / CSV
// ===================================================================

interface SpreadsheetReadResult {
  headers: string[];
  rows: Record<string, any>[];
  rows2D: any[][];
  headerRowIndex: number;
}

/**
 * Lê um arquivo Excel ou CSV e retorna dados estruturados.
 * Reutiliza a lógica de detecção de header que já existia.
 */
const readSpreadsheet = (data: ArrayBuffer, tipo: TipoArquivo): SpreadsheetReadResult => {
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Lê como array 2D para detecção de header
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
  const headerRowIndex = findHeaderRowIndex(rawRows);

  const headerRow = rawRows[headerRowIndex] || [];
  const headers = headerRow
    .map((h: any) => String(h || '').trim())
    .filter(Boolean);

  // Lê como objetos a partir do header detectado
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    range: headerRowIndex,
    blankrows: false,
  }) as Record<string, any>[];

  // Lê 2D estrutural para pareamento posicional
  const rows2D = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    range: headerRowIndex,
    blankrows: false,
  }) as any[][];

  return { headers, rows, rows2D, headerRowIndex };
};

/**
 * Converte linhas de planilha em ProdutoBruto[]
 */
const rowsToProdutosBrutos = (rows: Record<string, any>[]): ProdutoBruto[] => {
  return rows.map((row, idx) => ({
    campos: { ...row },
    linhaOrigem: idx,
  }));
};

// ===================================================================
// LEITURA DE PDF
// ===================================================================

/**
 * Lê um PDF e retorna ProdutoBruto[] usando a melhor estratégia.
 */
const readPDF = async (
  data: ArrayBuffer,
  adapter?: SupplierAdapter
): Promise<{ brutos: ProdutoBruto[]; strategy: ParserStrategy; metadata: Partial<ImportMetadata> }> => {
  const { pages, totalPages } = await extractTextFromPDF(data);
  const scores = scorePdfPages(pages);
  const tipoPDF = classifyPDF(pages);

  const paginasComDados = scores
    .filter(s => s.extractionConfidence >= 25)
    .map(s => s.pagina);

  const avgConfidence = scores.length > 0
    ? Math.round(scores.reduce((sum, s) => sum + s.extractionConfidence, 0) / scores.length)
    : 0;

  const metadata: Partial<ImportMetadata> = {
    tipoPDF,
    totalPaginas: totalPages,
    paginasComDados,
    confiancaExtracao: avgConfidence,
  };

  let brutos: ProdutoBruto[] = [];
  let strategy: ParserStrategy = 'pdf-textual';
  
  // Tentar detecção por Template de Fornecedor
  const validPages = pages.filter((p, i) => scores[i].extractionConfidence >= 25);
  const textSample = validPages.slice(0, 10).map(p => p.text).join('\n');
  const template = detectTemplate(textSample);

  if (template) {
    console.log(`[Pipeline PDF] Template detectado: ${template.supplierName}`);
    brutos = interpretPdfSemantically(validPages, template);
    strategy = 'pdf-blocos';
    if (brutos.length > 0) return { brutos, strategy, metadata };
  }

  // Tentar interpretador inteligente geral se não houver template
  console.log(`[Pipeline PDF] Usando Smart PDF Interpreter genérico...`);
  brutos = interpretPdfSemantically(validPages);
  if (brutos.length >= validPages.length) {
    strategy = 'pdf-blocos';
    return { brutos, strategy, metadata };
  }

  // Estratégia 1: Parser por blocos do adapter legado (se houver)
  if (adapter?.blockSeparator && (tipoPDF === 'pdf-blocos' || tipoPDF === 'pdf-misto' || tipoPDF === 'pdf-texto')) {
    strategy = 'pdf-blocos';
    for (const page of pages) {
      const pageBlocks = splitIntoProductBlocks(page.text, adapter.blockSeparator, page.pageNum);
      brutos.push(...pageBlocks);
    }
    if (brutos.length > brutos.length) { // O fallback extraiu mais?
      console.log(`[Pipeline PDF] Estratégia BLOCOS (legado): ${brutos.length} produtos extraídos`);
      return { brutos, strategy, metadata };
    }
  }

  // Estratégia 2: Parser tabular
  if (tipoPDF === 'pdf-tabela' || tipoPDF === 'pdf-misto') {
    strategy = 'pdf-tabular';
    brutos = parseTabularPDF(pages);
    if (brutos.length > 0) {
      console.log(`[Pipeline PDF] Estratégia TABULAR: ${brutos.length} linhas extraídas`);
      return { brutos, strategy, metadata };
    }
  }

  // Estratégia 3: Parser textual genérico (linha por linha)
  strategy = 'pdf-textual';
  brutos = [];
  for (const page of pages) {
    const lines = page.text.split('\n').map(l => l.trim()).filter(l => l.length > 5);
    for (let i = 0; i < lines.length; i++) {
      brutos.push({
        campos: { texto: lines[i], __rawLine: lines[i] },
        linhaOrigem: i,
        paginaOrigem: page.pageNum,
        textoBruto: lines[i],
      });
    }
  }

  console.log(`[Pipeline PDF] Estratégia TEXTUAL: ${brutos.length} linhas extraídas`);
  return { brutos, strategy, metadata };
};

// ===================================================================
// NORMALIZAÇÃO: ProdutoExtraido → ProdutoNormalizadoV2
// ===================================================================

const normalizeExtracted = (
  extraidos: ProdutoExtraido[],
  fornecedorNomeFinal: string,
  fornecedorIdFinal?: string
): ProdutoNormalizadoV2[] => {
  return extraidos.map(e => {
    const erros = [...e.erros];
    const warnings = [...e.warnings];

    const codigo = sanitizeForExport(e.codigo || '');
    const nome = sanitizeForExport(cleanDescription(e.descricao || ''));
    const precoBase = e.preco || 0;

    // Validação
    if (!codigo) erros.push('Código não encontrado');
    if (!nome) erros.push('Descrição não encontrada');
    if (precoBase <= 0) erros.push('Preço base deve ser maior que zero');

    let status: 'validado' | 'pendente' | 'erro' = 'validado';
    if (erros.length > 0) status = 'erro';
    else if (warnings.length > 0) status = 'pendente';

    return {
      fornecedor: fornecedorNomeFinal,
      fornecedorId: fornecedorIdFinal,
      codigo,
      codigoOriginal: codigo,
      codigoBarras: e.codigoBarras,
      codigoInterno: e.codigoInterno,
      nome,
      descricaoComplementar: e.descricaoComplementar,
      categoria: e.categoria,
      precoBase,
      precoPromocional: e.precoPromocional,
      precoFinal: precoBase, // Será recalculado ao aplicar desconto
      ipi: e.ipi,
      ncm: e.ncm,
      unidade: e.unidade || 'UN',
      quantidadeCaixa: e.quantidadeCaixa || 1,
      embalagem: e.embalagem,
      dimensoes: e.dimensoes,
      material: e.material,
      cor: e.cor,
      volume: e.volume,
      observacoes: e.observacoes,
      statusEstoque: e.statusEstoque,
      status,
      erros,
      warnings,
      origemArquivo: e.origemArquivo,
      paginaOrigem: e.paginaOrigem,
      linhaOrigem: e.linhaOrigem,
      confiancaExtracao: e.confiancaExtracao,
    };
  });
};

// ===================================================================
// DETECÇÃO DE INCONSISTÊNCIAS
// ===================================================================

const detectInconsistencies = (produtos: ProdutoNormalizadoV2[]): Inconsistencia[] => {
  const issues: Inconsistencia[] = [];

  // Contagem de códigos para duplicados
  const codigoCount = new Map<string, number>();
  for (const p of produtos) {
    if (p.codigo) {
      const key = p.codigo.toUpperCase();
      codigoCount.set(key, (codigoCount.get(key) || 0) + 1);
    }
  }

  for (const p of produtos) {
    if (!p.codigo) {
      issues.push({ tipo: 'sem-codigo', mensagem: 'Produto sem código', linha: p.linhaOrigem, pagina: p.paginaOrigem });
    }
    if (!p.nome) {
      issues.push({ tipo: 'sem-descricao', mensagem: 'Produto sem descrição', linha: p.linhaOrigem, pagina: p.paginaOrigem, produto: p.codigo });
    }
    if (p.precoBase <= 0) {
      issues.push({ tipo: 'sem-preco', mensagem: 'Produto sem preço válido', linha: p.linhaOrigem, pagina: p.paginaOrigem, produto: p.codigo });
    }
    if (p.codigo && (codigoCount.get(p.codigo.toUpperCase()) || 0) > 1) {
      issues.push({ tipo: 'codigo-duplicado', mensagem: `Código "${p.codigo}" duplicado`, linha: p.linhaOrigem, produto: p.codigo });
    }
    if (p.precoBase < 0) {
      issues.push({ tipo: 'preco-invalido', mensagem: `Preço negativo: ${p.precoBase}`, linha: p.linhaOrigem, produto: p.codigo });
    }
    if (p.quantidadeCaixa < 0) {
      issues.push({ tipo: 'caixa-invalida', mensagem: `Qtd caixa negativa: ${p.quantidadeCaixa}`, linha: p.linhaOrigem, produto: p.codigo });
    }
    if (p.nome && p.nome.length < 5) {
      issues.push({ tipo: 'descricao-curta', mensagem: `Descrição muito curta: "${p.nome}"`, linha: p.linhaOrigem, produto: p.codigo });
    }
  }

  return issues;
};

// ===================================================================
// PIPELINE PRINCIPAL
// ===================================================================

export interface PipelineOptions {
  /** ID ou nome do fornecedor (se já souber) */
  supplierId?: string;
  /** Nome do fornecedor (para exibição) */
  supplierName?: string;
  /** Forçar uso de um adapter específico */
  forceAdapter?: SupplierAdapter;
  /** Incluir itens com erro na saída */
  includeErrors?: boolean;
  /** Deduplicar por código */
  deduplicate?: boolean;
}

/**
 * Pipeline completo de importação.
 * Recebe um arquivo (File) e retorna produtos normalizados prontos para uso.
 */
export const runImportPipeline = async (
  file: File,
  options: PipelineOptions = {}
): Promise<PipelineResult> => {
  const startTime = performance.now();
  const tipoArquivo = detectFileType(file.name);

  console.log(`[Pipeline] Iniciando importação: ${file.name} (${tipoArquivo})`);

  // 1. Leitura do arquivo em ArrayBuffer
  const fileData = await file.arrayBuffer();

  // 2. Determinar adapter (fornecedor)
  let adapter: SupplierAdapter;
  let fornecedorDetectado: string | undefined;
  let fornecedorConfirmado: string | undefined;

  if (options.forceAdapter) {
    adapter = options.forceAdapter;
    fornecedorConfirmado = adapter.nome;
  } else if (options.supplierId || options.supplierName) {
    const found = getAdapterById(options.supplierId || options.supplierName || '');
    adapter = found || getGenericAdapter();
    if (found) fornecedorConfirmado = found.nome;
  } else {
    adapter = getGenericAdapter();
  }

  // 3. Leitura e extração conforme tipo de arquivo
  let brutos: ProdutoBruto[] = [];
  let parserUsado: ParserStrategy = 'xlsx-direto';
  let headers: string[] = [];
  let partialMetadata: Partial<ImportMetadata> = {};

  if (tipoArquivo === 'pdf') {
    const pdfResult = await readPDF(fileData, adapter);
    brutos = pdfResult.brutos;
    parserUsado = pdfResult.strategy;
    partialMetadata = pdfResult.metadata;

    // Tenta detecção automática do fornecedor pelo texto do PDF apenas se o usuário não tiver forçado um
    const userSelectedSupplier = !!(options.supplierId || options.supplierName);
    if (!userSelectedSupplier && !fornecedorConfirmado && brutos.length > 0) {
      const sampleText = brutos.slice(0, 20).map(b => b.textoBruto || '').join('\n');
      const codes = brutos.slice(0, 20).map(b => String(b.campos.codigo || '')).filter(Boolean);
      const detection = detectSupplier(sampleText, [], codes, file.name);
      if (detection.confianca >= 20) {
        adapter = detection.adapter;
        fornecedorDetectado = detection.adapter.nome;
        console.log(`[Pipeline] Fornecedor detectado: ${detection.adapter.nome} (confiança: ${detection.confianca}%)`);
      }
    }
  } else {
    // Excel / CSV
    parserUsado = 'xlsx-direto';
    const spreadsheet = readSpreadsheet(fileData, tipoArquivo);
    headers = spreadsheet.headers;
    brutos = rowsToProdutosBrutos(spreadsheet.rows);

    // Tenta detecção automática do fornecedor pelos headers e dados apenas se o usuário não tiver forçado um
    const userSelectedSupplier = !!(options.supplierId || options.supplierName);
    if (!userSelectedSupplier && !fornecedorConfirmado && brutos.length > 0) {
      const sampleText = headers.join(' ') + ' ' +
        brutos.slice(0, 10).map(b => Object.values(b.campos).join(' ')).join('\n');
      const codes = brutos.slice(0, 20).map(b => {
        const vals = Object.values(b.campos).map(String);
        return vals.find(v => /^[A-Z]{2,4}\d{3,}/.test(v)) || '';
      }).filter(Boolean);

      const detection = detectSupplier(sampleText, headers, codes, file.name);
      if (detection.confianca >= 20) {
        adapter = detection.adapter;
        fornecedorDetectado = detection.adapter.nome;
        console.log(`[Pipeline] Fornecedor detectado: ${detection.adapter.nome} (confiança: ${detection.confianca}%)`);
      }
    }
  }

  console.log(`[Pipeline] ${brutos.length} registros brutos extraídos. Adapter: ${adapter.nome}`);

  // 4. Extração usando o adapter
  const extraidos = extractProducts(brutos, adapter, file.name);
  console.log(`[Pipeline] ${extraidos.length} produtos extraídos pelo adapter "${adapter.nome}"`);

  // Determinar o nome e ID finais a serem salvos no banco
  // Prioridade: Fornecedor que o usuário selecionou explícito > Confirmado por alias > Adapter detectado
  const finalSupplierName = options.supplierName || fornecedorConfirmado || fornecedorDetectado || adapter.nome;
  
  // Para IDs criados manualmente, usamos o que veio de fora. Para adapters fixos, não mandamos os UUIDs dummy para o banco, deixamos undefined para forçar salvamento apenas pelo nome.
  let finalSupplierId = options.supplierId;
  if (!finalSupplierId && adapter.id && adapter.id !== '00000000-0000-4000-a000-000000000000' && adapter.id !== 'c0000000-0000-4000-a000-000000000000') {
    finalSupplierId = adapter.id;
  }

  // 5. Normalização
  const normalizados = normalizeExtracted(extraidos, finalSupplierName, finalSupplierId);

  // 6. Deduplicação (opcional)
  let produtosFinais = normalizados;
  let duplicadosRemovidos = 0;
  if (options.deduplicate !== false) {
    const dedup = deduplicateByCodigo(produtosFinais);
    produtosFinais = dedup.unicos as ProdutoNormalizadoV2[];
    duplicadosRemovidos = dedup.totalRemovidos;
    if (duplicadosRemovidos > 0) {
      console.log(`[Pipeline] ${duplicadosRemovidos} duplicados removidos`);
    }
  }

  // 7. Detecção de inconsistências
  const inconsistencias = detectInconsistencies(produtosFinais);

  // 8. Estatísticas
  const stats = {
    total: produtosFinais.length,
    validos: produtosFinais.filter(p => p.status === 'validado').length,
    comErro: produtosFinais.filter(p => p.status === 'erro').length,
    comWarning: produtosFinais.filter(p => p.status === 'pendente').length,
    duplicados: duplicadosRemovidos,
  };

  // 9. Metadados da importação
  const endTime = performance.now();
  const metadata: ImportMetadata = {
    tipoArquivo,
    tipoPDF: partialMetadata.tipoPDF,
    parserUsado,
    totalPaginas: partialMetadata.totalPaginas,
    paginasComDados: partialMetadata.paginasComDados,
    confiancaExtracao: partialMetadata.confiancaExtracao ??
      (produtosFinais.length > 0
        ? Math.round(produtosFinais.reduce((s, p) => s + (p.confiancaExtracao || 0), 0) / produtosFinais.length)
        : 0),
    fornecedorDetectado,
    fornecedorConfirmado: fornecedorConfirmado || options.supplierName,
    camposDetectados: headers,
    tempoProcessamentoMs: Math.round(endTime - startTime),
  };

  console.log(`[Pipeline] Concluído em ${metadata.tempoProcessamentoMs}ms. Stats:`, stats);

  return {
    metadata,
    produtosBrutos: brutos,
    produtosExtraidos: extraidos,
    produtosNormalizados: produtosFinais,
    stats,
    inconsistencias,
  };
};
