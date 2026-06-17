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

  it('codigoPattern cobre DTY####', () => {
    expect(duteAdapter.codigoPattern?.test('DTY0872')).toBe(true);
    expect(duteAdapter.codigoPattern?.test('RD1318')).toBe(false);
  });
});
