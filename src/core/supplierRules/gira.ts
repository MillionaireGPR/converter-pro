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
    // Headers se repetem a cada ~54 linhas no catálogo real (rows 52, 107, etc).
    // Sem esta regra, ~8 produtos com codigo="CÓDIGO" eram criados.
    { pattern: /^c[oó]digo$/i, descricao: 'Header repetido em linha de dados' },
  ],

  detectionPatterns: [
    /gira[\s_-]*import/i,
    /gira/i,
    // Sufixo letra opcional aceita variantes (GU0091A/B/C/D, TP1008A).
    // Sem o [A-Z]?, 5 produtos eram silenciosamente descartados.
    /^GC\d{3,5}[A-Z]?$/i,    // GC0220, GC0221, GC0220A...
    /^GU\d{3,5}[A-Z]?$/i,    // GU0010, GU0091A, GU0091B...
    /^TP\d{3,5}[A-Z]?$/i,    // TP1968, TP1008A...
    /^GRID\d{2,4}[A-Z]?$/i,  // GRID033...
  ],
};
