/**
 * 🔒 PREÇO PROMOCIONAL em COLUNA PRÓPRIA (Excel com TABELA + PROMO lado a
 * lado) — reunião 16/09/2026: Josef reportou 63 de 64 produtos com promoção
 * na FOLIA saindo com o preço cheio ("tabela") em vez do promocional. A
 * coluna era extraída (fieldAliases.precoPromocional) mas nunca usada pra
 * decidir o preço final — ficava presa em `precoPromocional` sem afetar
 * `preco`/`precoBase`/o export.
 *
 * Guarda de magnitude (promo < tabela) é o que impede a mesma mudança de
 * quebrar fornecedores que reusam o nome da coluna pra outra coisa (NEO
 * FESTAS: "precokits"/"precocaixa" é preço de CAIXA, sempre MAIOR que o
 * unitário — não é desconto).
 */
import { describe, it, expect } from 'vitest';
import { extractProducts } from './extractor';
import { foliaAdapter } from './folia';
import { neoFestasAdapter } from './neo-festas';
import { ProdutoBruto } from '../types/productPipeline';

const bruto = (campos: Record<string, any>): ProdutoBruto => ({
  campos, linhaOrigem: 0, paginaOrigem: 1, textoBruto: '',
});

describe('🔒 Preço promocional em coluna própria (FOLIA e afins)', () => {
  it('FOLIA: produto com PROMO menor que TABELA exporta o preço PROMO', () => {
    const [p] = extractProducts([bruto({
      referencia: 'JRF-10.0063', descricao: 'BONECA SEREIA', tabela: '8,10', promo: '6,50',
    })], foliaAdapter, 'folia.xlsx');
    expect(p.preco).toBe(6.5);
    expect((p as any).precoPromocional).toBe(6.5);
    expect((p as any).visualCategory).toBe('promocional');
    expect((p as any).bloqueiaDesconto).toBe(true);
  });

  it('FOLIA: produto SEM promo (coluna vazia) mantém o preço de tabela normalmente', () => {
    const [p] = extractProducts([bruto({
      referencia: 'JRF-10.0064', descricao: 'BLOCOS DE MONTAR', tabela: '9,90', promo: '',
    })], foliaAdapter, 'folia.xlsx');
    expect(p.preco).toBe(9.9);
    expect((p as any).visualCategory).toBeUndefined();
  });

  it('NEO FESTAS: preço de KIT/CAIXA (maior que unitário) NÃO deve substituir o preço unitário', () => {
    const [p] = extractProducts([bruto({
      codigo: '1234', descricao: 'BALAO METALIZADO', precounitario: '3,10', precokits: '45,00',
    })], neoFestasAdapter, 'neo-festas.xlsx');
    expect(p.preco).toBe(3.1);
    expect((p as any).visualCategory).toBeUndefined();
  });
});
