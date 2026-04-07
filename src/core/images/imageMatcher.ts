import { ImagemExtraida, ImagemAssociadaProduto, ResultadoExtracaoImagens } from './imageTypes';
import { ProdutoNormalizadoV2 } from '../types/productPipeline';

// Constantes de configuração
const MIN_CONFIDENCE_THRESHOLD = 0.70; // Mínimo 70% de confiança para aceitar match
const CONFIDENCE_EXCEL_EXACT = 0.95;   // Match exato por linha Excel
const CONFIDENCE_EXCEL_FUZZY = 0.85;   // Match aproximado por linha Excel  
const CONFIDENCE_PDF_SEQUENCE = 0.60;  // Match sequencial PDF (descontado)

type MatchType = 'excel-exact' | 'excel-fuzzy' | 'pdf-sequence' | 'rejected';

interface MatchCandidate {
  image: ImagemExtraida;
  product: ProdutoNormalizadoV2;
  score: number;
  matchType: MatchType;
  reason?: string;
}

const calculateMatchScore = (img: ImagemExtraida, prod: ProdutoNormalizadoV2): { score: number; type: MatchType; reason?: string } => {
  if (img.sourceType === 'excel' && typeof img.sourceIndex === 'number') {
    if (prod.linhaOrigem === img.sourceIndex) {
      return { score: CONFIDENCE_EXCEL_EXACT, type: 'excel-exact', reason: 'Linha exata' };
    }
    if (Math.abs(prod.linhaOrigem - img.sourceIndex) <= 1) {
      return { score: CONFIDENCE_EXCEL_FUZZY, type: 'excel-fuzzy', reason: 'Linha próxima (+/-1)' };
    }
  }
  if (img.sourceType === 'pdf' && img.sourcePage && prod.paginaOrigem) {
    if (img.sourcePage === prod.paginaOrigem) {
      return { score: CONFIDENCE_PDF_SEQUENCE, type: 'pdf-sequence', reason: `Mesma página ${img.sourcePage}` };
    }
  }
  return { score: 0, type: 'rejected', reason: 'Sem correspondência de linha/página' };
};

const generateFileName = (sku: string, ext: string, counter: Record<string, number>) => {
  let baseSku = (sku || 'SEM_SKU').replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
  if (!counter[baseSku]) {
    counter[baseSku] = 1;
    return `${baseSku}.${ext}`;
  } else {
    counter[baseSku]++;
    return `${baseSku}_${counter[baseSku]}.${ext}`;
  }
};

