/**
 * 🔒 TESTES DE REGRESSÃO — Adapter tuning de 28/05/2026
 *
 * Após validação com PDFs/Excel reais do cliente, ajustes foram aplicados em:
 *   - bm36.ts:       codigoPattern aceita WC + exclui "Pag: NN"
 *   - lila-home.ts:  exclusionRule "SUB" aceita "SUB 18", "SUB 4", etc
 *   - dagia.ts:      detectionPatterns ampliado p/ DCM/DS/DM/DV/LHSP/LX/CF*
 *   - freecom.ts:    looksLikeCode aceita códigos com `+` (ex: K7625+JK7003)
 *
 * Cada teste aqui falharia se um desses ajustes fosse revertido.
 */
import { describe, it, expect } from 'vitest';
import { bm36Adapter } from './bm36';
import { lilaHomeAdapter } from './lila-home';
import { dagiaAdapter } from './dagia';
import { freecomAdapter } from './freecom';
import { detectSupplier } from './registry';

// ═══════════════════════════════════════════════════════════════════════════
// 🔒 BM36 — codigoPattern aceita WC + exclui "Pag: N"
// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 BM36 — ajustes do catálogo real (BM + WC)', () => {
  it('codigoPattern aceita códigos BM (família principal)', () => {
    expect(bm36Adapter.codigoPattern?.test('BM361645')).toBe(true);
    expect(bm36Adapter.codigoPattern?.test('BM361643')).toBe(true);
  });

  it('codigoPattern aceita códigos WC (World Classic) — NÃO REGREDIR', () => {
    // Versão anterior `/^B\d{3,5}/i` rejeitava WC. Catálogo real tem
    // ambas as linhas misturadas → WC era perdido.
    expect(bm36Adapter.codigoPattern?.test('WC411011')).toBe(true);
    expect(bm36Adapter.codigoPattern?.test('WC123')).toBe(true);
  });

  it('codigoPattern continua rejeitando ruído', () => {
    expect(bm36Adapter.codigoPattern?.test('ABC123')).toBe(false);
    expect(bm36Adapter.codigoPattern?.test('123456')).toBe(false);
  });

  it('exclusionRules ignora rodapé "Pag: NN"', () => {
    const hasPagRule = bm36Adapter.exclusionRules?.some(r =>
      r.pattern.test('Pag: 002') && r.pattern.test('Pag: 123')
    );
    expect(hasPagRule).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔒 LILA HOME — exclusionRule SUB com número
// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 LilaHome — exclusionRule SUB aceita variantes', () => {
  it('exclui "SUB" puro (compat)', () => {
    const matchesSub = lilaHomeAdapter.exclusionRules?.some(r => r.pattern.test('SUB'));
    expect(matchesSub).toBe(true);
  });

  it('exclui "SUB 18", "SUB 4", "SUB 10" — NÃO REGREDIR', () => {
    // Versão anterior `/^SUB$/i` deixava "SUB 18" passar como ruído.
    const variants = ['SUB 18', 'SUB 4', 'SUB 10', 'SUB  100'];
    for (const v of variants) {
      const matched = lilaHomeAdapter.exclusionRules?.some(r => r.pattern.test(v));
      expect(matched, `"${v}" deve ser excluído`).toBe(true);
    }
  });

  it('NÃO exclui palavras que começam com SUB (false positive)', () => {
    // "SUBSTITUTO", "SUBSCRIBE" não podem cair na regra
    const nonMatches = ['SUBSTITUTO', 'SUBJETIVO'];
    for (const v of nonMatches) {
      const matched = lilaHomeAdapter.exclusionRules?.some(r => r.pattern.test(v));
      expect(matched, `"${v}" NÃO deve ser excluído`).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔒 DAGIA — detectionPatterns ampliados
// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 DAGIA — detectionPatterns cobrem famílias reais', () => {
  it('detecta famílias principais (DXP, DXPD, DZ, DPB)', () => {
    const samples = ['DXP25', 'DXPD53', 'DZ04', 'DPB01'];
    for (const code of samples) {
      const matched = dagiaAdapter.detectionPatterns.some(p =>
        p instanceof RegExp ? p.test(code) : new RegExp(p, 'i').test(code)
      );
      expect(matched, `Código "${code}" deve ser detectado`).toBe(true);
    }
  });

  it('detecta famílias secundárias (DCM, DS, DM, DV, LHSP, LX, CF*) — NÃO REGREDIR', () => {
    // Adapter anterior cobria só DXP/DXPD/DZ/DPB. Validação em catálogo real
    // 25-03-2026 mostrou ~50% dos SKUs nessas outras famílias.
    const samples = ['DCM25', 'DS10', 'DM11', 'DV31', 'LHSP75', 'LX15016', 'CF001/L12', 'CF029A/L12'];
    for (const code of samples) {
      const matched = dagiaAdapter.detectionPatterns.some(p =>
        p instanceof RegExp ? p.test(code) : new RegExp(p, 'i').test(code)
      );
      expect(matched, `Código "${code}" deve ser detectado`).toBe(true);
    }
  });

  it('detectSupplier identifica DAGIA pelo nome no documento', () => {
    const result = detectSupplier(
      'CATÁLOGO DAGIA 2026',
      undefined,
      ['DXP25', 'DCM26']
    );
    expect(result.adapter.id).toBe('dagia-0000-0000-4000-a000-000000000000');
    expect(result.confianca).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔒 FREECOM — looksLikeCode aceita códigos com `+`
// ═══════════════════════════════════════════════════════════════════════════
describe('🔒 FreeCom — códigos com caractere especial', () => {
  it('extrai produto com código contendo `+` — NÃO REGREDIR', () => {
    // Catálogo real linha 749: K7625+JK7003 era silenciosamente descartado
    // pela versão anterior `/^[A-Z0-9-]{4,15}$/i`.
    const brutos = [{
      origemArquivo: 'test.xlsx',
      campos: {
        'B': 'K7625+JK7003',
        'C': 'OCT - PRODUTO COMBO',
        'E': 12,
        'F': 50.0,
      },
      paginaOrigem: 1,
      linhaOrigem: 1,
    }];

    const produtos = freecomAdapter.extract!(brutos as any, freecomAdapter);
    expect(produtos.length).toBe(1);
    expect(produtos[0].codigo).toBe('K7625+JK7003');
    expect(produtos[0].precoBase).toBeGreaterThan(0);
  });

  it('continua aceitando códigos normais (alphanumeric)', () => {
    const brutos = [{
      origemArquivo: 'test.xlsx',
      campos: { 'B': '03SH5J01', 'C': 'PROD NORMAL', 'E': 6, 'F': 30.0 },
      paginaOrigem: 1,
      linhaOrigem: 1,
    }];
    const produtos = freecomAdapter.extract!(brutos as any, freecomAdapter);
    expect(produtos.length).toBe(1);
    expect(produtos[0].codigo).toBe('03SH5J01');
  });

  it('continua aceitando códigos com hífen (ex: 2306316-3)', () => {
    const brutos = [{
      origemArquivo: 'test.xlsx',
      campos: { 'B': '2306316-3', 'C': 'PROD COM HIFEN', 'E': 4, 'F': 25.0 },
      paginaOrigem: 1,
      linhaOrigem: 1,
    }];
    const produtos = freecomAdapter.extract!(brutos as any, freecomAdapter);
    expect(produtos.length).toBe(1);
    expect(produtos[0].codigo).toBe('2306316-3');
  });

  it('rejeita strings óbvias que não são código (ex: "TOTAL")', () => {
    const brutos = [{
      origemArquivo: 'test.xlsx',
      campos: { 'B': 'TOTAL GERAL', 'C': 'linha total', 'F': 100 },
      paginaOrigem: 1,
      linhaOrigem: 1,
    }];
    const produtos = freecomAdapter.extract!(brutos as any, freecomAdapter);
    // "TOTAL GERAL" tem espaço, não passa em /^[A-Z0-9+\-]{4,20}$/i
    expect(produtos.length).toBe(0);
  });
});
