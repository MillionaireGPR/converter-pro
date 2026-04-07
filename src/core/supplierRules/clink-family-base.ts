// ===================================================================
// CLINK FAMILY BASE - Lógica compartilhada para CLINK, MOMENT e FLASH
// Regras visuais por COR DE FONTE, preços, múltiplos e classificação
// ===================================================================

import { ProdutoBruto, ProdutoExtraido } from '../types/productPipeline';
import { SupplierAdapter, FieldAliases, ExclusionRule } from './types';
import { extractPrice, detectStockStatus, cleanDescription, normalizeSpaces } from '../normalizers/cleaners';
import { CellStyleInfo, detectVisualCategoryFromFontColor } from '../pipeline/importPipeline';

// ===================================================================
// TIPOS ESTENDIDOS PARA FAMÍLIA CLINK
// ===================================================================

export type VisualCategory = 'promocional' | 'preco-fixo' | 'novidade-reposicao' | 'padrao';

export interface ClinkFamilyProduct extends ProdutoExtraido {
  visualCategory?: VisualCategory;
  visualColorRaw?: string;      // Cor bruta detectada
  visualColorNormalized?: string; // Cor normalizada
  isPromotional?: boolean;
  isFixedPrice?: boolean;
  bloqueiaDescontoExtra?: boolean; // NOVO: Preço fixo bloqueia desconto adicional
  descontoAutomatico?: number;
  multiplo?: number;
  priceSource?: 'preco' | 'precoEspecial' | 'precoFinal' | 'precoPromocional';
  precoBase?: number;
  precoEspecial?: number;
  precoFinal?: number;
  informacoesAdicionais?: string;
  // NOVO: Nome comercial para Mercos
  nomeComercial?: string;       // Nome com sufixo ***PROMOCAO*** ou ***PRECO FIXO***
  nomeBase?: string;            // Nome limpo sem sufixo
  sufixoComercial?: string | null; // Sufixo aplicado (se houver)
}

// ===================================================================
// REGEX PARA DETECÇÃO DE TEXTO (FALLBACK SECUNDÁRIO)
// ===================================================================

export const CLINK_FAMILY_REGEX = {
  // Múltiplo / Sub
  SUB_MULTIPLO: [
    /sub\s*[:\-\s]*(\d+)/i,
    /m[uú]ltiplo\s*[:\-\s]*(\d+)/i,
    /multiplo\s*[:\-\s]*(\d+)/i,
    /cx\s*c\/?\s*(\d+)/i,
    /caixa\s*com\s*(\d+)/i,
    /pacote\s*com\s*(\d+)/i,
  ],

  // Quantidade por Caixa
  QTD_CAIXA: [
    /cx\s*[:\-\s]*(\d+)/i,
    /qtd\s*caixa\s*[:\-\s]*(\d+)/i,
    /caixa\s*[:\-\s]*(\d+)/i,
    /(\d+)\s*un\s*por\s*cx/i,
    /(\d+)\s*unidades?\s*por\s*caixa/i,
    /embalagem\s*com\s*(\d+)/i,
  ],

  // IPI
  IPI: /(\d+(?:[.,]\d+)?)\s*%?/,

  // Código do fornecedor (padrões comuns)
  CODIGO_PADRAO: /^(?:CL|MO|FL|CK|MT|FS)[A-Z0-9]{2,10}$/i,
};

// ===================================================================
// ALIASES DE CAMPOS FORTES (compartilhados entre a família)
// ===================================================================

