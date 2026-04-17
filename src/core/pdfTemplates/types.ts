import { ProdutoBruto } from '../types/productPipeline';

export interface PdfTemplate {
  supplierId: string;
  supplierName: string;
  
  /** Padrões textuais para identificar que o PDF pertence a este fornecedor */
  identificationPatterns: (string | RegExp)[];
  
  /** Regex longo para extrair um bloco completo de produto da string de uma página, ou função customizada */
  blockExtractor?: RegExp | ((pageText: string) => string[]);
  
  /** Regex para extrair campos específicos dentro de um bloco de produto */
  fieldExtractors: {
    codigo?: RegExp;
    descricao?: RegExp;
    preco?: RegExp;
    ipi?: RegExp;
    embalagem?: RegExp;
    ncm?: RegExp;
    quantidadeCaixa?: RegExp;
    codigoBarras?: RegExp;
  };
  
  /** 
   * Se os itens estiverem dispostos em formato tabular estrito e a separação em blocos não funcionar, 
   * pode-se usar uma regex de linha.
   */
  lineExtractor?: RegExp;
  
  /** Confiança mínima exigida para atribuir o match a este template (0-100) */
  minConfidence: number;
}
