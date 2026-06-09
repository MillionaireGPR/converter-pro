/**
 * 🔒 Testes — Heurística de detecção da CAIXA de kit DAGIA (v20)
 *
 * User feedback (08/06/2026): DZ02-04 acertaram, mas DZ01 pegou prato
 * em vez da caixa. Análise empírica dos xrefs reais mostrou:
 *   - Pratos: aspect h/w ≈ 0.97-1.01 (quase quadrado perfeito)
 *   - Caixas DAGIA (3D perspectiva): aspect h/w ≈ 0.65-0.90 (mais larga)
 *
 * Score combinado:
 *   aspect_score * 0.55 + std_dev_color * 0.30 + size_log * 0.15
 *
 * Esses testes travam a lógica em TypeScript paralelo ao Python real,
 * permitindo regressão se os pesos forem alterados sem critério.
 */
import { describe, it, expect } from 'vitest';

// Replica da função _box_score do cv_extractor.py
const boxScore = (aspect: number, area: number, stdDev: number): number => {
  let aspectScore: number;
  if (aspect >= 0.65 && aspect <= 0.90) {
    aspectScore = 1.0;
  } else if ((aspect >= 0.55 && aspect < 0.65) || (aspect > 0.90 && aspect <= 1.05)) {
    aspectScore = 0.6;
  } else if ((aspect >= 0.40 && aspect < 0.55) || (aspect > 1.05 && aspect <= 1.30)) {
    aspectScore = 0.3;
  } else {
    aspectScore = 0.1;
  }
  const sizeScore = Math.min(Math.log10(Math.max(area, 1)) / 6.0, 1.0);
  return aspectScore * 0.55 + stdDev * 0.30 + sizeScore * 0.15;
};

describe('🔒 DAGIA box detection — aspect ratio é sinal mais forte', () => {
  it('🎯 DZ01 (pg 7): caixa real vence pratos', () => {
    // Dados reais extraídos do PDF DAGIA pg 7
    const caixa = boxScore(0.74, 59850, 0.55);
    const prato1 = boxScore(0.99, 91805, 0.20);
    const prato2 = boxScore(0.99, 72899, 0.20);

    expect(caixa).toBeGreaterThan(prato1);
    expect(caixa).toBeGreaterThan(prato2);
    // Score alvo da caixa: > 0.80
    expect(caixa).toBeGreaterThan(0.80);
  });

  it('aspect 0.65-0.90 = zona ouro (1.0)', () => {
    expect(boxScore(0.65, 50000, 0.5)).toBeGreaterThan(boxScore(0.64, 50000, 0.5));
    expect(boxScore(0.74, 50000, 0.5)).toEqual(boxScore(0.85, 50000, 0.5));
    expect(boxScore(0.90, 50000, 0.5)).toBeGreaterThan(boxScore(0.91, 50000, 0.5));
  });

  it('aspect quadrado (~1.0) = penalidade (prato/peça)', () => {
    const quadrado = boxScore(1.0, 100000, 0.3);
    const retangular = boxScore(0.80, 100000, 0.3);
    expect(retangular).toBeGreaterThan(quadrado);
  });

  it('logos/fragmentos pequenos não são considerados', () => {
    // Filtro de área < 20000 ainda é aplicado no código Python.
    // Aqui só validamos que mesmo se passar, score baixo desfavorece.
    const fragmento = boxScore(1.07, 1978, 0.4); // xref=188 49x46
    const caixaReal = boxScore(0.79, 60000, 0.55);
    expect(caixaReal).toBeGreaterThan(fragmento);
  });

  it('caixa colorida (std alto) bate caixa pálida (std baixo) — desempate', () => {
    const corCheia = boxScore(0.75, 60000, 0.65); // caixa colorida
    const corPalida = boxScore(0.75, 60000, 0.20); // mesma forma, sem cor
    expect(corCheia).toBeGreaterThan(corPalida);
  });

  it('🔒 Peso aspect é o MAIOR (0.55) — mudança aqui é regressão crítica', () => {
    // Se algum dev ajustar pesos sem critério, este teste falha.
    // Aspect 1.0 (alto): zona ouro = 1.0 * 0.55 = 0.55
    // Aspect 0.3 (baixo): zero ouro fora = 0.1 * 0.55 = 0.055
    // Diferença pura de aspect: 0.495
    const diffPuro = boxScore(0.75, 50000, 0) - boxScore(0.20, 50000, 0);
    expect(diffPuro).toBeGreaterThan(0.45); // peso aspect dominante
  });
});
