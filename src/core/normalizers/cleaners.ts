// ===================================================================
// UTILITÁRIOS DE LIMPEZA E PÓS-PROCESSAMENTO
// Funções puras para higienizar dados extraídos de planilhas e PDFs
// ===================================================================

/** Remove espaços extras, quebras de linha excessivas e tabs */
export const normalizeSpaces = (text: string): string => {
  if (!text) return '';
  return text.replace(/[\t\r]+/g, ' ').replace(/\n{2,}/g, '\n').replace(/ {2,}/g, ' ').trim();
};

/** Remove textos de ruído comuns em catálogos (cabeçalhos, rodapés, etc.) */
const NOISE_PATTERNS = [
  /atualizado\s+em\s*[:\-]?\s*\d{2}[\/\-]\d{2}[\/\-]\d{2,4}/gi,
  /p[aá]gina\s*\d+/gi,
  /cat[aá]logo\s+\d{4}/gi,
  /sugest[aã]o\s+de\s+conjunto/gi,
  /produ[cç][aã]o\s*$/gi,
  /edi[cç][aã]o\s+\d{4}/gi,
  /tabela\s+de\s+pre[cç]os?/gi,
  /todos\s+os\s+direitos\s+reservados/gi,
  /www\.\S+/gi,
  /^\s*SUB\s*$/gim,
];

export const removeNoise = (text: string): string => {
  if (!text) return '';
  let cleaned = text;
  for (const pattern of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return normalizeSpaces(cleaned);
};

/** Corrige "R$ " quebrado: "R$ 1.234,56" ou "R$\n1234,56" → número */
export const extractPrice = (text: string): number => {
  if (!text) return 0;
  if (typeof text === 'number') return text;

  const str = String(text).trim();

  // Remove "R$" e espaços
  let cleaned = str.replace(/R\$\s*/gi, '').trim();

  // Se ficou vazio ou apenas símbolos
  if (!cleaned || /^[^\d]+$/.test(cleaned)) return 0;

  // Remove caracteres não-numéricos exceto . , -
  cleaned = cleaned.replace(/[^\d.,-]/g, '');

  if (!cleaned) return 0;

  // Decide formato BR vs US
  if (cleaned.includes(',') && cleaned.includes('.')) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.round(num * 100) / 100;
};

/** Converte vírgula decimal corretamente para número */
export const parseDecimalBR = (val: any): number => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  return extractPrice(String(val));
};

/** Extrai NCM separando do IPI se vieram juntos */
export const separateNCMAndIPI = (text: string): { ncm: string; ipi: number } => {
  if (!text) return { ncm: '', ipi: 0 };
  const str = String(text).trim();

  // Primeiro: verifica se é só NCM (formato ####.##.## sem IPI)
  if (/^\d{4}(?:\.\d{2}){0,2}$/.test(str)) {
    return { ncm: str, ipi: 0 };
  }

  // Padrão combinado: "8516.10.00 / 15%" ou "8516.10.00 IPI 15%"
  const match = str.match(/^(\d{4}(?:\.\d{2}){0,2})\s*[\/\-]\s*(?:IPI\s*)?(\d+(?:[.,]\d+)?)\s*%?\s*$/i);
  if (match) {
    return {
      ncm: match[1].trim(),
      ipi: parseDecimalBR(match[2]),
    };
  }

  // Padrão com "IPI" explícito: "8516.10.00 IPI 15%"
  const matchIPI = str.match(/^(\d{4}(?:\.\d{2}){0,2})\s+IPI\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/i);
  if (matchIPI) {
    return {
      ncm: matchIPI[1].trim(),
      ipi: parseDecimalBR(matchIPI[2]),
    };
  }

  return { ncm: str, ipi: 0 };
};

