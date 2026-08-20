// ===================================================================
// TIPOS DO PIPELINE DE CONVERSÃO DE PRODUTOS
// Fluxo: ProdutoBruto → ProdutoExtraido → ProdutoNormalizado → ProdutoMercos
// ===================================================================

import { ImageExtractionResult } from '../pipeline/imageExtractor';
import { SpatialContext } from '../images/imageTypes';

/** Tipo de arquivo detectado na importação */
export type TipoArquivo = 'xlsx' | 'xls' | 'csv' | 'pdf';

/** Classificação do tipo de PDF para escolha de estratégia de parsing */
export type TipoPDF =
  | 'pdf-texto'        // PDF com texto extraível nativo
  | 'pdf-tabela'       // PDF com tabelas estruturadas
  | 'pdf-blocos'       // PDF com blocos de produto (catálogo)
  | 'pdf-grade'        // PDF catálogo em grade visual
  | 'pdf-misto'        // PDF com mistura de formatos
  | 'pdf-imagem';      // PDF escaneado / baixa extração

/** Estratégia de parser usada na leitura */
export type ParserStrategy =
  | 'xlsx-direto'      // Leitura direta de Excel/CSV via lib xlsx
  | 'pdf-textual'      // Extração de texto nativo do PDF
  | 'pdf-tabular'      // Parser de tabelas do PDF
  | 'pdf-blocos'       // Parser por blocos de produto
  | 'pdf-ai-first'     // v23: Gemini Vision lê o catálogo inteiro (primário)
  | 'ocr-fallback';    // OCR como último recurso

/** Metadados coletados durante a leitura do arquivo */
export interface ImportMetadata {
  tipoArquivo: TipoArquivo;
  tipoPDF?: TipoPDF;
  parserUsado: ParserStrategy;
  totalPaginas?: number;
  paginasComDados?: number[];
  confiancaExtracao: number;          // 0 a 100
  fornecedorDetectado?: string;
  fornecedorConfirmado?: string;
  camposDetectados: string[];
  tempoProcessamentoMs?: number;
}

/** Score de qualidade por página de PDF */
export interface PdfPageScore {
  pagina: number;
  hasText: boolean;
  hasPricePattern: boolean;
  hasCodePattern: boolean;
  hasProductBlockPattern: boolean;
  extractionConfidence: number;       // 0 a 100
  usouOCR: boolean;
}

// ===================================================================
// ESTÁGIOS DO PRODUTO
// ===================================================================

/**
 * ESTÁGIO 1: ProdutoBruto
 * Dados crus extraídos diretamente do arquivo, sem nenhuma limpeza.
 * Representa uma linha/bloco exatamente como veio.
 */
export interface ProdutoBruto {
  /** Campos brutos como chave/valor sem tratamento */
  campos: Record<string, any>;
  /** Índice da linha ou bloco no arquivo original */
  linhaOrigem: number;
  /** Página de origem (para PDFs) */
  paginaOrigem?: number;
  /** Texto bruto do bloco (para PDFs por bloco) */
  textoBruto?: string;
  /** Contexto espacial do produto no PDF (coordenadas x, y, página) */
  spatialContext?: SpatialContext;
}

/**
 * ESTÁGIO 2: ProdutoExtraido
 * Campos já foram identificados e atribuídos, mas ainda sem normalização.
 * O adapter do fornecedor é responsável por esta transformação.
 */
export interface ProdutoExtraido {
  fornecedor: string;
  codigo?: string;
  codigoBarras?: string;
  codigoInterno?: string;
  descricao?: string;
  descricaoComplementar?: string;
  categoria?: string;
  preco?: number;
  precoPromocional?: number;
  /** Tabelas de preço EXTRA do fornecedor (além do preço principal).
   *  Ex. VAESO: V50 (tabela 50%), V250 (25%), V.R. (retira no depósito).
   *  Índice 0 → "Preço de Tabela #1 (opcional)" no export Mercos, e assim
   *  por diante. Preenchido via mapeamento de colunas do fornecedor. */
  precosTabela?: (number | null)[];
  /** Campos do Mercos que o cliente mapeou e que vão CRUS da planilha para a
   *  coluna correspondente do export (peso, dimensões, estoque, comissão,
   *  tamanhos, cores...). Chave = `campo` de CAMPOS_MERCOS. Existe para que
   *  um campo novo do Mercos seja uma linha de tabela, e não uma alteração em
   *  cada etapa do pipeline. */
  camposMercos?: Record<string, string | number>;
  unidade?: string;
  quantidadeCaixa?: number;
  embalagem?: string;
  ncm?: string;
  ipi?: number;
  dimensoes?: string;
  material?: string;
  cor?: string;
  volume?: string;
  observacoes?: string;
  statusEstoque?: 'disponivel' | 'esgotado' | 'pronta-entrega' | 'reposicao' | 'previsao';
  origemArquivo: string;
  paginaOrigem?: number;
  linhaOrigem: number;
  confiancaExtracao: number;          // 0 a 100
  erros: string[];
  warnings: string[];
  spatialContext?: SpatialContext;    // NOVO: Posição do texto do SKU no arquivo
}

