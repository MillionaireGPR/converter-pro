// ===================================================================
// ADAPTER: CLINK
// Padrão: Estrutura tabular com Código, Descrição, complemento,
// previsão, quantidade caixa, preço.
// Linhas quebradas de descrição. Múltiplas tabelas de preço.
// ===================================================================

import { SupplierAdapter } from './types';

export const clinkAdapter: SupplierAdapter = {
  id: 'c0000000-0000-4000-a000-000000000000', // UUID dummy válido para evitar erro de banco (supplier_id_fkey)
  nome: 'Clink',
  aliases: ['clink'],

  fieldAliases: {
    codigo: ['ref', 'referencia', 'codigo', 'cod', 'codfor', 'cd'],
    codigoBarras: ['ean', 'codigobarras', 'cdean'],
    descricao: ['nome', 'descricao', 'produto', 'descrcompl', 'descr compl', 'descricaocomplementar'],
    descricaoComplementar: ['complemento', 'compl', 'descr compl', 'descrcompl'],
    preco: ['pvenda', 'p.venda', 'preco', 'valor', 'custo', 'precoliquido', 'vlr'],
    precoPromocional: ['precoespecial', 'especial', 'pespecial', 'p.especial'],
    quantidadeCaixa: ['qtdcaixa', 'qtd caixa', 'caixa', 'cx', 'master', 'emb'],
    unidade: ['un', 'unidade'],
    categoria: ['categoria', 'familia', 'linha', 'grupo'],
    ncm: ['ncm'],
    ipi: ['ipi'],
    observacoes: ['obs', 'observacao', 'previsao', 'previsão', 'status'],
  },

  precoFormat: 'BR',
  defaultQuantidadeCaixa: 1,
  defaultUnidade: 'UN',

  exclusionRules: [
    { pattern: /^total/i, descricao: 'Linha de total' },
    { pattern: /^\s*$/, descricao: 'Linha vazia' },
    { pattern: /tabela\s+de\s+pre[cç]os/i, descricao: 'Cabeçalho de tabela' },
  ],

  detectionPatterns: [
    'CLINK',
    'Clink',
    /clink/i,
  ],

  hasMultiplePriceTables: true,
  priceTableLabels: ['Preço Especial', 'Preço Final', 'Tabela Padrão'],
};
