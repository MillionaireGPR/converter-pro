import { ImagemExtraida } from './imageTypes';

let pdfjsLib: any = null;

const loadPdfJs = async (): Promise<any> => {
  if (pdfjsLib) return pdfjsLib;
  try {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    pdfjsLib = pdfjs;
    return pdfjs;
  } catch (err) {
    console.error('[ImageExtractorPdf] Falha ao carregar pdfjs-dist:', err);
    throw err;
  }
};

export const extractImagesFromPdf = async (
  fileData: ArrayBuffer,
  fileName: string
): Promise<ImagemExtraida[]> => {
  const images: ImagemExtraida[] = [];
  const startTime = Date.now();
  const TIMEOUT_MS = 120000; // 120 segundos timeout total
  
  try {
    console.log(`[ImageExtractorPdf] Iniciando extração de imagens do PDF: ${fileName}`);
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fileData) }).promise;
    
    console.log(`[ImageExtractorPdf] PDF carregado: ${doc.numPages} páginas`);
    
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      // Verificar timeout global
      if (Date.now() - startTime > TIMEOUT_MS) {
        console.warn(`[ImageExtractorPdf] Timeout global atingido após ${TIMEOUT_MS}ms`);
        break;
      }
      
      try {
        console.log(`[ImageExtractorPdf] Processando página ${pageNum}/${doc.numPages}`);
        const page = await doc.getPage(pageNum);
        const ops = await page.getOperatorList();
        
        let pageImageCount = 0;
        
        for (let j = 0; j < ops.fnArray.length; j++) {
          // Verificar timeout a cada 100 operações
          if (j % 100 === 0 && Date.now() - startTime > TIMEOUT_MS) {
            console.warn(`[ImageExtractorPdf] Timeout durante processamento de operações`);
            break;
          }
          
          if (ops.fnArray[j] === pdfjs.OPS.paintImageXObject) {
            const objId = ops.argsArray[j][0];
            
            // NOVO: Timeout por imagem individual (3 segundos)
            const imgData = await Promise.race([
              new Promise<any>((resolve) => {
                try {
                  page.objs.get(objId, (img: any) => resolve(img));
                } catch(e) {
                  resolve(null);
                }
              }),
              new Promise((resolve) => 
                setTimeout(() => {
                  console.warn(`[ImageExtractorPdf] Timeout ao carregar imagem ${objId} na página ${pageNum}`);
                  resolve(null);
                }, 3000)
              )
            ]);
            
            if (imgData && imgData.width && imgData.height) {
              // Heurística: Descartar ícones e logos pequenos (ex: < 150px) pra não sujar o catálogo
              if (imgData.width < 150 || imgData.height < 150) continue;
              // Descartar imagens muito compridas ou muito altas (geralmente banners laterais)
              const ratio = imgData.width / imgData.height;
              if (ratio > 4 || ratio < 0.25) continue;
              
              const imgId = `${fileName}_p${pageNum}_i${images.length + 1}`;
              
              const canvas = document.createElement('canvas');
              canvas.width = imgData.width;
              canvas.height = imgData.height;
              const ctx = canvas.getContext('2d');
              
              if (ctx) {
                let blob: Blob | null = null;
                try {
                  // Existem duas formas principais de Imagem do pdf.js:
                  // 1. O retorno direto de uint8ClampedArray no .data (pixels crus em RGBA)
                  if (imgData.data && imgData.data.length > 0 && imgData.data.length === imgData.width * imgData.height * 4) {
                    const imageData = new ImageData(
                      new Uint8ClampedArray(imgData.data), 
                      imgData.width, 
                      imgData.height
                    );
                    ctx.putImageData(imageData, 0, 0);
                    blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.92));
                  } 
                  // 2. O PDF.js devolvendo um canvas ou ImageBitmap na propriedade bitmap
                  else if (imgData.bitmap) {
                    ctx.drawImage(imgData.bitmap, 0, 0);
                    blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.92));
                  }
                  
                  if (blob) {
                    // Converter blob para dataURL para poder salvar no histórico
                    const arrayBuffer = await blob.arrayBuffer();
                    const bytes = new Uint8Array(arrayBuffer);
                    let binary = '';
                    for (let i = 0; i < bytes.byteLength; i++) {
                      binary += String.fromCharCode(bytes[i]);
                    }
                    const base64 = btoa(binary);
                    const imageDataUrl = `data:image/jpeg;base64,${base64}`;
                    
                    images.push({
                      originalName: imgId,
                      temporaryId: imgId,
                      sourceType: 'pdf',
                      sourcePage: pageNum,
                      sourceIndex: images.length,
                      imageBlob: blob,
                      imageDataUrl: imageDataUrl,
                      width: imgData.width,
                      height: imgData.height,
                      confidence: 90
                    });
                    pageImageCount++;
                  }
                } catch(err) {
                  console.warn(`[ImageExtractorPdf] Imagem ignorada por incompatibilidade no canvas (Pag ${pageNum})`);
                }
              }
            }
          }
        }
        
        console.log(`[ImageExtractorPdf] Página ${pageNum}: ${pageImageCount} imagens extraídas`);
        
        // Liberar recursos da página
        page.cleanup();
        
      } catch(ex) {
         console.warn(`[ImageExtractorPdf] Falha página ${pageNum}:`, ex);
      }
    }
    
    console.log(`[ImageExtractorPdf] Extração concluída: ${images.length} imagens em ${Date.now() - startTime}ms`);
    
  } catch (err) {
    console.error('[ImageExtractorPdf] Erro global pdf:', err);
  }
  return images;
};
