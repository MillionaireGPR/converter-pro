/**
 * v23 — Pipeline AI-FIRST: Gemini como extrator PRIMÁRIO de PDFs.
 *
 * MOTIVAÇÃO (decisão aprovada pelo user em 09/06/2026):
 *   Manter 14 parsers regex artesanais = manutenção infinita. Cada mudança
 *   de layout de catálogo quebrava a extração. Spike empírico com DAGIA real
 *   provou: Gemini extraiu 28/28 códigos (100%), 28/28 preços (100%),
 *   5/5 EM BREVE em 45s por ~R$0,25.
 *
 * ARQUITETURA:
 *   PDF → POST /extract_products_ai (Gemini lê o catálogo inteiro)
 *       → polling /extract_products_ai_status/{jobId}
 *       → map produtos JSON → ProdutoBruto[]
 *       → injeta no importPipeline (normalização/validação/dedup reusados)
 *
 *   Fornecedores têm "hints" (3 linhas de prompt no backend) em vez de
 *   parsers regex. Ver SUPPLIER_HINTS em gemini_extractor.py.
 *
 *   FALLBACK AUTOMÁTICO: se a IA falhar (timeout/erro/0 produtos), o
 *   engine cai no pipeline regex existente. Nada quebra.
 *
 * INVARIANTES RESPEITADOS:
 *   IV-07: retry agressivo com backoff exponencial no upload
 *   IV-08: polling com timeout total + MAX_NOT_FOUND + MAX_CONSECUTIVE_ERRORS
 */

import { ProdutoBruto } from '../types/productPipeline';
import { getBackendUrl, invalidateBackend } from '../backendResolver';

/** Produto cru retornado pelo Gemini (schema do EXTRACTION_PROMPT) */
export interface AiProduto {
  codigo: string;
  nome: string;
  preco: number | null;
  precoPromocional?: number | null;
  quantidadeCaixa?: number | null;
  ipi?: number | null;
  ncm?: string | null;
  categoria?: string | null;
  paginaOrigem?: number | null;
  observacoes?: string | null;
  emBreve?: boolean;
  promocional?: boolean;  // item já com desconto aplicado (tag/selo) → bloqueia desconto
}

export interface ResultadoAiExtraction {
  success: boolean;
  model: string;
  produtos: AiProduto[];
  fornecedor_detectado?: string;
  confianca?: number;
  elapsed?: number;
  error?: string | null;
}

/**
 * Catálogos gigantes não passam pela IA (limite de contexto + custo).
 * Goal Kids tem 1042 páginas — continua no pipeline regex/workaround.
 */
export const AI_FIRST_MAX_PAGES = 200;

/**
 * Teto de upload do proxy (`client_max_body_size` no Nginx da Integrator).
 * PRECISA acompanhar o valor real do servidor — ver
 * `infra/integrator/nginx/converter-pro.conf.example`.
 *
 * Existe aqui pra falhar CEDO e com mensagem clara: quando o arquivo passa do
 * teto, o Nginx corta a conexão no meio do upload e o `fetch` do navegador vê
 * isso como erro de rede genérico (`TypeError`), não como HTTP 413. O retry
 * então trata como falha transitória e repete o upload inteiro 5 vezes à toa.
 * Foi exatamente o que aconteceu com o TUKA TOYS (435,7MB) em 08/09/2026:
 * 5×413 no log do Nginx em 46s, IA nunca chamada, e o cliente recebeu 26
 * produtos do regex sem nenhum aviso de que algo tinha falhado.
 */
export const MAX_UPLOAD_MB = 600;

