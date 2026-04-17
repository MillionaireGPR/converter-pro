import { SupplierAdapter } from './types';

/**
 * Adapter específico para PETRIN
 * Mapeia corretamente as colunas da planilha:
 * - Referência → código
 * - Descrição → nome/descricao
 * - Valor Venda → preco
 * - Qtd Emb (Físico) → quantidadeCaixa (quantidade por caixa)
 * - Emb → embalagem
 */
export const petrinAdapter: SupplierAdapter = {
  id: 'petrin',
  nome: 'Petrin',
  aliases: ['petrin', 'petrin imports'],

  // Padrões de detecção
  detectionPatterns: [
    /petrin/i,
    /valor\s*venda/i,
    /referencia/i,
    /qtd\s*emb/i,
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
