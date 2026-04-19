import { SupplierConfig } from '../types';

export const SUPPLIERS: SupplierConfig[] = [
  {
    id: 'clink',
    name: 'Clink',
    columnAliases: {
      codigo: ['ref', 'referencia', 'codigo', 'cod'],
      nome: ['nome', 'descricao', 'produto'],
      precoBase: ['preco', 'valor', 'custo'],
      ipi: ['ipi'],
      unidade: ['un', 'unidade'],
      quantidadeCaixa: ['qtd_caixa', 'caixa', 'master'],
      categoria: ['categoria', 'familia'],
    },
  },
  {
    id: 'goalKids',
    name: 'Goal Kids',
    columnAliases: {
      codigo: ['ref', 'referencia', 'codigo'],
      nome: ['descricao', 'produto', 'item'],
      precoBase: ['preco', 'valor', 'vlr_unit'],
      ipi: ['ipi'],
      unidade: ['un', 'unidade'],
      quantidadeCaixa: ['qtd_cx', 'embalagem'],
      categoria: ['categoria', 'genero'],
    },
  },
  {
    id: 'tramontina',
    name: 'Tramontina',
    columnAliases: {
      codigo: ['referencia', 'codigo', 'item'],
      nome: ['descricao', 'nome_produto'],
      precoBase: ['preco_venda', 'base'],
      ipi: ['aliq_ipi', 'ipi'],
      unidade: ['unidade_medida', 'un'],
      quantidadeCaixa: ['multiplo', 'caixa'],
      categoria: ['familia', 'linha'],
    },
  },
  {
    id: 'bosch',
    name: 'Bosch',
    columnAliases: {
      codigo: ['part_number', '10_digit', 'referencia'],
      nome: ['descricao', 'description'],
      precoBase: ['net_price', 'preco_liquido'],
      ipi: ['ipi_tax', 'ipi'],
      unidade: ['uom', 'un'],
      quantidadeCaixa: ['moq', 'packing_unit'],
      categoria: ['product_group', 'familia'],
    },
  },
];

export const getSupplierConfig = (idOrName: string): SupplierConfig | undefined => {
  if (!idOrName) return undefined;
  const searchTerm = idOrName.toLowerCase();
  return SUPPLIERS.find((s) => s.id.toLowerCase() === searchTerm || s.name.toLowerCase() === searchTerm);
};
