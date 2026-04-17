// ===================================================================
// ADAPTER: GOAL KIDS
// Padrão: Código GK####, quantidade PÇ/CX, preço, medidas, embalagem
// Blocos simples por produto em páginas com ~3 produtos
// ===================================================================

import { SupplierAdapter } from './types';

export const goalKidsAdapter: SupplierAdapter = {
  id: 'goal-kids',
  nome: 'Goal Kids',
  aliases: ['goal', 'goalkids', 'goal kids'],

  fieldAliases: {
    codigo: ['codigo', 'cod', 'ref', 'referencia', 'item', 'cd'],
    descricao: ['descricao', 'desc', 'produto', 'nome', 'item', 'description'],
    preco: ['preco', 'valor', 'pvenda', 'vlr', 'vlrunit'],
    quantidadeCaixa: ['pccx', 'pccaixa', 'qtdcaixa', 'cx', 'caixa', 'emb', 'qtd'],
    unidade: ['un', 'unidade'],
    dimensoes: ['medidas', 'dimensoes', 'tamanho', 'medida'],
    embalagem: ['embalagem', 'emb', 'pack'],
    categoria: ['categoria', 'linha', 'genero', 'familia'],
    ncm: ['ncm'],
    ipi: ['ipi'],
    observacoes: ['obs', 'observacao'],
  },

  codigoPattern: /^GK\d{4,5}/i,
  precoFormat: 'BR',
  defaultQuantidadeCaixa: 1,
  defaultUnidade: 'UN',

  exclusionRules: [
    { pattern: /^p[aá]gina\s*\d/i, descricao: 'Número de página' },
    { pattern: /cat[aá]logo/i, descricao: 'Texto de catálogo' },
  ],

  detectionPatterns: [
    'GOAL KIDS',
    'Goal Kids',
    /\bGK\d{4}/,
  ],

  blockSeparator: /(?=GK\d{4})/i,
};
