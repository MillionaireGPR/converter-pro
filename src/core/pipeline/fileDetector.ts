// ===================================================================
// DETECÇÃO DE TIPO DE ARQUIVO
// Identifica o formato do arquivo e, para PDFs, classifica o subtipo.
// ===================================================================

import { TipoArquivo, TipoPDF } from '../types/productPipeline';

/** Detecta o tipo de arquivo pela extensão */
export const detectFileType = (fileName: string): TipoArquivo => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'xlsx': return 'xlsx';
    case 'xls': return 'xls';
    case 'csv': return 'csv';
    case 'pdf': return 'pdf';
    default: return 'xlsx'; // fallback
  }
};

/** Extensões aceitas pelo sistema */
export const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.pdf'];

/** String para o atributo accept do input file */
export const ACCEPTED_FILE_TYPES = '.xlsx,.xls,.csv,.pdf';

/** Verifica se o arquivo é de um tipo aceito */
export const isAcceptedFileType = (fileName: string): boolean => {
  const ext = '.' + (fileName.split('.').pop()?.toLowerCase() || '');
  return ACCEPTED_EXTENSIONS.includes(ext);
};

/**
 * Classifica o tipo de PDF analisando seu conteúdo textual.
 * Essa é uma heurística baseada na densidade de texto extraído.
 */
export const classifyPDF = (
  pages: { pageNum: number; text: string }[]
): TipoPDF => {
  if (pages.length === 0) return 'pdf-imagem';

  let totalChars = 0;
  let pagesWithText = 0;
  let pagesWithPrices = 0;
  let pagesWithCodes = 0;
  let pagesWithBlocks = 0;

  const pricePattern = /R?\$\s*\d|(\d{1,3}[.,]\d{2})/;
  const codePattern = /\b[A-Z]{2,4}\d{3,}/;
  const blockPattern = /\b(CÓD|COD|REF|CÓDIGO|MATERIAL|TAMANHO)\s*:/i;

  for (const page of pages) {
    const text = page.text || '';
    totalChars += text.length;
    if (text.trim().length > 50) pagesWithText++;
    if (pricePattern.test(text)) pagesWithPrices++;
    if (codePattern.test(text)) pagesWithCodes++;
    if (blockPattern.test(text)) pagesWithBlocks++;
  }

  const avgCharsPerPage = totalChars / pages.length;
  const textRatio = pagesWithText / pages.length;

  // PDF com pouquíssimo texto → provavelmente imagem/scan
  if (textRatio < 0.3 || avgCharsPerPage < 100) {
    return 'pdf-imagem';
  }

  // PDF com blocos de produto (catálogo estruturado)
  if (pagesWithBlocks > pages.length * 0.3) {
    return 'pdf-blocos';
  }

  // PDF com tabelas (muitos preços e códigos em formato tabular)
  if (pagesWithPrices > pages.length * 0.5 && pagesWithCodes > pages.length * 0.5) {
    return 'pdf-tabela';
  }

  // PDF com algum texto mas formato misto
  if (textRatio > 0.5 && pagesWithPrices > 0) {
    return 'pdf-misto';
  }

  // PDF com texto extraível mas sem padrões claros
  return 'pdf-texto';
};