/**
 * Piso de banda de upload assumido pra dimensionar o timeout (KB/s).
 *
 * O teto FIXO de 180s derrubava catálogos grandes em links lentos: o Josef
 * (186.227.233.84) tentou o FORTAL (96,4MB) em 08/09/2026 e o log do Nginx
 * registrou 10 POSTs abortados, espaçados de 180s + o backoff exponencial
 * (183s, 186s, 192s, 204s) — assinatura exata do `AbortController` estourando
 * o prazo, não de erro do servidor. Cada rodada de 5 tentativas gastou ~16min
 * e terminou no regex. O mesmo arquivo, subido de um link rápido, levou 18,6s
 * pra subir e a IA devolveu 950 produtos em 47s.
 *
 * 300 KB/s (~2,4 Mbps) cobre um link de escritório ruim sem tornar o timeout
 * infinito; o teto de 20min mantém o prazo finito (IV-08).
 */
const UPLOAD_FLOOR_KBPS = 300;
const UPLOAD_TIMEOUT_MIN_MS = 180_000;  // IV-07 exige >= 120s por tentativa
const UPLOAD_TIMEOUT_MAX_MS = 20 * 60 * 1000;

/** Prazo do upload proporcional ao tamanho do arquivo. Ver `UPLOAD_FLOOR_KBPS`. */
export const uploadTimeoutMs = (fileSizeBytes: number): number => {
  const estimado = (fileSizeBytes / 1024 / UPLOAD_FLOOR_KBPS) * 1000;
  return Math.round(Math.min(Math.max(UPLOAD_TIMEOUT_MIN_MS, estimado), UPLOAD_TIMEOUT_MAX_MS));
};

/**
 * Por que a IA não foi usada nesta conversão.
 *
 * Existe porque o fallback pro regex é SILENCIOSO: o cliente recebe "Concluído"
 * com menos produtos e zero imagens casadas, sem nada dizendo que o motor
 * principal falhou. Em 08/09/2026 isso fez o Josef reportar "não extraiu as
 * imagens" sem que ninguém soubesse que a causa era upload/tamanho.
 */
export interface FalhaAiFirst {
  /** Rótulo curto, estável — serve pra telemetria/histórico. */
  motivo:
    | 'arquivo_grande_demais'
    | 'upload_nao_completou'
    | 'backend_indisponivel'
    | 'ia_sem_produtos'
    | 'timeout_processamento';
  /** Frase pronta pra mostrar ao cliente. */
  mensagem: string;
}

export interface RespostaAiFirst {
  /** Resultado da IA, ou null se ela não pôde ser usada. */
  resultado: ResultadoAiExtraction | null;
  /** Preenchido sempre que `resultado` é null. */
  falha?: FalhaAiFirst;
}

/**
 * Chama o backend /extract_products_ai (ASSÍNCRONO via polling).
 *
 * Com `resultado: null` o caller (engine) usa o pipeline regex como fallback —
 * e `falha` diz por quê, pra isso chegar ao cliente em vez de sumir no console.
 */
