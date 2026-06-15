/**
 * 🔒 PETRIN — quantidadeCaixa vem do "CX/N" da embalagem, NÃO do estoque.
 *
 * Reunião 11/06/2026: a planilha Petrin tem "Qtd Emb (Físico)" (ESTOQUE) e
 * "Emb" ("CX/36"). O sistema pegava o estoque. O correto é o N do "CX/N".
 * Dados reais da "Lista de produtos Petrin 27-03.xlsx":
 *   RD1318 ABRIDOR DE VINHO | Qtd Emb (Físico)=31 (estoque) | Emb=CX/36 → caixa=36
 *   RD1457 CONJUNTO FEMININO | estoque=37 | Emb=CX/60 → caixa=60
 */
import { describe, it, expect } from 'vitest';
import { extractProducts } from './extractor';
import { petrinAdapter } from './petrin';
import { ProdutoBruto } from '../types/productPipeline';

const bruto = (campos: Record<string, any>): ProdutoBruto => ({
  campos, linhaOrigem: 0, paginaOrigem: 1, textoBruto: '',
});

describe('🔒 PETRIN — qtd caixa do "CX/N", ignora estoque', () => {
  it('RD1318: usa 36 (CX/36), NÃO 31 (estoque Qtd Emb Físico)', () => {
    const [p] = extractProducts([bruto({
      'referencia': 'RD1318',
      'descricao': 'ABRIDOR DE VINHO CX/36',
      'qtd emb (fisico)': 31,   // estoque — deve ser IGNORADO
      'emb': 'CX/36',
      'valor venda': 50,
    })], petrinAdapter, 'petrin.xlsx');
    expect(p.quantidadeCaixa).toBe(36);
  });

  it('RD1457: usa 60 (CX/60), NÃO 37 (estoque)', () => {
    const [p] = extractProducts([bruto({
      'referencia': 'RD1457',
      'descricao': 'CONJUNTO FEMININO 2 PC',
      'qtd emb (fisico)': 37,
      'emb': 'CX/60',
      'valor venda': 80,
    })], petrinAdapter, 'petrin.xlsx');
    expect(p.quantidadeCaixa).toBe(60);
  });

  it('sem CX/N e sem qtd → default 1 (nunca 0)', () => {
    const [p] = extractProducts([bruto({
      'referencia': 'RD9999',
      'descricao': 'PRODUTO AVULSO',
      'emb': 'UN',
      'valor venda': 10,
    })], petrinAdapter, 'petrin.xlsx');
    expect(p.quantidadeCaixa).toBe(1);
  });
});