export const CLINK_FAMILY_FIELD_ALIASES: FieldAliases = {
  codigo: [
    'codigo', 'código', 'cod', 'codfor', 'cod for', 'cd', 'ref', 'referencia', 'referência',
    'cod referencia', 'cod. referencia', 'codref', 'sku', 'item', 'produto', 'id'
  ],
  codigoBarras: ['ean', 'codigobarras', 'código de barras', 'codbarras', 'cd barras', 'gtin'],
  codigoInterno: ['codinterno', 'cod interno', 'codigo interno', 'código interno', 'interno'],
  descricao: [
    'descricao', 'descrição', 'nome', 'produto', 'descr', 'desc', 'descr compl',
    'descricao complementar', 'descrição complementar', 'descrcompl', 'nome produto'
  ],
  descricaoComplementar: [
    'complemento', 'compl', 'descr compl', 'descrcompl', 'descricao compl',
    'observacao', 'observação', 'obs', 'detalhe', 'info adicional'
  ],
  preco: [
    'preco', 'preço', 'p.venda', 'p venda', 'pvenda', 'preco venda', 'preço venda',
    'valor', 'vlr', 'preco tabela', 'preço tabela', 'custo', 'preco base', 'preço base'
  ],
  precoPromocional: [
    'preco especial', 'preço especial', 'pespecial', 'p.especial', 'p especial',
    'preco final', 'preço final', 'pfinal', 'p.final', 'preco promocional', 'preço promocional'
  ],
  quantidadeCaixa: [
    'qtdcaixa', 'qtd caixa', 'quantidade caixa', 'qtde caixa', 'caixa', 'cx',
    'master', 'emb', 'embalagem', 'un cx', 'un por cx', 'unidades caixa'
  ],
  unidade: ['un', 'unidade', 'unid', 'und', 'tipo'],
  categoria: ['categoria', 'familia', 'família', 'linha', 'grupo', 'segmento', 'tipo'],
  ncm: ['ncm', 'cod ncm', 'codigo ncm', 'classificacao fiscal'],
  ipi: ['ipi', '% ipi', 'ipi %', 'aliquota ipi', 'imposto ipi'],
  observacoes: [
    'obs', 'observacao', 'observação', 'previsao', 'previsão', 'status',
    'info', 'informacao', 'informação', 'observacoes', 'observações'
  ],
};

// ===================================================================
// REGRAS DE EXCLUSÃO (ruído comum na família)
// ===================================================================

export const CLINK_FAMILY_EXCLUSION_RULES: ExclusionRule[] = [
  { pattern: /^total/i, descricao: 'Linha de total' },
  { pattern: /^subtotal/i, descricao: 'Linha de subtotal' },
  { pattern: /^\s*$/, descricao: 'Linha vazia' },
  { pattern: /tabela\s+de\s+pre[cç]os/i, descricao: 'Cabeçalho de tabela' },
  { pattern: /lista\s+de\s+pre[cç]os/i, descricao: 'Cabeçalho de lista' },
  { pattern: /cat[áa]logo\s+de\s+produtos/i, descricao: 'Cabeçalho de catálogo' },
  { pattern: /p[áa]gina\s*\d+/i, descricao: 'Rodapé de página' },
  { pattern: /^data\s*:/i, descricao: 'Linha de data' },
  { pattern: /^(de|para|atenciosamente|att|obs)/i, descricao: 'Texto administrativo' },
];

// ===================================================================
// FUNÇÕES DE DETECÇÃO VISUAL POR COR DE FONTE (REGRA REAL)
// ===================================================================

/**
 * Detecta categoria visual baseado na cor da fonte da célula
 * REGRA REAL DA FAMÍLIA CLINK:
 * - Vermelho = Promocional
 * - Azul = Preço Fixo
 * - Amarelo/Verde = Novidade/Reposição
 * - Preto/Padrão = Normal
 * 
 * @param cellStyles Map de estilos de célula do XLSX
 * @param linhaReal Número da linha na planilha (1-based)
 * @param colunaDescricao Índice da coluna de descrição (para buscar cor)
 * @param textoFallback Texto para fallback por regex (quando não há cor)
 */
