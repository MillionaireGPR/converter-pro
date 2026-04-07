import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { ResultadoExtracaoImagens } from './imageTypes';

export const buildAndDownloadZip = async (
  extractResult: ResultadoExtracaoImagens,
  fileNameBase: string
): Promise<void> => {
  if (extractResult.images.length === 0) {
    console.warn('[ImageZipBuilder] Nenhuma imagem para compactar.');
    return;
  }

  const zip = new JSZip();
  const folder = zip.folder(`${fileNameBase}_Imagens_Renomeadas`);
  const manifestRows = ['SKU,Nome original da Imagem,Nome final associado,Página de Origem,Confiança(0-100)'];

  if (folder) {
    extractResult.images.forEach(img => {
      // Adicionar a imagem real ao zip
      if (img.imageBlob) {
         folder.file(img.imageFileNameFinal, img.imageBlob);
      }
      // Adicionar linha ao manifesto CSV
      manifestRows.push(`"${img.sku}","imagem_bruta_desconhecida","${img.imageFileNameFinal}","${img.sourcePage || 0}","${img.confidence}"`);
    });

    // Se o usuário quiser revisar as erradas, salva numa pastinha "Revisao"
    if (extractResult.unmatchedImages.length > 0) {
        const revisaoFolder = folder.folder('Nao_Reconhecidas_Para_Revisao');
        if (revisaoFolder) {
            extractResult.unmatchedImages.forEach((unimg, idx) => {
               if (unimg.imageBlob) {
                  const ext = (unimg.originalName && unimg.originalName.includes('.')) ? unimg.originalName.split('.').pop() : 'jpg';
                  revisaoFolder.file(`nao_reconhecida_${idx + 1}.${ext}`, unimg.imageBlob);
               }
            });
        }
    }

    // Criar o arquivo manifesto csv
    folder.file(`manifest.csv`, "\uFEFF" + manifestRows.join('\n'));
    
    // Gerar o ZIP assincronamente e iniciar o download pelo browser
    try {
      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, `${fileNameBase}_Imagens_ConverterPro.zip`);
    } catch (e) {
      console.error('[ImageZipBuilder] Falha ao gerar o arquivo zip:', e);
      throw new Error("Erro na geração do ZIP de imagens. Se o arquivo for muito grande (centenas de MBs), seu navegador pode bloquear por falta de RAM.");
    }
  }
};
