import { ResultadoExtracaoImagens, ImagemAssociadaProduto, ImagemExtraida } from './imageTypes';
import { extractImagesViaBackend } from './imageExtractionApi';
import { extractImagesFromExcel } from './imageExtractorExcel';
import { ProdutoNormalizadoV2 } from '../types/productPipeline';

/**
 * Faz o matching entre imagens extraídas do Excel e produtos
 * Usa sourceIndex (linha da planilha) para associar imagens a produtos
 */
const matchExcelImagesToProducts = (
  imagens: ImagemExtraida[],
  produtos: ProdutoNormalizadoV2[],
  fornecedor: string
): { matched: ImagemAssociadaProduto[]; unmatched: ImagemExtraida[] } => {
  const matched: ImagemAssociadaProduto[] = [];
  const unmatched: ImagemExtraida[] = [];
  
  console.log(`[ExcelImageMatcher] ========================================`);
  console.log(`[ExcelImageMatcher] INICIANDO MATCHING`);
  console.log(`[ExcelImageMatcher] Total imagens recebidas: ${imagens.length}`);
  console.log(`[ExcelImageMatcher] Total produtos recebidos: ${produtos.length}`);
  
  // Criar mapa de produtos por linhaOrigem para matching rápido
  const produtosPorLinha = new Map<number, ProdutoNormalizadoV2[]>();
  // ✅ NOVO: Mapa por código para fallback
  const produtosPorCodigo = new Map<string, ProdutoNormalizadoV2>();
  
  produtos.forEach(p => {
    // Por linha
    if (p.linhaOrigem) {
      if (!produtosPorLinha.has(p.linhaOrigem)) {
        produtosPorLinha.set(p.linhaOrigem, []);
      }
      produtosPorLinha.get(p.linhaOrigem)!.push(p);
    }
    // Por código (para fallback)
    if (p.codigo) {
      produtosPorCodigo.set(p.codigo, p);
    }
  });
  
  console.log(`[ExcelImageMatcher] ${produtosPorLinha.size} linhas únicas de produtos mapeadas`);
  console.log(`[ExcelImageMatcher] ${imagens.length} imagens para processar`);
  
  // ✅ DIAGNÓSTICO: Mostrar amostra de linhas disponíveis
  if (produtosPorLinha.size > 0) {
    const linhasDisponiveis = Array.from(produtosPorLinha.keys()).slice(0, 10);
    console.log(`[ExcelImageMatcher] Amostra de linhas disponíveis: ${linhasDisponiveis.join(', ')}`);
  }
  
  // ✅ DIAGNÓSTICO: Mostrar amostra de imagens recebidas
  if (imagens.length > 0) {
    const amostraImagens = imagens.slice(0, 3).map(img => ({ 
      nome: img.originalName, 
      sourceIndex: img.sourceIndex,
      sourceSheet: img.sourceSheet 
    }));
    console.log(`[ExcelImageMatcher] Amostra de imagens:`, amostraImagens);
  }

  // Contadores para diagnóstico
  let matchPorLinha = 0;
  let matchPorCodigo = 0;
  let semSourceIndex = 0;
  let linhaNaoEncontrada = 0;

  for (const img of imagens) {
    let matchedProduto: ProdutoNormalizadoV2 | null = null;
    let matchMethod = '';

    // Tentativa 1: Matching por linha (sourceIndex -> linhaOrigem)
    if (img.sourceIndex && img.sourceIndex > 0) {
      const produtosNaLinha = produtosPorLinha.get(img.sourceIndex);
      
      if (produtosNaLinha && produtosNaLinha.length > 0) {
        matchedProduto = produtosNaLinha[0];
        matchMethod = 'linha';
        matchPorLinha++;
      } else {
        linhaNaoEncontrada++;
        
        // ✅ DIAGNÓSTICO: Mostrar primeira falha de linha
        if (linhaNaoEncontrada === 1) {
          console.log(`[ExcelImageMatcher] ⚠️ Primeira falha de matching por linha:`);
          console.log(`[ExcelImageMatcher]    Imagem na linha ${img.sourceIndex} (aba: ${img.sourceSheet || 'N/A'})`);
          console.log(`[ExcelImageMatcher]    Linhas disponíveis próximas:`, 
            Array.from(produtosPorLinha.keys()).filter(l => Math.abs(l - img.sourceIndex!) <= 5).sort((a, b) => a - b)
          );
        }
        
        // Tentativa 2: Matching por proximidade APENAS ±1 linha.
        // (Antes era ±5, mas isso causava matches errados em planilhas densas.
        // Com __rowNum__ correto, o offset de 1 linha cobre apenas o caso de
        // drawings ancorados na linha do título do produto vs próxima linha.)
        for (let offset = 1; offset <= 1; offset++) {
          const produtosOffset = produtosPorLinha.get(img.sourceIndex + offset) ||
                                 produtosPorLinha.get(img.sourceIndex - offset);
          if (produtosOffset && produtosOffset.length > 0) {
            matchedProduto = produtosOffset[0];
            matchMethod = `linha_offset_${offset}`;
            console.log(`[ExcelImageMatcher] 🔄 Match por offset (±1): ${img.originalName} -> ${matchedProduto.codigo} (linha ${img.sourceIndex} → ${matchedProduto.linhaOrigem})`);
            break;
          }
        }
      }
    } else {
      semSourceIndex++;
    }
    
    // Se encontrou produto, adicionar ao matched
    if (matchedProduto) {
      matched.push({
        sku: matchedProduto.codigo,
        productName: matchedProduto.nome,
        supplier: fornecedor,
        imageFileNameFinal: `${matchedProduto.codigo}.jpg`,
        sourcePage: img.sourceIndex || 0,
        confidence: img.confidence,
        warnings: [
          ...(img.sourceSheet ? [`Imagem da aba: ${img.sourceSheet}`] : []),
          ...(matchMethod !== 'linha' ? [`Match via ${matchMethod}`] : [])
        ],
        imageBlob: img.imageBlob,
        imageDataUrl: img.imageDataUrl
      });
      
      if (matchMethod === 'linha') {
        console.log(`[ExcelImageMatcher] ✅ ${img.originalName} -> ${matchedProduto.codigo} (linha ${img.sourceIndex}${img.sourceSheet ? `, aba "${img.sourceSheet}"` : ''})`);
      }
      continue;
    }
    
    // Se não conseguiu fazer match, adiciona à lista de não associadas
    unmatched.push(img);
  }
  
  // ✅ NOVO: Estratégia de fallback sequencial
  // Se o matching por linha falhou completamente (0 associados), 
  // tenta associar por ordem sequencial (1ª imagem → 1º produto sem imagem)
  if (matched.length === 0 && unmatched.length > 0 && produtos.length > 0) {
    console.log(`[ExcelImageMatcher] 🔄 FALLBACK: Matching sequencial ativado (0 matches por linha)`);
    
    // Pegar produtos que não têm imagem ainda e ordenar por código
    const produtosOrdenados = [...produtos].filter(p => p.codigo).sort((a, b) => a.codigo!.localeCompare(b.codigo!));
    console.log(`[ExcelImageMatcher] Produtos ordenados para fallback: ${produtosOrdenados.length}`);
    
    // Associar imagens não-matchadas aos produtos por ordem
    for (let i = 0; i < Math.min(unmatched.length, produtosOrdenados.length); i++) {
      const img = unmatched[i];
      const produto = produtosOrdenados[i];
      
      matched.push({
        sku: produto.codigo,
        productName: produto.nome,
        supplier: fornecedor,
        imageFileNameFinal: `${produto.codigo}.jpg`,
        sourcePage: img.sourceIndex || 0,
        confidence: 50, // Confiança média pois é fallback
        warnings: [
          ...(img.sourceSheet ? [`Imagem da aba: ${img.sourceSheet}`] : []),
          'Match sequencial (fallback)'
        ],
        imageBlob: img.imageBlob,
        imageDataUrl: img.imageDataUrl
      });
      
      console.log(`[ExcelImageMatcher] 🎯 Fallback: ${img.originalName} -> ${produto.codigo} (ordem ${i + 1})`);
    }
    
    // Remover imagens que foram associadas via fallback da lista de unmatched
    const numAssociadasFallback = Math.min(unmatched.length, produtosOrdenados.length);
    unmatched.splice(0, numAssociadasFallback);
    console.log(`[ExcelImageMatcher] ✅ ${numAssociadasFallback} imagens associadas via fallback sequencial`);
  }
  
  // Resumo detalhado
  console.log(`[ExcelImageMatcher] 📊 Estatísticas de matching:`);
  console.log(`[ExcelImageMatcher]    Por linha exata: ${matchPorLinha}`);
  console.log(`[ExcelImageMatcher]    Por offset: ${matchPorCodigo}`);
  console.log(`[ExcelImageMatcher]    Por fallback: ${matched.length - matchPorLinha - matchPorCodigo}`);
  console.log(`[ExcelImageMatcher]    Sem sourceIndex: ${semSourceIndex}`);
  console.log(`[ExcelImageMatcher]    Linha não encontrada: ${linhaNaoEncontrada}`);
  
  console.log(`[ExcelImageMatcher] ========================================`);
  console.log(`[ExcelImageMatcher] MATCHING CONCLUÍDO`);
  console.log(`[ExcelImageMatcher] ✅ Associadas: ${matched.length}`);
  console.log(`[ExcelImageMatcher] ⚠️ Não associadas: ${unmatched.length}`);
  console.log(`[ExcelImageMatcher] ========================================`);
  
  return { matched, unmatched };
};

