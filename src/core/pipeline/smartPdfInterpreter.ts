import { ProdutoBruto } from '../types/productPipeline';
import { PdfTemplate } from '../pdfTemplates/types';

/**
 * Motor semântico para interpretar páginas de PDF e convertê-las em blocos de ProdutoBruto.
 * Tenta usar um template se fornecido, senão aplica heurísticas genéricas baseadas na estrutura de catálogos.
 */
export const interpretPdfSemantically = (
  pages: { pageNum: number; text: string }[],
  template?: PdfTemplate
): ProdutoBruto[] => {
  const produtos: ProdutoBruto[] = [];

  for (const page of pages) {
    const text = page.text || '';
    if (text.trim().length < 20) continue;

    // 1. Tenta extrair usando o separador de blocos do template
    if (template && template.blockExtractor) {
      const blocks = typeof template.blockExtractor === 'function' 
        ? template.blockExtractor(text)
        : text.split(template.blockExtractor).filter(b => b.trim().length > 10);
      
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const campos = applyTemplateExtractors(block, template);
        if (Object.keys(campos).length > 1) { // Garante que algo útil foi extraído
          produtos.push({
            campos,
            linhaOrigem: i,
            paginaOrigem: page.pageNum,
            textoBruto: block.trim(),
          });
        }
      }
      continue;
    }

    // 2. Fallback: Heurísticas Genéricas de Separação de Blocos (Catálogos)
    // Muitos catálogos separam produtos por Código, Preço, ou quebra de item.
    // Vamos tentar fatiar o texto a cada vez que encontrar um Padrão de Código ou "R$"
    
    // Heurística de fatiamento: Encontrar códigos comuns formados por 2-4 letras e 3+ números (ex: DXP24, NX020)
    // e usar isso como âncora para iniciar um novo bloco de produto.
    const codeAnchorRegex = /\b([A-Z]{2,4}\d{3,})\b/g;
    let match;
    let codeMatches: { index: number; code: string }[] = [];
    while ((match = codeAnchorRegex.exec(text)) !== null) {
      codeMatches.push({ index: match.index, code: match[1] });
    }

    if (codeMatches.length > 0) {
      for (let i = 0; i < codeMatches.length; i++) {
        const start = codeMatches[i].index;
        const end = i < codeMatches.length - 1 ? codeMatches[i + 1].index : text.length;
        const blockText = text.substring(start, end).trim();
        
        if (blockText.length > 10) {
          const campos = extractFieldsByHeuristics(blockText, codeMatches[i].code);
          produtos.push({
            campos,
            linhaOrigem: i,
            paginaOrigem: page.pageNum,
            textoBruto: blockText,
          });
        }
      }
    } else {
      // Se não achou códigos evidentes, tenta separar por "R$" (preços)
      const priceAnchorRegex = /R\$\s*?\d/g;
      let priceMatches: number[] = [];
      while ((match = priceAnchorRegex.exec(text)) !== null) {
        priceMatches.push(match.index);
      }
      
      if (priceMatches.length > 0) {
        // Tenta retroceder um pouco o índice para capturar a descrição antes do R$
        for (let i = 0; i < priceMatches.length; i++) {
          const start = i === 0 ? 0 : priceMatches[i] - 50 > priceMatches[i-1] ? priceMatches[i] - 50 : priceMatches[i-1];
          const end = i < priceMatches.length - 1 ? priceMatches[i + 1] : text.length;
          const blockText = text.substring(start, end).trim();
          
          if (blockText.length > 10) {
            const campos = extractFieldsByHeuristics(blockText);
            produtos.push({
              campos,
              linhaOrigem: i,
              paginaOrigem: page.pageNum,
              textoBruto: blockText,
            });
          }
        }
      }
    }
  }

  return produtos;
};

/**
 * Extrai campos de um bloco de texto usando os regex definidos no template do fornecedor.
 */
