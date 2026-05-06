import JSZip from 'jszip';
import { ImagemExtraida } from './imageTypes';

/**
 * Lê o .xlsx diretamente em memória (sendo um formato .zip) e extrai
 * todas as mídias embutidas (pasta xl/media/). Em seguida vincula 
 * os relacionamentos XML do Drawing para descobrir a Linha Exata da célula
 * em que a imagem está ancorada.
 * 
 * ✅ AGORA COM SUPORTE A MÚLTIPLAS SHEETS (ABAS):
 * Busca imagens em todas as sheets do workbook, não apenas na primeira.
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
    if (mediaFiles.length === 0) {
      console.log('[ImageExtractorExcel] Nenhuma imagem encontrada em xl/media/');
      return images;
    }
    console.log(`[ImageExtractorExcel] Encontradas ${mediaFiles.length} imagens em xl/media/`);

    // Relacionamento (rId => xl/media/image.png) com a sheet de origem
    let anchorMap: Record<string, { rowIdx: number; sheetName: string }> = {};
    
    // === NOVO: Descobrir todas as sheets e seus drawings ===
    // 1. Ler workbook.xml para mapear sheetId -> sheetName
    const workbookXmlFile = zip.file('xl/workbook.xml');
    const sheetIdToName: Record<string, string> = {};
    
    if (workbookXmlFile) {
      const workbookXml = await workbookXmlFile.async('string');
      const parser = new DOMParser();
      const wbDoc = parser.parseFromString(workbookXml, 'application/xml');
      const sheets = wbDoc.querySelectorAll('sheets > sheet');
      
      sheets.forEach((sheet, idx) => {
        const sheetId = sheet.getAttribute('sheetId') || String(idx + 1);
        const sheetName = sheet.getAttribute('name') || `Sheet${idx + 1}`;
        sheetIdToName[sheetId] = sheetName;
        console.log(`[ImageExtractorExcel] Sheet encontrada: ${sheetName} (ID: ${sheetId})`);
      });
    }
    
    // 2. Para cada sheet, encontrar seu drawing correspondente
    const worksheetFiles = Object.keys(zip.files).filter(k => 
      k.startsWith('xl/worksheets/sheet') && 
      !k.includes('_rels') && 
      !k.endsWith('/')
    );
    
    console.log(`[ImageExtractorExcel] Processando ${worksheetFiles.length} worksheet(s)...`);
    
    for (const wsFile of worksheetFiles) {
      // Extrair número da sheet do nome do arquivo (sheet1.xml -> 1)
      const sheetMatch = wsFile.match(/sheet(\d+)\.xml$/);
      const sheetNum = sheetMatch ? sheetMatch[1] : '1';
      const sheetName = sheetIdToName[sheetNum] || `Sheet${sheetNum}`;
      
      // Ler a worksheet para encontrar o drawing relationship
      const wsContent = await zip.files[wsFile].async('string');
      const drawingRefMatch = wsContent.match(/r:id="([^"]+)".*?drawings\/drawing(\d+)\.xml/);
      
      if (drawingRefMatch) {
        const drawingNum = drawingRefMatch[2] || sheetNum;
        const drawKey = `xl/drawings/drawing${drawingNum}.xml`;
        const drawRelKey = `xl/drawings/_rels/drawing${drawingNum}.xml.rels`;
        
        console.log(`[ImageExtractorExcel] Sheet "${sheetName}" -> ${drawKey}`);
        
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
                    const rowIdx = parseInt(rowMatch[1], 10) + 1; // 1-based
                    const rId = embedMatch[1];
                    const target = idToTarget[rId];
                    if (target) {
                        anchorMap[target] = { rowIdx, sheetName };
                        console.log(`[ImageExtractorExcel] Imagem ${target} -> linha ${rowIdx} na sheet "${sheetName}"`);
                    }
                }
            });
        }
      } else {
        console.log(`[ImageExtractorExcel] Sheet "${sheetName}" não tem drawing`);
      }
    }

    // Gerar extração Blob final
    console.log(`[ImageExtractorExcel] Processando ${mediaFiles.length} imagens...`);
    let matchedCount = 0;
    let unmatchedCount = 0;
    
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
       const anchorInfo = anchorMap[relativePath];
       
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

       // Se temos informação de ancoragem, a confiança é alta
       const hasAnchor = !!anchorInfo;
       if (hasAnchor) {
         matchedCount++;
       } else {
         unmatchedCount++;
       }

       images.push({
         originalName: cleanFileName,
         temporaryId: tempName,
         sourceType: 'excel',
         sourceIndex: anchorInfo?.rowIdx, // Índice de linha exata da planilha
         sourceSheet: anchorInfo?.sheetName, // ✅ NOVO: Nome da aba/sheet
         imageBlob: blob,
         imageDataUrl: imageDataUrl,
         confidence: hasAnchor ? 95 : 40 // Baixa confiança se a imagem ta boiando de forma não ancorada
       });
    }
    
    console.log(`[ImageExtractorExcel] ✅ Extração completa: ${matchedCount} imagens ancoradas, ${unmatchedCount} sem ancora, total ${images.length}`);

  } catch(e) {
    console.error('[ImageExtractorExcel] Falha:', e);
  }
  return images;
};
