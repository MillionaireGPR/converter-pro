// Teste 11 (16/10/2026), Neo: 161 produtos com tarja ESGOTADO saíam na
// exportação. O backend marca `esgotado`; eles não entram no lote.
import { describe, it, expect } from 'vitest';
import { mapAiProductsToBrutos } from './aiFirstExtractionApi';

describe('ESGOTADO do AI-first', () => {
  it('produto com tarja ESGOTADO não entra; o vizinho entra', () => {
    const brutos = mapAiProductsToBrutos([
      { codigo: '135801', nome: 'CORTINA', preco: 7.97, esgotado: true },
      { codigo: '135828', nome: 'CORTINA', preco: 5.97 },
    ]);
    expect(brutos.map(b => b.campos.codigo)).toEqual(['135828']);
  });
});
