/**
 * Assinatura na tela (28/09/2026): desligada/em dia não muda nada; vencendo
 * e carência mostram faixa; bloqueada troca o conteúdo pela tela de renovar,
 * exceto na própria página /assinatura.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { STATUS_DESLIGADA, type EstadoAssinatura } from '@/core/billing/assinatura';

let estadoAtual: EstadoAssinatura = 'desligada';
vi.mock('@/hooks/useAssinatura', () => ({
  useAssinatura: () => ({
    status: {
      ...STATUS_DESLIGADA, estado: estadoAtual, ativa: estadoAtual !== 'desligada',
      pago_ate: '2026-10-01T12:00:00Z', bloqueia_em: '2026-10-06T12:00:00Z', dias_restantes: 3,
    },
    carregando: false, recarregar: vi.fn(),
  }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('@/components/AppSidebar', () => ({ AppSidebar: () => null }));
vi.mock('@/components/ConversoesEmAndamento', () => ({ ConversoesEmAndamento: () => null }));

import { AppLayout } from './AppLayout';

const montar = (estado: EstadoAssinatura, rota = '/conversao') => {
  estadoAtual = estado;
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/conversao" element={<p>TELA DE CONVERSÃO</p>} />
          <Route path="/assinatura" element={<p>TELA DE PAGAR</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
};

describe('Assinatura no layout', () => {
  it.each(['desligada', 'ativa'] as const)('%s: nada muda', (estado) => {
    montar(estado);
    expect(screen.getByText('TELA DE CONVERSÃO')).toBeTruthy();
    expect(screen.queryByText(/Renovar/)).toBeNull();
  });

  it('vencendo: faixa de aviso e o sistema segue funcionando', () => {
    montar('vencendo');
    expect(screen.getByText(/vence em 3 dias/)).toBeTruthy();
    expect(screen.getByText('TELA DE CONVERSÃO')).toBeTruthy();
  });

  it('carência: faixa de vencida e o sistema segue funcionando', () => {
    montar('carencia');
    expect(screen.getByText(/Assinatura vencida em/)).toBeTruthy();
    expect(screen.getByText('TELA DE CONVERSÃO')).toBeTruthy();
  });

  it('bloqueada: troca a tela pela de renovar', () => {
    montar('bloqueada');
    expect(screen.queryByText('TELA DE CONVERSÃO')).toBeNull();
    expect(screen.getByText('Renovar assinatura')).toBeTruthy();
  });

  it('bloqueada: a página de pagar continua abrindo', () => {
    montar('bloqueada', '/assinatura');
    expect(screen.getByText('TELA DE PAGAR')).toBeTruthy();
  });
});
