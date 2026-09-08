// ===================================================================
// RESOLVEDOR DE BACKEND COM FAILOVER AUTOMÁTICO (14/08/2026)
// ===================================================================
// Contexto real: o backend roda num servidor próprio (atrás de um
// Cloudflare Tunnel) com o Render como reserva. O servidor próprio caiu
// 3x em 3 dias (bloqueio de segurança da rede, fibra rompida, queda sem
// causa identificada) e TODA vez o cliente ficou parado até alguém
// perceber e trocar `VITE_BACKEND_URL` no Vercel + redeploy na mão.
//
// Por que NÃO um monitor externo de 5 em 5 min (a ideia inicial):
//   1. Se o monitor roda no próprio servidor, ele morre junto — inútil
//      exatamente no momento que importa.
//   2. Mesmo rodando fora, seriam até 5min de detecção + ~1min de
//      redeploy = ~6min de cliente parado A CADA queda.
//
// Este resolvedor troca na hora: testa o primário via /health, e se não
// responder usa o fallback na mesma requisição. Zero downtime, sem
// depender de nenhum processo externo estar vivo.
//
// IMPORTANTE — não re-resolver no meio de um job: um job criado no
// servidor A só existe no servidor A (o status fica em disco lá). Cada
// operação resolve UMA vez no início e usa a mesma URL até o fim, senão
// o polling perguntaria o status pro servidor errado e veria "not_found".
// Por isso o resolver expõe a URL resolvida e quem chama guarda numa
// const local pela duração da operação.
// ===================================================================

/** Cadeia de backends, do mais pra menos prioritário. */
type BackendChain = { primary: string; fallback: string; fallback2: string };

/** Sobrescrita explícita das URLs — ver `setBackends()`. */
let overrides: BackendChain | null = null;

/**
 * Define as URLs manualmente e limpa a escolha memoizada.
 *
 * Existe porque o Vite INLINA `import.meta.env` como literal no bundle, então
 * `vi.stubEnv` não alcança este módulo — sem um ponto de injeção, o failover
 * (a parte que mais precisa de teste, já que só dispara quando um servidor
 * cai) ficaria sem cobertura. Usado pelos testes; em produção ninguém chama e
 * a config vem do ambiente normalmente.
 */
export function setBackends(primary: string, fallback: string, fallback2 = ''): void {
  overrides = { primary, fallback, fallback2 };
  resolved = null;
  inFlight = null;
}

/**
 * Decide a cadeia primário → reserva → última instância a partir das
 * variáveis de ambiente.
 *
 * Arquitetura de 3 servidores (07/09/2026, decisão do Gabriel): Integrator
 * (VPS própria, homologada 04/09) é o primário, Render a reserva automática,
 * e o servidor do Wesley vira última instância — continua com porta fechada
 * e sem atualização no momento desta decisão, então na prática o health
 * check dele falha e ele nunca é escolhido enquanto isso não mudar. Ele fica
 * na cadeia mesmo assim: existir estruturalmente como último recurso é
 * melhor que site fora do ar caso Integrator E Render caiam juntos.
 *
 * Quatro variáveis, porque o `VITE_BACKEND_URL` NÃO é confiável como
 * primário: ele era reescrito automaticamente pelo watcher do Cloudflare
 * Tunnel do servidor do Wesley (a URL do túnel gratuito mudava a cada
 * reinício) e o watcher ainda disparava um redeploy. Ou seja: qualquer
 * decisão de "qual servidor atende o cliente" feita nessa variável se desfaz
 * sozinha na próxima queda do túnel — foi exatamente o que aconteceria com a
 * troca para o Render em 20/08/2026, feita enquanto o SSH do servidor
 * próprio estava fechado e o watcher não podia ser desligado. A variável
 * segue existindo só por compatibilidade com essa história; hoje nada mais
 * escreve nela.
 *
 *   VITE_BACKEND_URL_PRIMARY    → trava o primário (Integrator).
 *   VITE_BACKEND_URL            → legado do watcher do túnel; ignorada como
 *                                  candidata a reserva quando o pin existe.
 *   VITE_BACKEND_URL_FALLBACK   → reserva automática (Render).
 *   VITE_BACKEND_URL_FALLBACK_2 → última instância (Wesley).
 *
 * Sem o pin, o comportamento é o legado de 2 servidores (primário = watcher
 * ou localhost, reserva = FALLBACK) — FALLBACK_2 nunca entra em jogo nesse
 * caso, porque não existia essa variável antes do pin ser adotado.
 */