/**
 * ESTÁGIO 3: ProdutoNormalizadoV2
 * Produto completamente limpo, validado e pronto para transformação final.
 * Este tipo estende o ProdutoNormalizado original para compatibilidade.
 */
export interface ProdutoNormalizadoV2 {
  fornecedor: string;
  fornecedorId?: string;
  codigo: string;
  codigoOriginal: string;
  codigoBarras?: string;
  codigoInterno?: string;
  nome: string;
  descricaoComplementar?: string;
  categoria?: string;
  precoBase: number;
  precoPromocional?: number;
  /** Tabelas de preço extra — ver ProdutoExtraido.precosTabela. */
  precosTabela?: (number | null)[];
  /** Campos mapeados pelo cliente — ver ProdutoExtraido.camposMercos. */
  camposMercos?: Record<string, string | number>;
  descontoPercentual?: number;
  descontoString?: string;
  precoFinal: number;
  ipi?: number;
  ncm?: string;
  unidade: string;
  quantidadeCaixa: number;
  embalagem?: string;
  dimensoes?: string;
  material?: string;
  cor?: string;
  volume?: string;
  observacoes?: string;
  statusEstoque?: string;
  status: 'validado' | 'pendente' | 'erro';
  erros: string[];
  warnings: string[];
  imagemUrl?: string;
  temImagem?: boolean;
  origemArquivo?: string;
  paginaOrigem?: number;
  linhaOrigem?: number;
  confiancaExtracao?: number;
  // Campos visuais
  visualCategory?: string;      // Categoria predominante (para regras de desconto)
  visualTags?: string[];        // Todas as categorias detectadas (para filtros e sufixos)
  isPromotional?: boolean;
  isFixedPrice?: boolean;
  bloqueiaDesconto?: boolean;
  informacoesAdicionais?: string;
  spatialContext?: SpatialContext;    // NOVO: Coordenadas consolidadas
}

/**
 * ESTÁGIO 4: ProdutoMercos
 * Formato final EXATO do arquivo modelo de importação do Mercos (A até AP).
 * Nesta fase, somente 5 colunas são preenchidas e todas as demais ficam vazias.
 */
export type ProdutoMercos = Record<string, string | number>;

