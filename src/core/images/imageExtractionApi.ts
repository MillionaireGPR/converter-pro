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

    // Backend só consegue mapear SKUs com spatialContext válido — filtra antes
    // de enviar para evitar processar páginas sem produtos mapeados.
    const skus = allSkus.filter(s => s.spatialContext != null);
    const skipped = allSkus.length - skus.length;

    console.log(`[ImageExtractionApi] ${skus.length}/${allSkus.length} SKUs com spatialContext valido`);
    if (skipped > 0) {
      console.warn(`[ImageExtractionApi] ${skipped} SKUs sem spatialContext serao ignorados pelo backend`);
    }
    if (skus.length > 0) {
      console.log(`[ImageExtractionApi] Exemplo SKU[0]:`, skus[0]);
    }
    formData.append('skus', JSON.stringify(skus));
    
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
    
    const result = await response.json();
    console.log('[ImageExtractionApi] Backend respondeu:', result);
    
    if (result.status === 'success') {
      return {
        totalImagesFound: result.matchesCount || 0,
        totalImagesMatched: result.matchesCount || 0,
        totalImagesUnmatched: 0,
        images: [], // Backend retorna ZIP, não imagens individuais
        unmatchedImages: [],
        zipUrl: result.zipUrl,
        warnings: [],
        errors: []
      };
    }
    
    return null;
    
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
