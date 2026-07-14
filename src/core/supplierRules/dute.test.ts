/**
 * 🔒 DUTE TOYS — Excel idêntico à Petrin. qtd da caixa vem do "CX/N" do Emb,
 * NÃO do estoque (Qtd Emb Físico). Dados reais da "Lista de produtos Dute 25-03".
 */
import { describe, it, expect } from 'vitest';
import { extractProducts } from './extractor';
import { duteAdapter } from './dute';
import { getAdapterById } from './registry';
import { ProdutoBruto } from '../types/productPipeline';

const bruto = (campos: Record<string, any>): ProdutoBruto => ({
  campos, linhaOrigem: 0, paginaOrigem: 1, textoBruto: '',
});

describe('🔒 DUTE — registro + qtd caixa do "CX/N"', () => {
  it('Dute está registrado no registry (por id e por nome)', () => {
    expect(getAdapterById('dute')?.nome).toBe('Dute Toys');
    expect(getAdapterById('Dute Toys')?.id).toBe('dute');
  });

  it('DTY0872: usa 60 (CX/60), NÃO 62 (estoque Qtd Emb Físico)', () => {
    const [p] = extractProducts([bruto({
      'referencia': 'DTY0872',
      'descricao': 'ALFABETO MAGNÉTICO',
      'qtd emb (fisico)': 62,   // estoque — IGNORADO
      'emb': 'CX/60',
      'valor venda': 7.95,
    })], duteAdapter, 'dute.xlsx');
    expect(p.quantidadeCaixa).toBe(60);
  });

  it('DTY1324: usa 84 (CX/84), NÃO 35 (estoque)', () => {
    const [p] = extractProducts([bruto({
      'referencia': 'DTY1324',
      'descricao': 'ARMINHA LANÇA E PEGA',
      'qtd emb (fisico)': 35,
      'emb': 'CX/84',
      'valor venda': 6.85,
    })], duteAdapter, 'dute.xlsx');
    expect(p.quantidadeCaixa).toBe(84);
  });

  it('codigoPattern cobre DTY#### (formato antigo)', () => {
    expect(duteAdapter.codigoPattern?.test('DTY0872')).toBe(true);
    expect(duteAdapter.codigoPattern?.test('DTY1324')).toBe(true);
    expect(duteAdapter.codigoPattern?.test('RD1318')).toBe(false);
  });

  it('codigoPattern cobre DT10#### (formato novo 2026)', () => {
    expect(duteAdapter.codigoPattern?.test('DT10171')).toBe(true);
    expect(duteAdapter.codigoPattern?.test('DT10191')).toBe(true);
    expect(duteAdapter.codigoPattern?.test('DT10132')).toBe(true);
  });
});

// ===================================================================
// 🔒 DUTE — formato novo DT10#### (catálogo 2026 com coluna "Preço")
// Estoque NÃO deve ser lido como preço — regressão do bug reportado 07/26.
// ===================================================================

describe('🔒 DUTE — formato novo DT10#### (coluna "Preço" em vez de "Valor Venda")', () => {
  it('DT10171: usa preço (12.00) e NÃO o estoque (199)', () => {
    const [p] = extractProducts([bruto({
      'codigo':   'DT10171',
      'descricao': 'WATERGAME BATALHA CX/48',
      'estoque':  199,      // estoque — DEVE SER IGNORADO como preço
      'emb':      'CX/48',
      'preço':    12.00,    // coluna "Preço" no formato novo
    })], duteAdapter, 'dute.xlsx');
    expect(p.preco).toBe(12.00);
    expect(p.quantidadeCaixa).toBe(48);
  });

  it('DT10169: usa preço (3.80) e NÃO o estoque (193)', () => {
    const [p] = extractProducts([bruto({
      'codigo':   'DT10169',
      'descricao': 'WATERGAME TUBARÃO CX/144',
      'estoque':  193,
      'emb':      'CX/144',
      'preço':    3.80,
    })], duteAdapter, 'dute.xlsx');
    expect(p.preco).toBeCloseTo(3.80);
    expect(p.quantidadeCaixa).toBe(144);
  });

  it('DT10191: usa preço (21.00) e NÃO o estoque (197)', () => {
    const [p] = extractProducts([bruto({
      'codigo':   'DT10191',
      'descricao': 'VIOLÃO CX/24',
      'estoque':  197,
      'emb':      'CX/24',
      'valor':    21.00,    // coluna "Valor" também deve ser reconhecida
    })], duteAdapter, 'dute.xlsx');
    expect(p.preco).toBe(21.00);
    expect(p.quantidadeCaixa).toBe(24);
  });
});
