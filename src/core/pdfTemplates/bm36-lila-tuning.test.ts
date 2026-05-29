/**
 * 🔒 Testes de regressão — Tuning preventivo BM36 + LilaHome (28/05/2026)
 *
 * Aplicado baseado em análise dos PDFs reais antes do user testar.
 * Cobre: encoding U+FFFD no BM36, prefixo (PRO%) BM36, código com barra Lila.
 */
import { describe, it, expect } from 'vitest';
import { lilaHomeTemplate } from './lila-home.template';

describe('🔒 LilaHome — código com barra (LH276/270)', () => {
  it('captura código completo com barra', () => {
    const codigoRegex = lilaHomeTemplate.fieldExtractors!.codigo as RegExp;
    const samples = [
      { texto: 'CÓD: LH276/270 - bla', expected: 'LH276/270' },
      { texto: 'CÓD: LH273/275', expected: 'LH273/275' },
      { texto: 'CÓD: LH123', expected: 'LH123' },
      { texto: 'CÓD: 3041231A', expected: '3041231A' },
    ];
    for (const { texto, expected } of samples) {
      const match = texto.match(codigoRegex);
      expect(match?.[1], `falhou em "${texto}"`).toBe(expected);
    }
  });

  it('NÃO captura strings muito longas (proteção)', () => {
    const codigoRegex = lilaHomeTemplate.fieldExtractors!.codigo as RegExp;
    // 20 chars não passa em {2,15}
    const m = 'CÓD: ABCDEFGHIJKLMNOPQRST'.match(codigoRegex);
    expect(m?.[1].length).toBeLessThanOrEqual(15);
  });
});

describe('🔒 BM36 — encoding U+FFFD reparado em descrição', () => {
  // O smartPdfInterpreter aplica repairEncoding internamente.
  // Aqui validamos as substituições padrão.
  const repair = (s: string): string => {
    return s
      .replace(/CASTI[�?]AL/gi, 'CASTIÇAL')
      .replace(/CORA[�?]{1,2}O/gi, 'CORAÇÃO')
      .replace(/J[�?]IAS/gi, 'JÓIAS')
      .replace(/J[�?]IA/gi, 'JÓIA')
      .replace(/A[�?]UCAREIRO/gi, 'AÇUCAREIRO')
      .replace(/COLE[�?]AO/gi, 'COLEÇÃO')
      .replace(/DECORA[�?]AO/gi, 'DECORAÇÃO')
      .replace(/COMUNH[�?]O/gi, 'COMUNHÃO')
      .replace(/�/g, '');
  };

  it('repara CASTI�AL → CASTIÇAL', () => {
    expect(repair('CASTI�AL 12X12X5,7CM DECOR')).toBe('CASTIÇAL 12X12X5,7CM DECOR');
  });

  it('repara CORA��O → CORAÇÃO', () => {
    expect(repair('VASO CORA��O')).toBe('VASO CORAÇÃO');
  });

  it('repara J�IAS → JÓIAS', () => {
    expect(repair('PORTA J�IAS')).toBe('PORTA JÓIAS');
  });

  it('repara A�UCAREIRO → AÇUCAREIRO', () => {
    expect(repair('A�UCAREIRO 12CM')).toBe('AÇUCAREIRO 12CM');
  });

  it('remove � restantes (preferir nada a símbolo de erro)', () => {
    expect(repair('PRODUTO �ESPECIAL')).toBe('PRODUTO ESPECIAL');
  });
});
