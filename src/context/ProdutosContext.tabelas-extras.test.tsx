/**
 * 🔒 VAESO (Josef, 17/09): as 3 tabelas de preço extra (V50/V250/V.R.) eram
 * extraídas certo, mas a base padronizada (`Produto`) descartava `precosTabela`
 * e a tela de Exportações montava o produto sem ele — "nenhuma das 178 linhas
 * trouxe elas". Este teste prova que o valor sobrevive ao caminho
 * addProdutosNormalizados → estado → (insert com e sem a coluna mercos_extras).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

const inserts: any[][] = [];
let colunaExiste = true;

vi.mock('../integrations/supabase/client', () => {
  const builder = (table: string) => ({
    select: () => Promise.resolve({ data: [], error: null }),
    delete: () => ({ in: () => Promise.resolve({ error: null }) }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    insert: (rows: any[]) => ({
      select: () => {
        inserts.push(rows);
        if (!colunaExiste && rows.some(r => 'mercos_extras' in r)) {
          return Promise.resolve({ data: null, error: { message: 'column mercos_extras does not exist' } });
        }
        return Promise.resolve({ data: rows.map((r, i) => ({ id: `id-${i}`, ...r })), error: null });
      },
    }),
  });
  return { supabase: { from: builder } };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('./FornecedoresContext', () => ({
  useFornecedores: () => ({ fornecedores: [], refreshFornecedores: async () => {} }),
}));
vi.mock('./HistoricoContext', () => ({ useHistorico: () => ({ registrarHistorico: async () => {} }) }));

import { ProdutosProvider, useProdutos } from './ProdutosContext';

let api: ReturnType<typeof useProdutos> | null = null;
function Captura() {
  api = useProdutos();
  return null;
}

const produto = {
  fornecedor: 'VAESO', codigoOriginal: 'PS0450', codigo: 'PS0450', nome: 'POTE', precoBase: 12.99,
  precoFinal: 12.99, ipi: 0, unidade: 'UN', quantidadeCaixa: 24, status: 'validado', erros: [],
  precosTabela: [11.25, 10.75, 9.99],
} as any;

describe('🔒 tabelas de preço extra sobrevivem até a exportação', () => {
  beforeEach(() => {
    inserts.length = 0;
    colunaExiste = true;
    api = null;
  });

  it('com a coluna mercos_extras: grava e devolve no estado', async () => {
    render(<ProdutosProvider><Captura /></ProdutosProvider>);
    await waitFor(() => expect(api).not.toBeNull());
    await act(async () => { await api!.addProdutosNormalizados([produto]); });
    expect(inserts[0][0].mercos_extras.precosTabela).toEqual([11.25, 10.75, 9.99]);
    await waitFor(() => expect(api!.produtosPadronizados[0]?.precosTabela).toEqual([11.25, 10.75, 9.99]));
  });

  it('banco sem a coluna: regrava sem ela e mantém as tabelas na sessão', async () => {
    colunaExiste = false;
    render(<ProdutosProvider><Captura /></ProdutosProvider>);
    await waitFor(() => expect(api).not.toBeNull());
    await act(async () => { await api!.addProdutosNormalizados([produto]); });
    expect(inserts).toHaveLength(2);
    expect('mercos_extras' in inserts[1][0]).toBe(false);
    await waitFor(() => expect(api!.produtosPadronizados[0]?.precosTabela).toEqual([11.25, 10.75, 9.99]));
  });
});
