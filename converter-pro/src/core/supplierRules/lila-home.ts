// ===================================================================
// ADAPTER: LILA HOME
// Padrão: Blocos com CÓD, MATERIAL, TAMANHO, COR, CX, IPI, NCM, R$
// ===================================================================

import { SupplierAdapter } from './types';

export const lilaHomeAdapter: SupplierAdapter = {
  id: 'lila-home',
  nome: 'Lila Home',
  aliases: ['lila', 'lilahome', 'lila home'],

  fieldAliases: {
    codigo: ['cod', 'codigo', 'cód', 'ref', 'referencia'],
    descricao: ['descricao', 'produto', 'nome', 'item', 'desc'],
    descricaoComplementar: ['complemento', 'obs', 'observacao'],
    preco: ['preco', 'valor', 'r$', 'preço', 'pvenda', 'vlr'],
    quantidadeCaixa: ['cx', 'caixa', 'qtdcaixa', 'qtd', 'pccx'],
    ncm: ['ncm'],
    ipi: ['ipi'],
    material: ['material', 'materia'],
    cor: ['cor', 'cores', 'color'],
    dimensoes: ['tamanho', 'medidas', 'dimensoes', 'tam', 'medida'],
    unidade: ['un', 'unidade'],
    embalagem: ['embalagem', 'emb'],
    categoria: ['categoria', 'linha', 'familia'],
  },

  // Lila Home não tem prefixo de código fixo; detecção é por padrões textuais
  precoFormat: 'BR',
  defaultQuantidadeCaixa: 1,
  defaultUnidade: 'UN',

  exclusionRules: [
    { pattern: /^SUB$/i, descricao: 'Label SUB ignorada' },
    { pattern: /sugest[aã]o\s+de\s+conjunto/i, descricao: 'Texto de sugestão' },
    { pattern: /atualizado\s+em/i, descricao: 'Data de atualização' },
  ],

  detectionPatterns: [
    'LILA HOME',
    'Lila Home',
    /CÓD:\s*[A-Z]/i,
    /MATERIAL:\s*\w/i,
  ],

  blockSeparator: /(?=CÓD[:\s])/i,
};
