// ===================================================================
// ADAPTER: FOLIA BRINQUEDOS (Excel)
// Estrutura da planilha (Tabela Folia 11-05-2026):
//   L1-L6: cabeçalho/título (vazias ou logo)
//   L4 cell G: data
//   L7: HEADER → REFERÊNCIA | DESCRIÇÃO | ITENS CX | TABELA | PROMO | EST. CX
//   L8+: dados (JRF-10.0063 | BLOCOS DE MONTAR | 36 | 9,9 | _ | 15)
// ===================================================================

import { SupplierAdapter } from './types';

export const foliaAdapter: SupplierAdapter = {
  id: 'folia-brinquedos-0000-4000-a000-000000000000',
  nome: 'FOLIA',
  aliases: ['folia', 'folia brinquedos', 'foliabrinquedos', 'folia toys'],

  fieldAliases: {
    codigo: ['referencia', 'ref', 'codigo', 'cod', 'sku'],
    descricao: ['descricao', 'desc', 'nome', 'produto'],
    preco: ['tabela', 'preco', 'precotabela', 'valor'],
    precoPromocional: ['promo', 'promocional', 'precopromocional', 'especial'],
    quantidadeCaixa: ['itenscx', 'itenscaixa', 'qtcx', 'qtdcx', 'caixa', 'cx', 'pcscx'],
    observacoes: ['estcx', 'estoquecx', 'estoque'],
  },

  precoFormat: 'BR',
  defaultQuantidadeCaixa: 1,
  defaultUnidade: 'UN',

  exclusionRules: [
    { pattern: /^total/i, descricao: 'Linha de total' },
    { pattern: /^\s*$/, descricao: 'Linha vazia' },
  ],

  detectionPatterns: [
    /folia/i,
    /^JRF[-_]/i,        // JRF-10.0063
    /^FB\d{3,5}$/i,     // Folia Brinquedos
    /brinquedos/i,
  ],
};
