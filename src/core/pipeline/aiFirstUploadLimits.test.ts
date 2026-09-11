/**
 * Trava as duas causas do incidente de 08/09/2026, em que o Josef reportou
 * "a Fortal não extraiu as imagens" e "a TUKA TOYS não extraiu basicamente
 * nada". Nos DOIS casos a IA nunca chegou a rodar — o catálogo nem chegou ao
 * Gemini — e o cliente recebeu "Concluído" sem nenhum aviso.
 *
 * Provas colhidas na investigação (log do Nginx da Integrator + execução real):
 *
 *   FORTAL (96,4MB): 10 POSTs a /extract_products_ai abortados pelo cliente,
 *   espaçados de 183s, 186s, 192s, 204s — exatamente 180s (o timeout fixo que
 *   existia aqui) + o backoff exponencial 3/6/12/24s. O mesmo arquivo, subido
 *   de um link rápido, levou 18,6s pra subir e a IA devolveu 950 produtos em
 *   47s. Ou seja: não era o servidor nem o catálogo — era o prazo do upload.
 *
 *   TUKA TOYS (435,7MB): 5×413 do Nginx em 46s (client_max_body_size).
 *   O arquivo passa do teto do proxy, então nenhum byte útil sobe.
 */
import { describe, it, expect } from 'vitest';
import { uploadTimeoutMs, MAX_UPLOAD_MB, extractProductsViaAI } from './aiFirstExtractionApi';

const MB = 1024 * 1024;

describe('uploadTimeoutMs — prazo proporcional ao tamanho do arquivo', () => {
  it('mantém o piso de 180s em arquivo pequeno (IV-07 exige >= 120s)', () => {
    expect(uploadTimeoutMs(5 * MB)).toBe(180_000);
  });

  it('dá tempo real ao FORTAL (96,4MB) — o prazo fixo de 180s era a causa da falha', () => {
    const prazo = uploadTimeoutMs(96.4 * MB);
    // Com o piso de 120 KB/s: ~13,7min. O ponto é ser MAIOR que os 180s antigos,
    // que abortavam o upload do Josef no meio.
    expect(prazo).toBeGreaterThan(180_000);
    expect(prazo).toBeCloseTo(822_000, -4);
  });

  it('cobre o Dute (68MB) com folga sobre os 242s que ele levou de verdade', () => {
    // Medido no log do Nginx em 11/09/2026: a única tentativa que passou levou
    // 242s. O piso antigo de 300 KB/s dava 232s — ABAIXO do tempo real, que é
    // por que o upload morria por um triz e virava IMG-GEN.
    expect(uploadTimeoutMs(68 * MB)).toBeGreaterThan(242_000);
  });

  it('nunca é infinito — teto de 30min preserva o IV-08 (prazo finito)', () => {
    expect(uploadTimeoutMs(10_000 * MB)).toBe(30 * 60 * 1000);
  });

  it('cresce junto com o arquivo', () => {
    expect(uploadTimeoutMs(300 * MB)).toBeGreaterThan(uploadTimeoutMs(100 * MB));
  });
});

describe('teto de upload — falha cedo e explica, em vez de subir pra tomar 413', () => {
  /** File mínimo: só `size` e `name` são lidos antes do corte por tamanho. */
  const fakeFile = (mb: number) => ({ size: mb * MB, name: 'catalogo.pdf' }) as File;

  it('recusa arquivo acima do teto SEM chamar a rede', async () => {
    let houveFetch = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => { houveFetch = true; return Promise.reject(new Error('não deveria subir')); }) as typeof fetch;
    try {
      const { resultado, falha } = await extractProductsViaAI(fakeFile(MAX_UPLOAD_MB + 50), 'TUKA TOYS');
      expect(resultado).toBeNull();
      expect(falha?.motivo).toBe('arquivo_grande_demais');
      expect(houveFetch).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('a mensagem é acionável pro cliente (tamanho, limite e o que fazer)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error('não deveria subir'))) as typeof fetch;
    try {
      const { falha } = await extractProductsViaAI(fakeFile(MAX_UPLOAD_MB + 100), 'FORNECEDOR X');
      expect(falha?.mensagem).toContain(String(MAX_UPLOAD_MB + 100));
      expect(falha?.mensagem).toContain(String(MAX_UPLOAD_MB));
      // Precisa dizer que o resultado saiu SEM IA — foi a informação que faltou
      // ao Josef e o fez reportar como problema de casamento de imagens.
      expect(falha?.mensagem).toMatch(/sem IA/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('o TUKA TOYS real (435,7MB) CABE no teto atual — antes era barrado em 300MB', () => {
    // O teto do proxy subiu de 300MB para 600MB justamente por causa deste
    // catálogo. Se alguém baixar MAX_UPLOAD_MB abaixo de 435,7 de novo, o TUKA
    // volta a tomar 413 e a cair no regex sem IA — este teste falha antes disso
    // chegar ao cliente. Precisa acompanhar o client_max_body_size do Nginx.
    expect(MAX_UPLOAD_MB).toBeGreaterThanOrEqual(436);
  });
});
