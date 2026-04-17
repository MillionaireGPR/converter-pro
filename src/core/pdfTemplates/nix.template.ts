import { PdfTemplate } from './types';

export const nixTemplate: PdfTemplate = {
  supplierId: 'nix',
  supplierName: 'Nix House',
  identificationPatterns: ['NIX HOUSE', 'NIX'],
  minConfidence: 30,
  
  fieldExtractors: { /* Heurísticas genéricas suprem */ }
};
