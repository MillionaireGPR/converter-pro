import { PdfTemplate } from './types';

export const bm36Template: PdfTemplate = {
  supplierId: 'bm36',
  supplierName: 'BM36',
  identificationPatterns: ['BM36', 'BM 36'],
  minConfidence: 30,
  
  fieldExtractors: {
    // Código: "CD: BM361634"
    codigo: /CD:\s*([A-Za-z0-9]+)\b/i,
    // EAN: "CD: 789..."
    codigoBarras: /(?:CD|EAN):\s*(\d{13})\b/i,
    // Price code string like B2610B3132 - usually the first part BXXXX means XX.XX
    // Ex: B2610 -> 26.10
    preco: /B(\d{2,4})[A-Za-z]/i, // A normalização deve colocar a vírgula
  }
};
