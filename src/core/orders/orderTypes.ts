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
 * Resultado completo do processamento de um pedido.
 */
export interface PedidoProcessado {
  bruto: PedidoBruto;
  mapeamento: OrderColumnMapping;
  itens: ItemPedidoNormalizado[];
  stats: {
    totalItens: number;
    itensOk: number;
    itensIncompletos: number;
    itensErro: number;
  };
  destino: string;
}
