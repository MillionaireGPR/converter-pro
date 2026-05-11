export type StatusProduto = 'validado' | 'pendente' | 'erro' | 'incompleto';

export interface Fornecedor {
  id: string;
  nome: string;
  tipoArquivo: string;
  frequencia: string;
  descontoPadrao: number;
  ipiPadrao: number;
  ultimoProcessamento: string;
  totalProdutos: number;
  status: 'ativo' | 'inativo';
}

export interface ArquivoProcessado {
  id: string;
  nome: string;
  fornecedor: string;
  tipo: string;
  data: string;
  qtdProdutos: number;
  status: 'concluído' | 'erro';
}

export interface Produto {
  id: string;
  fornecedor: string;
  fornecedorId?: string;
  codigoOriginal: string;
  codigoFinal: string;
  nome: string;
  descricao: string;
  precoBase: number;
  descontoPercentual: number;
  descontoString?: string;
  precoFinal: number;
  ipi: number;
  unidade: string;
  visualCategory?: 'promocional' | 'preco-fixo' | 'novidade' | 'reposicao' | 'padrao';
  visualTags?: ('promocional' | 'preco-fixo' | 'novidade' | 'reposicao' | 'padrao')[];
  isPromotional?: boolean;
  isFixedPrice?: boolean;
  bloqueiaDesconto?: boolean;
  additionalInfo?: string;
  qtdCaixa: number;
  categoria: string;
  embalagem: string;
  status: StatusProduto;
  erros: string[];
  imagemUrl?: string;
  temImagem?: boolean;
}

export interface RegraMapeamento {
  id: string;
  fornecedor: string;
  colunaOrigem: string;
  colunaDestino: string;
  tipo: 'direto' | 'formula' | 'fixo';
  valor?: string;
}

export interface DescontoSalvo {
  id: string;
  fornecedor: string;
  campanha: string;
  percentual: number;
  produtosAfetados: number;
  data: string;
}

export interface OperacaoHistorico {
  id: string;
  arquivo: string;
  fornecedor: string;
  usuario: string;
  data: string;
  tipoConversao: string;
  qtdItens: number;
  status: 'concluído' | 'erro' | 'processando';
  produtos?: Produto[];
  imagens?: { id: string; url: string; nome: string }[];
  headersDetectados?: string[];
}

export interface ConversaoSalva {
  id: string;
  arquivo: string;
  fornecedor: string;
  data: string;
  produtos: Produto[];
  imagens: { id: string; url: string; nome: string; temporaryId?: string }[];
  headers: string[];
  totalProdutos: number;
  status: 'concluído' | 'erro';
  zipUrl?: string;
}

export interface ExportacaoMercos {
  id: string;
  data: string;
  produtos: Produto[];
  status: 'gerada' | 'pendente';
}

export interface CatalogoGerado {
  id: string;
  nome: string;
  fornecedor: string;
  desconto: number;
  data: string;
  qtdProdutos: number;
}

export interface PedidoConvertido {
  id: string;
  numero: string;
  destino: string;
  data: string;
  itens: PedidoItem[];
  total: number;
}

export interface PedidoItem {
  codigo: string;
  descricao: string;
  qtd: number;
  preco: number;
  total: number;
}

export interface DashboardData {
  arquivosProcessados: number;
  produtosConvertidos: number;
  exportacoesMercosCount: number;
  catalogosGeradosCount: number;
  fornecedoresAtivos: number;
  pedidosConvertidosCount: number;
  taxaAproveitamento: number;
  alertasPendentes: number;
}
