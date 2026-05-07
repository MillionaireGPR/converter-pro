/**
 * Testa o parser do PDF de pedido do Mercos.
 * Usa apenas as funções de parsing de strings — sem dependência de PDF.js
 * (que requer browser environment).
 */
import { describe, it, expect } from 'vitest';
import { parseDescPercent as parseDescExported, parseBRL as parseBRLExported } from './mercosOrderPdfParser';

// Aliases para compatibilidade com os testes
const parseDescPercent = parseDescExported;
const parseBRLLegacy = (raw: string): number => {
  if (!raw) return 0;
  const cleaned = raw
    .replace(/R\$\s*/gi, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.\-]/g, '');
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
};

describe('parseDescPercent', () => {
  it('"30%" => 0.30', () => {
    expect(parseDescPercent('30%')).toBeCloseTo(0.30, 4);
  });
  it('"30% + 15%" => composto cumulativo 0.405', () => {
    expect(parseDescPercent('30% + 15%')).toBeCloseTo(0.405, 4);
  });
  it('"" => 0', () => {
    expect(parseDescPercent('')).toBe(0);
  });
  it('"30,5%" => 0.305 (virgula)', () => {
    expect(parseDescPercent('30,5%')).toBeCloseTo(0.305, 4);
  });
});

describe('parseBRL', () => {
  it('"R$ 8,90" => 8.90', () => {
    expect(parseBRLExported('R$ 8,90')).toBeCloseTo(8.90, 2);
  });
  it('"R$ 1.601,46" => 1601.46 (separador de milhar BR)', () => {
    expect(parseBRLExported('R$ 1.601,46')).toBeCloseTo(1601.46, 2);
  });
  it('"R$ 9.648,93" => 9648.93', () => {
    expect(parseBRLExported('R$ 9.648,93')).toBeCloseTo(9648.93, 2);
  });
  it('vazio => 0', () => {
    expect(parseBRLExported('')).toBe(0);
  });
});

describe('regex de item de pedido Mercos', () => {
  const itemRegex = /^(\d+)\s+([A-Z0-9]{2,12})\s+(.+?)\s+(\d+)\s+([\d%+\s]+%)\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)$/;

  it('reconhece linha simples com 1 desconto', () => {
    const linha = '1 F0189 BOMBONIERE 500ML VIDRO 13,9CM X 18CM***PROMOCAO*** 180 30% R$ 8,90 R$ 1.601,46';
    const m = linha.match(itemRegex);
    expect(m).toBeTruthy();
    expect(m![2]).toBe('F0189');
    expect(m![4]).toBe('180');
    expect(m![5].trim()).toBe('30%');
    expect(parseBRLExported(m![6])).toBeCloseTo(8.90);
    expect(parseBRLExported(m![7])).toBeCloseTo(1601.46);
  });

  it('reconhece linha com desconto composto "30% + 15%"', () => {
    const linha = '2 F5297 CANECA 350ML AÇO E PLÁSTICO 11,8CM 48 30% + 15% R$ 12,41 R$ 595,48';
    const m = linha.match(itemRegex);
    expect(m).toBeTruthy();
    expect(m![2]).toBe('F5297');
    expect(m![4]).toBe('48');
    expect(m![5].trim()).toBe('30% + 15%');
    expect(parseDescPercent(m![5])).toBeCloseTo(0.405, 4);
  });

  it('reconhece codigo numerico+letra (FASTNEO style nao se aplica - mas codigos de 12 chars)', () => {
    const linha = '10 F5116 GARRAFA 600ML 7CM X 21,5CM 120 30% R$ 3,50 R$ 420,00';
    const m = linha.match(itemRegex);
    expect(m).toBeTruthy();
    expect(m![2]).toBe('F5116');
    expect(parseBRLExported(m![7])).toBeCloseTo(420.00);
  });
});

describe('extracao de cabecalho via regex (sample do PDF Mercos)', () => {
  const sample = `Nunes Representacoes
Pedido Nº 12961
Representada: FLASHGOODS / FLASHGOODS COMERCIO DE IMPORTACAO E EXPORTACAO LTDA
CNPJ: 40.165.831/0003-08
Telefone: (47) 3083-9191
Cliente: COMERCIAL NG DE ARMARINHO LTDA - EPP Nome Fantasia: COMERCIAL NG DE ARMARINHO
CNPJ: 24.934.598/0001-54 Inscrição Estadual: 07330791001-13
Endereço: CNG 06 LOTE 02 S/N LOJA / SOBRELOJA 01
Bairro: TAGUATINGA CEP: 72130-065
Cidade: BRASILÍA Estado: Distrito Federal
Telefone: (61) 3033-8245 E-mail: ngatacado@hotmail.com
Contato: VIEIRA
Vendedor: JOSEF AMARAL
Transportadora:
SONIC TRANSPORTE
Telefone:
11-2528-5677
Data de Emissão: 17/04/2026
Condição de Pagamento: BOLETO + BOLETO 15DD
Valor total: R$ 9.648,93`;

  it('extrai numero do pedido', () => {
    expect(sample.match(/Pedido\s*N[ºo]?\s*(\d+)/i)?.[1]).toBe('12961');
  });

  it('extrai CNPJs (ordem: fornecedor primeiro, cliente segundo)', () => {
    const cnpjs = Array.from(sample.matchAll(/CNPJ:\s*([\d./\-]+)/gi)).map(m => m[1].trim());
    expect(cnpjs[0]).toBe('40.165.831/0003-08');
    expect(cnpjs[1]).toBe('24.934.598/0001-54');
  });

  it('extrai nome do cliente', () => {
    expect(sample.match(/Cliente:\s*(.+?)(?=\s*Nome Fantasia:|\n)/i)?.[1].trim())
      .toBe('COMERCIAL NG DE ARMARINHO LTDA - EPP');
  });

  it('extrai inscricao estadual', () => {
    expect(sample.match(/Inscri[çc][ãa]o\s+Estadual:\s*([\d./\-]+)/i)?.[1])
      .toBe('07330791001-13');
  });

  it('extrai CEP', () => {
    expect(sample.match(/CEP:\s*([\d\-]+)/i)?.[1]).toBe('72130-065');
  });

  it('extrai data de emissao', () => {
    expect(sample.match(/Data\s+de\s+Emiss[ãa]o:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1])
      .toBe('17/04/2026');
  });

  it('extrai vendedor', () => {
    expect(sample.match(/Vendedor:\s*(.+?)(?=\n|Transportadora)/i)?.[1].trim())
      .toBe('JOSEF AMARAL');
  });

  it('extrai valor total', () => {
    expect(parseBRLExported(sample.match(/Valor\s+total:\s*R?\$\s*([\d.,]+)/i)?.[1] || ''))
      .toBeCloseTo(9648.93, 2);
  });

  it('mapeia "Distrito Federal" -> "DF"', () => {
    const ufMap: Record<string, string> = {
      'Distrito Federal': 'DF', 'São Paulo': 'SP', 'Rio de Janeiro': 'RJ',
    };
    const estado = sample.match(/Estado:\s*(.+?)(?=\nTelefone:|\sTelefone:|\n)/i)?.[1].trim() || '';
    expect(ufMap[estado]).toBe('DF');
  });
});
