/**
 * Garante que o pass de enriquecimento POSICIONAL de preço funciona:
 * quando o bloco do produto não contém R$ (PDF.js extraiu fora de ordem),
 * o interpreter deve buscar nos page.items o R$ espacialmente próximo do SKU.
 */
import { describe, it, expect } from 'vitest';
import { interpretPdfSemantically } from './smartPdfInterpreter';
import type { PdfPageData } from './pdfParser';
import { nixTemplate } from '../pdfTemplates/nix.template';

describe('Pipeline: enriquecimento posicional de preço (PDF)', () => {
  it('preenche preço via page.items quando o bloco não contém R$', () => {
    // Cenário: bloco NX020 não tem R$ (PDF.js extraiu fora de ordem).
    // O preço R$ 5,50 está em page.items na mesma coluna X que o SKU.
    const page: PdfPageData = {
      pageNum: 1,
      text: 'NX020 FORMA DE GELO C/BASE SILICONE - 12 CUBOS NCM: 3924.10.00 / IPI:6,5 DIMENSÃO: 25x11,5x3cm PEÇAS/CXS: 96 ',
      items: [
        { str: 'NX020', x: 100, y: 500, w: 30, h: 10 },
        { str: 'FORMA DE GELO C/BASE SILICONE', x: 100, y: 480, w: 200, h: 10 },
        { str: '12 CUBOS', x: 100, y: 465, w: 60, h: 10 },
        { str: 'NCM: 3924.10.00', x: 100, y: 450, w: 100, h: 10 },
        { str: 'IPI:6,5', x: 200, y: 450, w: 40, h: 10 },
        { str: 'DIMENSÃO: 25x11,5x3cm', x: 100, y: 435, w: 120, h: 10 },
        { str: 'PEÇAS/CXS: 96', x: 100, y: 420, w: 80, h: 10 },
        // Preço FORA do bloco textual mas próximo posicionalmente do SKU
        { str: 'R$ 5,50', x: 105, y: 400, w: 50, h: 12 },
        { str: 'unid.', x: 160, y: 400, w: 30, h: 10 },
      ],
    };

    const produtos = interpretPdfSemantically([page], nixTemplate);
    const nx020 = produtos.find(p => p.campos['codigo'] === 'NX020');
    expect(nx020).toBeDefined();
    expect(nx020!.campos['preco']).toBeTruthy();
    // Aceita "5,50" ou "5.50"
    const precoNum = parseFloat(String(nx020!.campos['preco']).replace(',', '.'));
    expect(precoNum).toBeCloseTo(5.50, 2);
  });

  it('escolhe o preço mais próximo do SKU quando há múltiplos preços na página', () => {
    const page: PdfPageData = {
      pageNum: 1,
      text: 'NX020 PROD1 NX021 PROD2',
      items: [
        // NX020 col 1
        { str: 'NX020', x: 100, y: 500, w: 30, h: 10 },
        { str: 'PROD1', x: 100, y: 485, w: 50, h: 10 },
        { str: 'R$ 5,50', x: 105, y: 400, w: 50, h: 12 }, // associa NX020
        // NX021 col 2
        { str: 'NX021', x: 300, y: 500, w: 30, h: 10 },
        { str: 'PROD2', x: 300, y: 485, w: 50, h: 10 },
        { str: 'R$ 12,99', x: 305, y: 400, w: 60, h: 12 }, // associa NX021
      ],
    };
    const produtos = interpretPdfSemantically([page], nixTemplate);
    const nx020 = produtos.find(p => p.campos['codigo'] === 'NX020');
    const nx021 = produtos.find(p => p.campos['codigo'] === 'NX021');
    expect(parseFloat(String(nx020!.campos['preco']).replace(',', '.'))).toBeCloseTo(5.50, 2);
    expect(parseFloat(String(nx021!.campos['preco']).replace(',', '.'))).toBeCloseTo(12.99, 2);
  });

  it('ignora NCM (8211.92.10) como falso preço', () => {
    const page: PdfPageData = {
      pageNum: 1,
      text: 'NX087 FACA P/PAO DE ACO INOX C/CABO BRANCO NCM: 8211.92.10 IPI:7,8 R$ 6,99 unid',
      items: [
        { str: 'NX087', x: 100, y: 500, w: 30, h: 10 },
        { str: 'FACA P/PÃO', x: 100, y: 485, w: 100, h: 10 },
        // NCM tem formato XXXX.XX.XX que poderia casar com preço inválido
        { str: 'NCM: 8211.92.10', x: 100, y: 460, w: 110, h: 10 },
        // Preço real correto
        { str: 'R$ 6,99', x: 105, y: 400, w: 50, h: 12 },
        { str: 'unid', x: 160, y: 400, w: 30, h: 10 },
      ],
    };
    const produtos = interpretPdfSemantically([page], nixTemplate);
    const nx087 = produtos.find(p => p.campos['codigo'] === 'NX087');
    const precoNum = parseFloat(String(nx087!.campos['preco']).replace(',', '.'));
    expect(precoNum).toBeCloseTo(6.99, 2);
    // NÃO deve ser 8211.92 (NCM)
    expect(precoNum).toBeLessThan(100);
  });

  it('preserva preço quando já estava extraído pelo template', () => {
    // Bloco já tem R$ 9,99 capturado pelo template - não deve sobrescrever
    const page: PdfPageData = {
      pageNum: 1,
      text: 'NX020 PRODUTO DESCRICAO LONGA R$ 9,99 unid CONTINUA TEXTO',
      items: [
        { str: 'NX020', x: 100, y: 500, w: 30, h: 10 },
        { str: 'R$ 9,99', x: 105, y: 480, w: 50, h: 12 },
        // Outro preço próximo (não deveria ser usado)
        { str: 'R$ 5,50', x: 105, y: 400, w: 50, h: 12 },
      ],
    };
    const produtos = interpretPdfSemantically([page], nixTemplate);
    const nx020 = produtos.find(p => p.campos['codigo'] === 'NX020');
    const precoNum = parseFloat(String(nx020!.campos['preco']).replace(',', '.'));
    // Deve usar o do template (9,99), não o do pass enriquecedor
    expect(precoNum).toBeCloseTo(9.99, 2);
  });
});
