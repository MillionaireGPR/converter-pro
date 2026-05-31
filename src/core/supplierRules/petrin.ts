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

  // Padrões de detecção (mais específicos: prefixo RD é assinatura única)
  detectionPatterns: [
    /petrin/i,
    /^RD\.?\d+/m,        // RD1318, RD.1120 — assinatura forte
    /valor\s*venda/i,
    /qtd\s*emb\s*\(?\s*fisico/i, // header completo "Qtd Emb (Físico)"
  ],

  // codigoPattern cobre RD1318, RD.1120 (com ponto), RD1098-1 (com sufixo)
  codigoPattern: /^RD\.?\d+(-\d+)?$/i,

  // Mapeamento de colunas — alias 'qtd emb fisico' adicionado para o header
  // literal "Qtd Emb (Físico)" da planilha real. 'emb' adicionado em embalagem.
  fieldAliases: {
    codigo: ['referencia', 'ref', 'codigo', 'cod'],
    descricao: ['descricao', 'desc', 'produto', 'nome'],
    preco: ['valor venda', 'valorvenda', 'preco venda', 'vlr venda', 'venda'],
    precoPromocional: ['valor promocional', 'preco promocional'],
    // Ordem importa: 'qtd emb fisico' é mais específico, vem antes do alias
    // genérico 'emb' (que está em embalagem). Engine resolve por inclusão.
    quantidadeCaixa: ['qtd emb fisico', 'qtdembfisico', 'qtd emb (fisico)', 'qtd emb', 'qt emb', 'quantidade embalagem', 'cx'],
    embalagem: ['embalagem', 'tipo emb', 'emb'],
    categoria: ['categoria', 'familia', 'setor'],
  },

  // Regras de exclusão (ignora cabeçalhos e linhas vazias)
  exclusionRules: [
    { pattern: /^(imagem|foto|pic)$/i, descricao: 'Ignora coluna imagem' },
    { pattern: /^\s*$/, descricao: 'Ignora linhas vazias' },
    { pattern: /total|subtotal|soma/i, descricao: 'Ignora linhas de totais' },
    // Header "Referência" se aparecer duplicado em outras sheets
    { pattern: /^refer[eê]ncia$/i, descricao: 'Header repetido' },
  ],
};
