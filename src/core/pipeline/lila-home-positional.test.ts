/**
 * 🔒 LILA HOME — pass posicional de nome + preço (validação empírica)
 *
 * BUG REPORTADO PELO USER (09/06/2026):
 *   Centenas de produtos importados com nome = código SKU (LH78, LH835, ...)
 *   em vez do nome real ("KIT BOWL DE CERÂMICA", etc).
 *
 * CAUSA RAIZ:
 *   Layout LILA HOME tem blocos `CÓD:` agrupados no topo da página, e os
 *   nomes + preços vêm DEPOIS em ordem visual. O blockExtractor cortava
 *   por CÓD, então o regex `descricao` capturava MATERIAL como nome (ex:
 *   "FIBRA DE BAMBU ECO") ou retornava vazio (caindo no fallback do SKU).
 *
 * FIX:
 *   `_extractLilaNamesAndPrices` varre a página INTEIRA coletando nomes
 *   (linhas em CAPS, filtra cores e keywords técnicas) e preços em ordem
 *   textual. Quem chama atribui em paralelo aos produtos da página.
 *
 * Esses testes usam dados reais extraídos do catálogo "LILA HOME 26.03"
 * (texto via PyMuPDF). Se alguém mexer no filtro sem testar, o teste falha.
 */
import { describe, it, expect } from 'vitest';
import { _extractLilaNamesAndPrices } from './smartPdfInterpreter';

describe('🔒 LILA HOME — extrai nomes e preços em ordem textual', () => {
  it('PG7 do catálogo: 4 códigos, 4 preços, 4 nomes corretos', () => {
    // Texto real da pg 7 (truncado pra trecho relevante)
    const text = `
KIT BOWLS C/ COLHER
CÓD: LH79
MATERIAL: CERÂMICA
TAMANHO: 23.5*20.5*5CM
COR: BRANCO
CX: 36 PEÇAS
IPI: 13,00 % NCM:69139000
CÓD: LH750
MATERIAL: CERÂMICA
TAMANHO: 6*10 CM
COR: AZUL CLARO, AZUL ESCURO
BRANCO E CINZA
CX: 36 PEÇAS
IPI: 13,00 % NCM: 69139000
CÓD: LH78
MATERIAL: CERÂMICA
TAMANHO:29*19*6CM
COR: 3 CORES SORTIDAS
CX: 3 PEÇAS
IPI: 13,00 % NCM:69139000
R$49,99
KIT BOWL DE CERÂMICA
R$ 38,00
KIT 2 PÇ BOWL DE CERÂMICA
 R$ 25,00
CÓD: LH835
MATERIAL: CERÂMICA
TAMANHO: 13*10*4 CM
COR: 1 COR
CX:120 PEÇAS
IPI: 13,00 % NCM: 69139000
BOWL DE CERÂMICA
R$12,00
SUB CX 10
`;
    const { names, prices } = _extractLilaNamesAndPrices(text);
    expect(names).toEqual([
      'KIT BOWLS C/ COLHER',
      'KIT BOWL DE CERÂMICA',
      'KIT 2 PÇ BOWL DE CERÂMICA',
      'BOWL DE CERÂMICA',
    ]);
    expect(prices).toEqual(['49.99', '38.00', '25.00', '12.00']);
  });

  it('PG13 do catálogo: blocos sem nome no bloco, nomes na lista', () => {
    const text = `
CÓD: LH429
MATERIAL: FIBRA DE BAMBU ECO
TAMANHO:18*17
COR:ESTAMPAS SORTIDAS
CX: 48 PEÇAS
IPI: 6,50 % NCM:39241000
CÓD: LH426
MATERIAL: FIBRA DE BAMBU ECO
TAMANHO:21*22*2
COR:LILAS CX 32
IPI: 6,50 % NCM:39241000
KIT ALIMENTAÇÃO 5 PEÇAS
R$ 35,00
TIGELA INFANTIL
R$ 20,00
CÓD: LH427
MATERIAL: FIBRA DE BAMBU ECO
TAMANHO:21*22*2
COR:VERDE
CX: 28 PEÇAS
IPI: 6,50 % NCM:39241000
KIT ALIMENTAÇÃO 5 PEÇAS
R$ 35,00
CÓD: LH428
MATERIAL: FIBRA DE BAMBU ECO
TAMANHO:21*22*2
COR:ROSA
CX: 28  PEÇAS
IPI: 6,50 % NCM:39241000
R$ 35,00
KIT ALIMENTAÇÃO 5 PEÇAS
`;
    const { names, prices } = _extractLilaNamesAndPrices(text);
    expect(names).toEqual([
      'KIT ALIMENTAÇÃO 5 PEÇAS',
      'TIGELA INFANTIL',
      'KIT ALIMENTAÇÃO 5 PEÇAS',
      'KIT ALIMENTAÇÃO 5 PEÇAS',
    ]);
    expect(prices).toEqual(['35.00', '20.00', '35.00', '35.00']);
  });

  it('filtra COR composta (BRANCO E CINZA, ESTAMPAS SORTIDAS, AZUL CLARO)', () => {
    const text = `
BRANCO E CINZA
KIT BOWL DE CERÂMICA
ESTAMPAS SORTIDAS
TIGELA INFANTIL
AZUL CLARO
KIT PORTA TEMPERO
`;
    const { names } = _extractLilaNamesAndPrices(text);
    expect(names).toEqual([
      'KIT BOWL DE CERÂMICA',
      'TIGELA INFANTIL',
      'KIT PORTA TEMPERO',
    ]);
  });

  it('filtra linhas com ":" (MATERIAL:, TAMANHO:, COR:)', () => {
    const text = `
MATERIAL: CERÂMICA
TAMANHO: 25CM
COR: BRANCO
NCM: 69139000
KIT BOWL DE CERÂMICA
`;
    const { names } = _extractLilaNamesAndPrices(text);
    expect(names).toEqual(['KIT BOWL DE CERÂMICA']);
  });

  it('filtra prefixos técnicos (NCM, IPI, CX, PEÇAS, SUB, CÓD)', () => {
    const text = `
NCM 12345678
IPI 13 PCT
CX 36 PEÇAS
SUB CX 10
PEÇAS SORTIDAS
KIT BOWL DE CERÂMICA
`;
    const { names } = _extractLilaNamesAndPrices(text);
    expect(names).toEqual(['KIT BOWL DE CERÂMICA']);
  });

  it('captura preços com e sem espaço, vírgula ou ponto decimal', () => {
    // Catálogo LILA HOME real não tem preços > 999,99 — regex simples suficiente.
    const text = `R$49,99 R$ 38.00 R$ 480,00 R$25,00`;
    const { prices } = _extractLilaNamesAndPrices(text);
    expect(prices).toEqual(['49.99', '38.00', '480.00', '25.00']);
  });

  it('🔒 nomes não podem conter ":" sob nenhuma circunstância', () => {
    // Se alguém afrouxar o filtro, este teste falha
    const text = `MATERIAL: CERÂMICA\nKIT BOWL DE CERÂMICA\nTAMANHO: 25CM\n`;
    const { names } = _extractLilaNamesAndPrices(text);
    expect(names.every(n => !n.includes(':'))).toBe(true);
  });
});
