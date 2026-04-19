import { PdfTemplate } from './types';

/**
 * Template de PDF para LILA HOME
 * Padrão: Blocos com CÓD, MATERIAL, TAMANHO, COR, CX, IPI, NCM, R$
 * Extrai nome do produto corretamente (não confundir com observações)
 */
export const lilaHomeTemplate: PdfTemplate = {
  supplierId: 'lila-home',
  supplierName: 'Lila Home',
  identificationPatterns: [
    'LILA HOME',
    'Lila Home',
    /CÓD[:\s]+[A-Z]/i,
    /MATERIAL[:\s]+\w/i,
    /TAMANHO[:\s]+[\d\/]/i,
  ],
  minConfidence: 20,

  // Separador de blocos: início de novo produto é marcado por CÓD:
  blockExtractor: /(?=CÓD[:\s])/i,

  fieldExtractors: {
    // Código: CÓD: ABC123 ou CÓD ABC123
    codigo: /CÓD[:\s]*(\w{2,10})/i,

    // Nome do produto: texto principal que vem após código
    // Deve capturar o nome real, não MATERIAL, TAMANHO, COR
    descricao: /(?:CÓD[:\s]*\w{2,10}\s*[-—]?\s*)?([A-ZÇÃÕÁÉÍÓÚÂÊÎÔÛÀÈÌÒÙ][A-ZÇÃÕÁÉÍÓÚÂÊÎÔÛÀÈÌÒÙa-zçãõáéíóúâêîôûàèìòù0-9\s\-]{5,60})(?=\s*(?:MATERIAL|TAMANHO|COR|CX|IPI|NCM|R\$|\d+[.,]\d{2}))/i,

    // Material extraído do campo MATERIAL
    material: /MATERIAL[:\s]*([A-Za-zçãõáéíóúâêîôûàèìòù\s]{3,30})/i,

    // Tamanho/Dimensões do campo TAMANHO
    dimensoes: /TAMANHO[:\s]*([\d\s,./xXcmCM]+)/i,

    // Cor do campo COR
    cor: /COR[:\s]*([A-Za-zçãõáéíóúâêîôûàèìòù\s]{3,25})/i,

    // Preço: R$ 123,45
    preco: /R?\$\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/i,

    // IPI: IPI 5%, IPI: 5, 5% IPI
    ipi: /(?:IPI[:\s]*)?(\d+(?:[.,]\d+)?)\s*%/i,

    // Quantidade por caixa: CX 12, CX: 12, CX12
    quantidadeCaixa: /CX[:\s]*(\d{1,4})/i,

    // NCM: NCM 1234.56.78 ou apenas 1234.56.78
    ncm: /(?:NCM[:\s]*)?(\d{4}[.]?\d{2}[.]?\d{2})/i,
  }
};