export function detectVisualCategoryFromCell(
  cellStyles: Map<string, CellStyleInfo> | undefined,
  linhaReal: number,
  colunaDescricao: number = 1, // Coluna B geralmente é descrição
  textoFallback?: string
): { category: VisualCategory; colorRaw?: string; colorNormalized?: string; source: 'color' | 'fallback' } {
  
  console.log(`[VisualRule DEBUG] detectVisualCategoryFromCell chamado: linhaReal=${linhaReal}, colunaDescricao=${colunaDescricao}, cellStyles size=${cellStyles?.size || 0}`);
  
  // Tentar detectar por cor da fonte PRIMEIRO (regra real)
  if (cellStyles && cellStyles.size > 0) {
    // Buscar estilo da célula na coluna de descrição (geralmente onde a cor está)
    // Tentar várias colunas comuns: A (0), B (1), C (2)
    const colunasParaVerificar = [0, 1, 2, 3, 4]; // A, B, C, D, E
    
    console.log(`[VisualRule DEBUG] Verificando ${colunasParaVerificar.length} colunas na linha ${linhaReal}`);
    
    for (const col of colunasParaVerificar) {
      const cellAddress = `${String.fromCharCode(65 + col)}${linhaReal}`;
      const style = cellStyles.get(cellAddress);
      
      console.log(`[VisualRule DEBUG] Célula ${cellAddress}: style=${style ? 'encontrado' : 'não encontrado'}, fontColor=${style?.fontColor || 'n/a'}`);
      
      if (style && style.fontColor && style.fontColor !== 'default') {
        const category = detectVisualCategoryFromFontColor(style.fontColor);
        
        console.log(`[VisualRule] codigo=linha${linhaReal} rawColor=${style.fontColor} normalized=${style.fontColor} category=${category} source=color cell=${cellAddress}`);
        
        if (category !== 'padrao') {
          return {
            category,
            colorRaw: style.fontColor,
            colorNormalized: style.fontColor,
            source: 'color'
          };
        }
      }
    }
    
    console.log(`[VisualRule DEBUG] Nenhuma cor especial encontrada nas colunas A-E da linha ${linhaReal}`);
  } else {
    console.log(`[VisualRule DEBUG] cellStyles vazio ou undefined para linha ${linhaReal}`);
  }

  // FALLBACK: Se não achou por cor, tentar por texto (menos confiável)
  if (textoFallback) {
    const category = detectVisualCategoryFromTextFallback(textoFallback);
    if (category !== 'padrao') {
      console.log(`[VisualRule] codigo=linha${linhaReal} category=${category} source=fallback-text`);
      return { category, source: 'fallback' };
    }
  }

  return { category: 'padrao', source: 'fallback' };
}

/**
 * Detecta categoria visual por texto (FALLBACK SECUNDÁRIO)
 * Usado quando não é possível ler a cor da fonte
 */
function detectVisualCategoryFromTextFallback(texto: string): VisualCategory {
  if (!texto) return 'padrao';
  const textUpper = texto.toUpperCase();

  // 1. Verificar se é promocional por texto
  const promocionalPatterns = [
    /promo[cç][aã]o/i,
    /\*{2,}\s*promo[cç][aã]o\s*\*{2,}/i,
    /\*{3,}PROMO[cç][aã]O\*{3,}/i,
    /promo/i,
    /promo[cç][aã]o\s* especial/i,
  ];
  for (const pattern of promocionalPatterns) {
    if (pattern.test(texto)) return 'promocional';
  }

  // 2. Verificar se é preço fixo por texto
  const precoFixoPatterns = [
    /pre[cç]o\s*fixo/i,
    /fixo/i,
    /\*+\s*pre[cç]o\s*fixo\s*\*+/i,
    /\*{3,}PRE[cç]O\s*FIXO\*{3,}/i,
  ];
  for (const pattern of precoFixoPatterns) {
    if (pattern.test(texto)) return 'preco-fixo';
  }

  // 3. Verificar se é novidade/reposição por texto
  const novidadePatterns = [
    /novidade/i,
    /reposi[cç][aã]o/i,
    /lan[cç]amento/i,
    /new/i,
    /novo/i,
  ];
  for (const pattern of novidadePatterns) {
    if (pattern.test(texto)) return 'novidade-reposicao';
  }

  return 'padrao';
}

