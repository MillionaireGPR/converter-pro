import { PdfTemplate } from './types';

export const dagiaTemplate: PdfTemplate = {
  supplierId: 'dagia',
  supplierName: 'Dagia',
  identificationPatterns: ['DAGIA'],
  minConfidence: 30,
  
  fieldExtractors: { /* Heurísticas genéricas já cobrem bem este fornecedor */ }
};
