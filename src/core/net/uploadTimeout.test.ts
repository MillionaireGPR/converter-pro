/**
 * Trava o prazo de upload que causou o IMG-GEN do Dute/FORTAL (11/09/2026).
 *
 * O navegador cortava o POST aos 180s fixos enquanto o catálogo de 68MB
 * precisava de 242s no link do cliente. O servidor estava saudável — na única
 * tentativa que passou ele devolveu 611 fotos e o ZIP inteiro —, mas o cliente
 * lia "a captação de fotos não funcionou neste catálogo".
 */
import { describe, it, expect } from 'vitest';
import { uploadTimeoutMs, uploadTimeoutForAttempt } from './uploadTimeout';

const MB = 1024 * 1024;
const TETO_MS = 30 * 60 * 1000;

describe('uploadTimeoutMs', () => {
  it('cobre o tempo REAL medido do Dute (68MB levou 242s)', () => {
    expect(uploadTimeoutMs(68 * MB)).toBeGreaterThan(242_000);
  });

  it('nunca desce abaixo de 120s por tentativa (IV-07)', () => {
    expect(uploadTimeoutMs(0)).toBeGreaterThanOrEqual(120_000);
    expect(uploadTimeoutMs(1)).toBeGreaterThanOrEqual(120_000);
  });

  it('é sempre finito (IV-08) — nem o maior catálogo aceito prende a tela', () => {
    expect(uploadTimeoutMs(600 * MB)).toBeLessThanOrEqual(TETO_MS);
    expect(uploadTimeoutMs(99_999 * MB)).toBe(TETO_MS);
  });

  it('cresce junto com o arquivo', () => {
    expect(uploadTimeoutMs(300 * MB)).toBeGreaterThan(uploadTimeoutMs(100 * MB));
  });
});

describe('uploadTimeoutForAttempt — a retentativa ganha mais tempo', () => {
  it('repetir com o MESMO prazo era repetir a derrota', () => {
    const t1 = uploadTimeoutForAttempt(68 * MB, 1);
    const t2 = uploadTimeoutForAttempt(68 * MB, 2);
    const t3 = uploadTimeoutForAttempt(68 * MB, 3);
    expect(t2).toBeGreaterThan(t1);
    expect(t3).toBeGreaterThan(t2);
  });

  it('a 1ª tentativa vale o prazo base', () => {
    expect(uploadTimeoutForAttempt(68 * MB, 1)).toBe(uploadTimeoutMs(68 * MB));
  });

  it('mesmo escalando, respeita o teto (IV-08)', () => {
    expect(uploadTimeoutForAttempt(600 * MB, 5)).toBeLessThanOrEqual(TETO_MS);
  });
});
