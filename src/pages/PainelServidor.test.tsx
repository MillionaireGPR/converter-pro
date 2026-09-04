/**
 * Trava o redirect fixo pro painel do servidor (incidente 12/08/2026: link
 * salvo do painel quebrava a cada troca de URL do Cloudflare Tunnel).
 *
 * NÃO testa/usa token de admin aqui de propósito -- ver comentário em
 * PainelServidor.tsx sobre por que ele não pode vir de VITE_ADMIN_TOKEN
 * (variáveis VITE_ ficam expostas em texto puro no bundle público).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PainelServidor from './PainelServidor';

describe('PainelServidor (redirect fixo)', () => {
  const originalLocation = window.location;
  const replaceMock = vi.fn();

  beforeEach(() => {
    replaceMock.mockClear();
    // jsdom não permite reassignar window.location.replace direto (read-only)
    // -- substitui o objeto location inteiro por um stub.
    // @ts-expect-error -- substituição intencional só para o teste
    delete window.location;
    // @ts-expect-error -- stub mínimo, só o que o componente usa
    window.location = { replace: replaceMock };
  });

  afterEach(() => {
    // @ts-expect-error -- restaura o location real do jsdom
    window.location = originalLocation;
  });

  it('redireciona sempre para o painel central da Integrator', async () => {
    render(<PainelServidor />);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        'https://conversor-vps.metodoiqc.com.br/admin/dashboard'
      )
    );
  });

  it('avisa que está abrindo a Central dos Servidores', () => {
    render(<PainelServidor />);
    expect(screen.getByText('Redirecionando para a Central dos Servidores...')).toBeTruthy();
  });

  it('faz somente um redirecionamento por montagem', async () => {
    render(<PainelServidor />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledTimes(1));
  });

  it('nunca inclui token na URL de redirecionamento (VITE_ é público no bundle)', async () => {
    render(<PainelServidor />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    const urlChamada = replaceMock.mock.calls[0][0] as string;
    expect(urlChamada).not.toContain('token');
    expect(urlChamada).not.toContain('?');
  });
});
