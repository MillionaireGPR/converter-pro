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
    expect(backendLabel('https://conversor-api.metodoiqc.com.br')).toBe('proprio');
    expect(backendLabel('https://conversor-vps.metodoiqc.com.br')).toBe('integrator');
    expect(backendLabel('http://localhost:8000')).toBe('local');
    expect(backendLabel('')).toBe('desconhecido');
  });
});

/**
 * Trava a decisão de 20/08/2026: o cliente foi apontado para o Render porque o
 * servidor próprio estava com o código antigo e o SSH fechado (não dava para
 * atualizar nem para desligar o watcher do túnel). O watcher reescreve
 * `VITE_BACKEND_URL` e dispara redeploy sozinho — sem o pin, a troca se
 * desfaria na próxima vez que o túnel reiniciasse, sem ninguém perceber.
 */
describe('pickBackends — pin do primário contra o watcher do túnel', () => {
  it('com pin: o pin manda e o que o watcher escreveu vira reserva', async () => {
    const { pickBackends } = await import('./backendResolver');
    expect(
      pickBackends({
        VITE_BACKEND_URL_PRIMARY: FALLBACK,
        VITE_BACKEND_URL: PRIMARY,
        VITE_BACKEND_URL_FALLBACK: 'https://ignorado.example',
      })
    ).toEqual({ primary: FALLBACK, fallback: PRIMARY });
  });

  it('nunca aponta primario e reserva pro MESMO servidor (failover morto)', async () => {
    const { pickBackends } = await import('./backendResolver');
    // Estado real da transicao: enquanto o pin nao valia em producao, o Render
    // precisava estar em VITE_BACKEND_URL. Ao passar a valer, a reserva pula
    // essa variavel (igual ao pin) e usa a reserva fixa.
    expect(
      pickBackends({
        VITE_BACKEND_URL_PRIMARY: FALLBACK,
        VITE_BACKEND_URL: FALLBACK,
        VITE_BACKEND_URL_FALLBACK: PRIMARY,
      })
    ).toEqual({ primary: FALLBACK, fallback: PRIMARY });
  });

  it('pin sem nenhuma reserva diferente: failover desligado, sem duplicar', async () => {
    const { pickBackends } = await import('./backendResolver');
    expect(
      pickBackends({ VITE_BACKEND_URL_PRIMARY: FALLBACK, VITE_BACKEND_URL: FALLBACK })
    ).toEqual({ primary: FALLBACK, fallback: '' });
  });

  it('o watcher trocando a URL do túnel NÃO promove o túnel a primário', async () => {
    const { pickBackends } = await import('./backendResolver');
    const depois = pickBackends({
      VITE_BACKEND_URL_PRIMARY: FALLBACK,
      VITE_BACKEND_URL: 'https://outro-tunel-qualquer.trycloudflare.com',
    });
    expect(depois.primary).toBe(FALLBACK);
    expect(depois.fallback).toBe('https://outro-tunel-qualquer.trycloudflare.com');
  });

  it('sem pin: comportamento idêntico ao de antes', async () => {
    const { pickBackends } = await import('./backendResolver');
    expect(
      pickBackends({ VITE_BACKEND_URL: PRIMARY, VITE_BACKEND_URL_FALLBACK: FALLBACK })
    ).toEqual({ primary: PRIMARY, fallback: FALLBACK });
  });

  it('sem nenhuma variável: cai em localhost e failover desligado', async () => {
    const { pickBackends } = await import('./backendResolver');
    expect(pickBackends({})).toEqual({ primary: 'http://localhost:8000', fallback: '' });
  });

  it('pin vazio é tratado como ausente (não zera o primário)', async () => {
    const { pickBackends } = await import('./backendResolver');
    expect(
      pickBackends({ VITE_BACKEND_URL_PRIMARY: '', VITE_BACKEND_URL: PRIMARY, VITE_BACKEND_URL_FALLBACK: FALLBACK })
    ).toEqual({ primary: PRIMARY, fallback: FALLBACK });
  });
});
