// ===================================================================
// ADAPTER: CLINK
// Herda da base da família CLINK com regras visuais e classificação
// ===================================================================

import { SupplierAdapter } from './types';
import {
  CLINK_FAMILY_FIELD_ALIASES,
  CLINK_FAMILY_EXCLUSION_RULES,
  extractClinkFamily,
  ClinkFamilyProduct,
} from './clink-family-base';
import { ProdutoBruto } from '../types/productPipeline';

export const clinkAdapter: SupplierAdapter = {
  id: 'c0000000-0000-4000-a000-000000000000',
  nome: 'Clink',
  aliases: ['clink', 'clique', 'clik', 'click'],

  fieldAliases: CLINK_FAMILY_FIELD_ALIASES,

  precoFormat: 'BR',
  defaultQuantidadeCaixa: 1,
  defaultUnidade: 'UN',

  exclusionRules: CLINK_FAMILY_EXCLUSION_RULES,

  detectionPatterns: [
    'CLINK',
    'Clink',
    /clink/i,
    /clique/i,
    /clik/i,
    /^CL[A-Z0-9]{3,}/i, // Códigos começando com CL
  ],

  hasMultiplePriceTables: true,
  priceTableLabels: ['Preço Especial', 'Preço Final', 'Tabela Padrão'],

  /**
   * Função de extração customizada usando a base da família
   */
  extract: (brutos: ProdutoBruto[], adapter: SupplierAdapter): ClinkFamilyProduct[] => {
    return extractClinkFamily(brutos, adapter, '', 'Clink');
  },
};
