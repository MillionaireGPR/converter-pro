/**
 * Testes do adapter FREECOM
 * - Extração de produtos com colunas posicionais (sem header)
 * - Detecção de cor de fonte vermelha = PROMO GERAL
 * - Regra de precificação: padrão = ×2 com -20%, promo = ×2 sem desconto
 */
import { describe, it, expect } from 'vitest';
import { freecomAdapter } from './freecom';
import type { ProdutoBruto } from '../types/productPipeline';
import type { CellStyleInfo } from '../pipeline/importPipeline';

// Helper para construir um bruto FREECOM
const buildBruto = (
  codigo: string,
  descricao: string,
  categoria: string,
  qtde: number,
  preco: number,
  isRed: boolean,
  linhaReal: number
): ProdutoBruto => {
  const styles = new Map<string, CellStyleInfo>();
  if (isRed) {
    // Aplica vermelho na coluna B da linha
    styles.set(`B${linhaReal}`, { fontColor: 'FFFF0000', fillColor: 'default' } as CellStyleInfo);
  }
  return {
    campos: {
      __EMPTY: codigo,
      __EMPTY_1: descricao,
      __EMPTY_2: categoria,
      __EMPTY_3: qtde,
      __EMPTY_4: preco,
      __cellStyles: styles,
      __linhaReal: linhaReal,
    },
    linhaOrigem: linhaReal,
  };
};

describe('FREECOM adapter', () => {
  it('extrai produtos posicionalmente sem depender de header', () => {
    const brutos = [
      buildBruto('03SH5J01', '03SH5J01 COPO EM VIDRO 180ML', 'PROMO GERAL', 36, 1.0, true, 3),
      buildBruto('1909227', '1909227 (SUB120) BUQUE DE FOLHAGEM EM PLASTICO', '', 480, 2.15, false, 7),
      buildBruto('2109088', '2109088 CALENDARIO EM MADEIRA E METAL 13X7,8X7CM', '', 48, 9.17, false, 24),
    ];

    const produtos = freecomAdapter.extract!(brutos, freecomAdapter);

    expect(produtos).toHaveLength(3);
    expect(produtos[0].codigo).toBe('03SH5J01');
    expect(produtos[1].codigo).toBe('1909227');
    expect(produtos[2].codigo).toBe('2109088');
  });

  it('aplica regra de precificação: VERMELHO (PROMO) = preço × 2', () => {
    const brutos = [
      buildBruto('03SH5J01', 'COPO 180ML', 'PROMO GERAL', 36, 1.0, true, 3),
    ];
    const [p] = freecomAdapter.extract!(brutos, freecomAdapter);

    expect(p.precoBase).toBeCloseTo(2.0, 2); // 1.0 × 2
    expect(p.preco).toBeCloseTo(2.0, 2); // sem desconto adicional
    expect((p as any).isPromotional).toBe(true);
    expect((p as any).bloqueiaDesconto).toBe(true);
  });

  it('aplica regra de precificação: PRETO (padrão) = preço × 2 com -20%', () => {
    const brutos = [
      buildBruto('1909227', 'BUQUE 28CM', '', 480, 2.15, false, 7),
    ];
    const [p] = freecomAdapter.extract!(brutos, freecomAdapter);

    expect(p.precoBase).toBeCloseTo(4.30, 2); // 2.15 × 2
    expect(p.preco).toBeCloseTo(3.44, 2); // 4.30 × 0.80
    expect((p as any).descontoAutomatico).toBe(20);
  });

  it('limpa prefixo redundante de código na descrição', () => {
    const brutos = [
      buildBruto('03SH5J01', '03SH5J01 COPO EM VIDRO 180ML', '', 36, 1.0, false, 3),
    ];
    const [p] = freecomAdapter.extract!(brutos, freecomAdapter);
    // Código não deve aparecer duplicado na descrição
    expect(p.descricao).toBe('COPO EM VIDRO 180ML');
    expect(p.nome).toBe('COPO EM VIDRO 180ML');
  });

  it('preserva quantidadeCaixa correta', () => {
    const brutos = [
      buildBruto('1909249', 'BUQUE DE ROSA', '', 500, 5.84, false, 9),
    ];
    const [p] = freecomAdapter.extract!(brutos, freecomAdapter);
    expect(p.quantidadeCaixa).toBe(500);
    expect(p.informacoesAdicionais).toContain('Cx c/ 500');
  });

  it('ignora linhas sem código válido', () => {
    const brutos = [
      {
        campos: { __EMPTY: '', __EMPTY_1: 'só descrição', __EMPTY_2: '' },
        linhaOrigem: 1,
      } as ProdutoBruto,
      {
        campos: { __EMPTY: 'invalido com espaço', __EMPTY_1: '', __EMPTY_2: '' },
        linhaOrigem: 2,
      } as ProdutoBruto,
    ];
    const produtos = freecomAdapter.extract!(brutos, freecomAdapter);
    expect(produtos).toHaveLength(0);
  });

  it('códigos numéricos puros são aceitos', () => {
    const brutos = [
      buildBruto('1909227', 'desc', '', 480, 2.15, false, 7),
      buildBruto('2109088', 'desc', '', 48, 9.17, false, 24),
    ];
    const produtos = freecomAdapter.extract!(brutos, freecomAdapter);
    expect(produtos).toHaveLength(2);
    expect(produtos[0].codigo).toBe('1909227');
  });

  it('códigos com hífen (ex: 2109004-1) são aceitos', () => {
    const brutos = [
      buildBruto('2109004-1', 'ENFEITE EM MDF', '', 96, 3.5, false, 21),
    ];
    const [p] = freecomAdapter.extract!(brutos, freecomAdapter);
    expect(p.codigo).toBe('2109004-1');
  });

  it('detecção: aceita "freecom" no nome do arquivo', () => {
    expect(freecomAdapter.aliases).toContain('freecom');
    expect(freecomAdapter.aliases).toContain('free com');
  });

  it('detecção: regex /freecom/i casa em texto da planilha', () => {
    const sample = 'CATALOGO FREECOM - VALOR X2 -20%';
    const found = freecomAdapter.detectionPatterns.some(p =>
      (p instanceof RegExp ? p : new RegExp(p)).test(sample)
    );
    expect(found).toBe(true);
  });

  it('todas as 5 cores vermelhas são reconhecidas como PROMO', () => {
    // Variações: FF0000, FFFF0000, etc.
    const variacoes = ['FF0000', 'FFFF0000'];
    for (const cor of variacoes) {
      const styles = new Map<string, CellStyleInfo>();
      styles.set('B3', { fontColor: cor, fillColor: 'default' } as CellStyleInfo);
      const bruto: ProdutoBruto = {
        campos: {
          __EMPTY: 'TEST123',
          __EMPTY_1: 'DESC',
          __EMPTY_2: '',
          __EMPTY_3: 10,
          __EMPTY_4: 5.0,
          __cellStyles: styles,
          __linhaReal: 3,
        },
        linhaOrigem: 3,
      };
      const [p] = freecomAdapter.extract!([bruto], freecomAdapter);
      expect((p as any).isPromotional).toBe(true);
    }
  });
});
