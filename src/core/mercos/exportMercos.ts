// ===================================================================
// GERADOR DE XLSX NO PADRÃO MERCOS
// Schema fixo, colunas estáveis, ordem imutável.
// ===================================================================

import * as XLSX from 'xlsx';
import {
  ProdutoMercos,
  MERCOS_EXPORT_COLUMNS,
} from '../types/productPipeline';
import { validateMercosProduct } from './normalizeToMercos';

/** Larguras de coluna padrão para exportação Mercos */
const COLUMN_WIDTHS: Record<string, number> = {
  'Código do produto (recomendado)': 20,
  'Nome do produto (obrigatório)': 45,
  'Preço de Tabela (obrigatório)': 16,
  'Preço Mínimo (opcional)': 16,
  'IPI (opcional - não informar o símbolo %)': 14,
  'Substituição Tributária (opcional - não informar o símbolo %)': 18,
  'Comissão (opcional - não informar o símbolo %)': 14,
  'Informações adicionais (opcional - neste campo coloca-se qualquer detalhe extra do produto. Não aparece no pedido)': 60,
  'Unidade (opcional – exemplo: Kg para produtos em quilo, Cx para caixas)': 12,
  'Quantidade em estoque (opcional - preencha com um número maior ou igual a 0)': 16,
  'Múltiplo (opcional)': 12,
  'Peso bruto (em Kg) (até três casas decimais)': 16,
  'Tipo peso e dimensões (opcional - preencha 1 se as colunas Largura, Altura e Comprimento à direita se referirem à caixa master)': 18,
  'Largura da embalagem (em centímetros, com até 5 casas decimais - obrigatório se as colunas Altura e Comprimento também estiverem preenchidas)': 18,
  'Altura da embalagem (em centímetros, com até 5 casas decimais - obrigatório se as colunas Largura e Comprimento também estiverem preenchidas)': 18,
  'Comprimento da embalagem (em centímetros, com até 5 casas decimais - obrigatório se as colunas Largura e Altura também estiverem preenchidas)': 18,
  'Categoria principal (opcional - Máximo 50 caracteres)': 24,
  'Subcategoria nível 2 (opcional - Máximo 50 caracteres)': 24,
  'Subcategoria nível 3 (opcional - Máximo 50 caracteres)': 24,
  'Ativo / Inativo (opcional - preencha 0 para tornar o produto ativo ou 1 para tornar o produto inativo. Deixando vazio, o novo produto ficará ativo e numa alteração manterá o estado cadastrado no sistema)': 14,
  'Exibido / Não exibido no e-commerce (opcional - preencha 0 para passar a exibir ou 1 para ocultar o produto do e-commerce B2B. Deixando vazio, o novo produto será exibido e numa alteração manterá o estado cadastrado no sistema)': 16,
  'Tamanhos (opcional - tamanhos separados por ponto e vírgula)': 20,
  'Cores (opcional - cores separadas por ponto e vírgula)': 20,
};

export const validateMercosHeaderOrder = (headers: string[]): string[] => {
  const erros: string[] = [];

  if (headers.length !== MERCOS_EXPORT_COLUMNS.length) {
    erros.push(`Quantidade de colunas divergente: esperado ${MERCOS_EXPORT_COLUMNS.length}, recebido ${headers.length}`);
  }

  for (let i = 0; i < MERCOS_EXPORT_COLUMNS.length; i++) {
    const expected = MERCOS_EXPORT_COLUMNS[i];
    const received = headers[i];
    if (expected !== received) {
      erros.push(`Cabeçalho divergente na posição ${i + 1}: esperado "${expected}", recebido "${received || ''}"`);
    }
  }

  return erros;
};

/**
 * Gera um arquivo XLSX no formato exato Mercos.
 *
 * Regras:
 * - Colunas fixas conforme MERCOS_EXPORT_COLUMNS
 * - Ordem fixa (nunca muda)
 * - Nomes de coluna fixos (nunca muda)
 * - Valores numéricos formatados consistentemente
 * - Nenhuma coluna extra
 */
export const generateMercosXLSX = (
  produtos: ProdutoMercos[],
  options?: {
    fileName?: string;
    fornecedorNome?: string;
    download?: boolean;
  }
): { workbook: XLSX.WorkBook; fileName: string; validationErrors: string[] } => {

  // 1. Validação de todos os produtos
  const allErrors: string[] = [];
  for (let i = 0; i < produtos.length; i++) {
    const erros = validateMercosProduct(produtos[i]);
    if (erros.length > 0) {
      allErrors.push(`Linha ${i + 1}: ${erros.join(', ')}`);
    }
  }

  if (allErrors.length > 0) {
    console.warn('[Mercos Export] Produtos com erros de validação:', allErrors);
  }

  // 2. Monta array de objetos na ordem fixa
  const data = produtos.map(p => {
    const row: Record<string, any> = {};
    for (const col of MERCOS_EXPORT_COLUMNS) {
      row[col] = p[col as keyof ProdutoMercos] ?? '';
    }
    return row;
  });

  // 3. Cria worksheet com headers na ordem exata
  const worksheet = XLSX.utils.json_to_sheet(data, {
    header: [...MERCOS_EXPORT_COLUMNS],
  });

  // 3.1. Valida que o cabeçalho no worksheet ficou idêntico ao modelo
  const exportedHeaders = MERCOS_EXPORT_COLUMNS.map((_, idx) => {
    const cell = XLSX.utils.encode_cell({ c: idx, r: 0 });
    return String(worksheet[cell]?.v || '');
  });
  const headerErrors = validateMercosHeaderOrder(exportedHeaders);
  if (headerErrors.length > 0) {
    allErrors.push(...headerErrors);
  }

  // 4. Define larguras de colunas
  worksheet['!cols'] = MERCOS_EXPORT_COLUMNS.map(col => ({
    wch: COLUMN_WIDTHS[col] || 15,
  }));

  // 5. Cria workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Produtos Mercos');

  // 6. Gera nome do arquivo
  const date = new Date().toISOString().slice(0, 10);
  const fornecedor = options?.fornecedorNome || 'geral';
  const fileName = options?.fileName ||
    `export_mercos_${fornecedor.toLowerCase().replace(/\s+/g, '_')}_${date}.xlsx`;

  // 7. Download automático (se solicitado)
  if (options?.download !== false) {
    XLSX.writeFile(workbook, fileName);
  }

  return { workbook, fileName, validationErrors: allErrors };
};

/**
 * Gera um relatório de erros em XLSX para download.
 */
export const generateErrorReport = (
  inconsistencias: { tipo: string; mensagem: string; linha?: number; produto?: string; sugestao?: string }[]
): void => {
  const data = inconsistencias.map(i => ({
    'Tipo': i.tipo,
    'Mensagem': i.mensagem,
    'Linha': i.linha ?? '-',
    'Produto': i.produto ?? '-',
    'Sugestão': i.sugestao ?? '-',
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Erros');

  ws['!cols'] = [{ wch: 20 }, { wch: 50 }, { wch: 10 }, { wch: 20 }, { wch: 60 }];

  const fileName = `relatorio_erros_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, fileName);
};
