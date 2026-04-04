import { PdfTemplate } from './types';

export const neoFestasTemplate: PdfTemplate = {
  supplierId: 'neo-festas', // Atualizar com ID real
  supplierName: 'Neo Festas',
  identificationPatterns: ['NEO FESTAS', 'FAST NEO'],
  minConfidence: 30,
  
  fieldExtractors: {
    // Código são geralmente 6 dígitos em uma linha ou bloco solto
    codigo: /\b(\d{6})\b/,
    // Queremos o preço unitário. Ex: "R$ 1,38 Un."
    preco: /R\$\s*([\d.,]+)\s*[Uu]n\./,
    // Caixa. Ex: "Cx. c/50 un."
    quantidadeCaixa: /[Cc]x\.?\s*c\/(\d+)\s*un/i,
  }
};
