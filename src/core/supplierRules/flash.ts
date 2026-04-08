// ===================================================================
// ADAPTER: FLASH
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

export const flashAdapter: SupplierAdapter = {
  id: 'f0000000-0000-4000-a000-000000000000',
  nome: 'Flash',
  aliases: ['flash', 'flask', 'flasch', 'flash goods', 'flashgoods', 'flash good'],

  fieldAliases: CLINK_FAMILY_FIELD_ALIASES,

  precoFormat: 'BR',
  defaultQuantidadeCaixa: 1,
  defaultUnidade: 'UN',

  exclusionRules: CLINK_FAMILY_EXCLUSION_RULES,

  detectionPatterns: [
    'FLASH',
    'Flash',
    /flash/i,
    /flask/i,
    /flasch/i,
    /^FL[A-Z0-9]{3,}/i, // Códigos começando com FL
    /^FS[A-Z0-9]{3,}/i, // Códigos começando com FS
  ],

  hasMultiplePriceTables: true,
  priceTableLabels: ['Preço Especial', 'Preço Final', 'Tabela Padrão'],

  /**
   * Função de extração customizada usando a base da família
   */
  extract: (brutos: ProdutoBruto[], adapter: SupplierAdapter): ClinkFamilyProduct[] => {
    return extractClinkFamily(brutos, adapter, '', 'Flash');
  },
};
