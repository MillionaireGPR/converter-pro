export type StatusProduto = 'validado' | 'pendente' | 'erro';

export interface ProdutoNormalizado {
  fornecedor: string;
  fornecedorId?: string;
  codigoOriginal: string;
  codigo: string;
  nome: string;
  descricaoComplementar?: string;
  precoBase: number;
  descontoPercentual?: number;
  descontoString?: string;
  precoFinal: number;
  ipi?: number;
  unidade: string;
  quantidadeCaixa: number;
  categoria?: string;
  embalagem?: string;
  observacoes?: string;
  status: StatusProduto;
  erros: string[];
  imagemUrl?: string;
  temImagem?: boolean;
  // Campos visuais
  visualCategory?: string;
  isPromotional?: boolean;
  isFixedPrice?: boolean;
  bloqueiaDesconto?: boolean;
  informacoesAdicionais?: string;
}

export interface SupplierConfig {
  id: string;
  name: string;
  columnAliases: {
    codigo: string[];
    nome: string[];
    precoBase: string[];
    ipi: string[];
    unidade: string[];
    quantidadeCaixa: string[];
    categoria: string[];
    descricaoComplementar?: string[];
  };
}
