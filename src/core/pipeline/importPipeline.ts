// ===================================================================
// PIPELINE PRINCIPAL DE IMPORTAÇÃO
// Orquestra: detecção → leitura → extração → normalização → validação
// ===================================================================

import * as XLSX from 'xlsx-js-style';
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
// LEITURA DE EXCEL / CSV COM SUPORTE A CORES DE FONTE
// ===================================================================

interface SpreadsheetReadResult {
  headers: string[];
  rows: Record<string, any>[];
  rows2D: any[][];
  headerRowIndex: number;
  cellStyles?: Map<string, CellStyleInfo>; // Map de endereço (A1, B2) para estilo
}

export interface CellStyleInfo {
  fontColor?: string;        // Cor da fonte em formato RGB ou ARGB
  fontColorTheme?: number;   // Índice da cor do tema
  fontColorIndexed?: number; // Índice da cor indexada
  fillColor?: string;        // Cor de fundo
  bold?: boolean;
  italic?: boolean;
  address?: string;          // Endereço da célula (ex: A1, B2)
  row?: number;
  col?: number;
}

/**
 * Normaliza uma cor Excel para RGB
 * Aceita: RGB, ARGB, theme, indexed
 */
export function normalizeExcelFontColor(
  color: any,
  themeColors?: string[]
): { color: string; type: 'rgb' | 'theme' | 'indexed' | 'unknown'; original: any } {
  if (!color) {
    return { color: 'default', type: 'unknown', original: null };
  }

  // 1. RGB direto (FF0000 ou FFFF0000 com alpha)
  if (color.rgb) {
    const rgb = color.rgb;
    // Remove canal alpha se presente (primeiros 2 caracteres)
    const cleanRgb = rgb.length === 8 ? rgb.substring(2) : rgb;
    return { color: `#${cleanRgb}`, type: 'rgb', original: color };
  }

  // 2. Cor do tema
  if (color.theme !== undefined) {
    const themeIndex = color.theme;
    
    // Tentar resolver pelo tema do workbook primeiro
    if (themeColors && themeColors[themeIndex]) {
      const resolved = themeColors[themeIndex];
      console.log(`[FontColor] Tema ${themeIndex} resolvido via workbook: ${resolved}`);
      return { color: resolved, type: 'theme', original: color };
    }
    
    // Fallback para cores de tema padrão do Office
    // Ordem padrão: lt1(white), dk1(black), lt2, dk2, accent1-6, hlink, folHlink
    const defaultThemes = [
      '#FFFFFF', '#000000', '#E7E6E6', '#44546A',
      '#4472C4', '#ED7D31', '#A5A5A5', '#FFC000',
      '#5B9BD5', '#70AD47', '#0563C1', '#954F72'
    ];
    const resolved = defaultThemes[themeIndex] || '#000000';
    console.log(`[FontColor] Tema ${themeIndex} resolvido via default: ${resolved}`);
    return { color: resolved, type: 'theme', original: color };
  }

  // 3. Cor indexada (paleta do Excel)
  if (color.indexed !== undefined) {
    const indexedColors = [
      '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
      '#800000', '#008000', '#000080', '#808000', '#800080', '#008080', '#C0C0C0', '#808080',
      '#9999FF', '#993366', '#FFFFCC', '#CCFFFF', '#660066', '#FF8080', '#0066CC', '#CCCCFF',
      '#000080', '#FF00FF', '#FFFF00', '#00FFFF', '#800080', '#800000', '#008080', '#0000FF',
      '#00CCFF', '#CCFFFF', '#CCFFCC', '#FFFF99', '#99CCFF', '#FF99CC', '#CC99FF', '#FFCC99',
      '#3366FF', '#33CCCC', '#99CC00', '#FFCC00', '#FF9900', '#FF6600', '#666699', '#969696',
      '#003366', '#339966', '#003300', '#333300', '#993300', '#993366', '#333399', '#333333'
    ];
    return { color: indexedColors[color.indexed] || '#000000', type: 'indexed', original: color };
  }

  return { color: 'default', type: 'unknown', original: color };
}

