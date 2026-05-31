/**
 * 🔒 Testes — Tuning FLASH + LEVIVAN (29/05/2026)
 *
 * Validado contra planilhas reais (Flashgoods 23.03, Levivan 27-03).
 */
import { describe, it, expect } from 'vitest';
import { flashAdapter } from './flash';
import { levivanAdapter } from './levivan';

// ═══════════════════════════════════════════════════════════════════════════
// FLASH
// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 FLASH — detectionPattern F\\d{3,4} (NÃO mais FL/FS)', () => {
  it('codigoPattern aceita códigos reais F0211, F0492', () => {
    expect(flashAdapter.codigoPattern?.test('F0211')).toBe(true);
    expect(flashAdapter.codigoPattern?.test('F0492')).toBe(true);
    expect(flashAdapter.codigoPattern?.test('F9999')).toBe(true);
  });

  it('codigoPattern rejeita variantes inválidas', () => {
    // Versão antiga aceitava FL... e FS... mas códigos reais são F + 4 dígitos.
    expect(flashAdapter.codigoPattern?.test('FL1234')).toBe(false);
    expect(flashAdapter.codigoPattern?.test('CK1234')).toBe(false); // CLINK
    expect(flashAdapter.codigoPattern?.test('LV1234')).toBe(false);
  });

  it('detectionPatterns inclui F\\d{3,4} (catálogo real)', () => {
    const hasFPattern = flashAdapter.detectionPatterns.some(p =>
      p instanceof RegExp && p.test('F0211')
    );
    expect(hasFPattern).toBe(true);
  });

  it('NÃO usa mais FL/FS (eram patterns mortos no catálogo real)', () => {
    // Catálogo real tem 426 produtos, TODOS no formato F\d{3,4}.
    // Os patterns FL e FS antigos não casavam com nada.
    const hasFlPattern = flashAdapter.detectionPatterns.some(p =>
      p instanceof RegExp && p.source.includes('FL[')
    );
    expect(hasFlPattern).toBe(false);
  });

  it('hasMultiplePriceTables: false (planilha só tem P.Venda)', () => {
    expect(flashAdapter.hasMultiplePriceTables).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LEVIVAN
// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 LEVIVAN — fix crítico de semântica quantidadeCaixa vs estoque', () => {
  it('quantidadeCaixa NÃO inclui "emb" ou "cx" (eram coluna Emb, não qtdCaixa)', () => {
    // Bug histórico: "Qtd Emb (Físico)" tem valores tipo 967 (estoque).
    // Se mapeado como quantidadeCaixa, produto saía com "967 unid/cx".
    const aliases = levivanAdapter.fieldAliases.quantidadeCaixa || [];
    expect(aliases).not.toContain('emb');
    expect(aliases).not.toContain('cx');
    expect(aliases).not.toContain('qtd emb');
  });

  it('embalagem mapeia "emb" (header literal da planilha)', () => {
    const aliases = levivanAdapter.fieldAliases.embalagem || [];
    expect(aliases).toContain('emb');
  });

  it('codigoPattern aceita LV\\d{3,5}', () => {
    expect(levivanAdapter.codigoPattern?.test('LV1009')).toBe(true);
    expect(levivanAdapter.codigoPattern?.test('LV1078')).toBe(true);
    expect(levivanAdapter.codigoPattern?.test('LV99999')).toBe(true);
  });

  it('codigoPattern rejeita ruído', () => {
    expect(levivanAdapter.codigoPattern?.test('Referência')).toBe(false);
    expect(levivanAdapter.codigoPattern?.test('LV')).toBe(false);
    expect(levivanAdapter.codigoPattern?.test('XYZ123')).toBe(false);
  });

  it('exclusionRule cobre header repetido em multi-sheet', () => {
    const hasRefRule = levivanAdapter.exclusionRules?.some(r =>
      r.pattern.test('Referência') && r.pattern.test('REFERENCIA')
    );
    expect(hasRefRule).toBe(true);
  });
});