/** Captura medidas em cm, mm, ml, L, g, kg */
export const extractMeasurements = (text: string): string => {
  if (!text) return '';
  const matches = text.match(/\d+(?:[.,]\d+)?\s*(?:cm|mm|m|ml|l|g|kg|")\b/gi);
  if (!matches) return '';
  return matches.join(' x ').replace(/\s+x\s+x\s+/g, ' x ');
};

/** Detecta status de estoque no texto */
export const detectStockStatus = (text: string): string | undefined => {
  if (!text) return undefined;
  const upper = text.toUpperCase();
  if (upper.includes('ESGOTADO') || upper.includes('SEM ESTOQUE')) return 'esgotado';
  if (upper.includes('PRONTA ENTREGA') || upper.includes('PRONTA-ENTREGA')) return 'pronta-entrega';
  if (upper.includes('REPOSIÇÃO') || upper.includes('REPOSICAO')) return 'reposicao';
  if (upper.includes('PREVISÃO') || upper.includes('PREVISAO')) return 'previsao';
  return undefined;
};

/** Verifica se um texto parece ser "lixo técnico" e não descrição de produto */
const JUNK_INDICATORS = [
  /^\d{13,}$/,                    // Código de barras solto
  /^R?\$\s*\d/,                   // Preço solto
  /^\d+[.,]\d{2}$/,              // Número decimal solto
  /^(un|cx|pç|jg|kg|l|ml)$/i,   // Unidade solta
  /^(ipi|ncm|ean|sku)$/i,       // Label solta
  /^\d{1,3}%$/,                   // Percentual solto
];

export const isJunkText = (text: string): boolean => {
  if (!text || text.trim().length < 2) return true;
  const trimmed = text.trim();
  return JUNK_INDICATORS.some(pattern => pattern.test(trimmed));
};

/** Limpa descrição removendo lixo técnico mas mantendo informação útil */
export const cleanDescription = (text: string): string => {
  if (!text) return '';
  let cleaned = removeNoise(text);
  // Remove status de estoque da descrição (será campo separado)
  cleaned = cleaned.replace(/\b(ESGOTADO|PRONTA ENTREGA|REPOSIÇÃO|PREVISÃO)\b/gi, '');
  return normalizeSpaces(cleaned);
};

/** Remove símbolos inválidos para exportação */
export const sanitizeForExport = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Caracteres de controle
    .replace(/[\u201C\u201D\u201E]/g, '"')    // Aspas inteligentes → normais
    .replace(/[\u2018\u2019\u201A]/g, "'")    // Aspas inteligentes → normais
    .replace(/[\u2013\u2014]/g, '-')          // Travessões → hífen
    .trim();
};

// ===================================================================
// DEDUPLICAÇÃO
// ===================================================================

export interface DeduplicationResult<T> {
  unicos: T[];
  duplicados: T[];
  totalRemovidos: number;
}

/** Deduplica produtos por código */
export function deduplicateByCodigo<T extends { codigo?: string }>(
  items: T[]
): DeduplicationResult<T> {
  const seen = new Map<string, T>();
  const duplicados: T[] = [];

  for (const item of items) {
    const key = (item.codigo || '').trim().toUpperCase();
    if (!key) {
      // Sem código: mantém (será tratado como erro na validação)
      seen.set(`__nocode_${seen.size}`, item);
      continue;
    }
    if (seen.has(key)) {
      duplicados.push(item);
    } else {
      seen.set(key, item);
    }
  }

  return {
    unicos: Array.from(seen.values()),
    duplicados,
    totalRemovidos: duplicados.length,
  };
}

/** Deduplica por código + descrição (mais restrito) */
export function deduplicateByCodigoDescricao<T extends { codigo?: string; descricao?: string; nome?: string }>(
  items: T[]
): DeduplicationResult<T> {
  const seen = new Map<string, T>();
  const duplicados: T[] = [];

  for (const item of items) {
    const cod = (item.codigo || '').trim().toUpperCase();
    const desc = ((item as any).descricao || (item as any).nome || '').trim().toUpperCase().slice(0, 50);
    const key = `${cod}||${desc}`;

    if (cod && seen.has(key)) {
      duplicados.push(item);
    } else {
      seen.set(key, item);
    }
  }

  return {
    unicos: Array.from(seen.values()),
    duplicados,
    totalRemovidos: duplicados.length,
  };
}