/**
 * Detecta categoria visual baseado na cor da fonte
 * REGRA REAL DA FAMÍLIA CLINK:
 * - Vermelho = Promocional
 * - Azul = Preço Fixo
 * - Amarelo/Verde = Novidade/Reposição
 * - Preto/Padrão = Normal
 */
export function detectVisualCategoryFromFontColor(
  fontColor: string
): 'promocional' | 'preco-fixo' | 'novidade-reposicao' | 'padrao' {
  if (!fontColor || fontColor === 'default') return 'padrao';

  const color = fontColor.toUpperCase().replace('#', '');

  console.log(`[VisualRule] Analisando cor da fonte: ${fontColor} (normalizado: #${color})`);

  // Função auxiliar para converter hex para RGB
  const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
    const clean = hex.replace('#', '');
    if (clean.length !== 6) return null;
    return {
      r: parseInt(clean.substring(0, 2), 16),
      g: parseInt(clean.substring(2, 4), 16),
      b: parseInt(clean.substring(4, 6), 16),
    };
  };

  // Função para verificar se uma cor está próxima de outra (tolerância)
  const isColorNear = (target: string, tolerance: number = 80): boolean => {
    const targetRgb = hexToRgb(target);
    const colorRgb = hexToRgb(color);
    if (!targetRgb || !colorRgb) return false;

    const diffR = Math.abs(targetRgb.r - colorRgb.r);
    const diffG = Math.abs(targetRgb.g - colorRgb.g);
    const diffB = Math.abs(targetRgb.b - colorRgb.b);

    return diffR <= tolerance && diffG <= tolerance && diffB <= tolerance;
  };

  // 1. VERMELHO = Promocional
  // Vermelho puro: FF0000, tons de vermelho: altos R, baixos G e B
  const rgb = hexToRgb(color);
  if (rgb) {
    // Vermelho dominante: R > 150 e R > G + 50 e R > B + 50
    if (rgb.r > 150 && rgb.r > rgb.g + 50 && rgb.r > rgb.b + 50) {
      console.log(`[VisualRule] Cor identificada como VERMELHO (Promocional)`);
      return 'promocional';
    }

    // Azul dominante: B > 150 e B > R + 50 e B > G + 50
    if (rgb.b > 150 && rgb.b > rgb.r + 50 && rgb.b > rgb.g + 50) {
      console.log(`[VisualRule] Cor identificada como AZUL (Preço Fixo)`);
      return 'preco-fixo';
    }

    // Amarelo dominante: R > 150, G > 150, B < 100
    if (rgb.r > 150 && rgb.g > 150 && rgb.b < 100) {
      console.log(`[VisualRule] Cor identificada como AMARELO (Novidade/Reposição)`);
      return 'novidade-reposicao';
    }

    // Verde dominante: G > 150 e G > R + 30 e G > B + 30
    if (rgb.g > 150 && rgb.g > rgb.r + 30 && rgb.g > rgb.b + 30) {
      console.log(`[VisualRule] Cor identificada como VERDE (Novidade/Reposição)`);
      return 'novidade-reposicao';
    }
  }

  // Fallback por cores exatas comuns
  const redColors = ['FF0000', 'FF3333', 'FF4444', 'FF5555', 'FF6666', 'CC0000', 'DD0000', 'EE0000'];
  const blueColors = ['0000FF', '3333FF', '4444FF', '5555FF', '6666FF', '0066CC', '0000CC', '0000DD'];
  const yellowColors = ['FFFF00', 'FFFF33', 'FFFF44', 'FFCC00', 'FFDD00', 'FFEE00', 'CCCC00'];
  const greenColors = ['00FF00', '33FF33', '44FF44', '00CC00', '00DD00', '00EE00'];

  if (redColors.includes(color)) {
    console.log(`[VisualRule] Cor identificada como VERMELHO exato (Promocional)`);
    return 'promocional';
  }
  if (blueColors.includes(color)) {
    console.log(`[VisualRule] Cor identificada como AZUL exato (Preço Fixo)`);
    return 'preco-fixo';
  }
  if (yellowColors.includes(color) || greenColors.includes(color)) {
    console.log(`[VisualRule] Cor identificada como AMARELO/VERDE exato (Novidade/Reposição)`);
    return 'novidade-reposicao';
  }

  console.log(`[VisualRule] Cor não mapeada, usando Padrão`);
  return 'padrao';
}

