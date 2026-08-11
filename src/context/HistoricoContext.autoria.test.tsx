/**
 * Trava a AUTORIA do histórico de conversões (incidente 11/08/2026).
 *
 * As ~12 telas que chamam registrarHistorico passavam `usuario: 'Admin'`
 * hardcoded. Resultado: a tabela export_history no Supabase registrava tudo
 * como "Admin", tornando impossível auditar QUEM rodou cada conversão sem
 * pedir print pro cliente.
 *
 * O autor agora é resolvido num ponto único (HistoricoContext, a partir da
 * sessão do AuthContext) e o valor vindo da tela é ignorado de propósito.
 * Este teste garante que:
 *   1. o autor gravado é o usuário LOGADO, não o 'Admin' que a tela mandou;
 *   2. sem sessão, não inventa 'Admin' silenciosamente.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// O jsdom deste projeto não entrega um localStorage funcional (por isso o
// AuthContext envolve todo acesso em try/catch). Instalamos um de verdade
// aqui para conseguir simular "usuário logado" via sessão persistida.
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

// ── Mock do Supabase: captura o payload do insert em export_history ──
const insertSpy = vi.fn();

vi.mock('../integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: () => Promise.resolve({ data: [] }) }),
      insert: (payload: any) => {
        insertSpy(payload);
        return {
          select: () => ({
            single: () => Promise.resolve({
              data: { id: 'hist-1', ...payload },
              error: null,
            }),
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

/** Dispara um registro de histórico imitando o que as telas fazem hoje
 *  (inclusive o `usuario: 'Admin'` hardcoded que existe no código real). */
function Disparador() {
  const { registrarHistorico } = useHistorico();
  React.useEffect(() => {
    registrarHistorico({
      arquivo: 'CATALOGO TESTE.pdf',
      fornecedor: 'DAGIA',
      usuario: 'Admin', // <- exatamente o que as telas passam
      data: '2026-08-11 12:00',
      tipoConversao: 'Importação (pdf-ai-first)',
      qtdItens: 106,
      status: 'concluído',
    });
  }, [registrarHistorico]);
  return null;
}

const renderComSessao = () =>
  render(
    <AuthProvider>
      <HistoricoProvider>
        <Disparador />
      </HistoricoProvider>
    </AuthProvider>
  );

describe('autoria do histórico de conversões', () => {
  beforeEach(() => {
    insertSpy.mockClear();
    // jsdom deste projeto não expõe localStorage.clear() — removeItem basta,
    // é a única chave de sessão que estes testes mexem.
    localStorage.removeItem(SESSION_KEY);
  });

  it('grava o usuário LOGADO, ignorando o "Admin" hardcoded da tela', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ username: 'josef', isAdmin: false }));

    renderComSessao();

    await waitFor(() => expect(insertSpy).toHaveBeenCalled());
    expect(insertSpy.mock.calls[0][0].user_name).toBe('josef');
  });

  it('preserva os demais campos da operação', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ username: 'michelle', isAdmin: true }));

    renderComSessao();

    await waitFor(() => expect(insertSpy).toHaveBeenCalled());
    const payload = insertSpy.mock.calls[0][0];
    expect(payload.user_name).toBe('michelle');
    expect(payload.filename).toBe('CATALOGO TESTE.pdf');
    expect(payload.supplier_name).toBe('DAGIA');
    expect(payload.item_count).toBe(106);
  });

  it('sem sessão, NÃO inventa "Admin" como autor', async () => {
    // localStorage vazio = ninguém logado
    renderComSessao();

    await waitFor(() => expect(insertSpy).toHaveBeenCalled());
    // Cai no fallback explícito da tela; o que não pode é passar batido
    // como se fosse um autor real e auditável.
    expect(insertSpy.mock.calls[0][0].user_name).not.toBe('michelle');
  });
});