export const extractProductsViaAI = async (
  file: File,
  supplier: string,
  maxAttempts: number = 5,
  /** Regras em texto livre escritas pelo cliente na tela do fornecedor.
   *  O backend as compila em regras objetivas antes de usar no prompt. */
  supplierRules: string = ''
): Promise<RespostaAiFirst> => {
  const fileSizeMB = file.size / 1024 / 1024;
  console.log(`[AiFirst] Extração AI-first iniciada: ${file.name} (${fileSizeMB.toFixed(1)}MB, supplier=${supplier})`);

  // Falha CEDO em arquivo acima do teto do proxy: subir pra tomar 413 no meio
  // do caminho só queima banda e some a causa real (ver MAX_UPLOAD_MB).
  if (fileSizeMB > MAX_UPLOAD_MB) {
    const msg =
      `Catálogo de ${fileSizeMB.toFixed(0)}MB passa do limite de ${MAX_UPLOAD_MB}MB para leitura por IA. ` +
      `Foi usado o leitor antigo (sem IA e sem casamento de imagens). ` +
      `Peça ao fornecedor um PDF mais leve ou divida o catálogo.`;
    console.error(`[AiFirst] ${msg}`);
    return { resultado: null, falha: { motivo: 'arquivo_grande_demais', mensagem: msg } };
  }

  const jobId = `aifirst_${crypto.randomUUID()}`;

  // Resolve o backend UMA vez: o job só existe no servidor onde foi criado,
  // então o polling da FASE 2 precisa falar com esse mesmo servidor.
  const BACKEND_URL = await getBackendUrl();

  // ─── FASE 1: POST cria o job (retry agressivo IV-07) ───
  let jobCreated = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('supplier', supplier || '');
      fd.append('jobId', jobId);
      if (supplierRules) fd.append('supplierRules', supplierRules);

      const ctrl = new AbortController();
      // Prazo proporcional ao tamanho (IV-07 exige >= 120s) — ver uploadTimeoutMs.
      const tid = setTimeout(() => ctrl.abort(), uploadTimeoutMs(file.size));

      const response = await fetch(`${BACKEND_URL}/extract_products_ai`, {
        method: 'POST',
        body: fd,
        signal: ctrl.signal,
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(tid);

      if ([502, 503, 504].includes(response.status)) {
        if (attempt < maxAttempts) {
          const backoff = Math.min(3000 * Math.pow(2, attempt - 1), 30_000);
          console.warn(`[AiFirst] HTTP ${response.status} tentativa ${attempt}/${maxAttempts}, retry em ${backoff / 1000}s...`);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
        return {
          resultado: null,
          falha: {
            motivo: 'backend_indisponivel',
            mensagem: `Servidor de IA fora do ar (HTTP ${response.status}) após ${maxAttempts} tentativas. Foi usado o leitor antigo (sem IA e sem casamento de imagens).`,
          },
        };
      }
      if (!response.ok) {
        console.error(`[AiFirst] HTTP ${response.status} ao criar job AI`);
        const grande = response.status === 413;
        return {
          resultado: null,
          falha: {
            motivo: grande ? 'arquivo_grande_demais' : 'backend_indisponivel',
            mensagem: grande
              ? `Catálogo de ${fileSizeMB.toFixed(0)}MB foi recusado por exceder o limite de upload do servidor. Foi usado o leitor antigo (sem IA e sem casamento de imagens).`
              : `Servidor de IA respondeu HTTP ${response.status}. Foi usado o leitor antigo (sem IA e sem casamento de imagens).`,
          },
        };
      }

      const created = await response.json();
      if (created.status === 'error') {
        console.error('[AiFirst] Backend recusou job:', created.message);
        return {
          resultado: null,
          falha: {
            motivo: 'backend_indisponivel',
            mensagem: `Servidor de IA recusou o catálogo: ${created.message || 'motivo não informado'}. Foi usado o leitor antigo (sem IA e sem casamento de imagens).`,
          },
        };
      }
      jobCreated = true;
      console.log(`[AiFirst] ✓ Job criado: ${jobId} (tentativa ${attempt}). Polling...`);
      break;
    } catch (err: any) {
      const msg = err.message || String(err);
      const isTransient =
        err.name === 'AbortError' ||
        err.name === 'TypeError' ||
        msg.includes('Failed to fetch') ||
        msg.includes('HTTP2_PROTOCOL_ERROR') ||
        msg.includes('HTTP/2') ||
        msg.includes('NetworkError') ||
        msg.includes('ECONNRESET') ||
        msg.includes('socket hang up') ||
        msg.includes('ERR_CONNECTION');
      if (isTransient && attempt < maxAttempts) {
        const backoff = Math.min(3000 * Math.pow(2, attempt - 1), 30_000);
        console.warn(`[AiFirst] Erro transitório tentativa ${attempt}/${maxAttempts}: ${msg.slice(0, 80)}. Retry em ${backoff / 1000}s...`);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      console.error(`[AiFirst] Erro definitivo após ${attempt} tentativa(s):`, err);
      // Backend pode ter caído no meio da sessão — descarta a memoização
      // pra próxima operação refazer o health check e cair na reserva.
      invalidateBackend();
      // AbortError = o prazo do upload estourou (link lento / catálogo pesado),
      // não é servidor fora do ar. Distinguir importa: a ação do cliente é
      // outra (rede/tamanho do arquivo, não "esperar o servidor voltar").
      const abortou = err?.name === 'AbortError';
      const prazoMin = Math.round(uploadTimeoutMs(file.size) / 60000);
      return {
        resultado: null,
        falha: abortou
          ? {
              motivo: 'upload_nao_completou',
              mensagem:
                `O envio do catálogo (${fileSizeMB.toFixed(0)}MB) não completou em ${prazoMin}min por ${maxAttempts} tentativas — conexão de upload lenta. ` +
                `Foi usado o leitor antigo (sem IA e sem casamento de imagens).`,
            }
          : {
              motivo: 'backend_indisponivel',
              mensagem:
                `Não foi possível falar com o servidor de IA após ${maxAttempts} tentativas. ` +
                `Foi usado o leitor antigo (sem IA e sem casamento de imagens).`,
            },
      };
    }
  }
  if (!jobCreated) {
    return {
      resultado: null,
      falha: {
        motivo: 'backend_indisponivel',
        mensagem: `Não foi possível criar o processamento por IA. Foi usado o leitor antigo (sem IA e sem casamento de imagens).`,
      },
    };
  }

  // ─── FASE 2: Polling até status terminal (IV-08) ───
  // Catálogos grandes (ex: FORTAL 96 págs) usam extração texto-chunked em
  // paralelo (~6-10min). Teto 18min com folga; ainda finito (IV-08).
  const POLL_INTERVAL_MS = 4000;
  const MAX_WAIT_MS = 18 * 60 * 1000;
  const MAX_CONSECUTIVE_ERRORS = 10;
  const MAX_NOT_FOUND_CHECKS = 3;
  const t0 = Date.now();
  let consecutiveErrors = 0;
  let notFoundCount = 0;
  let lastLog = 0;

  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const statusResp = await fetch(`${BACKEND_URL}/extract_products_ai_status/${jobId}`);
      if (!statusResp.ok) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.error(`[AiFirst] Backend HTTP ${statusResp.status} em ${consecutiveErrors} pollings — abortando`);
          return {
            resultado: null,
            falha: {
              motivo: 'backend_indisponivel',
              mensagem: `O servidor parou de responder durante a leitura por IA (HTTP ${statusResp.status}). Foi usado o leitor antigo (sem IA e sem casamento de imagens).`,
            },
          };
        }
        continue;
      }
      consecutiveErrors = 0;

      const data = await statusResp.json();

      if (data.status === 'not_found') {
        notFoundCount++;
        if (notFoundCount >= MAX_NOT_FOUND_CHECKS) {
          console.error(`[AiFirst] Job perdido (not_found ${notFoundCount}x) — backend reiniciou`);
          return {
            resultado: null,
            falha: {
              motivo: 'backend_indisponivel',
              mensagem: `O servidor reiniciou no meio da leitura por IA e o processamento se perdeu. Foi usado o leitor antigo (sem IA e sem casamento de imagens).`,
            },
          };
        }
        continue;
      }

      const now = Date.now();
      if (now - lastLog > 15_000) {
        console.log(`[AiFirst] [${((now - t0) / 1000).toFixed(0)}s] status=${data.status} stage=${data.stage || '?'}`);
        lastLog = now;
      }

      if (data.status === 'success' || data.status === 'error') {
        const result: ResultadoAiExtraction = data.ai_result || data;
        if (result.success && Array.isArray(result.produtos)) {
          console.log(
            `[AiFirst] ✓ ${result.produtos.length} produtos extraídos pela IA ` +
            `em ${result.elapsed?.toFixed(1) || '?'}s (${result.model}, confiança ${((result.confianca || 0) * 100).toFixed(0)}%)`
          );
          return { resultado: result };
        }
        console.warn('[AiFirst] IA retornou sem sucesso:', result.error);
        return {
          resultado: null,
          falha: {
            motivo: 'ia_sem_produtos',
            mensagem:
              `A IA não conseguiu ler este catálogo${result.error ? ` (${result.error})` : ''}. ` +
              `Foi usado o leitor antigo (sem IA e sem casamento de imagens).`,
          },
        };
      }
      // processing → continua
    } catch (err: any) {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`[AiFirst] Backend não responde após ${consecutiveErrors} pollings: ${err.message}`);
        return {
          resultado: null,
          falha: {
            motivo: 'backend_indisponivel',
            mensagem: `O servidor parou de responder durante a leitura por IA. Foi usado o leitor antigo (sem IA e sem casamento de imagens).`,
          },
        };
      }
    }
  }

  console.error(`[AiFirst] Timeout total (${MAX_WAIT_MS / 60000}min) no polling`);
  return {
    resultado: null,
    falha: {
      motivo: 'timeout_processamento',
      mensagem:
        `A leitura por IA passou de ${MAX_WAIT_MS / 60000}min e foi interrompida. ` +
        `Foi usado o leitor antigo (sem IA e sem casamento de imagens).`,
    },
  };
};