/**
 * Extrai estilos de célula parseando o XML interno do arquivo .xlsx
 * Um .xlsx é um ZIP contendo XMLs:
 * - xl/styles.xml → contém definições de fontes (incluindo cores)
 * - xl/worksheets/sheet1.xml → contém referências de estilo por célula (atributo s="")
 * 
 * Esta abordagem é 100% confiável no browser (sem polyfills Node.js)
 */
async function extractCellStylesFromXML(fileData: ArrayBuffer): Promise<Map<string, CellStyleInfo>> {
  const styles = new Map<string, CellStyleInfo>();
  const JSZip = (await import('jszip')).default;

  try {
    console.log(`[CellStyles XML] Iniciando extração de cores via parsing XML direto...`);
    
    const zip = await JSZip.loadAsync(fileData);
    
    // 1. LER xl/styles.xml → extrair cores de fonte de cada <font>
    const stylesXmlFile = zip.file('xl/styles.xml');
    if (!stylesXmlFile) {
      console.warn('[CellStyles XML] xl/styles.xml não encontrado no arquivo');
      return styles;
    }
    
    const stylesXml = await stylesXmlFile.async('string');
    const parser = new DOMParser();
    const stylesDoc = parser.parseFromString(stylesXml, 'application/xml');
    
    // Extrair lista de fontes (<font> elements)
    const fontElements = stylesDoc.querySelectorAll('fonts > font');
    const fontColors: (string | null)[] = [];
    
    console.log(`[CellStyles XML] Encontradas ${fontElements.length} definições de fonte`);
    
    fontElements.forEach((fontEl, idx) => {
      const colorEl = fontEl.querySelector('color');
      let color: string | null = null;
      
      if (colorEl) {
        // Prioridade: rgb > indexed > theme
        const rgb = colorEl.getAttribute('rgb');
        const indexed = colorEl.getAttribute('indexed');
        const theme = colorEl.getAttribute('theme');
        
        if (rgb) {
          // RGB/ARGB: 'FFFF0000' → '#FF0000'
          const cleanRgb = rgb.length === 8 ? rgb.substring(2) : rgb;
          color = `#${cleanRgb}`;
        } else if (indexed) {
          const indexedColors = [
            '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
            '#800000', '#008000', '#000080', '#808000', '#800080', '#008080', '#C0C0C0', '#808080',
            '#9999FF', '#993366', '#FFFFCC', '#CCFFFF', '#660066', '#FF8080', '#0066CC', '#CCCCFF',
            '#000080', '#FF00FF', '#FFFF00', '#00FFFF', '#800080', '#800000', '#008080', '#0000FF',
            '#00CCFF', '#CCFFFF', '#CCFFCC', '#FFFF99', '#99CCFF', '#FF99CC', '#CC99FF', '#FFCC99',
            '#3366FF', '#33CCCC', '#99CC00', '#FFCC00', '#FF9900', '#FF6600', '#666699', '#969696',
            '#003366', '#339966', '#003300', '#333300', '#993300', '#993366', '#333399', '#333333'
          ];
          color = indexedColors[parseInt(indexed)] || '#000000';
        } else if (theme) {
          // Tentar ler cores do tema do arquivo
          const themeIndex = parseInt(theme);
          const tint = parseFloat(colorEl.getAttribute('tint') || '0');
          
          // Cores padrão do Office (lt1, dk1, lt2, dk2, accent1-6)
          const defaultThemeColors = [
            '#FFFFFF', '#000000', '#E7E6E6', '#44546A',
            '#4472C4', '#ED7D31', '#A5A5A5', '#FFC000',
            '#5B9BD5', '#70AD47', '#0563C1', '#954F72'
          ];
          color = defaultThemeColors[themeIndex] || '#000000';
          
          // Aplicar tint se existir (aproximação simplificada)
          if (tint !== 0 && color) {
            // Tint positivo = clarear, negativo = escurecer
            // Abordagem simplificada: ignorar tint para detecção de cor base
          }
        }
      }
      
      fontColors.push(color);
      
      if (color && color !== '#000000' && color !== '#FFFFFF') {
        console.log(`[CellStyles XML] Fonte #${idx}: cor=${color}`);
      }
    });
    
    // 2. LER <cellXfs> → mapeia estilo index → font index
    const cellXfElements = stylesDoc.querySelectorAll('cellXfs > xf');
    const styleToFont: number[] = [];
    
    cellXfElements.forEach((xfEl) => {
      const fontId = parseInt(xfEl.getAttribute('fontId') || '0');
      styleToFont.push(fontId);
    });
    
    console.log(`[CellStyles XML] Mapeados ${styleToFont.length} estilos de célula para fontes`);
    
    // 3. LER xl/worksheets/sheet1.xml → pegar o atributo s="" de cada <c> (célula)
    const sheetFile = zip.file('xl/worksheets/sheet1.xml');
    if (!sheetFile) {
      console.warn('[CellStyles XML] xl/worksheets/sheet1.xml não encontrado');
      return styles;
    }
    
    const sheetXml = await sheetFile.async('string');
    const sheetDoc = parser.parseFromString(sheetXml, 'application/xml');
    
    const cellElements = sheetDoc.querySelectorAll('sheetData > row > c');
    let specialColors = 0;
    
    cellElements.forEach((cellEl) => {
      const cellRef = cellEl.getAttribute('r'); // ex: "A1", "B2"
      const styleIdx = parseInt(cellEl.getAttribute('s') || '0');
      
      if (!cellRef) return;
      
      // Resolver: célula → estilo → fonte → cor
      const fontIdx = styleToFont[styleIdx] ?? 0;
      const fontColor = fontColors[fontIdx] ?? null;
      
      const match = cellRef.match(/([A-Z]+)(\d+)/);
      const row = match ? parseInt(match[2]) : 0;
      const col = match ? match[1].charCodeAt(0) - 65 : 0;
      
      const styleInfo: CellStyleInfo = {
        address: cellRef,
        row,
        col,
        fontColor: fontColor || undefined,
      };
      
      if (fontColor && fontColor !== '#000000' && fontColor !== '#FFFFFF') {
        specialColors++;
        if (specialColors <= 30) {
          console.log(`[CellStyles XML] Cor especial: ${cellRef} → fonte#${fontIdx} → ${fontColor}`);
        }
      }
      
      styles.set(cellRef, styleInfo);
    });
    
    console.log(`[CellStyles XML] ✅ Resumo: ${cellElements.length} células, ${specialColors} com cores especiais`);
    console.log(`[CellStyles XML] Mapa final: ${styles.size} entradas`);
    
  } catch (error) {
    console.error(`[CellStyles XML] ❌ Erro ao extrair estilos:`, error);
  }

  return styles;
}

