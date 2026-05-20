// ===================================================================
// ADAPTER: DAGIA (Excel/CSV)
// Prefixos de código observados: DXP, DXPD, DZ, DPB, D + variantes
// ===================================================================

import { SupplierAdapter } from './types';

export const dagiaAdapter: SupplierAdapter = {
  id: 'dagia-0000-0000-4000-a000-000000000000',
  nome: 'DAGIA',
  aliases: ['dagia', 'dagio'],

  fieldAliases: {
    codigo: ['codigo', 'cod', 'referencia', 'ref', 'sku', 'item'],
    descricao: ['descricao', 'desc', 'nome', 'produto'],
    preco: ['preco', 'valor', 'tabela', 'precotabela'],
    precoPromocional: ['promo', 'promocional', 'oferta', 'especial'],
    quantidadeCaixa: ['cx', 'caixa', 'qtcx', 'qtdcx', 'qtcaixa', 'qtdcaixa', 'itenscx', 'pcscx'],
    ncm: ['ncm'],
    ipi: ['ipi'],
  },

  precoFormat: 'BR',
  defaultQuantidadeCaixa: 1,
  defaultUnidade: 'UN',

  exclusionRules: [
    { pattern: /^total/i, descricao: 'Linha de total' },
    { pattern: /^\s*$/, descricao: 'Linha vazia' },
  ],

  detectionPatterns: [
    /dagia/i,
    /dagio/i,
    /^DXP\d+/i,         // DXP25
    /^DXPD\d+/i,        // DXPD53
    /^DZ\d+/i,          // DZ04
    /^DPB\d+/i,         // DPB01
  ],
};
