/**
 * Testa o novo approach CIRÚRGICO: resgate apenas de preços faltantes.
 * Substitui o approach anterior (refazer extração inteira) que demorava 10min.
 */
import { describe, it, expect } from 'vitest';
import {
  applyRepairedPrices,
  buildSkusByPageForRepair,
} from './geminiExtractionApi';

describe('buildSkusByPageForRepair', () => {
  it('agrupa produtos sem preço por página', () => {
    const produtos = [
      { codigo: 'NX020', preco: 0, paginaOrigem: 4 },
      { codigo: 'NX021', preco: 0, paginaOrigem: 4 },
      { codigo: 'NX022', preco: 5.5, paginaOrigem: 4 }, // tem preço, não inclui
      { codigo: 'NX349', preco: 0, paginaOrigem: 11 },
    ];
    const result = buildSkusByPageForRepair(produtos);
    expect(result).toEqual({
      4: ['NX020', 'NX021'],
      11: ['NX349'],
    });
  });

  it('ignora produtos sem código ou sem página', () => {
    const produtos = [
      { codigo: '', preco: 0, paginaOrigem: 4 },
      { codigo: 'NX020', preco: 0, paginaOrigem: 0 },
      { codigo: 'NX021', preco: 0, paginaOrigem: 4 },
    ];
    const result = buildSkusByPageForRepair(produtos);
    expect(result).toEqual({ 4: ['NX021'] });
  });

  it('considera precoBase/precoFinal além de preco', () => {
    const produtos = [
      { codigo: 'A1', preco: 0, precoBase: 0, precoFinal: 5, paginaOrigem: 1 }, // tem precoFinal
      { codigo: 'A2', preco: 0, precoBase: 0, precoFinal: 0, paginaOrigem: 1 },
    ];
    const result = buildSkusByPageForRepair(produtos);
    expect(result).toEqual({ 1: ['A2'] });
  });

  it('retorna objeto vazio quando todos têm preço', () => {
    const produtos = [
      { codigo: 'A1', preco: 5, paginaOrigem: 1 },
      { codigo: 'A2', preco: 10, paginaOrigem: 2 },
    ];
    expect(buildSkusByPageForRepair(produtos)).toEqual({});
  });
});

describe('applyRepairedPrices', () => {
  it('aplica preço resgatado e limpa erro + status', () => {
    const produtos = [{
      codigo: 'NX020',
      preco: 0,
      precoBase: 0,
      precoFinal: 0,
      status: 'invalido',
      erros: ['Preço não encontrado ou inválido'],
    }];
    const result = applyRepairedPrices(produtos, { NX020: 5.5 });
    expect(result.applied).toBe(1);
    expect(produtos[0].preco).toBe(5.5);
    expect(produtos[0].precoBase).toBe(5.5);
    expect(produtos[0].precoFinal).toBe(5.5);
    expect(produtos[0].erros).toEqual([]);
    expect(produtos[0].status).toBe('valido');
  });

  it('NÃO sobrescreve produtos que já têm preço válido', () => {
    const produtos = [{ codigo: 'A1', preco: 10, precoBase: 10, precoFinal: 10 }];
    const result = applyRepairedPrices(produtos, { A1: 99 });
    expect(result.applied).toBe(0);
    expect(produtos[0].preco).toBe(10);
  });

  it('match case-insensitive e com trim', () => {
    const produtos = [{ codigo: '  nx020  ', preco: 0 }];
    const result = applyRepairedPrices(produtos, { NX020: 5.5 });
    expect(result.applied).toBe(1);
    expect((produtos[0] as any).preco).toBe(5.5);
  });

  it('match também por codigoOriginal e sku', () => {
    const produtos = [
      { codigo: 'X1', codigoOriginal: 'NX020', preco: 0 },
      { sku: 'NX021', codigo: '', preco: 0 },
    ];
    const result = applyRepairedPrices(produtos, { NX020: 5.5, NX021: 7.99 });
    expect(result.applied).toBe(2);
  });

  it('ignora preços não solicitados', () => {
    const produtos = [{ codigo: 'A1', preco: 0 }];
    const result = applyRepairedPrices(produtos, { B1: 99 });
    expect(result.applied).toBe(0);
  });

  it('NÃO falha quando precos está vazio', () => {
    const produtos = [{ codigo: 'A1', preco: 0 }];
    const result = applyRepairedPrices(produtos, {});
    expect(result.applied).toBe(0);
    expect(produtos[0].preco).toBe(0);
  });
});