/**
 * Converte linhas de planilha em ProdutoBruto[]
 */
const rowsToProdutosBrutos = (rows: Record<string, any>[]): ProdutoBruto[] => {
  return rows.map((row, idx) => ({
    campos: { ...row },
    linhaOrigem: idx,
  }));
};

/**
 * Lê um arquivo Excel ou CSV e retorna dados estruturados.
 * Reutiliza a lógica de detecção de header que já existia.
 * NOVO: Usa ExcelJS para extrair cores de fonte (SheetJS não lê estilos corretamente)
 */
const readSpreadsheet = async (data: ArrayBuffer, tipo: TipoArquivo): Promise<SpreadsheetReadResult> => {
  // Opções de leitura do SheetJS (para dados)
  const readOptions: XLSX.ParsingOptions = {
    type: 'array',
    cellNF: false,
    cellDates: true,
  };

  const workbook = XLSX.read(data, readOptions);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Extrair estilos de célula (cores de fonte) via parsing XML direto do .xlsx
  // JSZip + DOMParser: 100% confiável no browser
  console.log(`[ReadSpreadsheet] Extraindo cores de fonte via XML parsing...`);
  const cellStyles = await extractCellStylesFromXML(data);
  console.log(`[ReadSpreadsheet] Extraídos ${cellStyles.size} estilos via XML`);

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

  console.log(`[ReadSpreadsheet] Headers: ${headers.length}, Rows: ${rows.length}, Styles: ${cellStyles.size}`);

  return { headers, rows, rows2D, headerRowIndex, cellStyles };

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
    
    // NOVO: Preservar nome comercial da família CLINK se existir
    // Verificar se é um produto da família CLINK com nomeComercial
    const clinkProduct = e as any;
    let nome: string;
    
    if (clinkProduct.nomeComercial && clinkProduct.nomeComercial.trim()) {
      // Usar nome comercial já formatado (com sufixo ***PROMOCAO*** ou ***PRECO FIXO***)
      nome = sanitizeForExport(clinkProduct.nomeComercial);
      console.log(`[Normalize] Preservando nome comercial: ${codigo} = "${nome}"`);
    } else {
      // Fallback: limpar descrição normalmente
      nome = sanitizeForExport(cleanDescription(e.descricao || ''));
    }
    
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
      // CAMPOS VISUAIS (propagar da família CLINK)
      visualCategory: (e as any).visualCategory,
      isPromotional: (e as any).isPromotional,
      isFixedPrice: (e as any).isFixedPrice,
      bloqueiaDesconto: (e as any).bloqueiaDesconto,
      informacoesAdicionais: (e as any).informacoesAdicionais,
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
    const spreadsheet = await readSpreadsheet(fileData, tipoArquivo);
    headers = spreadsheet.headers;
    brutos = rowsToProdutosBrutos(spreadsheet.rows);

    // NOVO: Adicionar estilos de célula aos produtos brutos para classificação visual
    // Isso permite que adapters da família CLINK detectem cores de fonte
    if (spreadsheet.cellStyles && spreadsheet.cellStyles.size > 0) {
      console.log(`[Pipeline] Adicionando ${spreadsheet.cellStyles.size} estilos de célula aos produtos brutos`);
      brutos.forEach((bruto, idx) => {
        // Calcular linha real na planilha (considerando header)
        // headerRowIndex é 0-based no array, Excel é 1-based,
        // e os dados começam na linha DEPOIS do header (+2 = +1 para 1-based, +1 para pular header)
        const linhaReal = spreadsheet.headerRowIndex + idx + 2;
        bruto.campos.__cellStyles = spreadsheet.cellStyles;
        bruto.campos.__linhaReal = linhaReal;
        bruto.campos.__headerRowIndex = spreadsheet.headerRowIndex;
      });
    }

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
  // NOVO: Passar informações de estilo de célula para adapters da família CLINK
  const extraidos = extractProducts(brutos, adapter, file.name);
  console.log(`[Pipeline] ${extraidos.length} produtos extraídos pelo adapter "${adapter.nome}"`);

  // NOVO: Contagem de categorias visuais para métricas
  const visualCategories = {
    promocional: extraidos.filter(e => (e as any).visualCategory === 'promocional').length,
    precoFixo: extraidos.filter(e => (e as any).visualCategory === 'preco-fixo').length,
    novidadeReposicao: extraidos.filter(e => (e as any).visualCategory === 'novidade-reposicao').length,
    padrao: extraidos.filter(e => !(e as any).visualCategory || (e as any).visualCategory === 'padrao').length,
  };
  console.log(`[Pipeline] Categorias visuais detectadas:`, visualCategories);

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
  const metadata: ImportMetadata & { visualCategories?: typeof visualCategories } = {
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
    // NOVO: Métricas de categorização visual
    visualCategories,
  };

  console.log(`[Pipeline] Concluído em ${metadata.tempoProcessamentoMs}ms. Stats:`, stats);
  console.log(`[Pipeline] Total importado: ${stats.total} | Promocional: ${visualCategories.promocional} | Preço Fixo: ${visualCategories.precoFixo} | Novidade: ${visualCategories.novidadeReposicao} | Padrão: ${visualCategories.padrao}`);

  return {
    metadata,
    produtosBrutos: brutos,
    produtosExtraidos: extraidos,
    produtosNormalizados: produtosFinais,
    stats,
    inconsistencias,
  };
};
