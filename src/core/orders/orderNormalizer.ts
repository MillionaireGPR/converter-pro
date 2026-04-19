import { ItemPedidoNormalizado, StatusItemPedido } from './orderTypes';

export interface PedidoTransformado {
  idERP: string;
  cliente: string;
  itens: ItemPedidoTransformado[];
  totalPedido: number;
}

export interface ItemPedidoTransformado {
  codigoSistema: string; // O código convertido que o ERP vai entender
  quantidade: number;
  precoUnitarioAplicado: number;
  totalParcial: number;
  status: StatusItemPedido;
  avisos: string[];
}

/**
 * Placeholder para a lógica futura de transformação de pedidos.
 * Vai pegar um Pedido processado do Mercos e cruzar com a base padronizada 
 * para gerar o output pro sistema destino (Tiny, Bling, etc).
 */
export const transformarPedidoFormatERP = (itens: ItemPedidoNormalizado[]): PedidoTransformado => {
  console.log('[Order Normalizer] Função chamada as placeholder');
  return {
    idERP: '',
    cliente: '',
    itens: [],
    totalPedido: 0
  };
};