const applyTemplateExtractors = (block: string, template: PdfTemplate): Record<string, any> => {
  const campos: Record<string, any> = {};
  campos['__textoBruto'] = block;
  
  if (template.fieldExtractors.codigo) {
    const match = block.match(template.fieldExtractors.codigo);
    if (match) campos['codigo'] = match[1] || match[0];
  }
  
  if (template.fieldExtractors.descricao) {
    const match = block.match(template.fieldExtractors.descricao);
    if (match) campos['descricao'] = match[1] || match[0];
  }
  
  if (template.fieldExtractors.preco) {
    const match = block.match(template.fieldExtractors.preco);
    if (match) campos['preco'] = match[1] || match[0];
  }
  
  if (template.fieldExtractors.quantidadeCaixa) {
    const match = block.match(template.fieldExtractors.quantidadeCaixa);
    if (match) campos['cx'] = match[1] || match[0];
  }
  
  if (template.fieldExtractors.codigoBarras) {
    const match = block.match(template.fieldExtractors.codigoBarras);
    if (match) campos['ean'] = match[1] || match[0];
  }

  if (template.fieldExtractors.ncm) {
    const match = block.match(template.fieldExtractors.ncm);
    if (match) campos['ncm'] = match[1] || match[0];
  }

  if (template.fieldExtractors.ipi) {
    const match = block.match(template.fieldExtractors.ipi);
    if (match) campos['ipi'] = match[1] || match[0];
  }

  // Preenchimento de fallback para os campos não achados no regex (heurística genérica no bloco)
  const heuristic = extractFieldsByHeuristics(block);
  for (const k in heuristic) {
    if (!campos[k]) campos[k] = heuristic[k];
  }

  return campos;
};

/**
 * Extrai campos de um bloco usando heurísticas genéricas baseadas na estrutura comum de catálogos.
 */
const extractFieldsByHeuristics = (block: string, anchorCode?: string): Record<string, any> => {
  const campos: Record<string, any> = {};
  campos['__textoBruto'] = block;
  
  if (anchorCode) campos['codigo'] = anchorCode;
  
  // Tentar preço: R$ 1.234,56 ou R$33,75
  const priceMatch = block.match(/R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/);
  if (priceMatch) campos['preco'] = priceMatch[1];
  
  // Tentar EAN: 13 digitos seguidos ou "EAN \d+"
  const eanMatch = block.match(/(?:EAN|C[OÓ]DIGOBARRAS|C[OÓ]D)?\s*(\d{13})\b/i);
  if (eanMatch) campos['ean'] = eanMatch[1];
  
  // Tentar NCM: "NCM 7013.9900" ou "7013\.9900"
  const ncmMatch = block.match(/\b(\d{4}\.\d{2}(?:\.\d{2})?)\b/);
  if (ncmMatch) campos['ncm'] = ncmMatch[1];
  
  // Tentar IPI: "IP 9,75 %" ou "IPI:6,5"
  const ipiMatch = block.match(/IPI\s*[:\s]*(\d+(?:[.,]\d+)?)\s*%?/i) || block.match(/IP\s*(\d+(?:[.,]\d+)?)\s*%?/i);
  if (ipiMatch) campos['ipi'] = ipiMatch[1];
  
  // Tentar Caixa/Quantidade: "CX48", "CX: 24", "PEÇAS/CXS: 96", "Cx. c/50"
  const cxMatch = block.match(/(?:CX|CAIXA|PCT|KITS?|JGS)\s*(?:\.|:|\/|C\/|C\/)?\s*?(\d{1,4})/i) ||
                  block.match(/CXS?[:\s]*(\d+)/i) ||
                  block.match(/C\/(\d+)\s*(?:UN|P[CÇ]S|JGS)/i);
  if (cxMatch) campos['cx'] = cxMatch[1];

  // Identificar descrição. É geralmente um texto alfabético mais longo no bloco.
  // Vamos limpar códigos conhecidos do bloco e pegar a maior linha de texto.
  const cleanBlock = block
    .replace(anchorCode || '', '')
    .replace(priceMatch?.[0] || '', '')
    .replace(eanMatch?.[0] || '', '')
    .replace(ncmMatch?.[0] || '', '')
    .replace(ipiMatch?.[0] || '', '')
    .replace(cxMatch?.[0] || '', '')
    .trim();
    
  const possibleDescLines = cleanBlock.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 5 && /[A-Za-z]{3,}/.test(l));
    
  if (possibleDescLines.length > 0) {
    // A primeira linha viável que sobrou é a provável descrição
    campos['descricao'] = possibleDescLines[0];
  } else if (!campos['descricao']) {
    // Tenta um fallback final de texto em CAIXA ALTA (padrão de títulos de produto)
    const upperMatch = block.match(/\n?([A-ZÀ-Ú0-9\s\-\/\+]{10,})\n?/);
    if (upperMatch && upperMatch[1].trim().length > 5) {
      campos['descricao'] = upperMatch[1].trim();
    }
  }

  return campos;
};
