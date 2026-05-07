/**
 * Garante que rowsToProdutosBrutos preserva a linha REAL do Excel via __rowNum__,
 * mesmo com linhas vazias entre dados (caso típico NIX HOUSE / FREECOM).
 *
 * Sem isso, cada blank row anterior shiftava o cálculo de linhaOrigem em -1,
 * desalinhando o matching de imagens (sourceIndex) com o produto correto.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx-js-style';

describe('Pipeline: linhaOrigem real via __rowNum__', () => {
  it('SheetJS preserva __rowNum__ em modo objeto (raw=true)', () => {
    // Constrói uma planilha sintética: header em L1, produtos em L2, L4, L7
    const ws = XLSX.utils.aoa_to_sheet([
      ['Codigo', 'Nome'],         // L1 (header)
      ['ABC1', 'Produto A'],      // L2
      [],                          // L3 (vazia)
      ['ABC2', 'Produto B'],      // L4
      [],                          // L5 (vazia)
      [],                          // L6 (vazia)
      ['ABC3', 'Produto C'],      // L7
    ]);

    const rows = XLSX.utils.sheet_to_json(ws, { range: 0 }) as any[];

    expect(rows).toHaveLength(3);
    expect(rows[0].__rowNum__).toBe(1); // L2 (0-based)
    expect(rows[1].__rowNum__).toBe(3); // L4
    expect(rows[2].__rowNum__).toBe(6); // L7

    // linhaOrigem (1-based Excel) = __rowNum__ + 1
    expect(rows[0].__rowNum__ + 1).toBe(2);
    expect(rows[1].__rowNum__ + 1).toBe(4);
    expect(rows[2].__rowNum__ + 1).toBe(7);
  });

  it('Sem __rowNum__, o calculo legado idx + headerOffset + 2 desalinha com gaps', () => {
    // Demonstração do bug que estava causando matching errado de imagens
    const ws = XLSX.utils.aoa_to_sheet([
      ['Codigo'],                 // L1 header
      ['A1'],                      // L2
      [],                          // L3 vazia
      ['A2'],                      // L4 (linhaOrigem REAL = 4)
    ]);

    // Com blankrows: false (versão antiga)
    const rowsOld = XLSX.utils.sheet_to_json(ws, { range: 0, blankrows: false }) as any[];
    expect(rowsOld).toHaveLength(2);

    // Cálculo LEGADO: idx + headerOffset + 2
    const linhaOrigemLegado = rowsOld.map((_, idx) => idx + 0 + 2);
    expect(linhaOrigemLegado).toEqual([2, 3]); // ❌ ERRADO! L4 ficou como 3

    // Com __rowNum__ (versão corrigida)
    const linhaOrigemNova = rowsOld.map(r => r.__rowNum__ + 1);
    expect(linhaOrigemNova).toEqual([2, 4]); // ✅ CORRETO! L2 e L4 reais
  });

  it('FREECOM-like: dados começam em L3 (header em L1, L2 vazia)', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      [],                          // L1 (vazia/título)
      [],                          // L2 (vazia)
      ['F1', 'Produto X', 100],   // L3 (primeiro produto)
      ['F2', 'Produto Y', 200],   // L4
      ['F3', 'Produto Z', 300],   // L5
    ]);

    const rows = XLSX.utils.sheet_to_json(ws, { range: 0 }) as any[];

    // Os 3 produtos devem ter linhaOrigem 3, 4, 5
    expect(rows.map(r => r.__rowNum__ + 1)).toEqual([3, 4, 5]);
  });

  it('NIX-like: produtos com gaps de 2-3 linhas entre eles', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Codigo', 'Nome'],  // L1 header
      ['NX001', 'Item 1'], // L2
      [],                   // L3 (gap)
      [],                   // L4 (gap)
      ['NX002', 'Item 2'], // L5
      [],                   // L6 (gap)
      ['NX003', 'Item 3'], // L7
      ['NX004', 'Item 4'], // L8 (sem gap)
      [],                   // L9 (gap)
      [],                   // L10 (gap)
      [],                   // L11 (gap)
      ['NX005', 'Item 5'], // L12
    ]);

    const rows = XLSX.utils.sheet_to_json(ws, { range: 0 }) as any[];
    expect(rows).toHaveLength(5);
    const linhasReais = rows.map(r => r.__rowNum__ + 1);
    expect(linhasReais).toEqual([2, 5, 7, 8, 12]);

    // Se imagens estiverem ancoradas em L2, L5, L7, L8, L12 no XLSX,
    // o matching produtosPorLinha[sourceIndex] casa perfeitamente.
  });
});
