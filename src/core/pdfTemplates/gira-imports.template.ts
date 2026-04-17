import { PdfTemplate } from './types';

/**
 * TEMPLATE: GIRA IMPORTS
 * 
 * Estrutura de cada produto no catálogo PDF:
 * ───────────────────────────────────────────
 * TP1968 - VASO VIDRO BOTICA         ← Código + Nome do produto
 * 8*11cm    0690                     ← Dimensões + PREÇO (formato compacto: 0690 = R$ 6,90)
 *
 * CX48  IP 9,75 %                   ← Qtd por caixa + IPI
 * EAN 7908100214589                  ← Código de barras (13 dígitos)
 * NCM 7013.9900                     ← NCM fiscal
 * ───────────────────────────────────────────
 *
 * ATENÇÃO: O separador entre código e nome pode ser:
 *   - Hífen simples: TP1968 - VASO
 *   - Travessão:     TP1968 – VASO  (comum nas cerâmicas)
 *   - Apenas espaço: TP1968  VASO   (raro, mas acontece)
 */
export const giraImportsTemplate: PdfTemplate = {
  supplierId: 'gira-imports',
  supplierName: 'Gira Imports',
  identificationPatterns: ['GIRA IMPORTS', 'GIRA', 'CATALOGO GIRA'],
  minConfidence: 40,

  // Função customizada para fatiar o texto em blocos por produto.
  // IMPORTANTE: Aceita hífen (-), travessão (–/—) ou espaço como separador após TP####
  blockExtractor: (pageText: string): string[] => {
    const blocks: string[] = [];
    // Aceita Códigos TP, GU, GRID etc. (2-4 Letras + 3-5 dígitos), seguido de hífen/travessão ou apenas espaço
    // Proteção rigorosa: rejeita explicitamente (NCM|EAN|IPI|IP|CX) caso estejam grudados com números
    const codeRegex = /\b(?!(?:NCM|EAN|IPI?|CX))([A-Z]{2,4}\d{3,5})\s*[-–—]?\s*/gi;
    let match;
    const indices: { index: number; code: string }[] = [];

    while ((match = codeRegex.exec(pageText)) !== null) {
      // Evita duplicatas: se já tem um TP nesse index (±5 chars), pula
      const isDuplicate = indices.some(idx => Math.abs(idx.index - match!.index) < 5);
      if (!isDuplicate) {
        indices.push({ index: match.index, code: match[1] });
      }
    }

    // Para cada TP encontrado, pega o texto ATÉ o próximo TP
    for (let i = 0; i < indices.length; i++) {
      const start = indices[i].index;
      const end = i < indices.length - 1 ? indices[i + 1].index : pageText.length;
      const block = pageText.substring(start, end).trim();
      if (block.length > 10) {
        blocks.push(block);
      }
    }

    return blocks;
  },

  fieldExtractors: {
    // Código: 2-4 Letras (ex: TP, GU, GRID) em seguida 3-5 dígitos (ignorando jargões estruturais)
    codigo: /\b(?!(?:NCM|EAN|IPI?|CX))([A-Z]{2,4}\d{3,5})\b/i,

    // Preço compacto: pode começar com CERO MÚLTIPLO (ex: 0017900) e ter até 7 dígitos totais (00+17900 = 179.00)
    preco: /\b(0+\d{2,6})\s*$/m,

    // IPI: "IP 9,75 %", "IPI 9,75%", "IPI 13%", "IPI 0" (% OPCIONAL)
    ipi: /IP[I]?\s*(\d+(?:[.,]\d+)?)\s*%?/i,

    // Quantidade por caixa: CX48, CX 48, CX120
    quantidadeCaixa: /CX\s*(\d+)/i,

    // EAN: 13 dígitos precedidos de "EAN"
    codigoBarras: /EAN\s*(\d{13})/i,

    // NCM: formato ####.#### ou #### #### (espaço normalizado pelo postProcess)
    ncm: /NCM\s*(\d{4}[.\s]?\d{2,6})/i,
  },
};

