import { PdfTemplate } from './types';

export const giraImportsTemplate: PdfTemplate = {
  supplierId: 'gira-imports', // Atualizar com ID real se houver
  supplierName: 'Gira Imports',
  identificationPatterns: ['GIRA IMPORTS', 'VASOS - CATALOGO GIRA'],
  minConfidence: 30,
  
  // Ex: "TP1968 - VASO VIDRO BOTICA\n8*11cm 0690" -> Preço é o último número 4 dígitos
  fieldExtractors: {
    codigo: /(TP\d{3,5})/i,
    // Pegar o número inteiro no final da linha do código ou 2a linha, como preço (ex: 0690 -> 6.90)
    // Extraímos os dígitos e na normalização dividimos por 100
    preco: /(?:cm|mm)\s*0?(\d{2,4})\b/i, 
  }
};