/**
 * Ponto de entrada do pipeline de extração de imagens.
 * Usa backend Python (PyMuPDF) para extrair imagens de PDFs de forma eficiente.
 * 
 * Para Excel: usa extração local (XL/Media já está descompactado) com suporte a múltiplas sheets
 * Para PDF: chama backend Python que processa com PyMuPDF
 */
export const runImageExtraction = async (
  file: File,
  produtos: ProdutoNormalizadoV2[],
  fornecedor?: string
): Promise<ResultadoExtracaoImagens | null> => {
  const extension = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase();
  
  if (!['pdf', 'xlsx', 'xls'].includes(extension)) {
    console.warn(`[ImageExtractionPipeline] Tipo de arquivo "${extension}" não suportado.`);
    return null;
  }

  // Para PDFs: usa backend Python (PyMuPDF - mais eficiente que pdfjs)
  if (extension === 'pdf') {
    console.log(`[ImageExtractionPipeline] Usando backend Python para PDF: ${file.name}`);
    return await extractImagesViaBackend(file, produtos, fornecedor || 'desconhecido');
  }
  
  // ✅ NOVO: Para Excel (xlsx, xls): extração local com suporte a múltiplas sheets
  console.log(`[ImageExtractionPipeline] ========================================`);
  console.log(`[ImageExtractionPipeline] INICIANDO EXTRAÇÃO DE IMAGENS DO EXCEL`);
  console.log(`[ImageExtractionPipeline] Arquivo: ${file.name}`);
  console.log(`[ImageExtractionPipeline] Tamanho: ${(file.size / 1024).toFixed(2)} KB`);
  console.log(`[ImageExtractionPipeline] Produtos recebidos: ${produtos.length}`);
  console.log(`[ImageExtractionPipeline] ========================================`);
  
  // ✅ DIAGNÓSTICO: Verificar se produtos têm linhaOrigem
  const produtosComLinha = produtos.filter(p => p.linhaOrigem).length;
  const produtosSemLinha = produtos.length - produtosComLinha;
  console.log(`[ImageExtractionPipeline] Produtos com linhaOrigem: ${produtosComLinha}`);
  console.log(`[ImageExtractionPipeline] Produtos sem linhaOrigem: ${produtosSemLinha}`);
  if (produtosComLinha > 0) {
    const amostra = produtos.slice(0, 3).map(p => ({ codigo: p.codigo, linhaOrigem: p.linhaOrigem }));
    console.log(`[ImageExtractionPipeline] Amostra de produtos:`, amostra);
  }
  
  try {
    const fileData = await file.arrayBuffer();
    console.log(`[ImageExtractionPipeline] ArrayBuffer carregado: ${fileData.byteLength} bytes`);
    
    const imagensExtraidas = await extractImagesFromExcel(fileData, file.name);
    
    console.log(`[ImageExtractionPipeline] ========================================`);
    console.log(`[ImageExtractionPipeline] EXTRAÇÃO CONCLUÍDA`);
    console.log(`[ImageExtractionPipeline] Total de imagens extraídas: ${imagensExtraidas.length}`);
    console.log(`[ImageExtractionPipeline] ========================================`);
    
    if (imagensExtraidas.length === 0) {
      console.log('[ImageExtractionPipeline] Nenhuma imagem encontrada no Excel');
      return {
        totalImagesFound: 0,
        totalImagesMatched: 0,
        totalImagesUnmatched: 0,
        images: [],
        unmatchedImages: [],
        warnings: ['Nenhuma imagem encontrada na planilha.'],
        errors: []
      };
    }
    
    // Fazer matching entre imagens e produtos
    const { matched, unmatched } = matchExcelImagesToProducts(
      imagensExtraidas,
      produtos,
      fornecedor || 'desconhecido'
    );
    
    const warnings: string[] = [];
    if (unmatched.length > 0) {
      warnings.push(`${unmatched.length} imagem(ns) não puderam ser associadas a produtos.`);
    }
    
    // Sheets únicas usadas
    const sheetsUsadas = [...new Set(imagensExtraidas.filter(img => img.sourceSheet).map(img => img.sourceSheet))];
    if (sheetsUsadas.length > 0) {
      warnings.push(`Imagens extraídas das abas: ${sheetsUsadas.join(', ')}`);
    }
    
    return {
      totalImagesFound: imagensExtraidas.length,
      totalImagesMatched: matched.length,
      totalImagesUnmatched: unmatched.length,
      images: matched,
      unmatchedImages: unmatched,
      warnings,
      errors: []
    };
    
  } catch (error) {
    console.error('[ImageExtractionPipeline] Erro ao extrair imagens do Excel:', error);
    return {
      totalImagesFound: 0,
      totalImagesMatched: 0,
      totalImagesUnmatched: 0,
      images: [],
      unmatchedImages: [],
      warnings: [],
      errors: [`Falha na extração de imagens: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
};
