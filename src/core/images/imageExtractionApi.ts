import { ResultadoExtracaoImagens } from './imageTypes';
import { ProdutoNormalizadoV2 } from '../types/productPipeline';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

/**
 * Extrai imagens de PDF usando o backend Python (PyMuPDF)
 * Chama o backend na rota /process
 */
export const extractImagesViaBackend = async (
  file: File,
  produtos: ProdutoNormalizadoV2[],
  fornecedor: string
): Promise<ResultadoExtracaoImagens | null> => {
  try {
    console.log('[ImageExtractionApi] Iniciando extração via backend Python...');
    
    // 1. Gerar jobId único
    const jobId = crypto.randomUUID();
    
    // 2. Upload do PDF via FormData direto para o backend
    const formData = new FormData();
    formData.append('file', file);
    formData.append('jobId', jobId);
    formData.append('supplier', fornecedor);
    formData.append('totalProducts', String(produtos.length));
    
    // Adiciona lista de SKUs com coordenadas espaciais (para match correto no PDF)
    const allSkus = produtos.map(p => ({
      sku: p.codigoOriginal || p.codigo,
      name: p.nome || p.descricaoComplementar || p.codigoOriginal,
      page: p.paginaOrigem || 0,
      spatialContext: p.spatialContext || null  // {x, y, width, height, page}
    }));

    // Estratégia: envia TODOS os SKUs ao backend, mesmo sem spatialContext.
    // O backend tenta inferir posição quando spatialContext está ausente
    // (busca textual no PDF). Antes filtravamos e o resultado era ZERO matches
    // em catalogos onde o lookup de spatialContext falhava (NIX / FOLIA / DAGIA).
    const withCoords = allSkus.filter(s => s.spatialContext != null).length;
    console.log(`[ImageExtractionApi] ${withCoords}/${allSkus.length} SKUs com spatialContext valido (resto sera resolvido no backend)`);
    if (allSkus.length > 0) {
      console.log(`[ImageExtractionApi] Exemplo SKU[0]:`, allSkus[0]);
    }
    formData.append('skus', JSON.stringify(allSkus));

    // v21: Gemini Vision Picker para fornecedores com imagens densas/ambíguas.
    // Backend também auto-ativa pra DAGIA, mas mandamos explícito pra documentar
    // a decisão e permitir expandir pra outros fornecedores no futuro.
    const aiPickerSuppliers = ['DAGIA'];
    const useAiPicker = aiPickerSuppliers.includes((fornecedor || '').toUpperCase());
    formData.append('useAiPicker', useAiPicker ? 'true' : 'false');
    if (useAiPicker) {
      console.log(`[ImageExtractionApi] AI Picker ATIVADO para fornecedor=${fornecedor}`);
    }

    // 3. Chamar backend Python (com retry agressivo p/ ERR_HTTP2_PROTOCOL_ERROR)
    console.log(`[ImageExtractionApi] Chamando backend: ${BACKEND_URL}/process`);

    const MAX_ATTEMPTS = 5;
    let response: Response | null = null;
    let lastErr: any = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const ctrl = new AbortController();
        // 180s: PDFs ~13MB em conexão lenta podem levar 60-90s só pra upload
        const tid = setTimeout(() => ctrl.abort(), 180_000);

        response = await fetch(`${BACKEND_URL}/process`, {
          method: 'POST',
          body: formData,
          signal: ctrl.signal,
          headers: { 'Accept': 'application/json' },
        });
        clearTimeout(tid);

        if ([502, 503, 504].includes(response.status)) {
          if (attempt < MAX_ATTEMPTS) {
            const backoff = Math.min(3000 * Math.pow(2, attempt - 1), 30_000);
            console.warn(`[ImageExtractionApi] HTTP ${response.status} tentativa ${attempt}/${MAX_ATTEMPTS}, retry em ${backoff/1000}s...`);
            await new Promise(r => setTimeout(r, backoff));
            response = null;
            continue;
          }
        }
        break; // sucesso ou erro definitivo
      } catch (err: any) {
        lastErr = err;
        const msg = err.message || String(err);
        const isTransient =
          err.name === 'AbortError' ||
          err.name === 'TypeError' ||
          msg.includes('Failed to fetch') ||
          msg.includes('HTTP2_PROTOCOL_ERROR') ||
          msg.includes('HTTP/2') ||
          msg.includes('NetworkError') ||
          msg.includes('ECONNRESET');

        if (isTransient && attempt < MAX_ATTEMPTS) {
          const backoff = Math.min(3000 * Math.pow(2, attempt - 1), 30_000);
          const kind = msg.includes('HTTP2') ? 'HTTP/2 reset' : (err.name === 'AbortError' ? 'timeout' : 'rede');
          console.warn(
            `[ImageExtractionApi] Erro ${kind} tentativa ${attempt}/${MAX_ATTEMPTS}: ${msg.slice(0, 80)}. ` +
            `Retry em ${backoff/1000}s...`
          );
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
        throw err; // erro definitivo
      }
    }

    if (!response) {
      throw lastErr || new Error('Backend não respondeu após retentativas');
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Backend retornou ${response.status}: ${errorText}`);
    }

    const initialResult = await response.json();
    console.log(`[ImageExtractionApi] Backend respondeu (após tentativas):`, initialResult);
    
    if (initialResult.status === 'error') {
      throw new Error(`Erro no backend: ${initialResult.message}`);
    }

    // Se o backend retornar sucesso imediato (ex: PDF sem imagens)
    if (initialResult.status === 'success') {
      return {
        totalImagesFound: initialResult.matchesCount || 0,
        totalImagesMatched: initialResult.matchesCount || 0,
        totalImagesUnmatched: initialResult.unmatchedCount || 0,
        images: [],
        unmatchedImages: [],
        zipUrl: initialResult.zipUrl,
        warnings: [],
        errors: []
      };
    }

    console.log(`[ImageExtractionApi] Job ${jobId} iniciado em background. Iniciando polling...`);

    // Polling com TIMEOUT TOTAL e tolerância a falhas transitórias.
    // Antes era while(true) infinito + not_found ignorado → user via 20min sem progresso.
    const POLL_INTERVAL_MS = 5000;
    const MAX_WAIT_MS = 6 * 60 * 1000; // 6 minutos (NIX 51 pgs costuma levar 2-4min)
    const MAX_CONSECUTIVE_ERRORS = 6; // 6×5s = 30s tolerado de servidor down
    const MAX_NOT_FOUND_CHECKS = 3; // 3 confirmações de not_found = job perdido
    const t0 = Date.now();
    let consecutiveErrors = 0;
    let notFoundCount = 0;
    let lastLog = 0;

    while (Date.now() - t0 < MAX_WAIT_MS) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

      try {
        const statusResponse = await fetch(`${BACKEND_URL}/status/${jobId}`);
        if (!statusResponse.ok) {
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            throw new Error(`Backend retornou ${statusResponse.status} em ${consecutiveErrors} pollings consecutivos — provavelmente caiu`);
          }
          console.warn(`[ImageExtractionApi] Erro HTTP ${statusResponse.status} no polling (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}). Tentando novamente...`);
          continue;
        }
        consecutiveErrors = 0;

        const statusData = await statusResponse.json();

        if (statusData.status === 'success') {
          console.log(`[ImageExtractionApi] Extração concluída! ZIP: ${statusData.zipUrl}`);
          return {
            totalImagesFound: statusData.matchesCount || 0,
            totalImagesMatched: statusData.matchesCount || 0,
            totalImagesUnmatched: statusData.unmatchedCount || 0,
            images: [],
            unmatchedImages: [],
            unmatchedSkusDetails: statusData.unmatchedSkus || [],
            zipUrl: statusData.zipUrl,
            warnings: [],
            errors: []
          };
        }

        if (statusData.status === 'error') {
          throw new Error(`Backend falhou durante extração: ${statusData.message}`);
        }

        if (statusData.status === 'not_found') {
          notFoundCount++;
          if (notFoundCount >= MAX_NOT_FOUND_CHECKS) {
            // Servidor confirmou not_found N vezes → job realmente perdido (restart)
            throw new Error(
              `Servidor reiniciou e perdeu o job (not_found confirmado ${notFoundCount}x). ` +
              `Tente novamente.`
            );
          }
          console.warn(`[ImageExtractionApi] not_found ${notFoundCount}/${MAX_NOT_FOUND_CHECKS}, aguardando confirmação...`);
          continue;
        }

        // status === 'processing'
        const now = Date.now();
        if (now - lastLog > 30_000) {
          const elapsed = ((now - t0) / 1000).toFixed(0);
          console.log(`[ImageExtractionApi] [${elapsed}s] Job ${jobId} ainda em processamento...`);
          lastLog = now;
        }
      } catch (err: any) {
        // Erros do backend (success=false, not_found confirmado): re-raise
        if (err.message?.includes('Backend falhou') || err.message?.includes('Servidor reiniciou')) {
          throw err;
        }
        // Erros de rede transitórios: contar e continuar até MAX_CONSECUTIVE_ERRORS
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          throw new Error(`Backend não responde após ${consecutiveErrors} tentativas: ${err.message}`);
        }
        console.warn(`[ImageExtractionApi] Falha de rede no polling (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${err.message}`);
      }
    }

    throw new Error(`Timeout: extração de imagens não concluiu em ${MAX_WAIT_MS / 1000}s`);

  } catch (error: any) {
    console.error('[ImageExtractionApi] Erro:', error);
    return {
      totalImagesFound: 0,
      totalImagesMatched: 0,
      totalImagesUnmatched: 0,
      images: [],
      unmatchedImages: [],
      warnings: [],
      errors: [`Falha na extração: ${error.message}`]
    };
  }
};