/**
 * Extrai múltiplo comercial de textos como "Sub 18", "Múltiplo 12"
 */
export function extractMultiplo(texto: string): number | undefined {
  if (!texto) return undefined;

  for (const pattern of CLINK_FAMILY_REGEX.SUB_MULTIPLO) {
    const match = texto.match(pattern);
    if (match && match[1]) {
      const valor = parseInt(match[1], 10);
      if (!isNaN(valor) && valor > 0) {
        return valor;
      }
    }
  }

  return undefined;
}

/**
 * Extrai quantidade por caixa de textos
 */
export function extractCaixa(texto: string): number | undefined {
  if (!texto) return undefined;

  for (const pattern of CLINK_FAMILY_REGEX.QTD_CAIXA) {
    const match = texto.match(pattern);
    if (match && match[1]) {
      const valor = parseInt(match[1], 10);
      if (!isNaN(valor) && valor > 0) {
        return valor;
      }
    }
  }

  return undefined;
}

/**
 * Extrai IPI de texto (remove símbolo %)
 */
export function extractIpi(texto: string): number | undefined {
  if (!texto) return undefined;

  const cleaned = texto.replace(/%/g, '').trim();
  const match = cleaned.match(/(\d+(?:[.,]\d+)?)/);

  if (match && match[1]) {
    const valor = parseFloat(match[1].replace(',', '.'));
    if (!isNaN(valor) && valor >= 0) {
      return valor;
    }
  }

  return undefined;
}

/**
 * Detecta tipo de preço e retorna prioridade
 */
export function detectPriceType(
  preco: number,
  precoEspecial?: number,
  precoFinal?: number,
  precoPromocional?: number,
  categoriaVisual?: VisualCategory
): { precoEfetivo: number; source: ClinkFamilyProduct['priceSource'] } {
  // Se for item promocional e tiver preço promocional explícito, usa ele
  if (categoriaVisual === 'promocional' && precoPromocional && precoPromocional > 0) {
    return { precoEfetivo: precoPromocional, source: 'precoPromocional' };
  }

  // Se tiver preço final explícito, usa ele
  if (precoFinal && precoFinal > 0) {
    return { precoEfetivo: precoFinal, source: 'precoFinal' };
  }

  // Se tiver preço especial
  if (precoEspecial && precoEspecial > 0) {
    return { precoEfetivo: precoEspecial, source: 'precoEspecial' };
  }

  // Padrão: preço base
  return { precoEfetivo: preco, source: 'preco' };
}

/**
 * Calcula desconto automático baseado na categoria visual
 * REGRAS DE NEGÓCIO CORRETAS:
 * - PROMOCIONAL: aplica 30% sobre a tabela, permite negociação adicional
 * - PREÇO FIXO: aplica 30% sobre a tabela, BLOQUEIA desconto adicional
 * - NOVIDADE: sem desconto automático
 * - PADRÃO: fluxo normal
 */
