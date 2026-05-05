import { PdfTemplate } from './types';

/**
 * TEMPLATE: BM36 / WORLD CLASSIC
 *
 * Estrutura consistente do catálogo (3x4 grid, ~12 produtos por página):
 * ────────────────────────────────────────────────────────────
 * CASTIÇAL 12X12X5,7CM DECOR BM361645        ← Descrição + SKU (às vezes truncado)
 * CD: 7898667549917                            ← EAN (13 dígitos)
 * CD: BM361645                                 ← SKU completo (fonte de verdade)
 * CX: 40                                       ← Quantidade por caixa
 * B2040B2448                                   ← Preço: B<base>B<com margem> (R$ 20,40)
 * ────────────────────────────────────────────────────────────
 *
 * SKUs no formato:
 *   - BM###### (BM36) — ex: BM361645
 *   - WC###### (World Classic) — ex: WC409750
 *
 * Preço B####B####:
 *   - Primeiro B: preço base em centavos (B2040 → R$ 20,40)
 *   - Segundo B: preço com margem (~20% acima)
 */
export const bm36Template: PdfTemplate = {
  supplierId: 'bm36',
  supplierName: 'BM36',
  identificationPatterns: ['BM36', 'BM 36', 'WORLD CLASSIC', 'WORLDCLASSIC'],
  minConfidence: 30,

  /**
   * Fatia o texto da página em blocos de produto.
   * Cada bloco vai de uma linha "B####B####" até a próxima (inclusive).
   * Estratégia: usar a linha de preço como ÂNCORA DE FIM de cada cell.
   */
  blockExtractor: (pageText: string): string[] => {
    const blocks: string[] = [];
    // Localizar todas as posições de "B####B####" (preço final do produto)
    const priceRegex = /B\d{2,5}B\d{2,5}/g;
    const priceMarkers: { index: number; length: number }[] = [];
    let m;
    while ((m = priceRegex.exec(pageText)) !== null) {
      priceMarkers.push({ index: m.index, length: m[0].length });
    }

    if (priceMarkers.length === 0) return blocks;

    let prevEnd = 0;
    for (const marker of priceMarkers) {
      const blockEnd = marker.index + marker.length;
      const block = pageText.substring(prevEnd, blockEnd).trim();
      // Bloco precisa ter mínimo conteúdo (descrição + EAN + SKU)
      if (block.length > 30 && /BM\d|WC\d/i.test(block)) {
        blocks.push(block);
      }
      prevEnd = blockEnd;
    }

    return blocks;
  },

  fieldExtractors: {
    // SKU: pega da segunda linha "CD: BM######" ou "CD: WC######"
    codigo: /CD:\s*((?:BM|WC)\d{4,8})/i,

    // EAN: 13 dígitos após primeira "CD:"
    codigoBarras: /CD:\s*(\d{13})/i,

    // Preço: primeiro grupo do padrão B####B####
    // (cents → divisão por 100 no post-process)
    preco: /B(\d{2,5})B\d{2,5}/i,

    // Quantidade por caixa: "CX: 40" ou "CX 40"
    quantidadeCaixa: /CX:?\s*(\d{1,4})/i,
  },
};
