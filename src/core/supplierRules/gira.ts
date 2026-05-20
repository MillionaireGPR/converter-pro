// ===================================================================
// ADAPTER: GIRA IMPORT (Excel)
// Estrutura da planilha (Tabela GIRA 06 MAI 2026):
//   L1: TABELA PREÇOS _GIRA IMPORT
//   L2: Atualizado em <data>
//   L3: (vazia)
//   L4: HEADER → CÓDIGO | DESCRIÇÃO | QT CX | PREÇO
//   L5+: dados (GC0220 | GC0220 PORTA RETRATO... | 48 | 6,9)
// ===================================================================

import { SupplierAdapter } from './types';

export const giraAdapter: SupplierAdapter = {
  id: 'gira-import-0000-4000-a000-000000000000',
  nome: 'GIRA',
  aliases: ['gira', 'gira import', 'gira imports', 'giraimport', 'giraimports'],

  fieldAliases: {
    codigo: ['codigo', 'cod', 'cd', 'ref', 'referencia', 'sku'],
    descricao: ['descricao', 'desc', 'nome', 'produto'],
    preco: ['preco', 'precobase', 'valor', 'tabela', 'precotabela'],
    quantidadeCaixa: ['qtcx', 'qtdcx', 'qtcaixa', 'qtdcaixa', 'cx', 'caixa', 'quantcx', 'pcscx', 'pccx'],
    ncm: ['ncm'],
    ipi: ['ipi'],
  },

  precoFormat: 'BR',
  defaultQuantidadeCaixa: 1,
  defaultUnidade: 'UN',

  exclusionRules: [
    { pattern: /^total/i, descricao: 'Linha de total' },
    { pattern: /^\s*$/, descricao: 'Linha vazia' },
    { pattern: /tabela\s+pre[cç]os/i, descricao: 'Cabeçalho da tabela' },
    { pattern: /atualizado\s+em/i, descricao: 'Rodapé de atualização' },
  ],

  detectionPatterns: [
    /gira[\s_-]*import/i,
    /gira/i,
    /^GC\d{3,5}$/i,    // GC0220, GC0221...
    /^GU\d{3,5}$/i,    // GU0010...
    /^TP\d{3,5}$/i,    // TP1968...
    /^GRID\d{2,4}$/i,  // GRID033...
  ],
};
