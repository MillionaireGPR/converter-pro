// ===================================================================
// ADAPTER: NIX HOUSE / NIX GLASS
// Padrão: Código NX###, descrição forte, NCM/IPI, dimensão, pçs/cxs
// Páginas em grade com múltiplos itens
// ===================================================================

import { SupplierAdapter } from './types';

export const nixAdapter: SupplierAdapter = {
  id: 'nix',
  nome: 'Nix House',
  aliases: ['nix', 'nixhouse', 'nix house', 'nixglass', 'nix glass'],

  fieldAliases: {
    codigo: ['codigo', 'cod', 'ref', 'referencia', 'item'],
    codigoBarras: ['ean', 'codigobarras'],
    descricao: ['descricao', 'produto', 'nome', 'desc', 'description'],
    preco: ['preco', 'precounitario', 'valor', 'vlrunit', 'pvenda', 'vlr'],
    quantidadeCaixa: ['pccx', 'pccaixa', 'qtdcaixa', 'cx', 'caixa', 'pecascaixa'],
    ncm: ['ncm'],
    ipi: ['ipi'],
    dimensoes: ['dimensao', 'dimensoes', 'medidas', 'tamanho', 'medida'],
    unidade: ['un', 'unidade'],
    categoria: ['categoria', 'linha', 'familia', 'grupo'],
    observacoes: ['obs', 'observacao', 'observacoes'],
  },

  codigoPattern: /^NX\d{3,5}/i,
  precoFormat: 'BR',
  defaultQuantidadeCaixa: 1,
  defaultUnidade: 'UN',

  exclusionRules: [
    { pattern: /^p[aá]gina\s*\d/i, descricao: 'Número de página' },
    { pattern: /tabela\s+de\s+pre[cç]os/i, descricao: 'Cabeçalho de tabela' },
  ],

  detectionPatterns: [
    'NIX HOUSE',
    'NIX GLASS',
    'Nix House',
    'Nix Glass',
    /\bNX\d{3}/,
  ],

  blockSeparator: /(?=NX\d{3})/i,
};
