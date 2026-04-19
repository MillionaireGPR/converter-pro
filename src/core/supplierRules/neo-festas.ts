// ===================================================================
// ADAPTER: NEO FESTAS
// Padrão: Preço unitário + preço kit/caixa/pacote, código numérico,
// dimensões, material, embalagem, status ESGOTADO
// ===================================================================

import { SupplierAdapter } from './types';

export const neoFestasAdapter: SupplierAdapter = {
  id: 'neo-festas',
  nome: 'Neo Festas',
  aliases: ['neo', 'neofestas', 'neo festas', 'fast neo festas', 'fast neo'],

  fieldAliases: {
    codigo: ['codigo', 'cod', 'ref', 'referencia', 'item', 'cd'],
    descricao: ['descricao', 'desc', 'produto', 'nome', 'item', 'description'],
    preco: ['precounitario', 'precoun', 'precounit', 'preco', 'valor', 'vlrunit', 'unitario'],
    precoPromocional: ['precokits', 'precocaixa', 'precopacote', 'kit', 'pacote', 'caixa'],
    quantidadeCaixa: ['cx', 'caixa', 'qtdcaixa', 'qtd', 'pccx', 'pccaixa', 'emb'],
    unidade: ['un', 'unidade'],
    dimensoes: ['dimensao', 'dimensoes', 'medidas', 'tamanho'],
    material: ['material', 'materia', 'composicao'],
    embalagem: ['embalagem', 'emb', 'pack'],
    categoria: ['categoria', 'linha', 'familia', 'grupo'],
    ncm: ['ncm'],
    ipi: ['ipi'],
    observacoes: ['obs', 'observacao', 'observacoes', 'status'],
  },

  precoFormat: 'BR',
  defaultQuantidadeCaixa: 1,
  defaultUnidade: 'UN',

  exclusionRules: [
    { pattern: /^total/i, descricao: 'Linha de total' },
    { pattern: /tabela\s+de\s+pre[cç]os/i, descricao: 'Cabeçalho de tabela' },
  ],

  detectionPatterns: [
    'NEO FESTAS',
    'Neo Festas',
    'Fast Neo Festas',
    'FAST NEO',
    /neo\s*festas/i,
    /fast\s*neo/i,
  ],

  fieldPriority: {
    preco: ['precounitario', 'precoun', 'unitario', 'preco', 'valor'],
  },
};
