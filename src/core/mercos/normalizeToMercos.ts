// ===================================================================
// NORMALIZAÇÃO PARA O PADRÃO MERCOS
// Transforma ProdutoNormalizadoV2 → ProdutoMercos (formato final)
// ===================================================================

import {
  ProdutoNormalizadoV2,
  ProdutoMercos,
  MERCOS_EXPORT_SCHEMA,
  MERCOS_EXPORT_COLUMNS,
  MERCOS_ALLOWED_FILLED_COLUMNS,
} from '../types/productPipeline';
import { sanitizeForExport, normalizeSpaces } from '../normalizers/cleaners';

/**
 * Monta o campo "Informações adicionais" do Mercos.
 * Prioridade:
 * 1) quantidade por caixa
 * 2) embalagem
 * 3) medida/volume
 * 4) material/cor
 *
 * Regras:
 * - evita duplicatas
 * - ignora campos vazios
 * - não repete nome do produto
 * - concatena com " | "
 */
export const buildInformacoesAdicionais = (p: ProdutoNormalizadoV2): string => {
  const parts: string[] = [];
  const seen = new Set<string>();

  const pushUnique = (raw: string | undefined) => {
    const value = sanitizeForExport(normalizeSpaces(raw || ''));
    if (!value) return;
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) return;
    if ((p.nome || '').toLowerCase().includes(normalized)) return;
    seen.add(normalized);
    parts.push(value);
  };

  if (p.quantidadeCaixa && p.quantidadeCaixa > 1) {
    pushUnique(`Cx c/ ${p.quantidadeCaixa} unidades`);
  }

  pushUnique(p.embalagem);
  pushUnique(p.dimensoes);
  pushUnique(p.volume);
  pushUnique(p.material);
  pushUnique(p.cor);
  pushUnique(p.observacoes);
  pushUnique(p.descricaoComplementar);

  return sanitizeForExport(normalizeSpaces(parts.join(' | ')));
};

/**
 * Formata preço para número consistente (2 casas decimais, sem NaN)
 */
const formatDecimal = (val: number | undefined, precision = 2): number => {
  if (val === undefined || val === null || isNaN(val)) return 0;
  const factor = 10 ** precision;
  return Math.round(val * factor) / factor;
};

const createEmptyMercosRow = (): ProdutoMercos => {
  const row: ProdutoMercos = {};
  for (const col of MERCOS_EXPORT_COLUMNS) row[col] = '';
  return row;
};

/**
 * Transforma um produto normalizado no formato exato Mercos.
 *
 * Regras:
 * - Nunca exportar colunas aleatórias
 * - Nunca mudar nome de coluna dinamicamente
 * - Manter ordem fixa de colunas (MERCOS_EXPORT_COLUMNS)
 * - Valores numéricos em formato consistente
 * - Remover símbolos inválidos
 * - Preço sempre numérico
 * - quantidadeCaixa não pode invadir descrição
 * - Complementos vão para observações
 * - Se faltar código ou descrição → item inválido
 */
export const normalizeToMercos = (p: ProdutoNormalizadoV2): ProdutoMercos => {
  const row = createEmptyMercosRow();

  row['Código do produto (recomendado)'] = sanitizeForExport(p.codigo || p.codigoOriginal || '');
  row['Nome do produto (obrigatório)'] = sanitizeForExport(normalizeSpaces(p.nome || ''));
  row['Preço de Tabela (obrigatório)'] = formatDecimal(p.precoFinal > 0 ? p.precoFinal : p.precoBase, 2);
  row['IPI (opcional - não informar o símbolo %)'] =
    p.ipi !== undefined && p.ipi !== null && p.ipi > 0 ? formatDecimal(p.ipi, 2) : '';
  row['Informações adicionais (opcional - neste campo coloca-se qualquer detalhe extra do produto. Não aparece no pedido)'] =
    buildInformacoesAdicionais(p);

  return row;
};

/**
 * Transforma uma lista de produtos normalizados para o formato Mercos.
 * Filtra items inválidos opcionalmente.
 */
export const batchNormalizeToMercos = (
  produtos: ProdutoNormalizadoV2[],
  options?: { incluirInvalidos?: boolean; incluirEsgotados?: boolean }
): { validos: ProdutoMercos[]; invalidos: ProdutoNormalizadoV2[]; total: number } => {
  const validos: ProdutoMercos[] = [];
  const invalidos: ProdutoNormalizadoV2[] = [];

  for (const p of produtos) {
    const codigo = String(p.codigo || p.codigoOriginal || '').trim();
    const nome = String(p.nome || '').trim();
    const preco = p.precoFinal > 0 ? p.precoFinal : p.precoBase;

    // Validação de campos obrigatórios
    const isMissingRequired = !codigo || !nome;
    const isMissingPrice = preco <= 0;
    const isEsgotado = p.statusEstoque === 'esgotado';

    if (isMissingRequired) {
      invalidos.push(p);
      continue;
    }

    if (isMissingPrice && !options?.incluirInvalidos) {
      invalidos.push(p);
      continue;
    }

    if (isEsgotado && !options?.incluirEsgotados) {
      invalidos.push(p);
      continue;
    }

    validos.push(normalizeToMercos(p));
  }

  return { validos, invalidos, total: produtos.length };
};

/**
 * Valida que um objeto ProdutoMercos segue o schema esperado.
 * Retorna lista de erros (vazia se tudo ok).
 */
export const validateMercosProduct = (p: ProdutoMercos): string[] => {
  const erros: string[] = [];

  for (const col of MERCOS_EXPORT_SCHEMA.requiredFilled) {
    const val = p[col];
    if (val === undefined || val === null || val === '') {
      erros.push(`Campo obrigatório "${col}" está vazio`);
    }
  }

  for (const col of MERCOS_EXPORT_SCHEMA.numericFilled) {
    const val = p[col];
    if (val !== undefined && val !== null && val !== '' && typeof val !== 'number') {
      erros.push(`Campo "${col}" deve ser numérico, recebeu: ${typeof val}`);
    }
  }

  for (const col of MERCOS_EXPORT_COLUMNS) {
    if (!MERCOS_ALLOWED_FILLED_COLUMNS.includes(col as (typeof MERCOS_ALLOWED_FILLED_COLUMNS)[number])) {
      const val = p[col];
      if (val !== undefined && val !== null && val !== '') {
        erros.push(`Coluna não permitida nesta fase foi preenchida: "${col}"`);
      }
    }
  }

  return erros;
};

/**
 * Retorna os nomes de coluna na ordem fixa para geração de XLSX.
 */
export const getMercosColumnOrder = (): readonly string[] => {
  return MERCOS_EXPORT_COLUMNS;
};
