/**
 * 🔒 Testes — Tuning Folia + Gira + Petrin (28/05/2026)
 *
 * Validado contra planilhas reais do cliente. Trava regressões.
 */
import { describe, it, expect } from 'vitest';
import { foliaAdapter } from './folia';
import { giraAdapter } from './gira';
import { petrinAdapter } from './petrin';
import { goalKidsAdapter } from './goal-kids';
import { goalKidsTemplate } from '../pdfTemplates/goal-kids.template';

// ═══════════════════════════════════════════════════════════════════════════
// FOLIA
// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 FOLIA — tuning após validação real (584 produtos)', () => {
  it('codigoPattern aceita JRF-10.0063 (formato real)', () => {
    expect(foliaAdapter.codigoPattern?.test('JRF-10.0063')).toBe(true);
    expect(foliaAdapter.codigoPattern?.test('JRF_20.1234')).toBe(true);
    expect(foliaAdapter.codigoPattern?.test('JRF-90.99999')).toBe(true);
  });

  it('codigoPattern rejeita strings inválidas', () => {
    expect(foliaAdapter.codigoPattern?.test('ABC123')).toBe(false);
    expect(foliaAdapter.codigoPattern?.test('JRF-XX.YYY')).toBe(false);
  });

  it('NÃO inclui /^FB\\d{3,5}$/ (era código morto, 0 ocorrências reais)', () => {
    const hasFbPattern = foliaAdapter.detectionPatterns.some(p =>
      p instanceof RegExp && p.source.includes('FB')
    );
    expect(hasFbPattern).toBe(false);
  });

  it('exclui linha TOTAIS (catálogo termina com agregação)', () => {
    const hasTotaisRule = foliaAdapter.exclusionRules?.some(r =>
      r.pattern.test('TOTAIS') && r.pattern.test('Totais')
    );
    expect(hasTotaisRule).toBe(true);
  });

  it('NÃO mapeia mais EST.CX para observacoes (era float feio)', () => {
    expect(foliaAdapter.fieldAliases.observacoes).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GIRA
// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 GIRA — aceita variantes com sufixo letra + exclui headers repetidos', () => {
  it('detectionPatterns aceita variantes (GU0091A, TP1008A)', () => {
    const codes = ['GC0220', 'GC0220A', 'GU0091A', 'GU0091B', 'TP1008A', 'GRID033'];
    for (const c of codes) {
      const matched = giraAdapter.detectionPatterns.some(p =>
        p instanceof RegExp ? p.test(c) : new RegExp(p, 'i').test(c)
      );
      expect(matched, `Código "${c}" deve ser detectado`).toBe(true);
    }
  });

  it('exclusionRules ignora header CÓDIGO repetido (a cada 54 linhas)', () => {
    const hasHeaderRule = giraAdapter.exclusionRules?.some(r =>
      r.pattern.test('CÓDIGO') && r.pattern.test('CODIGO') && r.pattern.test('Código')
    );
    expect(hasHeaderRule).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PETRIN
// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 PETRIN — mapeia Emb + Qtd Emb (Físico) + codigoPattern', () => {
  it('embalagem alias inclui "emb" (header literal da planilha)', () => {
    expect(petrinAdapter.fieldAliases.embalagem).toContain('emb');
  });

  it('quantidadeCaixa cobre "Qtd Emb (Físico)" (header completo)', () => {
    const aliases = petrinAdapter.fieldAliases.quantidadeCaixa || [];
    const coverage = aliases.some(a => a.toLowerCase().includes('fisico') || a.toLowerCase().includes('emb'));
    expect(coverage).toBe(true);
  });

  it('codigoPattern cobre RD1318, RD.1120, RD1098-1', () => {
    expect(petrinAdapter.codigoPattern?.test('RD1318')).toBe(true);
    expect(petrinAdapter.codigoPattern?.test('RD.1120')).toBe(true);
    expect(petrinAdapter.codigoPattern?.test('RD1098-1')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GOAL KIDS
// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 GOAL KIDS — template novo (194 pgs, padrão consistente)', () => {
  it('blockExtractor separa produtos por código GK', () => {
    const texto = `GK3493
BONECA C/ MOTOCICLETA
Quant: 120 PÇ/CX
Preço: R$19,84
GK2927
BONECA C/ BICICLETA
Quant: 60 PÇ/CX
Preço: R$26,50`;

    const blocks = texto.split(goalKidsTemplate.blockExtractor as RegExp).filter(b => b.trim().length > 5);
    expect(blocks.length).toBe(2);
    expect(blocks[0]).toMatch(/^GK3493/);
    expect(blocks[1]).toMatch(/^GK2927/);
  });

  it('codigo extractor captura GK + 3-5 dígitos', () => {
    const samples = [
      { texto: 'GK3493 BONECA', expected: 'GK3493' },
      { texto: 'GK0155 BONECA DA MODA', expected: 'GK0155' },
      { texto: 'GK12345', expected: 'GK12345' },
    ];
    const regex = goalKidsTemplate.fieldExtractors!.codigo as RegExp;
    for (const { texto, expected } of samples) {
      const m = texto.match(regex);
      expect(m?.[1]).toBe(expected);
    }
  });

  it('preco captura mesmo com encoding quebrado (Pre�o)', () => {
    const regex = goalKidsTemplate.fieldExtractors!.preco as RegExp;
    expect('Preço: R$19,84'.match(regex)?.[1]).toBe('19,84');
    expect('Pre�o: R$26,50'.match(regex)?.[1]).toBe('26,50');
    expect('Pre?o: R$4,99'.match(regex)?.[1]).toBe('4,99');
  });

  it('quantidadeCaixa captura "Quant: NN PÇ/CX"', () => {
    const regex = goalKidsTemplate.fieldExtractors!.quantidadeCaixa as RegExp;
    expect('Quant: 120 PÇ/CX'.match(regex)?.[1]).toBe('120');
    expect('Quant: 36 PC/CX'.match(regex)?.[1]).toBe('36');
    expect('Quant: 60 P�/CX'.match(regex)?.[1]).toBe('60');
  });

  it('adapter goalKidsAdapter já existe e tem codigoPattern', () => {
    expect(goalKidsAdapter.codigoPattern?.test('GK3493')).toBe(true);
  });
});
