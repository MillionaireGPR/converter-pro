/**
 * 🔒 PROMOÇÃO via AI-first: item que já vem com desconto (tag/selo) deve
 * bloquear desconto em massa + ganhar ***PROMOCAO*** no nome. A IA marca
 * promocional=true → mapAiProductsToBrutos seta __promo → extractor vira
 * visualCategory='promocional' + bloqueiaDesconto.
 */
import { describe, it, expect } from 'vitest';
import { extractProducts } from './extractor';
import { genericAdapter } from './generic';
import { giraAdapter } from './gira';
import { fortalAdapter } from './fortal';
import { mapAiProductsToBrutos } from '../pipeline/aiFirstExtractionApi';
import { ProdutoBruto } from '../types/productPipeline';

const bruto = (campos: Record<string, any>): ProdutoBruto => ({
  campos, linhaOrigem: 0, paginaOrigem: 1, textoBruto: '',
});

describe('🔒 PROMOÇÃO AI-first', () => {
  it('mapAiProductsToBrutos seta __promo quando promocional=true', () => {
    const [b] = mapAiProductsToBrutos([
      { codigo: 'LH365', nome: 'KIT BOWL', preco: 15, promocional: true } as any,
    ]);
    expect(b.campos['__promo']).toBe(true);
  });

  it('item NÃO promocional não seta __promo', () => {
    const [b] = mapAiProductsToBrutos([
      { codigo: 'LH366', nome: 'KIT BOWL', preco: 15 } as any,
    ]);
    expect(b.campos['__promo']).toBeUndefined();
  });

  it('extractor: __promo → visualCategory=promocional + bloqueiaDesconto', () => {
    const [p] = extractProducts([bruto({
      codigo: 'LH365', descricao: 'KIT BOWL CERAMICA', preco: '15', __promo: true,
    })], genericAdapter, 'lila.pdf');
    expect((p as any).visualCategory).toBe('promocional');
    expect((p as any).bloqueiaDesconto).toBe(true);
    expect((p as any).isPromotional).toBe(true);
  });

  // Reunião 28/09: GIRA TP1951 riscado 14,95 → 11,96 exportava 14,95 porque
  // o adapter da GIRA não tinha alias de preço promocional.
  it.each([['GIRA', giraAdapter], ['FORTAL', fortalAdapter]])(
    'IA com preço riscado: %s exporta o preço novo mesmo sem alias de promo',
    (_n, adapter) => {
      const brutos = mapAiProductsToBrutos([
        { codigo: 'TP1951', nome: 'KIT 3 POTES DE VIDRO', preco: 14.95, precoPromocional: 11.96, promocional: true } as any,
      ]);
      const [p] = extractProducts(brutos, adapter as any, 'gira.pdf');
      expect(p.preco).toBe(11.96);
      expect((p as any).bloqueiaDesconto).toBe(true);
    },
  );

  it('promo maior que o preço (kit/caixa) não substitui o unitário', () => {
    const brutos = mapAiProductsToBrutos([
      { codigo: 'X1', nome: 'ITEM', preco: 5, precoPromocional: 60 } as any,
    ]);
    const [p] = extractProducts(brutos, giraAdapter as any, 'x.pdf');
    expect(p.preco).toBe(5);
  });
});
