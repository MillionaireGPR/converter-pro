// ===================================================================
// ADAPTER GENÉRICO (FALLBACK)
// Usado quando o sistema não consegue identificar o fornecedor.
// Tenta mapear colunas comuns automaticamente.
// ===================================================================

import { SupplierAdapter } from './types';

export const genericAdapter: SupplierAdapter = {
  id: '00000000-0000-4000-a000-000000000000', // UUID dummy válido para o banco aceitar
  nome: 'Genérico',
  aliases: ['generic', 'generico'],

  fieldAliases: {
    codigo: ['codigo', 'cod', 'codfor', 'referencia', 'ref', 'sku', 'item', 'partnumber', 'ean', 'cd', 'code'],
    codigoBarras: ['ean', 'codigobarras', 'gtin', 'barcode', 'codbarras', 'cdean'],
    codigoInterno: ['codigointerno', 'codinterno', 'cdintern', 'skuinterno'],
    descricao: ['descricao', 'desc', 'produto', 'nome', 'descrcompl', 'description', 'nomedoproduto', 'item', 'denominacao'],
    descricaoComplementar: ['descricaocomplementar', 'obs', 'observacao', 'detalhes', 'complemento', 'compl'],
    preco: ['preco', 'pvenda', 'valor', 'valorunitario', 'precodetabela', 'tabela', 'base', 'custo', 'netprice', 'precoliquido', 'vlr', 'vl', 'precovenda', 'vlrunit'],
    precoPromocional: ['precopromocional', 'promocional', 'oferta', 'precoespecial', 'especial', 'promo'],
    unidade: ['un', 'unidade', 'und', 'uom', 'unidademedida'],
    // Cobre: GIRA (QT CX -> qtcx), FOLIA (ITENS CX -> itenscx), DAGIA (CX -> cx),
    // PETRIN (Cx c/ N), genérico (qtdcaixa/quantcx/etc).
    quantidadeCaixa: [
      'qtdcaixa', 'caixa', 'qtcaixa', 'qtcx', 'qtdcx', 'embalagemmaster',
      'quantcx', 'quantidadecaixa', 'qtdecaixa',
      'cx', 'multiplo', 'emb', 'embalagem', 'moq',
      'packingunit', 'pccx', 'pccaixa', 'pcscx',
      'itenscx', 'itenscaixa', 'itenscaix', 'qtitens',
      'masterbox', 'embmaster', 'unidadescaixa', 'unidcaixa',
      'pacote', 'pcs', 'unidadespacote'
    ],
    embalagem: ['embalagem', 'emb', 'pack', 'packing'],
    categoria: ['categoria', 'familia', 'linha', 'grupo', 'genero', 'productgroup', 'tipo'],
    ncm: ['ncm', 'ncmsh', 'classificacaofiscal'],
    ipi: ['ipi', 'percipi', 'aliquotaipi', 'ipitax', 'aliqipi'],
    dimensoes: ['dimensoes', 'medidas', 'tamanho', 'dim', 'measures', 'size'],
    material: ['material', 'materia', 'composicao'],
    cor: ['cor', 'color', 'cores'],
    volume: ['volume', 'vol', 'capacidade', 'litros', 'ml'],
    observacoes: ['observacoes', 'observacao', 'obs', 'notas', 'nota'],
  },

  precoFormat: 'BR',
  defaultQuantidadeCaixa: 1,
  defaultUnidade: 'UN',

  exclusionRules: [
    { pattern: /^total/i, descricao: 'Linha de total' },
    { pattern: /^subtotal/i, descricao: 'Linha de subtotal' },
    { pattern: /^\s*$/, descricao: 'Linha vazia' },
  ],

  detectionPatterns: [],
};
