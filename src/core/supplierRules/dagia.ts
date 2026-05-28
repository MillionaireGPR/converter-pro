// ===================================================================
// ADAPTER: DAGIA (PDF / Excel / CSV)
// Prefixos de código observados (catálogo real 25-03-2026):
//   Principais: DXP, DXPD, DZ, DPB
//   Outras famílias: DCM, DS, DM, DV, LHSP, LX, CF*/L12
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
    // Catálogo PDF expressa quantidade como "CX C/12Jgs", "CX C/8Pçs" etc.
    // O parser captura "CX C/N" via padrão dedicado (não via alias Excel).
    quantidadeCaixa: ['cx', 'caixa', 'qtcx', 'qtdcx', 'qtcaixa', 'qtdcaixa', 'itenscx', 'pcscx', 'cxc'],
    ncm: ['ncm'],
    ipi: ['ipi'],
  },

  precoFormat: 'BR',
  defaultQuantidadeCaixa: 1,
  defaultUnidade: 'UN',

  exclusionRules: [
    { pattern: /^total/i, descricao: 'Linha de total' },
    { pattern: /^\s*$/, descricao: 'Linha vazia' },
    // Catálogo real tem 5 SKUs (DXPD51-55) marcados como "EM BREVE..."
    // sem preço. Não excluir o produto — deixar passar para o usuário ver.
    // (Removido `em breve` da exclusionRules para preservar visibilidade.)
  ],

  detectionPatterns: [
    /dagia/i,
    /dagio/i,
    // Famílias principais (validadas em catálogo real)
    /^DXP\d+/i,         // DXP25
    /^DXPD\d+/i,        // DXPD53
    /^DZ\d+/i,          // DZ04
    /^DPB\d+/i,         // DPB01
    // Famílias secundárias descobertas em catálogo 25-03-2026
    /^DCM\d+/i,         // DCM25 (centro de mesa)
    /^DS\d+/i,          // DS10 (açucareiro)
    /^DM\d+/i,          // DM11 (meleira)
    /^DV\d+/i,          // DV31 (vaso)
    /^LHSP\d+/i,        // LHSP75
    /^LX\d+/i,          // LX15016
    /^CF\d+[A-Z]?\/L\d+/i, // CF001/L12, CF029A/L12
  ],
};
