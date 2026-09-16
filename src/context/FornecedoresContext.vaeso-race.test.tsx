/**
 * 🔒 VAESO — corrida de "última gravação vence" ao configurar as 3 tabelas
 * de preço extra em sequência rápida (reunião 16/09/2026: "a VAESO ainda tá
 * saindo SEM as tabelas secundárias por mais que eu escolha no sistema").
 *
 * Causa: cada chamada de `salvarMapeamentoColuna` mesclava o campo novo em
 * cima de `forn.columnMappings` — só atualizado DEPOIS do round-trip do
 * Supabase. As 3 escolhas da tela (1 por vez, botão "+ tabela de preço")
 * disparam 3 chamadas antes da 1ª resolver; todas liam o MESMO snapshot
 * vazio e cada uma gravava só o SEU campo — a que resolvesse por último no
 * banco vencia, apagando as outras duas.
 *
 * Este teste dispara as 3 chamadas na mesma síncrona (como o clique real
 * nos 3 selects) e prova que MESMO a primeira gravação a sair já carrega os
 * TRÊS campos mesclados — porque o merge agora acontece de forma síncrona
 * num ref, não depois do round-trip de rede.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const updatePayloads: Record<string, any>[] = [];
const resolvers: Array<() => void> = [];

vi.mock('../integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => Promise.resolve({
        data: [{
          id: 'sup-vaeso', name: 'VAESO', file_type: 'Excel', frequency: 'Semanal',
          default_discount: 0, default_ipi: 0, last_processed: '', total_products: 0,
          status: 'ativo', column_mappings: {}, extraction_rules: undefined,
        }],
        error: null,
      }),
      update: (payload: any) => ({
        eq: () => new Promise<{ error: null }>(resolve => {
          updatePayloads.push(payload.column_mappings);
          resolvers.push(() => resolve({ error: null }));
        }),
      }),
    }),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { FornecedoresProvider, useFornecedores } from './FornecedoresContext';

let dispararTrocas: (() => void) | null = null;
let lerColumnMappings: (() => Record<string, string> | undefined) | null = null;

function Disparador() {
  const { fornecedores, salvarMapeamentoColuna } = useFornecedores();
  dispararTrocas = () => {
    if (fornecedores.length === 0) return;
    // As 3 escolhas do botão "+ tabela de preço" da ConferenciaColunas,
    // disparadas antes de qualquer uma resolver — exatamente o fluxo real.
    salvarMapeamentoColuna('VAESO', 'precoTabela1', 'V50');
    salvarMapeamentoColuna('VAESO', 'precoTabela2', 'V250');
    salvarMapeamentoColuna('VAESO', 'precoTabela3', 'V.R.');
  };
  lerColumnMappings = () => fornecedores.find(f => f.nome === 'VAESO')?.columnMappings;
  return null;
}

describe('🔒 FornecedoresContext — sem corrida ao salvar múltiplas colunas em sequência', () => {
  beforeEach(() => {
    updatePayloads.length = 0;
    resolvers.length = 0;
    dispararTrocas = null;
    lerColumnMappings = null;
  });

  it('a 1ª gravação a sair já carrega as 3 colunas mescladas (não só a sua)', async () => {
    render(
      <FornecedoresProvider>
        <Disparador />
      </FornecedoresProvider>
    );

    await waitFor(() => expect(dispararTrocas).not.toBeNull());
    dispararTrocas!();

    await waitFor(() => expect(updatePayloads.length).toBeGreaterThanOrEqual(1));
    expect(updatePayloads[0]).toEqual({
      precoTabela1: 'V50',
      precoTabela2: 'V250',
      precoTabela3: 'V.R.',
    });
  });

  it('depois que as 3 gravações resolvem, o fornecedor fica com as 3 colunas — nenhuma se perde', async () => {
    render(
      <FornecedoresProvider>
        <Disparador />
      </FornecedoresProvider>
    );

    await waitFor(() => expect(dispararTrocas).not.toBeNull());
    dispararTrocas!();

    await waitFor(() => expect(updatePayloads.length).toBe(1));
    resolvers[0]();
    await waitFor(() => expect(updatePayloads.length).toBe(2));
    resolvers[1]();
    await waitFor(() => expect(updatePayloads.length).toBe(3));
    resolvers[2]();

    await waitFor(() => {
      expect(lerColumnMappings!()).toEqual({
        precoTabela1: 'V50',
        precoTabela2: 'V250',
        precoTabela3: 'V.R.',
      });
    });
  });
});
