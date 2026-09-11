/**
 * Prazo de upload proporcional ao tamanho do arquivo.
 *
 * Vive sozinho porque DOIS caminhos sobem o MESMO PDF para o backend — a
 * leitura por IA (`aiFirstExtractionApi`) e a captação de fotos
 * (`imageExtractionApi`) — e em 10/09/2026 só o primeiro foi corrigido. O
 * segundo ficou com o teto fixo de 180s e continuou derrubando catálogo
 * grande, o que chegou ao cliente como "as fotos não funcionaram"
 * (código IMG-GEN) mesmo com o servidor terminando o trabalho direitinho.
 *
 * ┌─ PROVA (log do Nginx, 11/09/2026, Dute Toys 68MB, IP do Josef) ─────────┐
 * │ 10:37:38  POST /process → 400 (upload cortado pelo navegador)          │
 * │ 10:40:43  POST /process → 400   ← 3min04 depois (180s + backoff 3s)    │
 * │ 10:43:51  POST /process → 400   ← 3min08 (180s + 6s)                   │
 * │ 10:47:04  POST /process → 400   ← 3min13 (180s + 12s)                  │
 * │ 10:50:28  POST /process → 400   ← 3min24 (180s + 24s)                  │
 * │ …e a ÚNICA tentativa que passou levou 242s (10:24:34 → 10:28:36),      │
 * │ terminou em "611 matches" e o ZIP subiu inteiro pro Supabase.          │
 * └────────────────────────────────────────────────────────────────────────┘
 * Ou seja: o arquivo precisava de 242s e o navegador desistia aos 180s. Não
 * era o servidor, não era o catálogo — era o cronômetro do lado do cliente.
 */

/**
 * Banda de upload assumida no pior caso (KB/s).
 *
 * Os 242s medidos acima em 68MB dão ~288 KB/s no link do cliente, ou seja,
 * o piso anterior de 300 KB/s prometia mais banda do que ele tem — por isso
 * o prazo calculado ficava logo ABAIXO do tempo real e o upload morria por
 * um triz. 120 KB/s (~1 Mbps) deixa ~2,4× de folga sobre o medido e absorve
 * um dia ruim de internet sem tornar o prazo infinito.
 */
const UPLOAD_FLOOR_KBPS = 120;

/** IV-07 exige pelo menos 120s por tentativa; 180s é a nossa margem. */
const UPLOAD_TIMEOUT_MIN_MS = 180_000;

/**
 * Teto: mantém o prazo FINITO (IV-08) — sem ele um link morto prenderia a
 * tela para sempre. 30min cobre o maior catálogo aceito (600MB) na banda
 * real do cliente; acima disso o problema é outro e precisa aparecer.
 */
const UPLOAD_TIMEOUT_MAX_MS = 30 * 60 * 1000;

/** Prazo do upload proporcional ao tamanho do arquivo. Ver `UPLOAD_FLOOR_KBPS`. */
export const uploadTimeoutMs = (fileSizeBytes: number): number => {
  const estimado = (fileSizeBytes / 1024 / UPLOAD_FLOOR_KBPS) * 1000;
  return Math.round(Math.min(Math.max(UPLOAD_TIMEOUT_MIN_MS, estimado), UPLOAD_TIMEOUT_MAX_MS));
};

/**
 * Prazo da tentativa N, já com folga crescente.
 *
 * Repetir um upload que estourou o prazo com o MESMO prazo é repetir a
 * derrota: se 180s não bastaram, 180s de novo também não bastam. Cada nova
 * tentativa ganha 50% a mais de tempo (limitado pelo teto), então a retentativa
 * ataca a causa real — o arquivo é grande e o link é lento — em vez de só
 * queimar banda. Foi assim que o Dute gastou 16min em 5 uploads natimortos.
 */
export const uploadTimeoutForAttempt = (fileSizeBytes: number, attempt: number): number => {
  const base = uploadTimeoutMs(fileSizeBytes);
  const fator = 1.5 ** Math.max(0, attempt - 1);
  return Math.round(Math.min(base * fator, UPLOAD_TIMEOUT_MAX_MS));
};
