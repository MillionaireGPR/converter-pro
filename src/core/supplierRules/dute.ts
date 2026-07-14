import { SupplierAdapter } from './types';

/**
 * Adapter para DUTE (DUTE TOYS) — planilha Excel idêntica à da Petrin.
 * Formatos conhecidos:
 *   - DTY#### (antigo): Referência | Descrição | Qtd Emb (Físico)=ESTOQUE | Emb | Valor Venda
 *   - DT10#### (novo 2026): Imagem | Código | Descrição | Estoque | Emb | Preço | Total
 *
 * IMPORTANTE: "Qtd Emb (Físico)" / "Estoque" é ESTOQUE, NÃO a caixa. A quantidade
 * real da caixa está no "CX/N" da coluna Emb (parseada no extractor) — mesmo
 * padrão validado na Petrin. O alias de quantidadeCaixa NÃO aponta p/ estoque.
 */
export const duteAdapter: SupplierAdapter = {
  id: 'dute',
  nome: 'Dute Toys',
  aliases: ['dute', 'dute toys', 'dutytoys', 'duty'],

  detectionPatterns: [
    /\bdute\b/i,
    /^DTY\d+/m,           // DTY0872, DTY1324 — formato antigo
    /^DT1\d{4,}/m,        // DT10132, DT10191 — formato novo 2026
    /valor\s*venda/i,
  ],

  // DTY#### (antigo) e DT1#### (novo, 5+ dígitos começando com 1)
  codigoPattern: /^(?:DTY\d+|DT[1-9]\d{3,})(-\d+)?$/i,

  fieldAliases: {
    codigo: ['referencia', 'ref', 'codigo', 'cod'],
    descricao: ['descricao', 'desc', 'produto', 'nome'],
    // Formato antigo: "Valor Venda". Formato novo DT10####: "Preço", "Valor".
    // Aliases genéricos (preco, valor) ficam por último para evitar falsos positivos.
    preco: [
      'valor venda', 'valorvenda', 'preco venda', 'vlr venda', 'venda',
      'preco', 'preço', 'valor', 'preco unit', 'precounit', 'valor unit', 'valorunit',
    ],
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
