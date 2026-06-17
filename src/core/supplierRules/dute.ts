import { SupplierAdapter } from './types';

/**
 * Adapter para DUTE (DUTE TOYS) — planilha Excel idêntica à da Petrin.
 * Colunas: Referência (DTY####), Descrição, Qtd Emb (Físico)=ESTOQUE,
 * Emb ("CX/60"), Valor Venda. Abas: linha normal / promocionais / pré-venda.
 *
 * IMPORTANTE: "Qtd Emb (Físico)" é ESTOQUE, NÃO a caixa. A quantidade real da
 * caixa está no "CX/N" da coluna Emb (parseada no extractor) — mesmo padrão
 * validado na Petrin. Por isso o alias de quantidadeCaixa NÃO aponta p/ estoque.
 */
export const duteAdapter: SupplierAdapter = {
  id: 'dute',
  nome: 'Dute Toys',
  aliases: ['dute', 'dute toys', 'dutytoys', 'duty'],

  detectionPatterns: [
    /\bdute\b/i,
    /^DTY\d+/m,           // DTY0872, DTY1324 — assinatura forte
    /valor\s*venda/i,
  ],

  // DTY0872, DTY1324; aceita sufixo -N defensivo
  codigoPattern: /^DTY\d+(-\d+)?$/i,

  fieldAliases: {
    codigo: ['referencia', 'ref', 'codigo', 'cod'],
    descricao: ['descricao', 'desc', 'produto', 'nome'],
    preco: ['valor venda', 'valorvenda', 'preco venda', 'vlr venda', 'venda'],
    precoPromocional: ['valor promocional', 'preco promocional'],
    // estoque NÃO mapeado em quantidadeCaixa; qtd vem do "CX/N" do Emb (extractor)
    quantidadeCaixa: ['quantidade caixa', 'qtd caixa', 'qtdcaixa'],
    embalagem: ['emb', 'embalagem', 'tipo emb'],
    categoria: ['categoria', 'familia', 'setor'],
  },

  precoFormat: 'BR',
  defaultQuantidadeCaixa: 1,
  defaultUnidade: 'UN',

  exclusionRules: [
    { pattern: /^(imagem|foto|pic)$/i, descricao: 'Ignora coluna imagem' },
    { pattern: /^\s*$/, descricao: 'Ignora linhas vazias' },
    { pattern: /total|subtotal|soma/i, descricao: 'Ignora linhas de totais' },
    { pattern: /^refer[eê]ncia$/i, descricao: 'Header repetido' },
  ],
};
