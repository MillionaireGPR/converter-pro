import { PdfTemplate } from './types';

/**
 * Template Goal Kids — validado em catálogo real 18-03-2026 (194 pgs).
 *
 * Padrão estável: 3 produtos por página, formato consistente.
 *
 * Exemplo de bloco no PDF:
 *   GK3493
 *   BONECA C/ MOTOCICLETA
 *   E ACESSÓRIOS
 *   Quant: 120 PÇ/CX
 *   Preço: R$19,84
 *   ••Medidas: 15,5 cm x 20 cm
 *   ••Embalagem: Caixa
 *
 * PDF tem encoding U+FFFD em alguns acentos (similar ao BM36).
 * O postProcess do supplier limpa isso.
 */
export const goalKidsTemplate: PdfTemplate = {
  supplierId: 'goal-kids',
  supplierName: 'Goal Kids',
  identificationPatterns: [
    'GOAL KIDS',
    'Goal Kids',
    /Cat[aá�]logo\s+(?:de\s+)?Brinquedos?/i,
    /\bGK\d{3,5}\b/,
  ],
  minConfidence: 25,

  // Cada produto começa com prefixo GK + dígitos. Lookahead garante que o
  // próprio código fique no bloco.
  blockExtractor: /(?=\bGK\d{3,5}\b)/i,

  fieldExtractors: {
    // Código: GK seguido de 3-5 dígitos
    codigo: /\b(GK\d{3,5})\b/i,

    // Descrição: tudo entre o código e "Quant:" (DOTALL para múltiplas linhas)
    descricao: /GK\d{3,5}\s+(.+?)(?=\s*Quant:|\s*Pre[cç]o:|\s*$)/is,

    // Quantidade caixa: "Quant: 120 PÇ/CX", "Quant: 36 PC/CX"
    quantidadeCaixa: /Quant:\s*(\d{1,4})\s*P[CÇ�?]/i,

    // Preço: "Preço: R$19,84" ou "Pre�o: R$19,84" (com encoding quebrado)
    preco: /Pre[cç�?]o:\s*R\$\s*(\d{1,4}(?:[.,]\d{2})?)/i,

    // Dimensões: "Medidas: 15,5 cm x 20 cm"
    dimensoes: /Medidas:\s*([\d.,\s]+(?:cm|mm)(?:\s*[xX]\s*[\d.,\s]+(?:cm|mm))*)/i,

    // Embalagem: "Embalagem: Caixa" / "Embalagem: Cartela"
    embalagem: /Embalagem:\s*([A-Za-zçãõáéíóúâêîôû]+)/i,
  },
};
