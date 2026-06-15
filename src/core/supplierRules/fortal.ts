// ===================================================================
// ADAPTER: FORTAL (catálogo PDF — processado via AI-first)
// ===================================================================
// Fornecedor novo (reunião 11/06/2026). Catálogo PDF ~96 páginas, ~1.200
// produtos, PREÇO JÁ FINAL (sem cálculo de desconto). Layout por bloco:
//   NOME DO PRODUTO (CAPS)
//   <código>            (variado: SZ-01, JIN-2501, JXX-2502, HL100, UP012...)
//   <dimensão/material> (ex: 40x40cm - Poliéster)
//   Qtd. p/ Caixa: N UND
//   R$ X,XX             (preço final)
//   [CORES SORTIDAS]
//
// Os códigos NÃO têm prefixo único, então NÃO há codigoPattern rígido — a
// extração é feita pelo pipeline AI-first (Gemini lê o catálogo inteiro) com
// o hint FORTAL no backend (ver gemini_extractor.py SUPPLIER_HINTS). Este
// adapter serve para detecção/nomeação e normalização dos campos canônicos
// que a IA devolve.

import { SupplierAdapter } from './types';

export const fortalAdapter: SupplierAdapter = {
  id: 'fortal-0000-0000-4000-a000-000000000000',
  nome: 'Fortal',
  aliases: ['fortal', 'fortal importacao', 'fortal importação', 'fortal imports'],

  fieldAliases: {
    codigo: ['codigo', 'cod', 'referencia', 'ref', 'sku'],
    descricao: ['descricao', 'desc', 'nome', 'produto'],
    preco: ['preco', 'valor', 'r$', 'preço'],
    // "Qtd. p/ Caixa: N UND" → quantidadeCaixa (a IA já entrega o N)
    quantidadeCaixa: ['quantidadecaixa', 'qtd p/ caixa', 'qtd caixa', 'qtd. p/ caixa', 'cx'],
    dimensoes: ['dimensoes', 'tamanho', 'medida'],
    cor: ['cor', 'cores'],
    ncm: ['ncm'],
    ipi: ['ipi'],
  },

  // Preço já é FINAL no catálogo — sem desconto a aplicar.
  precoFormat: 'BR',
  defaultQuantidadeCaixa: 1,
  defaultUnidade: 'UN',

  exclusionRules: [
    { pattern: /^\s*$/, descricao: 'Linha vazia' },
    { pattern: /^-?\s*[ÍI]NDICE\s*-?$/i, descricao: 'Página de índice' },
    { pattern: /^total/i, descricao: 'Linha de total' },
  ],

  detectionPatterns: [
    /fortal/i,
    /Qtd\.\s*p\/\s*Caixa:/i, // assinatura textual do catálogo Fortal
  ],
};
