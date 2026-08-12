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
import { render, waitFor } from '@testing-library/react';
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

  it('redireciona para {backendUrl}/admin/dashboard', async () => {
    render(<PainelServidor backendUrl="https://qualquer-url-do-tunel.trycloudflare.com" />);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        'https://qualquer-url-do-tunel.trycloudflare.com/admin/dashboard'
      )
    );
  });

  it('acompanha o backend atual mesmo que a URL do túnel mude', async () => {
    render(<PainelServidor backendUrl="https://outra-url-diferente.trycloudflare.com" />);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        'https://outra-url-diferente.trycloudflare.com/admin/dashboard'
      )
    );
  });

  it('não tenta redirecionar sem backendUrl configurado', async () => {
    render(<PainelServidor backendUrl="" />);

    await new Promise((r) => setTimeout(r, 10));
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('nunca inclui token na URL de redirecionamento (VITE_ é público no bundle)', async () => {
    render(<PainelServidor backendUrl="https://qualquer-url.trycloudflare.com" />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    const urlChamada = replaceMock.mock.calls[0][0] as string;
    expect(urlChamada).not.toContain('token');
    expect(urlChamada).not.toContain('?');
  });
});
