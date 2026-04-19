import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx-js-style';
import { generateMercosXLSX, validateMercosHeaderOrder } from './exportMercos';
import { MERCOS_EXPORT_COLUMNS } from '../types/productPipeline';

describe('exportMercos', () => {
  it('cabeçalho no XLSX é idêntico ao modelo Mercos', () => {
    const produtos = [
      {
        'Código do produto (recomendado)': 'CK4527',
        'Nome do produto (obrigatório)': 'ABRIDOR GARRAFA',
        'Preço de Tabela (obrigatório)': 5.25,
        'IPI (opcional - não informar o símbolo %)': 13,
        'Informações adicionais (opcional - neste campo coloca-se qualquer detalhe extra do produto. Não aparece no pedido)': 'CX: 120',
      },
    ];

    const { workbook } = generateMercosXLSX(produtos as any, { download: false });
    const ws = workbook.Sheets['Produtos Mercos'];

    const exportedHeaders = MERCOS_EXPORT_COLUMNS.map((_, idx) => {
      const cell = XLSX.utils.encode_cell({ c: idx, r: 0 });
      return String(ws[cell]?.v || '');
    });

    expect(exportedHeaders).toEqual(MERCOS_EXPORT_COLUMNS);
  });

  it('quantidade total de colunas é 42 (A até AP)', () => {
    expect(MERCOS_EXPORT_COLUMNS.length).toBe(42);
  });

  it('validateMercosHeaderOrder detecta divergência de ordem', () => {
    const wrong = [...MERCOS_EXPORT_COLUMNS];
    const tmp = wrong[0];
    wrong[0] = wrong[1];
    wrong[1] = tmp;

    const erros = validateMercosHeaderOrder(wrong);
    expect(erros.length).toBeGreaterThan(0);
  });

  it('colunas fora das 5 permitidas permanecem vazias no XLSX', () => {
    const produtos = [
      {
        'Código do produto (recomendado)': 'A1',
        'Nome do produto (obrigatório)': 'Produto A1',
        'Preço de Tabela (obrigatório)': 9.99,
        'IPI (opcional - não informar o símbolo %)': '',
        'Informações adicionais (opcional - neste campo coloca-se qualquer detalhe extra do produto. Não aparece no pedido)': 'CX: 12',
      },
    ];

    const { workbook } = generateMercosXLSX(produtos as any, { download: false });
    const ws = workbook.Sheets['Produtos Mercos'];

    const row2Values = MERCOS_EXPORT_COLUMNS.map((_, idx) => {
      const cell = XLSX.utils.encode_cell({ c: idx, r: 1 });
      return ws[cell]?.v ?? '';
    });

    for (let i = 0; i < MERCOS_EXPORT_COLUMNS.length; i++) {
      const col = MERCOS_EXPORT_COLUMNS[i];
      const value = row2Values[i];
      const isAllowed = [
        'Código do produto (recomendado)',
        'Nome do produto (obrigatório)',
        'Preço de Tabela (obrigatório)',
        'IPI (opcional - não informar o símbolo %)',
        'Informações adicionais (opcional - neste campo coloca-se qualquer detalhe extra do produto. Não aparece no pedido)',
      ].includes(col);

      if (!isAllowed) {
        expect(value).toBe('');
      }
    }
  });
});
