import { ProdutoNormalizado } from '../types';

/**
 * Valida um produto normalizado e atualiza seu status e lista de erros.
 */
export const validarProduto = (produto: ProdutoNormalizado): ProdutoNormalizado => {
  const novosErros: string[] = [];

  if (!produto.codigo || produto.codigo === '') {
    novosErros.push('Código do produto não encontrado ou vazio.');
  }

  if (!produto.nome || produto.nome === '') {
    novosErros.push('Nome do produto não encontrado ou vazio.');
  }

  if (produto.precoBase <= 0) {
    novosErros.push('Preço base deve ser maior que zero.');
  }

  // Se houver erros, status é 'erro'. 
  // Se não houver erros mas faltar alguma informação não crítica (ex: categoria), poderia ser 'pendente'.
  // Por enquanto, se passar nessas 3, consideraremos 'validado'.
  
  if (novosErros.length > 0) {
    return {
      ...produto,
      status: 'erro',
      erros: [...produto.erros, ...novosErros],
    };
  }

  return {
    ...produto,
    status: 'validado',
    erros: [],
  };
};

/**
 * Valida uma lista de produtos.
 */
export const validarProdutos = (produtos: ProdutoNormalizado[]): ProdutoNormalizado[] => {
  return produtos.map(validarProduto);
};
