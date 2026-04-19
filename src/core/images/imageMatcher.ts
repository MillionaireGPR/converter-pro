import { ImagemExtraida, ImagemAssociadaProduto, ResultadoExtracaoImagens } from './imageTypes';
import { ProdutoNormalizadoV2 } from '../types/productPipeline';

// Constantes de configuração
const MIN_CONFIDENCE_THRESHOLD = 0.65; // Mínimo para aceitar match
const CONFIDENCE_EXCEL_EXACT = 0.95;   // Match exato por linha Excel
const CONFIDENCE_EXCEL_FUZZY = 0.85;   // Match aproximado por linha Excel  
const CONFIDENCE_PDF_SPATIAL = 0.90;   // Match por proximidade X,Y no PDF
const CONFIDENCE_PDF_SEQUENCE = 0.70;  // Match sequencial (fallback)
const CONFIDENCE_NAME_MATCH = 1.0;     // O arquivo já tem o SKU no nome

type MatchType = 'excel-exact' | 'excel-fuzzy' | 'pdf-spatial' | 'pdf-sequence' | 'name-match' | 'rejected';

interface MatchCandidate {
  image: ImagemExtraida;
  product: ProdutoNormalizadoV2;
  score: number;
  matchType: MatchType;
  reason?: string;
}

const calculateMatchScore = (img: ImagemExtraida, prod: ProdutoNormalizadoV2): { score: number; type: MatchType; reason?: string } => {
  const finalCode = (prod.codigo || prod.codigoOriginal || '').toLowerCase().trim();
  const normalizedFileName = (img.originalName || '').toLowerCase().trim();
  
  // 1. Match por Nome (100%)
  if (finalCode && normalizedFileName && (normalizedFileName.includes(finalCode) || finalCode.includes(normalizedFileName))) {
    return { score: CONFIDENCE_NAME_MATCH, type: 'name-match', reason: 'SKU encontrado no nome do arquivo' };
  }

  // 2. Match Excel por Linha
  if (img.sourceType === 'excel' && typeof img.sourceIndex === 'number') {
    if (prod.linhaOrigem === img.sourceIndex) {
      return { score: CONFIDENCE_EXCEL_EXACT, type: 'excel-exact', reason: 'Linha exata' };
    }
    if (Math.abs(prod.linhaOrigem - img.sourceIndex) <= 1) {
      return { score: CONFIDENCE_EXCEL_FUZZY, type: 'excel-fuzzy', reason: 'Linha próxima (+/-1)' };
    }
  }

  // 3. Match PDF Espacial (NOVO)
  if (img.sourceType === 'pdf' && img.spatialContext && prod.spatialContext) {
    if (img.spatialContext.page === prod.spatialContext.page) {
      const iCtx = img.spatialContext;
      const pCtx = prod.spatialContext;
      
      // Centro da imagem e do texto do SKU
      const iCenterX = iCtx.x + iCtx.width / 2;
      const iCenterY = iCtx.y + iCtx.height / 2;
      const pCenterX = pCtx.x + pCtx.width / 2;
      const pCenterY = pCtx.y + pCtx.height / 2;
      
      const dist = Math.sqrt(Math.pow(iCenterX - pCenterX, 2) + Math.pow(iCenterY - pCenterY, 2));
      
      // Heurística de proximidade (ex: SKU costuma estar abaixo ou ao lado)
      if (dist < 150) {
        return { score: CONFIDENCE_PDF_SPATIAL, type: 'pdf-spatial', reason: `Proximidade física (dist: ${Math.round(dist)})` };
      }
      if (dist < 300) {
        return { score: CONFIDENCE_PDF_SPATIAL - 0.15, type: 'pdf-spatial', reason: `Localização próxima (dist: ${Math.round(dist)})` };
      }
    }
  }

  // 4. Fallback: Match PDF por Página (Sequencial)
  if (img.sourceType === 'pdf' && img.sourcePage && prod.paginaOrigem) {
    if (img.sourcePage === prod.paginaOrigem) {
      return { score: CONFIDENCE_PDF_SEQUENCE, type: 'pdf-sequence', reason: `Mesma página ${img.sourcePage} (sequencial)` };
    }
  }

  return { score: 0, type: 'rejected', reason: 'Sem correspondência física ou lógica' };
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
        imageDataUrl: bestMatch.image.imageDataUrl,
      });
      usedImages.add(img.temporaryId);
      usedProducts.add(prod.codigo || prod.codigoOriginal);
      console.log(`[ImageMatch] ✅ MATCHED: sku=${prod.codigo} img=${img.temporaryId} score=${bestMatch.score.toFixed(2)} type=${bestMatch.matchType} reason="${bestMatch.reason}" linhaProduto=${prod.linhaOrigem} sourceIndex=${img.sourceIndex}`);
    } else {
      console.log(`[ImageMatch] ❌ REJECTED: img=${img.temporaryId} sourceIndex=${img.sourceIndex} score=${bestMatch?.score.toFixed(2) || 0} bestMatchCodigo=${bestMatch?.product?.codigo || 'none'}`);
    }
  }

  // Fase 2: Match PDF (Espacial + Sequencial)
  console.log(`[ImageMatcher] Fase 2: Match PDF (Espacial + Sequência)`);
  const pdfImages = images.filter(img => img.sourceType === 'pdf' && !usedImages.has(img.temporaryId));
  console.log(`[ImageMatcher DEBUG] ${pdfImages.length} imagens PDF para match`);

  for (const img of pdfImages) {
    let bestMatch: MatchCandidate | null = null;
    
    // Filtrar produtos da MESMA página para otimização
    const candidateProducts = produtos.filter(p => 
      !usedProducts.has(p.codigo || p.codigoOriginal) && 
      p.paginaOrigem === img.sourcePage
    );

    for (const prod of candidateProducts) {
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
        imageDataUrl: bestMatch.image.imageDataUrl,
      });
      usedImages.add(img.temporaryId);
      usedProducts.add(prod.codigo || prod.codigoOriginal);
      console.log(`[ImageMatch] ✅ PDF MATCH: sku=${prod.codigo} img=${img.temporaryId} score=${bestMatch.score.toFixed(2)} type=${bestMatch.matchType} reason="${bestMatch.reason}" pag=${prod.paginaOrigem} dist=${bestMatch.matchType === 'pdf-spatial' ? 'calculada' : 'n/a'}`);
    } else {
      console.log(`[ImageMatch] ❌ PDF REJECT: img=${img.temporaryId} pagina=${img.sourcePage} score=${bestMatch?.score.toFixed(2) || 0} bestReason="${bestMatch?.reason || 'Sem candidatos'}"`);
    }
  }

  // Fase 3: Não associadas (Sequencial cego para o que sobrou)
  // IMPORTANTE: Para Excel, só tentamos match cego se a imagem tiver uma linha de origem.
  // Isso evita que logotipos e ícones flutuantes virem fotos de produtos.
  const remainingImages = images.filter(img => 
    !usedImages.has(img.temporaryId) && 
    (img.sourceType !== 'excel' || typeof img.sourceIndex === 'number')
  );

  remainingImages.forEach(img => {
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
