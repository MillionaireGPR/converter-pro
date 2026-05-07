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

    // Relacionamento (xl/media/image.png => lista de (rowIdx, sheetName))
    // Uma imagem pode estar ancorada em múltiplas sheets/linhas — armazenamos
    // todas para que o matcher use a melhor.
    const anchorMap: Record<string, Array<{ rowIdx: number; sheetName: string }>> = {};
    
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

      // ── Etapa 1: ler o sheet1.xml e extrair o r:id da referência <drawing/> ──
      const wsContent = await zip.files[wsFile].async('string');
      const drawingTagMatch = wsContent.match(/<drawing\s+r:id="([^"]+)"\s*\/?>/i);

      if (!drawingTagMatch) {
        console.log(`[ImageExtractorExcel] Sheet "${sheetName}" não tem drawing`);
        continue;
      }
      const drawingRId = drawingTagMatch[1];

      // ── Etapa 2: abrir o _rels da sheet para resolver rId -> drawingN.xml ──
      const wsRelsKey = wsFile.replace(/sheet(\d+)\.xml$/, '_rels/sheet$1.xml.rels');
      const wsRelsFile = zip.files[wsRelsKey];
      if (!wsRelsFile) {
        console.log(`[ImageExtractorExcel] Sheet "${sheetName}" sem .rels (${wsRelsKey})`);
        continue;
      }
      const wsRelsText = await wsRelsFile.async('string');
      const wsRels: Record<string, string> = {};
      for (const m of wsRelsText.matchAll(/<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/ig)) {
        wsRels[m[1]] = m[2];
      }
      const drawingTarget = wsRels[drawingRId];
      if (!drawingTarget) {
        console.log(`[ImageExtractorExcel] Sheet "${sheetName}": rId ${drawingRId} não resolvido em rels`);
        continue;
      }

      // Normaliza caminho: pode vir como "../drawings/drawing1.xml" ou "/xl/drawings/drawing1.xml"
      let drawKey = drawingTarget.replace(/^\.\.\//, 'xl/').replace(/^\//, '');
      if (!drawKey.startsWith('xl/')) drawKey = `xl/${drawKey}`;
      const drawingFileName = drawKey.split('/').pop() || '';
      const drawRelKey = `xl/drawings/_rels/${drawingFileName}.rels`;

      console.log(`[ImageExtractorExcel] Sheet "${sheetName}" -> ${drawKey}`);

      const drawingFile = zip.files[drawKey];
      const drawingRels = zip.files[drawRelKey];

      if (!drawingFile || !drawingRels) {
        console.log(`[ImageExtractorExcel] Drawing files faltando: file=${!!drawingFile} rels=${!!drawingRels}`);
        continue;
      }

      const relsText = await drawingRels.async('string');
      const drawText = await drawingFile.async('string');

      // ── Etapa 3: rels do drawing -> rId -> xl/media/imageN.jpg ──
      const idToTarget: Record<string, string> = {};
      for (const m of relsText.matchAll(/<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/ig)) {
        let targetFixed = m[2].replace(/^\.\.\//, 'xl/').replace(/^\//, '');
        if (!targetFixed.startsWith('xl/')) targetFixed = `xl/${targetFixed}`;
        idToTarget[m[1]] = targetFixed;
      }

      // ── Etapa 4: para cada xdr:*CellAnchor, capturar from.row + a:blip embed ──
      // Também captura "absoluteAnchor" como fallback (raro).
      const anchorChunks = drawText.split(/<xdr:(?:oneCellAnchor|twoCellAnchor|absoluteAnchor)/g);
      let anchorsFoundInDrawing = 0;
      for (const chunk of anchorChunks) {
        const rowMatch = chunk.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
        const embedMatch = chunk.match(/<a:blip[^>]+r:embed="([^"]+)"/);
        if (rowMatch && embedMatch) {
          const rowIdx = parseInt(rowMatch[1], 10) + 1; // 0-based -> 1-based (linha do Excel)
          const rId = embedMatch[1];
          const target = idToTarget[rId];
          if (target) {
            if (!anchorMap[target]) anchorMap[target] = [];
            anchorMap[target].push({ rowIdx, sheetName });
            anchorsFoundInDrawing++;
          }
        }
      }
      console.log(`[ImageExtractorExcel] Sheet "${sheetName}": ${anchorsFoundInDrawing} âncoras extraídas`);
    }

    // Gerar extração Blob final.
    // Uma imagem pode estar ancorada em VÁRIAS sheets (ex: aparece em
    // "Conferencias" e "DADOS"). Geramos UMA entrada de imagem por âncora,
    // assim o matcher por linha encontra a posição correta em cada sheet.
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

       // Converter blob para dataURL UMA VEZ (compartilhado entre âncoras)
       const arrayBuffer = await blob.arrayBuffer();
       const bytes = new Uint8Array(arrayBuffer);
       let binary = '';
       for (let j = 0; j < bytes.byteLength; j++) {
         binary += String.fromCharCode(bytes[j]);
       }
       const base64 = btoa(binary);
       const mimeType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
       const imageDataUrl = `data:${mimeType};base64,${base64}`;

       const anchors = anchorMap[relativePath];

       if (anchors && anchors.length > 0) {
         // Uma entrada por âncora distinta (sheet/linha)
         anchors.forEach((anchor, idx) => {
           const tempName = `${fileName}_img${i + 1}${anchors.length > 1 ? `_${anchor.sheetName}` : ''}.${extension}`;
           images.push({
             originalName: cleanFileName,
             temporaryId: tempName,
             sourceType: 'excel',
             sourceIndex: anchor.rowIdx,
             sourceSheet: anchor.sheetName,
             imageBlob: blob,
             imageDataUrl,
             confidence: 95,
           });
           matchedCount++;
         });
       } else {
         // Sem âncora — preserva imagem mas com baixa confiança (matcher fará fallback)
         images.push({
           originalName: cleanFileName,
           temporaryId: `${fileName}_img${i + 1}.${extension}`,
           sourceType: 'excel',
           sourceIndex: undefined,
           sourceSheet: undefined,
           imageBlob: blob,
           imageDataUrl,
           confidence: 40,
         });
         unmatchedCount++;
       }
    }

    console.log(`[ImageExtractorExcel] ✅ Extração completa: ${matchedCount} entradas com âncora, ${unmatchedCount} sem âncora, total ${images.length} (mediaFiles=${mediaFiles.length})`);

  } catch(e) {
    console.error('[ImageExtractorExcel] Falha:', e);
  }
  return images;
};
