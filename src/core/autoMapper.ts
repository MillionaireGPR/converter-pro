import { SupplierConfig } from './types';

// Função para remover acentos, espaços extras, converter pra minúsculo e remover caracteres não-alfabéticos
export const normalizeHeader = (header: string): string => {
  if (!header) return '';
  return header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") // mantem apenas letras e numeros
    .trim();
};

const COMMON_ALIASES: Record<string, string[]> = {
  codigo: ['codigo', 'cod', 'codfor', 'referencia', 'ref', 'sku', 'item', 'partnumber', 'ean'],
  nome: ['descricao', 'desc', 'produto', 'nome', 'descrcompl', 'description', 'nomedoproduto'],
  precoBase: ['preco', 'pvenda', 'valor', 'valorunitario', 'precodetabela', 'tabela', 'base', 'custo', 'netprice', 'precoliquido', 'vlr', 'vl'],
  ipi: ['ipi', 'percipi', 'aliquotaipi', 'ipitax', 'aliqipi'],
  quantidadeCaixa: ['qtdcaixa', 'caixa', 'qtcaixa', 'embalagemmaster', 'quantcx', 'cx', 'multiplo', 'emb', 'embalagem', 'moq', 'packingunit'],
  unidade: ['un', 'unidade', 'und', 'uom', 'unidademedida'],
  categoria: ['categoria', 'familia', 'linha', 'grupo', 'genero', 'productgroup'],
  descricaoComplementar: ['descricaocomplementar', 'obs', 'observacao', 'detalhes']
};

/**
 * Analisa as primeiras linhas de uma planilha bruta (2D array) e pontua
 * para descobrir qual a linha exata que contém o cabeçalho real.
 */
export const findHeaderRowIndex = (rawRows: any[][]): number => {
  let bestScore = -1;
  let bestIndex = 0;

  // Analisa no máximo as primeiras 20 linhas
  const maxRows = Math.min(rawRows.length, 20);

  // Palavras super-chave que praticamente garantem que é um header de tabela
  const headerKeywords = [
    'codigo', 'cod', 'codfor', 'sku', 'referencia', 'ean',
    'descricao', 'nome', 'produto', 'descrcompl', 'descr compl',
    'preco', 'valor', 'pvenda', 'p.venda', 'custo',
    'ipi', 'qtd', 'quantidade', 'caixa', 'qtdcaixa', 'unidade'
  ];

  for (let i = 0; i < maxRows; i++) {
    const row = rawRows[i];
    if (!row || !Array.isArray(row)) continue;

    // Filtra células preenchidas (strings com conteúdo real)
    const filledCells = row.filter(cell => cell && typeof cell === 'string' && cell.trim().length > 0);
    
    // Se a linha tem poucas células (< 3) ou é uma célula mesclada gigante (título visual), ignora
    if (filledCells.length < 3) continue;

    let rowScore = 0;
    
    // Pontua com base na quantidade de células preenchidas (tabelas reais tendem a ter colunas cheias)
    rowScore += filledCells.length;

    // Pontua match forte com nossos keywords operacionais
    for (const cell of filledCells) {
      const normCell = normalizeHeader(String(cell));
      if (headerKeywords.some(keyword => normCell.includes(normalizeHeader(keyword)))) {
        rowScore += 10;
      }
    }

    console.log(`[Auto-Mapper Parser] Candidata L${i + 1} | Células: ${filledCells.length} | Score: ${rowScore} | Preview:`, row.slice(0, 5));

    if (rowScore > bestScore) {
      bestScore = rowScore;
      bestIndex = i;
    }
  }

  return bestIndex;
};

/**
 * Mapeador Inteligente de Colunas
 * Recebe a lista de headers originais vindo da planilha
 * Retorna as configurações do fornecedor (SupplierConfig) com os aliases resolvidos
 */
export const detectColumnMapping = (
  headers: string[],
  supplierId: string,
  supplierName: string
): SupplierConfig => {
  const mapping: Record<string, string[]> = {
    codigo: [],
    nome: [],
    precoBase: [],
    ipi: [],
    quantidadeCaixa: [],
    unidade: [],
    categoria: [],
    descricaoComplementar: []
  };

  const normalizedHeaders = headers.map(h => ({
    original: h,
    norm: normalizeHeader(h)
  }));

  // Para cada campo esperado
  for (const [field, aliases] of Object.entries(COMMON_ALIASES)) {
    // 1. Tentar Match Exato Normalizado
    let matched = normalizedHeaders.find(h => aliases.includes(h.norm));
    
    // 2. Tentar Contains (se o cabeçalho tiver a palavra chave inteira)
    if (!matched) {
      matched = normalizedHeaders.find(h => 
        aliases.some(alias => h.norm.includes(alias) && alias.length > 2)
      );
    }

    if (matched) {
      mapping[field] = [matched.original];
    }
  }

  console.log(`[Auto-Mapper] Resultado da detecção automática para ${supplierName}:`, mapping);

  return {
    id: supplierId,
    name: supplierName,
    columnAliases: mapping as any
  };
};
