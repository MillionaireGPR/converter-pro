// ===== TIPOS DA FASE 2 - CONVERSÃO DE PEDIDOS =====

export type StatusItemPedido = 'ok' | 'incompleto' | 'erro';

/**
 * Representa os dados crus lidos diretamente do arquivo de pedido.
 */
export interface PedidoBruto {
  nomeArquivo: string;
  linhas: Record<string, any>[];
  linhas2D: any[][];
  headerRowIndex: number;
  headersDetectados: string[];
}

/**
 * Item individual do pedido já normalizado e com status.
 */
export interface ItemPedidoNormalizado {
  codigo: string;
  descricao: string;
  quantidade: number;
  precoUnitario: number;
  total: number;
  ipi?: number;           // Opcional - IPI do item
  desconto?: number;     // Opcional - Desconto percentual
  unidade?: string;      // Opcional - Unidade de medida
  observacoes: string;
  referenciaPedido: string;
  status: StatusItemPedido;
  erros: string[];
}

/**
 * Mapeamento de colunas detectadas no arquivo de pedido.
 */
export interface OrderColumnMapping {
  codigo: string | null;
  descricao: string | null;
  quantidade: string | null;
  preco: string | null;
  total: string | null;
  observacoes: string | null;
  referenciaPedido: string | null;
}

/**
 * Cabeçalho/metadados do pedido (cliente + fornecedor + transportadora + datas)
 */
export interface PedidoCabecalho {
  // Pedido
  numero?: string;             // "12961"
  dataEmissao?: string;        // "17/04/2026"
  vendedor?: string;
  condicaoPagamento?: string;
  // Fornecedor (Representada)
  fornecedorNome?: string;
  fornecedorCnpj?: string;
  fornecedorTelefone?: string;
  // Cliente
  clienteRazaoSocial?: string;
  clienteNomeFantasia?: string;
  clienteCnpj?: string;
  clienteIE?: string;
  clienteEndereco?: string;
  clienteNumero?: string;
  clienteComplemento?: string;
  clienteBairro?: string;
  clienteCidade?: string;
  clienteUF?: string;
  clienteCEP?: string;
  clienteTelefone?: string;
  clienteTelefone2?: string;
  clienteEmail?: string;
  clienteEmail2?: string;
  clienteContato?: string;
  // Transportadora
  transpNome?: string;
  transpCnpj?: string;
  transpIE?: string;
  transpTelefone?: string;
  // Tabela de preço
  tabelaPreco?: string;
  // Pedido externo
  pedidoExterno?: string;
  // Frete (1 = Emitente / 2 = Destinatário)
  fretePor?: '1' | '2' | '';
  // Observações livres
  informacoesAdicionais?: string;
  valorTotal?: number;
}

/**
 * Resultado completo do processamento de um pedido.
 */
export interface PedidoProcessado {
  bruto: PedidoBruto;
  mapeamento: OrderColumnMapping;
  itens: ItemPedidoNormalizado[];
  cabecalho?: PedidoCabecalho;
  stats: {
    totalItens: number;
    itensOk: number;
    itensIncompletos: number;
    itensErro: number;
  };
  destino: string;
}
