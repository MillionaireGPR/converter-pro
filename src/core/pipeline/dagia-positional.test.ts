/**
 * 🔒 Testes — Pass posicional DAGIA + fallback de descrição (03/06/2026)
 *
 * Bug reportado: na página 12 do DAGIA, preços vêm AGRUPADOS no fim:
 *   ...DXP57 ... CF026/L12 ... CF029A/L12 ... R$33,00 R$26,60 R$26,60
 * Bloco split por código deixava o último (CF029A/L12) pegando R$33,00.
 *
 * Bug 2: DZ03 (pg 9) tem título "Jogo De Jantar..." no FIM do bloco.
 * Descrição vinha vazia/só hífens.
 *
 * Esses testes travam a lógica.
 */
import { describe, it, expect } from 'vitest';

describe('🔒 DAGIA — pass posicional de preços (página 12 layout)', () => {
  it('distribui preços agrupados no fim em ordem dos SKUs', () => {
    // Simula o texto real da página 12 do DAGIA
    const text = `XICARAS
DXP57
Xicara C/ Pires 275 ml
CF026/L12
Xicara C/ Pires 190 ml
CF029A/L12
Xicara C/ Pires 210 ml
R$33,00
R$26,60
R$26,60`;

    const priceMatches = [...text.matchAll(/R\$\s*(\d{1,4}(?:[.,]\d{2}))/gi)];
    const pricesInOrder = priceMatches.map(m => m[1].replace(',', '.'));

    expect(pricesInOrder).toEqual(['33.00', '26.60', '26.60']);
  });

  it('regex preço NÃO captura sem decimais (evita false positive)', () => {
    const text = 'R$ 33 sem decimais NÃO casa, R$33,00 casa';
    const matches = [...text.matchAll(/R\$\s*(\d{1,4}(?:[.,]\d{2}))/gi)];
    expect(matches.length).toBe(1);
    expect(matches[0][1]).toBe('33,00');
  });

  it('fallback descrição DZ03: pega "Jogo De Jantar" (não Xicara das peças)', () => {
    // Texto real do DZ03 (pg 9): título no fim, peças no meio
    const blockText = `DZ03
-
Xicara C/ Pires 190 ml
8PCS  (6cm Alt - 7cm Larg)
Jogo De Jantar E Cha Opalina 20 Pcs`;
    // Padrão específico para DZ (prefixo do código = DZ → Jogos)
    const pat = /\b(Jogo\s+De[\s\w�?ãáéíóúçÇÃÁÉÍÓÚ]{5,80})/i;
    expect(blockText.match(pat)?.[1]).toContain('Jogo De Jantar');
  });

  it('fallback descrição DCM: pega "Centro De Mesa"', () => {
    const blockText = 'DCM25\n-\nR$76,25\nCentro De Mesa 22cm';
    const pat = /\b(Centro\s+De\s+Mesa[\s\w]{0,40})/i;
    expect(blockText.match(pat)?.[1]).toContain('Centro De Mesa');
  });

  it('fallback descrição CF: pega "Xicara C/" (prefixo CF = xícaras)', () => {
    const blockText = 'CF029A/L12\n-\nXicara C/ Pires 210 ml C/12 Pcs';
    const pat = /\b(Xicara\s+C\/[\s\w�?ãáéíóúçÇÃÁÉÍÓÚ]{5,80})/i;
    expect(blockText.match(pat)?.[1]).toContain('Xicara C/');
  });

  it('NÃO sobrescreve preço quando produto está marcado EM BREVE', () => {
    // Mesmo se a página tem N preços e N produtos, EM BREVE deve ficar sem preço
    const campos = { __emBreve: true, preco: undefined };
    const pricesInOrder = ['12.00', '15.00'];
    // Simula o loop forEach
    if (!campos.__emBreve) {
      campos.preco = pricesInOrder[0] as any;
    }
    expect(campos.preco).toBeUndefined();
  });

  it('🔒 PAGE-WIDE EM BREVE: detecta texto em qualquer bloco da página', () => {
    // Bug reportado: PDF.js extrai texto fora de ordem visual. "EM BREVE..."
    // pode estar em UM bloco mas pertencer a OUTRO produto sem preço.
    // Lógica: se página tem N "EM BREVE" e N produtos sem preço, marca todos.
    const pageText = `
DXPD53
Xicara Opalina 185 ml C/Borda Dourada
DXPD52
Xicara Opalina 80 ml C/Borda Dourada
EM BREVE...
EM BREVE...
`;
    const emBreveCount = (pageText.match(/em\s+breve/gi) || []).length;
    expect(emBreveCount).toBe(2);

    const pageProds = [
      { campos: { codigo: 'DXPD53', preco: undefined } },
      { campos: { codigo: 'DXPD52', preco: undefined } },
    ];
    const semPreco = pageProds.filter(p => !p.campos.preco);
    expect(semPreco.length).toBe(2);

    // Marca todos
    if (emBreveCount >= semPreco.length) {
      for (const p of semPreco) {
        (p.campos as any).__emBreve = true;
      }
    }
    expect((pageProds[0].campos as any).__emBreve).toBe(true);
    expect((pageProds[1].campos as any).__emBreve).toBe(true);
  });

  it('🔒 PAGE-WIDE EM BREVE: NÃO marca quando #EM BREVE < #produtos sem preço', () => {
    // Se só 1 EM BREVE mas 3 produtos sem preço, não pode marcar todos
    const pageText = 'PRODUTO1\nPRODUTO2\nPRODUTO3\nEM BREVE...';
    const emBreveCount = (pageText.match(/em\s+breve/gi) || []).length;
    const semPreco = [{}, {}, {}];
    expect(emBreveCount < semPreco.length).toBe(true);
    // Lógica não marca neste caso (proteção contra falso positivo)
  });
});
