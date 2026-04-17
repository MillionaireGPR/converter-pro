// ===================================================================
// PARSER DE PDF
// Estratégia híbrida: texto nativo → tabular → blocos → OCR fallback
// Usa pdfjs-dist (Mozilla PDF.js) para extração em browser.
// ===================================================================

import { ProdutoBruto, PdfPageScore } from '../types/productPipeline';

/**
 * Carrega o PDF.js dinamicamente (só quando necessário).
 * Isso evita carregar a lib pesada se o usuário só usar Excel/CSV.
 */
let pdfjsLib: any = null;

const loadPdfJs = async (): Promise<any> => {
  if (pdfjsLib) return pdfjsLib;
  try {
    // Usar a versão exata do package.json para evitar inconsistências
    const version = '5.6.205';
    const cdnUrl = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.mjs`;
    
    // Importação dinâmica via URL com ignore do Vite para evitar bugs de resolução
    const pdfjs = await import(/* @vite-ignore */ cdnUrl);
    
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
    
    pdfjsLib = pdfjs;
    return pdfjs;
  } catch (err) {
    console.error('[PDF Parser] Falha ao carregar pdfjs-dist via CDN:', err);
    
    // Fallback: tentar importação local se o CDN falhar
    try {
      const pdfjsLocal = await import('pdfjs-dist');
      pdfjsLib = pdfjsLocal;
      return pdfjsLocal;
    } catch (localErr) {
      throw new Error('Biblioteca de leitura de PDF não disponível. Verifique sua conexão.');
    }
  }
};

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfPageData {
  pageNum: number;
  text: string;
  items: PdfTextItem[];
}

/**
 * Extrai texto e coordenadas de todas as páginas de um PDF.
 */
export const extractTextFromPDF = async (
  fileData: ArrayBuffer
): Promise<{ pages: PdfPageData[]; totalPages: number }> => {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: fileData }).promise;

  const pages: PdfPageData[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.0 });
    const content = await page.getTextContent();
    
    const items: PdfTextItem[] = content.items.map((item: any) => ({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      w: item.width,
      h: item.height
    }));

    const text = items.map(it => it.str).join(' ');
    
    pages.push({ 
      pageNum: i, 
      text,
      items
    });
  }

  return { pages, totalPages: doc.numPages };
};

/**
 * Pontua cada página do PDF para qualidade de extração.
 */
export const scorePdfPages = (
  pages: { pageNum: number; text: string }[]
): PdfPageScore[] => {
  const pricePattern = /R?\$\s*\d|(\d{1,3}[.,]\d{2})/;
  const codePattern = /\b[A-Z]{2,4}\d{3,}/;
  const blockPattern = /\b(CÓD|COD|REF|CÓDIGO|MATERIAL|TAMANHO)\s*:/i;

  return pages.map(p => {
    const text = p.text || '';
    const hasText = text.trim().length > 50;
    const hasPricePattern = pricePattern.test(text);
    const hasCodePattern = codePattern.test(text);
    const hasProductBlockPattern = blockPattern.test(text);

    let confidence = 0;
    if (hasText) confidence += 25;
    if (hasPricePattern) confidence += 25;
    if (hasCodePattern) confidence += 25;
    if (hasProductBlockPattern) confidence += 25;

    return {
      pagina: p.pageNum,
      hasText,
      hasPricePattern,
      hasCodePattern,
      hasProductBlockPattern,
      extractionConfidence: confidence,
      usouOCR: false,
    };
  });
};

/**
 * Separa texto em blocos de produto usando um separador (regex).
 * Cada bloco vira um ProdutoBruto com o texto bruto.
 */
export const splitIntoProductBlocks = (
  text: string,
  separator: RegExp,
  pageNum?: number
): ProdutoBruto[] => {
  const blocks = text.split(separator).filter(b => b.trim().length > 10);

  return blocks.map((block, idx) => ({
    campos: parseBlockFields(block),
    linhaOrigem: idx,
    paginaOrigem: pageNum,
    textoBruto: block.trim(),
  }));
};

/**
 * Extrai campos chave/valor de um bloco de texto de produto.
 * Padrão esperado: "LABEL: valor" ou "LABEL valor"
 */
const parseBlockFields = (block: string): Record<string, any> => {
  const campos: Record<string, any> = {};
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);

  // Padrão 1: "LABEL: valor"
  const labelPattern = /^([A-ZÀ-Ú\s]{2,20})\s*:\s*(.+)/i;

  for (const line of lines) {
    const match = line.match(labelPattern);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      campos[key] = value;
    }
  }

  // Se não extraiu campos estruturados, tenta heurísticas
  if (Object.keys(campos).length === 0) {
    // Tenta extrair código (primeiro padrão alfanumérico forte)
    const codeMatch = block.match(/\b([A-Z]{2,4}\d{3,6})\b/);
    if (codeMatch) campos['codigo'] = codeMatch[1];

    // Tenta extrair preço
    const priceMatch = block.match(/R?\$\s*([\d.,]+)/);
    if (priceMatch) campos['preco'] = priceMatch[1];

    // Tenta extrair NCM
    const ncmMatch = block.match(/\b(\d{4}\.\d{2}\.\d{2})\b/);
    if (ncmMatch) campos['ncm'] = ncmMatch[1];

    // Tenta extrair IPI
    const ipiMatch = block.match(/IPI\s*[:\s]*(\d+(?:[.,]\d+)?)\s*%?/i);
    if (ipiMatch) campos['ipi'] = ipiMatch[1];

    // Tenta extrair CX / quantidade
    const cxMatch = block.match(/(?:CX|CAIXA)\s*[:\s]*(\d+)/i);
    if (cxMatch) campos['cx'] = cxMatch[1];

    // O resto do texto é potencialmente a descrição
    let descricao = block
      .replace(/\b[A-Z]{2,4}\d{3,6}\b/, '')
      .replace(/R?\$\s*[\d.,]+/, '')
      .replace(/\d{4}\.\d{2}\.\d{2}/, '')
      .replace(/IPI\s*[:\s]*\d+(?:[.,]\d+)?\s*%?/i, '')
      .replace(/(?:CX|CAIXA)\s*[:\s]*\d+/i, '')
      .trim();

    if (descricao.length > 5) {
      campos['descricao'] = descricao.split('\n')[0].trim();
    }
  }

  // Guarda o texto bruto completo como campo auxiliar
  campos['__textoBruto'] = block;

  return campos;
};

/**
 * Parser de PDF tabular: tenta organizar texto em linhas/colunas.
 * Divide por quebras de linha e tenta alinhar por posição.
 */
export const parseTabularPDF = (
  pages: { pageNum: number; text: string }[]
): ProdutoBruto[] => {
  const produtos: ProdutoBruto[] = [];

  for (const page of pages) {
    const lines = page.text.split('\n').map(l => l.trim()).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Heurística: linhas com código + preço são provavelmente produtos
      const hasCode = /\b[A-Z]{1,4}[\-]?\d{3,}/i.test(line);
      const hasPrice = /\d+[.,]\d{2}/.test(line);

      if (hasCode || hasPrice) {
        // Divide a linha em "células" por múltiplos espaços
        const cells = line.split(/\s{2,}/).map(c => c.trim()).filter(Boolean);

        const campos: Record<string, any> = {};
        cells.forEach((cell, idx) => {
          campos[`col_${idx}`] = cell;
        });
        campos['__rawLine'] = line;

        produtos.push({
          campos,
          linhaOrigem: i,
          paginaOrigem: page.pageNum,
          textoBruto: line,
        });
      }
    }
  }

  return produtos;
};