export const matchImagesToProducts = (images: ImagemExtraida[], produtos: ProdutoNormalizadoV2[]): ResultadoExtracaoImagens => {
  const startTime = Date.now();
  console.log(`[ImageMatcher] Iniciando match de ${images.length} imagens para ${produtos.length} produtos`);
  
  // Log detalhado das imagens recebidas
  console.log(`[ImageMatcher DEBUG] Imagens recebidas:`);
  images.forEach((img, i) => {
    console.log(`[ImageMatcher DEBUG]   [${i}] tempId=${img.temporaryId}, sourceType=${img.sourceType}, sourceIndex=${img.sourceIndex}, sourcePage=${img.sourcePage}`);
  });
  
  // Log detalhado dos produtos recebidos
  console.log(`[ImageMatcher DEBUG] Produtos recebidos (primeiros 10):`);
  produtos.slice(0, 10).forEach((prod, i) => {
    console.log(`[ImageMatcher DEBUG]   [${i}] codigo=${prod.codigo}, linhaOrigem=${prod.linhaOrigem}, paginaOrigem=${prod.paginaOrigem}, nome="${prod.nome?.substring(0, 30)}..."`);
  });

  const matched: ImagemAssociadaProduto[] = [];
  const unmatched: ImagemExtraida[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  const usedImages = new Set<string>();
  const usedProducts = new Set<string>();
  const skuCounter: Record<string, number> = {};

  // Fase 1: Match Excel
  console.log(`[ImageMatcher] Fase 1: Match Excel por linha`);
  const excelImages = images.filter(img => img.sourceType === 'excel' && typeof img.sourceIndex === 'number' && !usedImages.has(img.temporaryId));
  console.log(`[ImageMatcher DEBUG] ${excelImages.length} imagens Excel para match`);

  for (const img of excelImages) {
    let bestMatch: MatchCandidate | null = null;
    for (const prod of produtos) {
      if (usedProducts.has(prod.codigo || prod.codigoOriginal)) continue;
      const result = calculateMatchScore(img, prod);
      if (result.score > (bestMatch?.score || 0)) {
        bestMatch = { image: img, product: prod, score: result.score, matchType: result.type, reason: result.reason };
      }
    }

    if (bestMatch && bestMatch.score >= MIN_CONFIDENCE_THRESHOLD) {
      const prod = bestMatch.product;
      const ext = bestMatch.image.originalName.split('.').pop() || 'jpg';
      matched.push({
        sku: prod.codigo || prod.codigoOriginal,
        productName: prod.nome,
        supplier: prod.fornecedor,
        imageFileNameFinal: generateFileName(prod.codigo || prod.codigoOriginal, ext, skuCounter),
        sourcePage: bestMatch.image.sourcePage,
        confidence: bestMatch.score,
        imageBlob: bestMatch.image.imageBlob,
      });
      usedImages.add(img.temporaryId);
      usedProducts.add(prod.codigo || prod.codigoOriginal);
      console.log(`[ImageMatch] ✅ MATCHED: sku=${prod.codigo} img=${img.temporaryId} score=${bestMatch.score.toFixed(2)} type=${bestMatch.matchType} reason="${bestMatch.reason}" linhaProduto=${prod.linhaOrigem} sourceIndex=${img.sourceIndex}`);
    } else {
      console.log(`[ImageMatch] ❌ REJECTED: img=${img.temporaryId} sourceIndex=${img.sourceIndex} score=${bestMatch?.score.toFixed(2) || 0} bestMatchCodigo=${bestMatch?.product?.codigo || 'none'}`);
    }
  }

  // Fase 2: Match PDF
  console.log(`[ImageMatcher] Fase 2: Match PDF por página/sequência`);
  const pdfImages = images.filter(img => img.sourceType === 'pdf' && !usedImages.has(img.temporaryId));

  if (pdfImages.length > 0) {
    const imagesByPage: Record<number, ImagemExtraida[]> = {};
    const productsByPage: Record<number, ProdutoNormalizadoV2[]> = {};

    pdfImages.forEach(img => {
      const page = img.sourcePage || 1;
      if (!imagesByPage[page]) imagesByPage[page] = [];
      imagesByPage[page].push(img);
    });

    produtos.forEach(prod => {
      if (usedProducts.has(prod.codigo || prod.codigoOriginal)) return;
      const page = prod.paginaOrigem || 1;
      if (!productsByPage[page]) productsByPage[page] = [];
      productsByPage[page].push(prod);
    });

    Object.keys(imagesByPage).forEach(pageStr => {
      const page = parseInt(pageStr);
      const imgsOnPage = imagesByPage[page];
      const prodsOnPage = productsByPage[page] || [];
      console.log(`[ImageMatcher] Página ${page}: ${imgsOnPage.length} imgs, ${prodsOnPage.length} prods`);

      for (let i = 0; i < imgsOnPage.length; i++) {
        const img = imgsOnPage[i];
        if (i >= prodsOnPage.length) {
          console.log(`[ImageMatch] img=${img.temporaryId} REJECTED=excess_images (página ${page})`);
          continue;
        }
        const prod = prodsOnPage[i];
        if (usedProducts.has(prod.codigo || prod.codigoOriginal)) {
          console.log(`[ImageMatch] img=${img.temporaryId} REJECTED=product_already_matched`);
          continue;
        }
        const ext = img.originalName.split('.').pop() || 'jpg';
        const score = CONFIDENCE_PDF_SEQUENCE - (i * 0.02);
        if (score >= MIN_CONFIDENCE_THRESHOLD) {
          matched.push({
            sku: prod.codigo || prod.codigoOriginal,
            productName: prod.nome,
            supplier: prod.fornecedor,
            imageFileNameFinal: generateFileName(prod.codigo || prod.codigoOriginal, ext, skuCounter),
            sourcePage: img.sourcePage,
            confidence: Math.max(0.50, score),
            imageBlob: img.imageBlob,
          });
          usedImages.add(img.temporaryId);
          usedProducts.add(prod.codigo || prod.codigoOriginal);
          console.log(`[ImageMatch] sku=${prod.codigo} img=${img.temporaryId} score=${score.toFixed(2)} type=pdf-sequence page=${page} index=${i}`);
        } else {
          console.log(`[ImageMatch] img=${img.temporaryId} score=${score.toFixed(2)} REJECTED=low_confidence`);
        }
      }
    });
  }

  // Fase 3: Não associadas
  images.forEach(img => {
    if (!usedImages.has(img.temporaryId)) {
      unmatched.push(img);
      console.log(`[ImageMatch] img=${img.temporaryId} UNMATCHED`);
    }
  });

  const duration = Date.now() - startTime;
  console.log(`[ImageMatcher] Concluído em ${duration}ms: ${matched.length} matched, ${unmatched.length} unmatched`);

  const productsWithoutImages = produtos.filter(p => !usedProducts.has(p.codigo || p.codigoOriginal));
  if (productsWithoutImages.length > 0) {
    console.log(`[ImageMatcher] ${productsWithoutImages.length} produtos sem imagem`);
    productsWithoutImages.slice(0, 5).forEach(p => console.log(`[ImageMatcher] Sem imagem: sku=${p.codigo} nome="${p.nome}"`));
  }

  return {
    totalImagesFound: images.length,
    totalImagesMatched: matched.length,
    totalImagesUnmatched: unmatched.length,
    images: matched,
    unmatchedImages: unmatched,
    warnings,
    errors
  };
};