/** Nomes e ordem fixa das colunas no modelo oficial do Mercos (A → AP) */
export const MERCOS_EXPORT_COLUMNS = [
  'Código do produto (recomendado)',
  'Nome do produto (obrigatório)',
  'Preço de Tabela (obrigatório)',
  'Preço Mínimo (opcional)',
  'IPI (opcional - não informar o símbolo %)',
  'Substituição Tributária (opcional - não informar o símbolo %)',
  'Comissão (opcional - não informar o símbolo %)',
  'Informações adicionais (opcional - neste campo coloca-se qualquer detalhe extra do produto. Não aparece no pedido)',
  'Unidade (opcional – exemplo: Kg para produtos em quilo, Cx para caixas)',
  'Quantidade em estoque (opcional - preencha com um número maior ou igual a 0)',
  'Múltiplo (opcional)',
  'Peso bruto (em Kg) (até três casas decimais)',
  'Tipo peso e dimensões (opcional - preencha 1 se as colunas Largura, Altura e Comprimento à direita se referirem à caixa master)',
  'Largura da embalagem (em centímetros, com até 5 casas decimais - obrigatório se as colunas Altura e Comprimento também estiverem preenchidas)',
  'Altura da embalagem (em centímetros, com até 5 casas decimais - obrigatório se as colunas Largura e Comprimento também estiverem preenchidas)',
  'Comprimento da embalagem (em centímetros, com até 5 casas decimais - obrigatório se as colunas Largura e Altura também estiverem preenchidas)',
  'Categoria principal (opcional - Máximo 50 caracteres)',
  'Subcategoria nível 2 (opcional - Máximo 50 caracteres)',
  'Subcategoria nível 3 (opcional - Máximo 50 caracteres)',
  'Ativo / Inativo (opcional - preencha 0 para tornar o produto ativo ou 1 para tornar o produto inativo. Deixando vazio, o novo produto ficará ativo e numa alteração manterá o estado cadastrado no sistema)',
  'Exibido / Não exibido no e-commerce (opcional - preencha 0 para passar a exibir ou 1 para ocultar o produto do e-commerce B2B. Deixando vazio, o novo produto será exibido e numa alteração manterá o estado cadastrado no sistema)',
  'Tamanhos (opcional - tamanhos separados por ponto e vírgula)',
  'Cores (opcional - cores separadas por ponto e vírgula)',
  'Preço de Tabela #1 (opcional)',
  'Preço de Tabela #2 (opcional)',
  'Preço de Tabela #3 (opcional)',
  'Preço de Tabela #4 (opcional)',
  'Preço de Tabela #5 (opcional)',
  'Preço de Tabela #6 (opcional)',
  'Preço de Tabela #7 (opcional)',
  'Preço de Tabela #8 (opcional)',
  'Preço de Tabela #9 (opcional)',
  'Preço de Tabela #10 (opcional)',
  'Preço de Tabela #11 (opcional)',
  'Preço de Tabela #12 (opcional)',
  'Preço de Tabela #13 (opcional)',
  'Preço de Tabela #14 (opcional)',
  'Preço de Tabela #15 (opcional)',
  'Preço de Tabela #16 (opcional)',
  'Preço de Tabela #17 (opcional)',
  'Preço de Tabela #18 (opcional)',
  'Preço de Tabela #19 (opcional)',
] as const;

/**
 * Colunas que podem sair preenchidas no export.
 *
 * Até 19/08 era uma lista curta ("nesta etapa só preenchemos estas"), porque
 * só o sistema decidia o que escrever. Depois da reunião com o Josef
 * (20/08/2026) o cliente mapeia QUALQUER campo do modelo oficial — peso,
 * dimensões, estoque, comissão, tamanhos, cores, as 19 tabelas de preço —, e
 * uma lista curta passaria a reprovar exatamente o que ele configurou.
 *
 * A trava contra coluna inventada continua existindo, e é mais forte: a linha
 * nasce de MERCOS_EXPORT_COLUMNS em `createEmptyMercosRow`, então nenhuma
 * chave fora do modelo chega ao arquivo. Coluna não mapeada segue vazia.
 */
export const MERCOS_ALLOWED_FILLED_COLUMNS = MERCOS_EXPORT_COLUMNS;

/** Schema de validação da exportação Mercos */
export const MERCOS_EXPORT_SCHEMA = {
  columns: MERCOS_EXPORT_COLUMNS,
  allowedFilledColumns: MERCOS_ALLOWED_FILLED_COLUMNS,
  requiredFilled: [
    'Código do produto (recomendado)',
    'Nome do produto (obrigatório)',
    'Preço de Tabela (obrigatório)',
  ] as const,
  numericFilled: [
    'Preço de Tabela (obrigatório)',
    'IPI (opcional - não informar o símbolo %)',
  ] as const,
} as const;

// ===================================================================
// RESULTADO DO PIPELINE
// ===================================================================

export interface PipelineResult {
  metadata: ImportMetadata;
  produtosBrutos: ProdutoBruto[];
  produtosExtraidos: ProdutoExtraido[];
  produtosNormalizados: ProdutoNormalizadoV2[];
  imagens?: ImageExtractionResult[];
  stats: {
    total: number;
    validos: number;
    comErro: number;
    comWarning: number;
    duplicados: number;
  };
  inconsistencias: Inconsistencia[];
  /** Warnings gerais sobre a importação (ex: desalinhamento de linhas) */
  warnings?: string[];
}

export interface Inconsistencia {
  tipo: 'sem-codigo' | 'sem-descricao' | 'sem-preco' | 'codigo-duplicado' |
        'preco-invalido' | 'caixa-invalida' | 'campos-misturados' |
        'descricao-curta' | 'descricao-lixo';
  mensagem: string;
  linha?: number;
  pagina?: number;
  produto?: string;
}