export function calcularDescontoAutomatico(
  categoriaVisual: VisualCategory,
  precoBase: number
): { 
  desconto: number; 
  bloqueiaDescontoExtra: boolean;
  motivo: string;
  precoCalculado: number;
} {
  
  switch (categoriaVisual) {
    case 'promocional':
      // Promocional: 30% desconto, permite negociação adicional
      return {
        desconto: 30,
        bloqueiaDescontoExtra: false,
        motivo: 'Item promocional (fonte vermelha) - 30% aplicado, permite negociação adicional',
        precoCalculado: +(precoBase * 0.7).toFixed(2) // 30% de desconto
      };

    case 'preco-fixo':
      // Preço Fixo: 30% desconto, BLOQUEIA desconto adicional
      return {
        desconto: 30,
        bloqueiaDescontoExtra: true, // BLOQUEIA desconto extra
        motivo: 'Item preço fixo (fonte azul) - 30% aplicado, desconto adicional bloqueado',
        precoCalculado: +(precoBase * 0.7).toFixed(2) // 30% de desconto
      };

    case 'novidade-reposicao':
      // Novidade: sem desconto automático
      return {
        desconto: 0,
        bloqueiaDescontoExtra: false,
        motivo: 'Item novidade/reposição (fonte amarela/verde) - sem desconto automático',
        precoCalculado: precoBase
      };

    case 'padrao':
    default:
      // Padrão: segue fluxo normal (pode aplicar desconto padrão do fornecedor depois)
      return {
        desconto: 0,
        bloqueiaDescontoExtra: false,
        motivo: 'Item padrão (fonte preta) - segue fluxo normal de desconto',
        precoCalculado: precoBase
      };
  }
}

/**
 * Monta campo "Informações Adicionais" no formato Mercos
 */
export function buildInformacoesAdicionais(
  quantidadeCaixa?: number,
  multiplo?: number,
  categoriaVisual?: VisualCategory,
  observacoes?: string,
  descontoInfo?: { desconto: number; bloqueiaDescontoExtra: boolean }
): string {
  const partes: string[] = [];

  // 1. Quantidade por caixa
  if (quantidadeCaixa && quantidadeCaixa > 0) {
    partes.push(`CX: ${quantidadeCaixa}`);
  }

  // 2. Múltiplo
  if (multiplo && multiplo > 0) {
    partes.push(`Múltiplo: ${multiplo}`);
  }

  // 3. Categoria visual e desconto
  if (categoriaVisual) {
    switch (categoriaVisual) {
      case 'promocional':
        partes.push('Promocional -30%');
        break;
      case 'preco-fixo':
        partes.push('Preço Fixo -30% (sem desc extra)');
        break;
      case 'novidade-reposicao':
        partes.push('Novidade');
        break;
    }
  }

  // 4. Observações curtas (limpar)
  if (observacoes) {
    const obsLimpa = observacoes
      .replace(/undefined|null|NaN/gi, '')
      .trim();
    if (obsLimpa && obsLimpa.length > 0 && obsLimpa.length < 50) {
      partes.push(obsLimpa);
    }
  }

  return partes.join(' | ');
}

// ===================================================================
// FUNÇÃO DE NOME COMERCIAL FINAL (REGRA REAL MERCOS)
// ===================================================================

const SUFIXO_PROMOCIONAL = '***PROMOCAO***';
const SUFIXO_PRECO_FIXO = '***PRECO FIXO***';

/**
 * Constrói o nome comercial final do produto com sufixo comercial
 * REGRA REAL:
 * - Promocional (vermelho) → adiciona " ***PROMOCAO***" no final
 * - Preço Fixo (azul) → adiciona " ***PRECO FIXO***" no final
 * - Novidade/Padrão → mantém nome base sem sufixo
 * 
 * Proteções:
 * - Não duplica sufixo se já existir
 * - Corrige sufixo se categoria mudar
 * - Sempre preserva nome base limpo
 */
