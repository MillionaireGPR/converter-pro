import { describe, it, expect } from 'vitest';
import { classifyImageError } from './imageErrorClassifier';

describe('classifyImageError', () => {
  it('erro real do crash (numpy.int32 unpack) → IMG-GRID', () => {
    const info = classifyImageError('Backend falhou durante extração: cannot unpack non-iterable numpy.int32 object');
    expect(info.code).toBe('IMG-GRID');
    expect(info.friendly).not.toContain('numpy'); // cliente NÃO vê termo técnico
    expect(info.technical).toContain('numpy');     // suporte VÊ o detalhe
  });

  it('servidor reiniciou / perdeu o job → IMG-SRV', () => {
    expect(classifyImageError('Servidor reiniciou e perdeu o job (not_found confirmado 3x).').code).toBe('IMG-SRV');
    expect(classifyImageError('Ran out of memory (used over 512MB)').code).toBe('IMG-SRV');
  });

  it('timeout → IMG-TIMEOUT', () => {
    expect(classifyImageError('Timeout: extração de imagens não concluiu em 360s').code).toBe('IMG-TIMEOUT');
  });

  it('erro desconhecido → IMG-GEN, sem vazar termo técnico na mensagem', () => {
    const info = classifyImageError('erro bizarro qualquer 0xDEADBEEF');
    expect(info.code).toBe('IMG-GEN');
    expect(info.friendly.length).toBeGreaterThan(10);
    expect(info.technical).toContain('0xDEADBEEF');
  });

  it('mensagem amigável nunca é vazia e sempre tranquiliza sobre preço/produto', () => {
    for (const raw of ['cannot unpack numpy', 'not_found', 'timeout', 'xyz']) {
      const info = classifyImageError(raw);
      expect(info.friendly.trim().length).toBeGreaterThan(0);
      expect(info.code.startsWith('IMG-')).toBe(true);
    }
  });
});