export function pickBackends(env: Record<string, any>): BackendChain {
  const pin = env.VITE_BACKEND_URL_PRIMARY || '';
  const doWatcher = env.VITE_BACKEND_URL || '';
  const reservaFixa = env.VITE_BACKEND_URL_FALLBACK || '';
  const ultimaInstancia = env.VITE_BACKEND_URL_FALLBACK_2 || '';

  if (pin) {
    // Cada posição da cadeia é a primeira URL candidata que exista, seja
    // DIFERENTE do pin e ainda não tenha sido usada numa posição anterior —
    // sem esse cuidado a troca de 20/08 viraria "primário e reserva no mesmo
    // servidor" (failover morto e ninguém percebe).
    const usados = new Set([pin]);
    const proxima = (candidatos: string[]) => {
      const achado = candidatos.find(u => u && !usados.has(u)) || '';
      if (achado) usados.add(achado);
      return achado;
    };
    const fallback = proxima([doWatcher, reservaFixa, ultimaInstancia]);
    const fallback2 = proxima([reservaFixa, ultimaInstancia, doWatcher]);
    return { primary: pin, fallback, fallback2 };
  }

  return {
    primary: doWatcher || 'http://localhost:8000',
    fallback: reservaFixa,
    fallback2: '',
  };
}

function readBackends(): BackendChain {
  if (overrides) return overrides;
  return pickBackends((import.meta as any).env ?? {});
}

/** Timeout do teste de saúde. Servidor fora do ar costuma falhar em ~1s
 *  (DNS/conexão recusada); esse teto cobre o caso "pendurado sem responder". */
const HEALTH_TIMEOUT_MS = 8000;

let resolved: string | null = null;
let inFlight: Promise<string> | null = null;

async function isHealthy(url: string): Promise<boolean> {
  if (!url) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const resp = await fetch(`${url}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

async function probe(): Promise<string> {
  const { primary, fallback, fallback2 } = readBackends();

  // Sem fallback configurado: comportamento idêntico ao de antes (nenhum
  // health check extra, nenhuma latência adicionada).
  if (!fallback) return primary;

  if (await isHealthy(primary)) return primary;

  console.warn('[BackendResolver] Primário não respondeu — testando reserva...');
  if (await isHealthy(fallback)) {
    console.warn(`[BackendResolver] Usando backend reserva: ${fallback}`);
    return fallback;
  }

  if (fallback2) {
    console.warn('[BackendResolver] Reserva não respondeu — testando última instância...');
    if (await isHealthy(fallback2)) {
      console.warn(`[BackendResolver] Usando backend de última instância: ${fallback2}`);
      return fallback2;
    }
  }

  // Todos fora: devolve o primário pra que o erro real (e sua mensagem)
  // apareça normalmente, em vez de mascarar como problema de fallback.
  console.error('[BackendResolver] Primário, reserva e última instância fora do ar.');
  return primary;
}

/**
 * Retorna a URL do backend saudável. Resolve uma vez e memoiza pela sessão
 * (chamadas concorrentes compartilham a mesma promise, sem health check
 * duplicado). Use `invalidateBackend()` pra forçar nova checagem.
 */
export async function getBackendUrl(): Promise<string> {
  if (resolved) return resolved;
  if (inFlight) return inFlight;

  inFlight = probe();
  try {
    resolved = await inFlight;
    return resolved;
  } finally {
    inFlight = null;
  }
}

/** Descarta a escolha memoizada — próxima chamada testa de novo. Usar quando
 *  uma operação falhar por rede (o servidor pode ter caído no meio da sessão). */
export function invalidateBackend(): void {
  resolved = null;
}

/** Só pra diagnóstico/telemetria: rótulo curto do backend em uso. */
export function backendLabel(url: string): string {
  if (!url) return 'desconhecido';
  if (url.includes('onrender.com')) return 'render';
  if (url.includes('conversor-vps.metodoiqc.com.br')) return 'integrator';
  // trycloudflare.com = túnel antigo; conversor-api = servidor do Wesley.
  if (url.includes('trycloudflare.com') || url.includes('conversor-api.metodoiqc.com.br')) return 'proprio';
  if (url.includes('localhost') || url.includes('127.0.0.1')) return 'local';
  return 'outro';
}