export function buildCommercialProductName(
  nomeBase: string,
  visualCategory: VisualCategory,
  nomeOriginal?: string
): { nomeComercial: string; nomeBase: string; sufixoAplicado: string | null } {
  // Limpar nome base
  let nomeLimpo = nomeBase?.trim() || '';
  
  // Se vier nome original separado, usar ele como base
  if (nomeOriginal && nomeOriginal.trim()) {
    nomeLimpo = nomeOriginal.trim();
  }
  
  // Remover sufixos existentes para evitar duplicação
  // Regex para remover sufixos comerciais existentes (com ou sem espaço antes)
  nomeLimpo = nomeLimpo
    .replace(/\s*\*\*\*PROMOCAO\*\*\*$/i, '')
    .replace(/\s*\*\*\*PRECO FIXO\*\*\*$/i, '')
    .replace(/\s*\*\*\*PREÇO FIXO\*\*\*$/i, '')
    .trim();
  
  // Determinar sufixo baseado na categoria visual
  let sufixo: string | null = null;
  
  switch (visualCategory) {
    case 'promocional':
      sufixo = ` ${SUFIXO_PROMOCIONAL}`;
      break;
    case 'preco-fixo':
      sufixo = ` ${SUFIXO_PRECO_FIXO}`;
      break;
    case 'novidade-reposicao':
    case 'padrao':
    default:
      sufixo = null;
      break;
  }
  
  // Montar nome comercial final
  const nomeComercial = sufixo 
    ? `${nomeLimpo}${sufixo}` 
    : nomeLimpo;
  
  return {
    nomeComercial,
    nomeBase: nomeLimpo,
    sufixoAplicado: sufixo?.trim() || null
  };
}

/**
 * Verifica se um nome já tem sufixo comercial
 */
export function hasCommercialSuffix(nome: string): boolean {
  if (!nome) return false;
  const upper = nome.toUpperCase();
  return upper.includes(SUFIXO_PROMOCIONAL) || upper.includes(SUFIXO_PRECO_FIXO);
}

/**
 * Remove sufixo comercial de um nome (para obter nome base)
 */
export function removeCommercialSuffix(nome: string): string {
  if (!nome) return '';
  return nome
    .replace(/\s*\*\*\*PROMOCAO\*\*\*$/i, '')
    .replace(/\s*\*\*\*PRECO FIXO\*\*\*$/i, '')
    .replace(/\s*\*\*\*PREÇO FIXO\*\*\*$/i, '')
    .trim();
}

// ===================================================================
// FUNÇÃO DE EXTRAÇÃO ESPECÍFICA DA FAMÍLIA
// ===================================================================

/**
 * Extrator especializado para fornecedores da família CLINK
 * Aplica regras por COR DE FONTE da célula (regra real)
 */
