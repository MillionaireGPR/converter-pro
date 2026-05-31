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

  // Catálogo Flash real (FLASHGOODS 23.03): códigos no formato F\d{3,4}
  // (F0211, F0492). codigoPattern valida na fase tardia.
  codigoPattern: /^F\d{3,4}$/i,

  // Planilha real tem P.Venda como float NATIVO do Excel (ex: 7.86, 47.0).
  // O `toNum` do extractor já lida com `typeof === 'number'` sem aplicar
  // regras BR; o precoFormat 'BR' é só hint para casos string.
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
    // CORRIGIDO: catálogo real usa F\d{3,4} (F0211, F0492), NÃO FL ou FS.
    // Antes /^FL[A-Z0-9]{3,}/i não casava com nenhum código real.
    /^F\d{3,4}\b/i,
  ],

  // CORRIGIDO: planilha real tem APENAS coluna P.Venda. Os rótulos antigos
  // (Preço Especial / Final / Padrão) eram herança copy-paste do Clink e
  // não existem no Excel real do FLASHGOODS.
  hasMultiplePriceTables: false,

  /**
   * Função de extração customizada usando a base da família
   */
  extract: (brutos: ProdutoBruto[], adapter: SupplierAdapter): ClinkFamilyProduct[] => {
    return extractClinkFamily(brutos, adapter, '', 'Flash');
  },
};
