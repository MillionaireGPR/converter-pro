import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { ResultadoExtracaoImagens } from './imageTypes';

/**
 * Processa uma imagem para garantir que ela tenha um fundo branco sólido.
 * Útil para converter PNGs/GIFs transparentes em um padrão uniforme.
 */
const processImageWithWhiteBackground = async (imageDataUrl: string): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Falha ao obter contexto 2D do Canvas'));
        return;
      }

      // 1. Pintar fundo branco sólido
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 2. Desenhar a imagem por cima
      ctx.drawImage(img, 0, 0);

      // 3. Exportar como JPEG (que não suporta transparência e é mais leve)
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Falha ao gerar Blob do Canvas'));
      }, 'image/jpeg', 0.9);
    };
    img.onerror = () => reject(new Error('Falha ao carregar imagem para processamento'));
    img.src = imageDataUrl;
  });
};

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
    for (const img of extractResult.images) {
      // Adicionar a imagem real ao zip
      try {
        // Se tivermos a dataUrl, processamos para garantir o fundo branco e converter para JPEG
        if (img.imageDataUrl) {
          const processedBlob = await processImageWithWhiteBackground(img.imageDataUrl);
          // Ajustar nome para .jpg já que processamos como jpeg
          const fileName = img.imageFileNameFinal.replace(/\.(png|gif|webp|jpeg)$/i, '.jpg');
          folder.file(fileName, processedBlob);
        } else if (img.imageBlob) {
          // Fallback caso não tenha dataUrl
          folder.file(img.imageFileNameFinal, img.imageBlob);
        }
      } catch (err) {
        console.error(`[ZipBuilder] Erro ao processar imagem ${img.sku}:`, err);
        // Se falhar o processamento, tenta colocar o original
        if (img.imageBlob) {
          folder.file(img.imageFileNameFinal, img.imageBlob);
        }
      }
      
      // Adicionar linha ao manifesto CSV
      manifestRows.push(`"${img.sku}","imagem_bruta_desconhecida","${img.imageFileNameFinal}","${img.sourcePage || 0}","${img.confidence}"`);
    }

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
