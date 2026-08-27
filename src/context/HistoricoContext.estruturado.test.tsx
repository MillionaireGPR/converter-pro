/**
 * Trava o registro das colunas estruturadas do histórico (27/08/2026) e o
 * fallback pro schema antigo — cenário REAL hoje: a migration
 * 20260827_historico_estruturado.sql ainda não foi aplicada no Supabase de
 * produção (a CLI usada nesta sessão não tem acesso a esse projeto), então
 * o insert com as colunas novas falha com "column does not exist" até
 * alguém rodar o SQL manualmente. Sem esse fallback, TODO registro de
 * histórico quebraria nesse intervalo — regressão inaceitável numa feature
 * que hoje já funciona.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

const insertSpy = vi.fn();
// Controla se o PRÓXIMO insert deve simular "coluna não existe" (schema
// antigo, migration não aplicada) ou suceder normalmente.
let falharProximoInsert = false;

vi.mock('../integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: () => Promise.resolve({ data: [] }) }),
      delete: () => ({ lt: () => Promise.resolve({ data: null, error: null }) }),
      insert: (payload: any) => {
        insertSpy(payload);
        if (falharProximoInsert) {
          falharProximoInsert = false;
          return {
            select: () => ({
              single: () => Promise.resolve({
                data: null,
                error: { message: 'column "server_used" of relation "export_history" does not exist' },
              }),
            }),
          };
        }
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: 'hist-1', ...payload }, error: null }),
          }),
        };
      },
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { HistoricoProvider, useHistorico } from './HistoricoContext';
import { AuthProvider } from './AuthContext';

const SESSION_KEY = 'converter-pro-auth';

function Disparador({ relatorioFalhas }: { relatorioFalhas?: string }) {
  const { registrarHistorico } = useHistorico();
  React.useEffect(() => {
    registrarHistorico({
      arquivo: 'Catalogo Vaeso 026.pdf',
      fornecedor: 'VAESO',
      usuario: 'Admin',
      data: '2026-08-27 15:01',
      tipoConversao: 'Importação (pdf-ai-first · IA) · 1:02 · proprio',
      qtdItens: 162,
      status: 'concluído',
      servidor: 'proprio',
      duracaoSeg: 62,
      parserUsado: 'pdf-ai-first',
      usouIA: true,
      imagensEncontradas: 162,
      imagensAssociadas: 145,
      imagensFalhas: 17,
      relatorioFalhas,
    });
  }, [registrarHistorico, relatorioFalhas]);
  return null;
}

const renderComSessao = (relatorioFalhas?: string) =>
  render(
    <AuthProvider>
      <HistoricoProvider>
        <Disparador relatorioFalhas={relatorioFalhas} />
      </HistoricoProvider>
    </AuthProvider>
  );

describe('histórico — colunas estruturadas e fallback de schema', () => {
  beforeEach(() => {
    insertSpy.mockClear();
    falharProximoInsert = false;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ username: 'josef', isAdmin: false }));
  });

  it('grava servidor, duração, contagem de imagens e relatório de falhas', async () => {
    const relatorio = 'RELATÓRIO DE SKUS SEM IMAGEM\n============================\nSKU: PHD10000 | Página: 6 | Motivo: no_plausible_match';
    renderComSessao(relatorio);

    await waitFor(() => expect(insertSpy).toHaveBeenCalled());
    const payload = insertSpy.mock.calls[0][0];
    expect(payload.server_used).toBe('proprio');
    expect(payload.duration_sec).toBe(62);
    expect(payload.images_found).toBe(162);
    expect(payload.images_matched).toBe(145);
    expect(payload.images_failed).toBe(17);
    expect(payload.failure_report).toBe(relatorio);
  });

  it('sem falha de imagem, grava failure_report como null (não string vazia)', async () => {
    renderComSessao(undefined);

    await waitFor(() => expect(insertSpy).toHaveBeenCalled());
    expect(insertSpy.mock.calls[0][0].failure_report).toBeNull();
  });

  it('se a migration ainda não rodou (insert falha por coluna ausente), refaz com o schema antigo e não perde o registro', async () => {
    falharProximoInsert = true;
    renderComSessao('relatorio qualquer');

    // Duas tentativas: 1ª com colunas novas (falha), 2ª só com o schema antigo.
    await waitFor(() => expect(insertSpy).toHaveBeenCalledTimes(2));

    const tentativaComColunasNovas = insertSpy.mock.calls[0][0];
    expect(tentativaComColunasNovas.server_used).toBe('proprio');

    const tentativaFallback = insertSpy.mock.calls[1][0];
    expect(tentativaFallback.server_used).toBeUndefined();
    expect(tentativaFallback.filename).toBe('Catalogo Vaeso 026.pdf');
    expect(tentativaFallback.item_count).toBe(162);
  });
});
