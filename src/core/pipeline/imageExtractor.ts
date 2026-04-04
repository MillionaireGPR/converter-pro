export interface ImageExtractionResult {
  codigoProduto: string;
  imageDataUrl?: string;    // base64 ou URL
  imageName: string;        // nomeado pelo código
  source: 'pdf' | 'url' | 'manual';
  confidence: number;
}

/**
 * Placeholder para futura implementação de extração de imagens do PDF.
 * Por conta das limitações de extractores no frontend/browser com pdfjs,
 * a extração real será implementada em fases futuras ou usando um backend.
 */
export const extractImagesFromPDF = async (
  fileData: ArrayBuffer
): Promise<ImageExtractionResult[]> => {
  console.warn('[ImageExtractor] Extração de imagens de PDF ainda não implementada.');
  return [];
};
