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
const LAST_RESORT = 'https://conversor-api.metodoiqc.com.br';

/**
 * Carrega o módulo com as URLs injetadas via `setBackends` (o Vite inlina
 * import.meta.env no bundle, então stubEnv não alcança o módulo — ver
 * comentário em backendResolver.ts).
 */
async function loadResolver(env: Record<string, string>) {
  vi.resetModules();
  const mod = await import('./backendResolver');
  mod.setBackends(
    env.VITE_BACKEND_URL ?? '',
    env.VITE_BACKEND_URL_FALLBACK ?? '',
    env.VITE_BACKEND_URL_FALLBACK_2 ?? ''
  );
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

  it('primário e reserva fora do ar: cai na última instância (arquitetura de 3 servidores, 07/09/2026)', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.startsWith(LAST_RESORT) ? Promise.resolve(okResponse) : Promise.reject(new TypeError('Failed to fetch'))
    );
    const { getBackendUrl } = await loadResolver({
      VITE_BACKEND_URL: PRIMARY,
      VITE_BACKEND_URL_FALLBACK: FALLBACK,
      VITE_BACKEND_URL_FALLBACK_2: LAST_RESORT,
    });

    expect(await getBackendUrl()).toBe(LAST_RESORT);
  });

  it('os três fora do ar: devolve o primário (erro real aparece)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { getBackendUrl } = await loadResolver({
      VITE_BACKEND_URL: PRIMARY,
      VITE_BACKEND_URL_FALLBACK: FALLBACK,
      VITE_BACKEND_URL_FALLBACK_2: LAST_RESORT,
    });

    expect(await getBackendUrl()).toBe(PRIMARY);
  });

  it('sem última instância configurada: para na reserva, nunca tenta um 3º health check', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.startsWith(FALLBACK) ? Promise.resolve(okResponse) : Promise.reject(new TypeError('Failed to fetch'))
    );
    const { getBackendUrl } = await loadResolver({
      VITE_BACKEND_URL: PRIMARY,
      VITE_BACKEND_URL_FALLBACK: FALLBACK,
    });

    expect(await getBackendUrl()).toBe(FALLBACK);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    ).toEqual({ primary: FALLBACK, fallback: PRIMARY, fallback2: 'https://ignorado.example' });
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
    ).toEqual({ primary: FALLBACK, fallback: PRIMARY, fallback2: '' });
  });

  it('pin sem nenhuma reserva diferente: failover desligado, sem duplicar', async () => {
    const { pickBackends } = await import('./backendResolver');
    expect(
      pickBackends({ VITE_BACKEND_URL_PRIMARY: FALLBACK, VITE_BACKEND_URL: FALLBACK })
    ).toEqual({ primary: FALLBACK, fallback: '', fallback2: '' });
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
    ).toEqual({ primary: PRIMARY, fallback: FALLBACK, fallback2: '' });
  });

  it('sem nenhuma variável: cai em localhost e failover desligado', async () => {
    const { pickBackends } = await import('./backendResolver');
    expect(pickBackends({})).toEqual({ primary: 'http://localhost:8000', fallback: '', fallback2: '' });
  });

  it('pin vazio é tratado como ausente (não zera o primário)', async () => {
    const { pickBackends } = await import('./backendResolver');
    expect(
      pickBackends({ VITE_BACKEND_URL_PRIMARY: '', VITE_BACKEND_URL: PRIMARY, VITE_BACKEND_URL_FALLBACK: FALLBACK })
    ).toEqual({ primary: PRIMARY, fallback: FALLBACK, fallback2: '' });
  });
});

/**
 * Arquitetura de 3 servidores (07/09/2026, decisão do Gabriel): Integrator
 * primário, Render reserva automática, Wesley última instância — pois o
 * servidor do Wesley segue com porta fechada e sem atualização, mas ainda
 * assim é melhor que site fora do ar se Integrator E Render caírem juntos.
 */
describe('pickBackends — última instância (Wesley, 3º servidor)', () => {
  it('com os três configurados: cadeia Integrator → Render → Wesley', async () => {
    const { pickBackends } = await import('./backendResolver');
    expect(
      pickBackends({
        VITE_BACKEND_URL_PRIMARY: PRIMARY,
        VITE_BACKEND_URL_FALLBACK: FALLBACK,
        VITE_BACKEND_URL_FALLBACK_2: LAST_RESORT,
      })
    ).toEqual({ primary: PRIMARY, fallback: FALLBACK, fallback2: LAST_RESORT });
  });

  it('última instância igual à reserva: não duplica, fica de fora da cadeia', async () => {
    const { pickBackends } = await import('./backendResolver');
    expect(
      pickBackends({
        VITE_BACKEND_URL_PRIMARY: PRIMARY,
        VITE_BACKEND_URL_FALLBACK: FALLBACK,
        VITE_BACKEND_URL_FALLBACK_2: FALLBACK,
      })
    ).toEqual({ primary: PRIMARY, fallback: FALLBACK, fallback2: '' });
  });

  it('última instância igual ao pin: fica de fora da cadeia (nunca primário e reserva no mesmo servidor)', async () => {
    const { pickBackends } = await import('./backendResolver');
    expect(
      pickBackends({
        VITE_BACKEND_URL_PRIMARY: PRIMARY,
        VITE_BACKEND_URL_FALLBACK: FALLBACK,
        VITE_BACKEND_URL_FALLBACK_2: PRIMARY,
      })
    ).toEqual({ primary: PRIMARY, fallback: FALLBACK, fallback2: '' });
  });

  it('sem pin: última instância nunca entra em jogo (comportamento legado de 2 servidores)', async () => {
    const { pickBackends } = await import('./backendResolver');
    expect(
      pickBackends({
        VITE_BACKEND_URL: PRIMARY,
        VITE_BACKEND_URL_FALLBACK: FALLBACK,
        VITE_BACKEND_URL_FALLBACK_2: LAST_RESORT,
      })
    ).toEqual({ primary: PRIMARY, fallback: FALLBACK, fallback2: '' });
  });
});
