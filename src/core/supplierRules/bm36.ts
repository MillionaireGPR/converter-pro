// ===================================================================
// ADAPTER: BM36 / WORLD CLASSIC / BeLLE / GARRAFA & CIA
// Padrão: Descrição, CD EAN, CD interno, CX, valores Bxxxx
// ===================================================================

import { SupplierAdapter } from './types';

export const bm36Adapter: SupplierAdapter = {
  id: 'bm36',
  nome: 'BM36',
  aliases: ['bm36', 'worldclassic', 'world classic', 'belle', 'garrafa', 'garrafa e cia', 'garrafa & cia'],

  fieldAliases: {
    codigo: ['codigo', 'cod', 'cdintern', 'codinterno', 'ref', 'referencia', 'cd'],
    codigoBarras: ['cdean', 'ean', 'codigobarras', 'gtin'],
    codigoInterno: ['cdintern', 'codinterno', 'codigointerno'],
    descricao: ['descricao', 'desc', 'produto', 'nome', 'item', 'description'],
    preco: ['preco', 'valor', 'pvenda', 'vlr', 'precounitario'],
    quantidadeCaixa: ['cx', 'caixa', 'qtdcaixa', 'emb', 'pccx'],
    unidade: ['un', 'unidade'],
    categoria: ['categoria', 'linha', 'familia', 'grupo'],
    ncm: ['ncm'],
    ipi: ['ipi'],
    observacoes: ['obs', 'observacao'],
  },

  codigoPattern: /^B\d{3,5}/i,
  precoFormat: 'BR',
  defaultQuantidadeCaixa: 1,
  defaultUnidade: 'UN',

  exclusionRules: [
    { pattern: /^total/i, descricao: 'Linha de total' },
    { pattern: /tabela\s+de\s+pre[cç]os/i, descricao: 'Cabeçalho de tabela' },
  ],

  detectionPatterns: [
    'BM36',
    'WORLD CLASSIC',
    'BeLLE',
    'GARRAFA',
    /\bB\d{4,5}\b/,
  ],
};
