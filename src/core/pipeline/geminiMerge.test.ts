/**
 * Garante que o merge AI ↔ pipeline tradicional:
 *  - ENRIQUECE produtos com preço zerado, qtde caixa faltante, IPI ausente
 *  - NÃO sobrescreve dados que já estavam corretos
 *  - ADICIONA produtos que só a AI encontrou
 *  - LIMPA erros de "preço não encontrado" quando AI fornece preço
 */
import { describe, it, expect } from 'vitest';
import { mergeProdutosComAI, type ProdutoAI } from './geminiExtractionApi';

describe('mergeProdutosComAI', () => {
  it('enriquece produto com preço zerado usando preço da AI', () => {
    const locais = [{
      codigo: 'NX020',
      nome: 'FORMA DE GELO',
      preco: 0,
      precoBase: 0,
      precoFinal: 0,
      quantidadeCaixa: 96,
      ipi: 6.5,
      status: 'invalido',
      erros: ['Preço não encontrado ou inválido'],
    }];
    const ai: ProdutoAI[] = [{
      codigo: 'NX020',
      nome: 'FORMA DE GELO C/BASE',
      preco: 5.50,
      precoPromocional: null,
      quantidadeCaixa: 96,
      ipi: 6.5,
      ncm: '3924.10.00',
      categoria: 'COZINHA',
      paginaOrigem: 4,
      observacoes: '',
    }];

    const { merged, enriched, added } = mergeProdutosComAI(locais, ai);
    expect(enriched).toBe(1);
    expect(added).toBe(0);
    expect(merged[0].preco).toBe(5.50);
    expect(merged[0].precoBase).toBe(5.50);
    expect(merged[0].precoFinal).toBe(5.50);
    // erro de preço foi removido
    expect((merged[0] as any).erros).toEqual([]);
    expect((merged[0] as any).status).toBe('valido');
  });

  it('NÃO sobrescreve preço quando local já tem valor válido', () => {
    const locais = [{
      codigo: 'NX021',
      nome: 'PROD',
      preco: 12.99,
      precoBase: 12.99,
      precoFinal: 12.99,
      quantidadeCaixa: 1,
      ipi: 0,
      status: 'valido',
      erros: [],
    }];
    const ai: ProdutoAI[] = [{
      codigo: 'NX021',
      nome: 'PROD AI',
      preco: 50.00, // valor diferente — não deve usar
      precoPromocional: null,
      quantidadeCaixa: 48,
      ipi: 7.8,
      ncm: null,
      categoria: null,
      paginaOrigem: 5,
      observacoes: '',
    }];
    const { merged, enriched } = mergeProdutosComAI(locais, ai);
    expect(merged[0].preco).toBe(12.99); // preservou local
    // mas preencheu qtdcx (era 1) e ipi (era 0)
    expect(merged[0].quantidadeCaixa).toBe(48);
    expect(merged[0].ipi).toBe(7.8);
    expect(enriched).toBe(1);
  });

  it('adiciona produtos que só a AI encontrou', () => {
    const locais = [{
      codigo: 'NX020',
      nome: 'P1',
      preco: 5,
      precoBase: 5,
      precoFinal: 5,
      quantidadeCaixa: 12,
      ipi: 0,
      status: 'valido',
      erros: [],
    }];
    const ai: ProdutoAI[] = [
      {
        codigo: 'NX020', nome: 'P1', preco: 5, precoPromocional: null,
        quantidadeCaixa: 12, ipi: 0, ncm: null, categoria: null,
        paginaOrigem: 1, observacoes: '',
      },
      {
        codigo: 'NX999', nome: 'Produto que parser perdeu', preco: 9.90,
        precoPromocional: null, quantidadeCaixa: 24, ipi: 5,
        ncm: '3924.10.00', categoria: null, paginaOrigem: 3, observacoes: '',
      },
    ];
    const { merged, added } = mergeProdutosComAI(locais, ai);
    expect(added).toBe(1);
    expect(merged).toHaveLength(2);
    const novo = merged.find((p: any) => p.codigo === 'NX999');
    expect(novo).toBeDefined();
    expect((novo as any).preco).toBe(9.90);
    expect((novo as any).warnings).toContain('Adicionado via AI (não detectado pelo parser tradicional)');
  });

  it('match é case-insensitive e tolera espaços', () => {
    const locais = [{
      codigo: '  nx020  ',
      nome: 'PROD',
      preco: 0,
      precoBase: 0,
      precoFinal: 0,
      quantidadeCaixa: 1,
      ipi: 0,
    }];
    const ai: ProdutoAI[] = [{
      codigo: 'NX020', nome: 'P AI', preco: 7, precoPromocional: null,
      quantidadeCaixa: 1, ipi: 0, ncm: null, categoria: null,
      paginaOrigem: 1, observacoes: '',
    }];
    const { enriched } = mergeProdutosComAI(locais, ai);
    expect(enriched).toBe(1);
  });

  it('retorna lista local intacta quando AI vazia', () => {
    const locais = [{ codigo: 'X1', nome: 'P', preco: 5, quantidadeCaixa: 1, ipi: 0 }];
    const { merged, enriched, added } = mergeProdutosComAI(locais, []);
    expect(merged).toEqual(locais);
    expect(enriched).toBe(0);
    expect(added).toBe(0);
  });

  it('match por codigoOriginal também funciona', () => {
    const locais = [{
      codigo: 'XYZ-123',
      codigoOriginal: 'NX020',
      nome: 'P',
      preco: 0,
      quantidadeCaixa: 1,
      ipi: 0,
    }];
    const ai: ProdutoAI[] = [{
      codigo: 'NX020', nome: 'P AI', preco: 5, precoPromocional: null,
      quantidadeCaixa: 1, ipi: 0, ncm: null, categoria: null,
      paginaOrigem: 1, observacoes: '',
    }];
    const { enriched } = mergeProdutosComAI(locais, ai);
    expect(enriched).toBe(1);
  });
});