export function extractClinkFamily(
  brutos: ProdutoBruto[],
  adapter: SupplierAdapter,
  nomeArquivo: string,
  fornecedorNome: string
): ClinkFamilyProduct[] {
  const produtos: ClinkFamilyProduct[] = [];
  const fa = CLINK_FAMILY_FIELD_ALIASES;

  console.log(`[ClinkFamily] Iniciando extração de ${brutos.length} produtos para ${fornecedorNome}`);

  // Contadores para métricas
  const contadores = {
    promocional: 0,
    precoFixo: 0,
    novidadeReposicao: 0,
    padrao: 0,
    byColor: 0,
    byFallback: 0
  };

  // Helper para buscar valores
  const norm = (s: string): string => {
    if (!s) return '';
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  };

  const findValue = (campos: Record<string, any>, aliases: string[]): any => {
    const keys = Object.keys(campos);
    for (const alias of aliases) {
      const normalizedAlias = norm(alias);
      const foundKey = keys.find(k => norm(k) === normalizedAlias);
      if (foundKey !== undefined && campos[foundKey] !== undefined && campos[foundKey] !== '') {
        return campos[foundKey];
      }
    }
    return undefined;
  };

  const toStr = (val: any): string => {
    if (val === null || val === undefined) return '';
    return normalizeSpaces(String(val));
  };

  const toNum = (val: any): number => {
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') return val;
    return extractPrice(String(val));
  };

  const shouldExclude = (campos: Record<string, any>): boolean => {
    const allText = Object.values(campos).filter(v => typeof v === 'string').join(' ');
    for (const rule of CLINK_FAMILY_EXCLUSION_RULES) {
      if (rule.pattern.test(allText)) return true;
    }
    return false;
  };

  for (let idx = 0; idx < brutos.length; idx++) {
    const bruto = brutos[idx];
    const campos = bruto.campos;

    if (shouldExclude(campos)) continue;

    const erros: string[] = [];
    const warnings: string[] = [];

    // === EXTRAÇÃO BÁSICA ===
    let codigo = toStr(findValue(campos, fa.codigo));
    let descricao = toStr(findValue(campos, fa.descricao));
    const descricaoComplementar = toStr(findValue(campos, fa.descricaoComplementar));
    const codigoBarras = toStr(findValue(campos, fa.codigoBarras));
    const categoria = toStr(findValue(campos, fa.categoria));
    const ncm = toStr(findValue(campos, fa.ncm));

    // === PREÇOS ===
    let precoBase = toNum(findValue(campos, fa.preco));
    const precoEspecial = toNum(findValue(campos, fa.precoPromocional));
    let precoFinal: number | undefined;
    let precoPromocional: number | undefined;

    const allValues = Object.values(campos).map(String).join(' ');

    // === DETECÇÃO VISUAL POR COR DE FONTE (REGRA REAL) ===
    const cellStyles = campos.__cellStyles as Map<string, CellStyleInfo> | undefined;
    const linhaReal = campos.__linhaReal as number | undefined;

    const visualDetection = detectVisualCategoryFromCell(
      cellStyles,
      linhaReal || (idx + 1),
      1, // Coluna de descrição
      `${descricao} ${descricaoComplementar}`
    );

    const visualCategory = visualDetection.category;
    
    // Atualizar contadores
    if (visualDetection.source === 'color') {
      contadores.byColor++;
    } else {
      contadores.byFallback++;
    }
    
    switch (visualCategory) {
      case 'promocional': contadores.promocional++; break;
      case 'preco-fixo': contadores.precoFixo++; break;
      case 'novidade-reposicao': contadores.novidadeReposicao++; break;
      default: contadores.padrao++;
    }

    // === EXTRAÇÃO DE MÚLTIPLO E CAIXA ===
    let multiplo = extractMultiplo(`${descricao} ${descricaoComplementar} ${allValues}`);
    let quantidadeCaixa = toNum(findValue(campos, fa.quantidadeCaixa));

    if (!quantidadeCaixa || quantidadeCaixa <= 0) {
      const qtdExtraida = extractCaixa(`${descricao} ${descricaoComplementar} ${allValues}`);
      if (qtdExtraida) {
        quantidadeCaixa = qtdExtraida;
      }
    }

    if (!quantidadeCaixa || quantidadeCaixa <= 0) {
      quantidadeCaixa = 1;
    }

    // === IPI ===
    let ipi = toNum(findValue(campos, fa.ipi));
    if (ipi <= 0) {
      const ipiExtraido = extractIpi(`${descricao} ${descricaoComplementar} ${allValues}`);
      if (ipiExtraido !== undefined) {
        ipi = ipiExtraido;
      }
    }

    // === REGRAS DE NEGÓCIO CORRETAS ===
    const descontoInfo = calcularDescontoAutomatico(visualCategory, precoBase);
    const descontoAutomatico = descontoInfo.desconto;
    const bloqueiaDescontoExtra = descontoInfo.bloqueiaDescontoExtra;
    const precoFinalCalculado = descontoInfo.precoCalculado;

    // Log de debug para cada item
    if (visualCategory !== 'padrao') {
      console.log(`[ClinkFamily] codigo=${codigo} categoria=${visualCategory} desconto=${descontoAutomatico}% bloqueiaExtra=${bloqueiaDescontoExtra} precoBase=${precoBase} precoFinal=${precoFinalCalculado}`);
    }

    // === INFORMAÇÕES ADICIONAIS ===
    const observacoes = toStr(findValue(campos, fa.observacoes));
    const informacoesAdicionais = buildInformacoesAdicionais(
      quantidadeCaixa,
      multiplo,
      visualCategory,
      observacoes,
      descontoInfo
    );

    // === STATUS DE ESTOQUE ===
    const statusEstoque = detectStockStatus(`${descricao} ${descricaoComplementar} ${allValues}`) as ProdutoExtraido['statusEstoque'];

    // === LIMPEZA DA DESCRIÇÃO BASE ===
    const descricaoLimpa = cleanDescription(descricao);

    // === NOME COMERCIAL FINAL (REGRA REAL MERCOS) ===
    // Aplicar ANTES de qualquer outra transformação para preservar o sufixo
    const nomeComercialResult = buildCommercialProductName(descricaoLimpa, visualCategory);
    const nomeComercial = nomeComercialResult.nomeComercial;
    const nomeBase = nomeComercialResult.nomeBase;
    const sufixoComercial = nomeComercialResult.sufixoAplicado;

    // Log de debug para nome comercial (apenas quando tem sufixo)
    if (sufixoComercial) {
      console.log(`[CommercialName] codigo=${codigo} category=${visualCategory} base="${nomeBase}" final="${nomeComercial}"`);
    }

    // === VALIDAÇÕES ===
    if (!codigo) erros.push('Código não encontrado');
    if (!descricao) erros.push('Descrição não encontrada');
    if (precoBase <= 0 && precoFinalCalculado <= 0) erros.push('Preço não encontrado ou inválido');
    if (descricao && descricao.length < 3) warnings.push('Descrição muito curta');

    // === CONFIANÇA ===
    let confianca = 100;
    if (!codigo) confianca -= 30;
    if (!descricao) confianca -= 30;
    if (precoBase <= 0 && precoFinalCalculado <= 0) confianca -= 20;
    if (warnings.length > 0) confianca -= warnings.length * 5;
    confianca = Math.max(0, confianca);

    produtos.push({
      fornecedor: fornecedorNome,
      codigo,
      codigoBarras,
      descricao: nomeComercial, // Nome comercial com sufixo para exibição/exportação
      descricaoComplementar,
      categoria,
      preco: precoFinalCalculado,
      precoBase,
      precoEspecial: precoEspecial > 0 ? precoEspecial : undefined,
      precoFinal: precoFinalCalculado !== precoBase ? precoFinalCalculado : undefined,
      precoPromocional,
      priceSource: descontoAutomatico > 0 ? 'precoFinal' : 'preco',
      unidade: 'UN',
      quantidadeCaixa,
      multiplo,
      ncm,
      ipi,
      statusEstoque,
      // NOVO: Classificação visual
      visualCategory,
      visualColorRaw: visualDetection.colorRaw,
      visualColorNormalized: visualDetection.colorNormalized,
      // NOVO: Flags de regras de negócio
      isPromotional: visualCategory === 'promocional',
      isFixedPrice: visualCategory === 'preco-fixo',
      bloqueiaDescontoExtra,
      descontoAutomatico,
      // NOVO: Nome comercial para Mercos
      nomeComercial,
      nomeBase,
      sufixoComercial,
      // Informações adicionais
      observacoes,
      informacoesAdicionais,
      origemArquivo: nomeArquivo,
      paginaOrigem: bruto.paginaOrigem,
      linhaOrigem: bruto.linhaOrigem,
      confiancaExtracao: confianca,
      erros,
      warnings,
    });
  }

  // Log final de métricas
  console.log(`[ClinkFamily] Extração concluída: ${produtos.length} produtos`);
  console.log(`[ClinkFamily] Categorias: Promocional=${contadores.promocional} PreçoFixo=${contadores.precoFixo} Novidade=${contadores.novidadeReposicao} Padrão=${contadores.padrao}`);
  console.log(`[ClinkFamily] Detecção: PorCor=${contadores.byColor} Fallback=${contadores.byFallback}`);

  return produtos;
}
