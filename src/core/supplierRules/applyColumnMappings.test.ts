/**
 * Trava o mapeamento de colunas por fornecedor (19/08/2026).
 *
 * Contexto: nomes de coluna fora do padrão (VAESO: "Caixa master") faziam o
 * campo cair no default em silêncio e exigiam alias novo no código + deploy.
 * Agora o cliente configura por fornecedor. Estes testes garantem as duas
 * propriedades que, se quebrarem, causam dado errado sem erro visível:
 *   1. a escolha do cliente VENCE a detecção automática;
 *   2. a config de um fornecedor NÃO vaza para os outros.
 */
import { describe, it, expect } from 'vitest';
import { applyColumnMappings, tabelaPrecoColumns } from './applyColumnMappings';
import type { SupplierAdapter } from './types';

const baseAdapter = (): SupplierAdapter => ({
  id: 'test-0000-0000-4000-a000-000000000000',
  nome: 'Teste',
  aliases: ['teste'],
  fieldAliases: {
    codigo: ['codigo', 'ref'],
    quantidadeCaixa: ['qtdcaixa', 'caixa'],
  },
  precoFormat: 'BR',
} as SupplierAdapter);

describe('applyColumnMappings', () => {
  it('coloca a coluna escolhida na FRENTE (vence o alias automático)', () => {
    const out = applyColumnMappings(baseAdapter(), { quantidadeCaixa: 'Caixa master' });
    expect(out.fieldAliases.quantidadeCaixa[0]).toBe('Caixa master');
  });

  it('mantém os aliases originais como fallback (fornecedor pode renomear a coluna)', () => {
    const out = applyColumnMappings(baseAdapter(), { quantidadeCaixa: 'Caixa master' });
    expect(out.fieldAliases.quantidadeCaixa).toContain('qtdcaixa');
    expect(out.fieldAliases.quantidadeCaixa).toContain('caixa');
  });

  it('NÃO muta o adapter original (senão a config vazaria entre fornecedores)', () => {
    const original = baseAdapter();
    const antes = [...original.fieldAliases.quantidadeCaixa];

    applyColumnMappings(original, { quantidadeCaixa: 'Caixa master' });

    expect(original.fieldAliases.quantidadeCaixa).toEqual(antes);
  });

  it('sem mapeamento, devolve o adapter intacto', () => {
    const original = baseAdapter();
    expect(applyColumnMappings(original, undefined)).toBe(original);
    expect(applyColumnMappings(original, {})).toBe(original);
  });

  it('ignora coluna vazia (campo deixado em branco na tela)', () => {
    const out = applyColumnMappings(baseAdapter(), { quantidadeCaixa: '   ' });
    expect(out.fieldAliases.quantidadeCaixa[0]).toBe('qtdcaixa');
  });

  it('precoTabelaN não vira alias de campo (é tratado à parte)', () => {
    const out = applyColumnMappings(baseAdapter(), { precoTabela1: 'V50' });
    const todos = Object.values(out.fieldAliases).flat();
    expect(todos).not.toContain('V50');
  });
});

describe('tabelaPrecoColumns', () => {
  it('devolve as colunas na ordem #1, #2, #3', () => {
    expect(tabelaPrecoColumns({ precoTabela1: 'V50', precoTabela2: 'V250', precoTabela3: 'V.R.' }))
      .toEqual(['V50', 'V250', 'V.R.']);
  });

  it('preserva a POSIÇÃO quando há buraco (#2 não vira #1)', () => {
    // Cliente mapeou só #1 e #3 — o #2 precisa continuar vazio, senão o
    // preço da tabela 3 apareceria na tabela 2 no Mercos.
    expect(tabelaPrecoColumns({ precoTabela1: 'V50', precoTabela3: 'V.R.' }))
      .toEqual(['V50', '', 'V.R.']);
  });

  it('corta no último preenchido (não devolve 12 vazios)', () => {
    expect(tabelaPrecoColumns({ precoTabela1: 'V50' })).toEqual(['V50']);
  });

  it('sem mapeamento, devolve vazio', () => {
    expect(tabelaPrecoColumns(undefined)).toEqual([]);
    expect(tabelaPrecoColumns({ quantidadeCaixa: 'Caixa master' })).toEqual([]);
  });
});
