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
    
    // 3. Chamar backend Python
    console.log(`[ImageExtractionApi] Chamando backend: ${BACKEND_URL}/process`);
    
    const response = await fetch(`${BACKEND_URL}/process`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Backend retornou ${response.status}: ${errorText}`);
    }
    
    const initialResult = await response.json();
    console.log('[ImageExtractionApi] Backend respondeu:', initialResult);
    
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

    // Polling: Pergunta ao servidor a cada 5 segundos se terminou
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      try {
        const statusResponse = await fetch(`${BACKEND_URL}/status/${jobId}`);
        if (!statusResponse.ok) {
          console.warn(`[ImageExtractionApi] Erro na rede ao checar status (${statusResponse.status}). Tentando novamente...`);
          continue;
        }
        
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
          throw new Error('Servidor reiniciou ou perdeu o job (not_found).');
        }

        console.log(`[ImageExtractionApi] Job ${jobId} ainda em processamento...`);
      } catch (err) {
        if (err instanceof Error && err.message.includes('Backend falhou')) {
          throw err;
        }
        console.warn('[ImageExtractionApi] Falha no polling, ignorando e aguardando...', err);
      }
    }
    
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
