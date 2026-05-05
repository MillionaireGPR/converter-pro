import { describe, it, expect } from 'vitest';
import { bm36Template } from './bm36.template';

describe('BM36 template', () => {
  const sampleText = `COZINHA & UD
CASTIÇAL 12X12X5,7CM DECOR BM361645
CD: 7898667549917
CD: BM361645
CX: 40
B2040B2448
CASTIÇAL 12X6,3CM BM361643
CD: 7898667549894
CD: BM361643
CX: 24
B2130B2556
TABUA BAMBU 28X38X1.8 JOINVILLE WC40
CD: 7898681264667
CD: WC409750
CX: 20
B3150B3780`;

  it('blockExtractor splits text into 3 product blocks', () => {
    const blocks = (bm36Template.blockExtractor as Function)(sampleText);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain('CASTIÇAL 12X12X5,7CM');
    expect(blocks[1]).toContain('CASTIÇAL 12X6,3CM');
    expect(blocks[2]).toContain('TABUA BAMBU');
  });

  it('field extractors capture SKU, EAN, CX, price', () => {
    const block = `CASTIÇAL 12X12X5,7CM DECOR BM361645
CD: 7898667549917
CD: BM361645
CX: 40
B2040B2448`;

    const sku = block.match(bm36Template.fieldExtractors.codigo!);
    const ean = block.match(bm36Template.fieldExtractors.codigoBarras!);
    const cx = block.match(bm36Template.fieldExtractors.quantidadeCaixa!);
    const preco = block.match(bm36Template.fieldExtractors.preco!);

    expect(sku?.[1]).toBe('BM361645');
    expect(ean?.[1]).toBe('7898667549917');
    expect(cx?.[1]).toBe('40');
    expect(preco?.[1]).toBe('2040'); // 20.40 em centavos
  });

  it('handles WC (World Classic) codes', () => {
    const block = `TABUA BAMBU 28X38X1.8 JOINVILLE WC40
CD: 7898681264667
CD: WC409750
CX: 20
B3150B3780`;

    const sku = block.match(bm36Template.fieldExtractors.codigo!);
    expect(sku?.[1]).toBe('WC409750');
  });
});
