/**
 * Trava o failover automático de backend (14/08/2026).
 *
 * Motivação real: o servidor próprio caiu 3x em 3 dias e TODA vez o cliente
 * ficou parado até alguém trocar VITE_BACKEND_URL no Vercel na mão. Estes
 * testes garantem que o site cai na reserva sozinho — e, tão importante
 * quanto, que NÃO troca de servidor no meio de um job (o job só existe no
 * servidor onde foi criado).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const PRIMARY = 'https://tunel-do-servidor.trycloudflare.com';
const FALLBACK = 'https://converter-pro-image-extractor.onrender.com';

/**
 * Carrega o módulo com as URLs injetadas via `setBackends` (o Vite inlina
 * import.meta.env no bundle, então stubEnv não alcança o módulo — ver
 * comentário em backendResolver.ts).
 */
async function loadResolver(env: Record<string, string>) {
  vi.resetModules();
  const mod = await import('./backendResolver');
  mod.setBackends(env.VITE_BACKEND_URL ?? '', env.VITE_BACKEND_URL_FALLBACK ?? '');
  return mod;
}

const okResponse = { ok: true } as Response;

describe('backendResolver — failover automático', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('usa o primário quando ele está saudável (não toca na reserva)', async () => {
    fetchMock.mockResolvedValue(okResponse);
    const { getBackendUrl } = await loadResolver({
      VITE_BACKEND_URL: PRIMARY,
      VITE_BACKEND_URL_FALLBACK: FALLBACK,
    });

    expect(await getBackendUrl()).toBe(PRIMARY);
    expect(fetchMock).toHaveBeenCalledWith(`${PRIMARY}/health`, expect.anything());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cai na reserva quando o primário não responde (erro de rede)', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.startsWith(PRIMARY)
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(okResponse)
    );
    const { getBackendUrl } = await loadResolver({
      VITE_BACKEND_URL: PRIMARY,
      VITE_BACKEND_URL_FALLBACK: FALLBACK,
    });

    expect(await getBackendUrl()).toBe(FALLBACK);
  });

  it('cai na reserva quando o primário responde com erro HTTP', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({ ok: !url.startsWith(PRIMARY) } as Response)
    );
    const { getBackendUrl } = await loadResolver({
      VITE_BACKEND_URL: PRIMARY,
      VITE_BACKEND_URL_FALLBACK: FALLBACK,
    });

    expect(await getBackendUrl()).toBe(FALLBACK);
  });

  it('memoiza: chamadas seguintes não refazem health check (não troca no meio do job)', async () => {
    fetchMock.mockResolvedValue(okResponse);
    const { getBackendUrl } = await loadResolver({
      VITE_BACKEND_URL: PRIMARY,
      VITE_BACKEND_URL_FALLBACK: FALLBACK,
    });

    await getBackendUrl();
    await getBackendUrl();
    await getBackendUrl();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('chamadas concorrentes compartilham UM único health check', async () => {
    fetchMock.mockResolvedValue(okResponse);
    const { getBackendUrl } = await loadResolver({
      VITE_BACKEND_URL: PRIMARY,
      VITE_BACKEND_URL_FALLBACK: FALLBACK,
    });

    const [a, b, c] = await Promise.all([getBackendUrl(), getBackendUrl(), getBackendUrl()]);

    expect([a, b, c]).toEqual([PRIMARY, PRIMARY, PRIMARY]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('invalidateBackend() força nova checagem (servidor pode ter caído na sessão)', async () => {
    fetchMock.mockResolvedValue(okResponse);
    const { getBackendUrl, invalidateBackend } = await loadResolver({
      VITE_BACKEND_URL: PRIMARY,
      VITE_BACKEND_URL_FALLBACK: FALLBACK,
    });

    await getBackendUrl();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    invalidateBackend();
    // Agora o primário morreu: deve migrar pra reserva sem reload da página.
    fetchMock.mockImplementation((url: string) =>
      url.startsWith(PRIMARY)
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(okResponse)
    );

    expect(await getBackendUrl()).toBe(FALLBACK);
  });

  it('sem reserva configurada: NÃO faz health check nenhum (comportamento antigo)', async () => {
    const { getBackendUrl } = await loadResolver({
      VITE_BACKEND_URL: PRIMARY,
      VITE_BACKEND_URL_FALLBACK: '',
    });

    expect(await getBackendUrl()).toBe(PRIMARY);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ambos fora do ar: devolve o primário (erro real aparece, não vira erro de fallback)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { getBackendUrl } = await loadResolver({
      VITE_BACKEND_URL: PRIMARY,
      VITE_BACKEND_URL_FALLBACK: FALLBACK,
    });

    expect(await getBackendUrl()).toBe(PRIMARY);
  });
});

describe('backendLabel — rótulo pra diagnóstico', () => {
  it('identifica cada backend', async () => {
    const { backendLabel } = await loadResolver({ VITE_BACKEND_URL: PRIMARY });
    expect(backendLabel('https://x.onrender.com')).toBe('render');
    expect(backendLabel('https://y.trycloudflare.com')).toBe('proprio');
    expect(backendLabel('http://localhost:8000')).toBe('local');
    expect(backendLabel('')).toBe('desconhecido');
  });
});