/**
 * Converte produtos do Gemini → ProdutoBruto[] aceitos pelo importPipeline.
 *
 * As chaves de `campos` usam os nomes canônicos + aliases mais comuns dos
 * adapters ('codigo', 'descricao', 'preco', 'cx', 'ipi', 'ncm') para que
 * o extractor de QUALQUER fornecedor resolva os campos sem mapeamento extra.
 *
 * EM BREVE: seta __emBreve (o extractor propaga para visualCategory
 * 'em-breve' — produto validado sem preço + ***EM BREVE*** no título).
 */
export const mapAiProductsToBrutos = (produtos: AiProduto[]): ProdutoBruto[] => {
  const brutos: ProdutoBruto[] = [];
  for (let i = 0; i < produtos.length; i++) {
    const p = produtos[i];
    const codigo = String(p.codigo || '').trim();
    if (!codigo) continue; // sem código não há produto

    const campos: Record<string, any> = {
      codigo,
      descricao: String(p.nome || '').trim(),
      // Campos vêm prontos da IA — bloqueia heurísticas do extractor
      // (ex: "menor numérico = preço" pegaria IPI/CX como preço em
      // produtos legitimamente sem preço).
      __postProcessed: true,
    };

    // Preço: null/0 + emBreve → sem preço (EM BREVE); senão número
    const preco = p.preco;
    if (preco !== null && preco !== undefined && Number(preco) > 0) {
      campos['preco'] = String(preco);
    }
    if (p.precoPromocional !== null && p.precoPromocional !== undefined && Number(p.precoPromocional) > 0) {
      campos['precopromocional'] = String(p.precoPromocional);
      campos['promo'] = String(p.precoPromocional);
    }

    const qcx = Number(p.quantidadeCaixa || 0);
    if (qcx > 0) {
      // Duas chaves: canônica + alias universal 'cx' (adapters variam)
      campos['quantidadecaixa'] = String(qcx);
      campos['cx'] = String(qcx);
    }

    const ipi = Number(p.ipi || 0);
    if (ipi > 0) campos['ipi'] = String(ipi);
    if (p.ncm) campos['ncm'] = String(p.ncm);
    if (p.categoria) campos['categoria'] = String(p.categoria);
    if (p.observacoes) campos['observacoes'] = String(p.observacoes);

    if (p.emBreve === true) {
      campos['__emBreve'] = true;
      campos['informacoesAdicionais'] = 'EM BREVE';
      // Não deletar preco: EM BREVE pode ter preço visível (ex: DV003 R$37,37).
      // Se Gemini retornou preco=null, o campo já não foi setado na linha acima.
    }

    // PROMOÇÃO: item que já vem com desconto aplicado → bloqueia desconto em massa
    // (extractor vira visualCategory='promocional' + ***PROMOCAO*** + bloqueiaDesconto).
    if (p.promocional === true) {
      campos['__promo'] = true;
    }

    brutos.push({
      campos,
      linhaOrigem: i,
      paginaOrigem: Number(p.paginaOrigem || 0) || 1,
      textoBruto: `${codigo} ${p.nome || ''} [ai-first]`,
    });
  }
  return brutos;
};
