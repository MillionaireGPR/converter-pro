import { ImagemExtraida, ResultadoExtracaoImagens } from './imageTypes';
import { extractImagesFromPdf } from './imageExtractorPdf';
import { extractImagesFromExcel } from './imageExtractorExcel';
import { matchImagesToProducts } from './imageMatcher';
import { ProdutoNormalizadoV2 } from '../types/productPipeline';

/**
 * Ponto de entrada do pipeline de processamento paralelo de imagens.
 * Orquestra a leitura primária (PDF x Excel), valida a integridade visual,
 * e despacha para o vinculador Heurístico (Matcher) acoplar os SKUs extraídos.
 */
export const runImageExtraction = async (
  file: File,
  produtos: ProdutoNormalizadoV2[]
): Promise<ResultadoExtracaoImagens | null> => {
  const extension = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase();
  
  if (!['pdf', 'xlsx', 'xls'].includes(extension)) {
    console.warn(`[ImageExtractionPipeline] Tipo de arquivo "${extension}" não suportado ou vazio.`);
    return null;
  }

  try {
    console.log(`[ImageExtractionPipeline] Iniciando varredura binária em ${file.name}`);
    const fileData = await file.arrayBuffer();
    
    let extractedImages: ImagemExtraida[] = [];
    
    if (extension === 'pdf') {
       extractedImages = await extractImagesFromPdf(fileData, file.name.replace('.pdf', ''));
    } else {
       // XLSX ou XLS suportam extração estruturada de XL/Media
       extractedImages = await extractImagesFromExcel(fileData, file.name.replace(`.${extension}`, ''));
    }

    if (extractedImages.length === 0) {
      console.log(`[ImageExtractionPipeline] Varredura não encontrou nenhuma mídia no arquivo.`);
      return {
          totalImagesFound: 0,
          totalImagesMatched: 0,
          totalImagesUnmatched: 0,
          images: [],
          unmatchedImages: [],
          warnings: ["Nenhuma imagem detectada no arquivo gốc original."],
          errors: []
      };
    }

    // Passar pro motor de colisão / linking com os Produtos já decodificados
    console.log(`[ImageExtractionPipeline] ${extractedImages.length} mídias achadas. Direcionando ao Matcher Engine...`);
    const resultMatch = matchImagesToProducts(extractedImages, produtos);
    
    console.log(`[ImageExtractionPipeline] Resultado de Match: ${resultMatch.totalImagesMatched} associadas, ${resultMatch.totalImagesUnmatched} sem ref.`);
    return resultMatch;
    
  } catch(e: any) {
    console.error(`[ImageExtractionPipeline] Fatal Error:`, e);
    return {
        totalImagesFound: 0,
        totalImagesMatched: 0,
        totalImagesUnmatched: 0,
        images: [],
        unmatchedImages: [],
        warnings: [],
        errors: [`A engine travou ao tentar baixar e decodificar o documento: ${e.message}`]
    };
  }
};
