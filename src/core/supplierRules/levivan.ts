import { SupplierAdapter } from './types';

/**
 * Adapter específico para LEVIVAN
 * Mesma estrutura da Petrin - mapeia corretamente as colunas:
 * - Referência → código
 * - Descrição → nome/descricao
 * - Valor Venda → preco
 * - Qtd Emb (Físico) → quantidadeCaixa (quantidade por caixa)
 * - Emb → embalagem
 */
export const levivanAdapter: SupplierAdapter = {
  id: 'levivan',
  nome: 'Levivan',
  aliases: ['levivan', 'levivan vidros', 'levivan casa'],

  // Padrões de detecção
  detectionPatterns: [
    /levivan/i,
    /valor\s*venda/i,
    /referencia/i,
    /qtd\s*emb/i,
    /lv\d{4}/i,  // Padrão de código LV1009, LV1007, etc.
  ],

  // Mapeamento de colunas
  fieldAliases: {
    codigo: ['referencia', 'ref', 'codigo', 'cod'],
    descricao: ['descricao', 'desc', 'produto', 'nome'],
    preco: ['valor venda', 'valorvenda', 'preco venda', 'vlr venda', 'venda'],
    precoPromocional: ['valor promocional', 'preco promocional'],
    quantidadeCaixa: ['qtd emb', 'qt emb', 'quantidade embalagem', 'emb', 'cx'],
    embalagem: ['embalagem', 'tipo emb'],
    categoria: ['categoria', 'familia', 'setor'],
  },

  // Regras de exclusão (ignora cabeçalhos e linhas vazias)
  exclusionRules: [
    { pattern: /^(imagem|foto|pic)$/i, descricao: 'Ignora linhas de imagem/foto' },
    { pattern: /^\s*$/, descricao: 'Ignora linhas vazias' },
    { pattern: /total|subtotal|soma/i, descricao: 'Ignora linhas de totais' },
  ],
};
