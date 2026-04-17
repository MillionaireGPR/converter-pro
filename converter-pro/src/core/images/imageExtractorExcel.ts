import JSZip from 'jszip';
import { ImagemExtraida } from './imageTypes';

/**
 * Lê o .xlsx diretamente em memória (sendo um formato .zip) e extrai
 * todas as mídias embutidas (pasta xl/media/). Em seguida vincula 
 * os relacionamentos XML do Drawing para descobrir a Linha Exata da célula
 * em que a imagem está ancorada.
 */
export const extractImagesFromExcel = async (
  fileData: ArrayBuffer,
  fileName: string
): Promise<ImagemExtraida[]> => {
  const images: ImagemExtraida[] = [];
  try {
    const zip = new JSZip();
    await zip.loadAsync(fileData);
    
    const mediaFiles = Object.keys(zip.files).filter(k => k.startsWith('xl/media/') && !k.endsWith('/'));
    if (mediaFiles.length === 0) return images;

    // Relacionamento (rId => xl/media/image.png)
    let anchorMap: Record<string, number> = {};
    
    // Tentar localizar os drawings. O Excel permite n drawings pra N sheets
    // Mas normalmente há só o drawing1.xml no MVP de catálogo de produtos
    const drawingKeys = Object.keys(zip.files).filter(k => k.startsWith('xl/drawings/') && !k.includes('_rels'));
    
    for (const drawKey of drawingKeys) {
        const drawRelKey = drawKey.replace('xl/drawings/', 'xl/drawings/_rels/') + '.rels';
        const drawingFile = zip.files[drawKey];
        const drawingRels = zip.files[drawRelKey];

        if (drawingFile && drawingRels) {
            const relsText = await drawingRels.async('string');
            const drawText = await drawingFile.async('string');
            
            // Relacionamentos: <Relationship Id="rId1" Target="../media/image1.jpeg"/>
            const idToTarget: Record<string, string> = {};
            const relMatches = [...relsText.matchAll(/<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/ig)];
            relMatches.forEach(m => {
                let targetFixed = m[2].replace('../media/', 'xl/media/');
                idToTarget[m[1]] = targetFixed;
            });

            // Mapeamentos: A quebra da linha do Anchor.
            // Para "oneCellAnchor" ou "twoCellAnchor"
            const anchorChunks = drawText.split(/<xdr:oneCellAnchor|<xdr:twoCellAnchor/g);
            anchorChunks.forEach(chunk => {
                const rowMatch = chunk.match(/<xdr:from>.*?<xdr:row>(\d+)<\/xdr:row>/);
                const embedMatch = chunk.match(/<a:blip[^>]+r:embed="([^"]+)"/);
                
                if (rowMatch && embedMatch) {
                    const rowIdx = parseInt(rowMatch[1], 10) + 1; // 1-based (se é linha 3 no XML -> row 4 visual -> mas xlsx engine usa o origin. Ajustar no matcher depois)
                    const rId = embedMatch[1];
                    const target = idToTarget[rId];
                    if (target) {
                        anchorMap[target] = rowIdx;
                    }
                }
            });
        }
    }

    // Gerar extração Blob final
    for (let i = 0; i < mediaFiles.length; i++) {
       const relativePath = mediaFiles[i];
       const file = zip.files[relativePath];
       const blob = await file.async('blob');
       
       let extension = 'jpg';
       if (relativePath.endsWith('png')) extension = 'png';
       if (relativePath.endsWith('jpeg')) extension = 'jpeg';
       if (relativePath.endsWith('webp')) extension = 'webp';
       
       const cleanFileName = relativePath.split('/').pop() || '';
       const tempName = `${fileName}_img${i + 1}.${extension}`;
       const sourceRow = anchorMap[relativePath];
       
       // Converter blob para dataURL
       const arrayBuffer = await blob.arrayBuffer();
       const bytes = new Uint8Array(arrayBuffer);
       let binary = '';
       for (let j = 0; j < bytes.byteLength; j++) {
         binary += String.fromCharCode(bytes[j]);
       }
       const base64 = btoa(binary);
       const mimeType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
       const imageDataUrl = `data:${mimeType};base64,${base64}`;

       images.push({
         originalName: cleanFileName,
         temporaryId: tempName,
         sourceType: 'excel',
         sourceIndex: sourceRow, // Índice de linha exata da planilha
         imageBlob: blob,
         imageDataUrl: imageDataUrl,
         confidence: sourceRow ? 95 : 40 // Baixa confiança se a imagem ta boiando de forma não ancorada
       });
    }

  } catch(e) {
    console.error('[ImageExtractorExcel] Falha:', e);
  }
  return images;
};
