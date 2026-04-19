import { PdfTemplate } from './types';

/**
 * Template de PDF para NIX HOUSE / NIX GLASS
 * Extrai código, descrição, preço e IPI de catálogos em PDF
 */
export const nixTemplate: PdfTemplate = {
  supplierId: 'nix',
  supplierName: 'Nix House',
  identificationPatterns: ['NIX HOUSE', 'NIX GLASS', 'Nix House', 'Nix Glass', /\bNX\d{3,}/],
  minConfidence: 25,

  // Separador de blocos: código NX seguido de dígitos
  blockExtractor: /(?=NX\d{3,5}\b)/i,

  fieldExtractors: {
    // Código: NX001, NX123, NX12345, NX001-ABC, etc.
    codigo: /\b(NX\d{2,6}(?:[-]?[A-Z0-9]{1,4})?)\b/i,

    // Descrição: texto após código até preço ou IPI
    // Pega o texto principal, ignorando campos estruturados
    descricao: /(?:NX\d{2,6}\s*[-]?\s*)?([A-ZÇÃÕÁÉÍÓÚÂÊÎÔÛÀÈÌÒÙ][A-ZÇÃÕÁÉÍÓÚÂÊÎÔÛÀÈÌÒÙa-zçãõáéíóúâêîôûàèìòù0-9\s\-\/\(\)\.]{5,80})(?=\s*(?:R\$|IPI|IP\s|NCM|EAN|CX|\d{1,3}[.,]\d{2}\s*%|\d{2,8}[.,]\d{2}))/i,

    // Preço: R$ 123,45 ou 123,45 (preços costumam estar no final)
    // NIX geralmente tem preço base e preço promocional
    preco: /R?\$\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/i,

    // IPI: vários padrões possíveis em PDFs da NIX
    // "IPI 5%", "IPI: 5", "IP 5%", "5% IPI", "IPI 5,5%"
    ipi: /(?:IPI?|I\.P\.I)[\s:.]*(\d+(?:[.,]\d+)?)\s*%?/i,

    // Quantidade por caixa: "CX 12", "CX12", "CX: 12", "C/12", "C/ 12"
    quantidadeCaixa: /(?:CX|C\/|C\s\/|CAIXA)[\s:.]*(\d{1,4})\b/i,

    // Código de barras/EAN: 13 dígitos
    codigoBarras: /\b(\d{13})\b/,

    // NCM: 1234.56.78 ou 12345678
    ncm: /(?:NCM[\s:.]*)?(\d{4}[.]?\d{2}[.]?\d{2})/i,
  }
};
