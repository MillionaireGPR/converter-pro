// ===================================================================
// CATÁLOGO DE CAMPOS MAPEÁVEIS DO MERCOS (20/08/2026)
// ===================================================================
// Reunião com o Josef: a tela de mapeamento só oferecia os campos
// obrigatórios, então fornecedor que traz peso, dimensões, estoque,
// comissão, tamanhos/cores ou várias tabelas de preço não tinha para
// onde mandar esses dados — e o cliente precisava pedir código novo.
//
// Esta tabela é a ÚNICA fonte de verdade: alimenta a tela de regras, a
// conferência do upload e a escrita no export. Campo novo do Mercos =
// uma linha aqui, sem tocar em mais nada.
//
// `coluna` tem que bater LETRA POR LETRA com MERCOS_EXPORT_COLUMNS — é
// o nome do cabeçalho no modelo oficial, e o Mercos rejeita o arquivo
// se divergir. O teste `camposMercos.test.ts` trava isso.
// ===================================================================

import { MERCOS_EXPORT_COLUMNS } from '../types/productPipeline';

export type TipoCampoMercos = 'texto' | 'numero';

export interface CampoMercos {
  /** Chave usada em `suppliers.column_mappings`. */
  campo: string;
  /** Como o campo é chamado para o cliente. */
  rotulo: string;
  /** Coluna exata no modelo Mercos. '' = campo interno, não vai direto pro export. */
  coluna: string;
  tipo: TipoCampoMercos;
  /**
   * true  = o valor vai CRU da planilha para a coluna (passthrough genérico).
   * false = já existe regra de negócio própria montando essa coluna
   *         (nome em maiúsculas, preço com desconto/bloqueio, múltiplo por
   *         fornecedor, EM BREVE...). Mapear continua valendo — muda de onde
   *         o dado é LIDO —, mas quem escreve no export continua sendo a regra.
   */
  passthrough: boolean;
  /** Aparece na conferência do upload mesmo quando não está mapeado. */
  essencial?: boolean;
}

/** Quantas tabelas de preço extra o cliente pode mapear.
 *  O modelo do Mercos vai até #19; era 12 e não havia motivo pro corte. */
export const MAX_TABELAS_PRECO = 19;

/** Chave de mapeamento para a N-ésima tabela de preço (1-based). */
export const precoTabelaKey = (n: number): string => `precoTabela${n}`;

/** Coluna do Mercos para a N-ésima tabela de preço. */
export const precoTabelaColuna = (n: number): string => `Preço de Tabela #${n} (opcional)`;

const C = MERCOS_EXPORT_COLUMNS;
/** Acha a coluna oficial pelo começo do nome — os títulos do Mercos são
 *  frases longas e repetir cada uma aqui só criaria chance de divergir. */
const col = (prefixo: string): string => {
  const achada = C.find(c => c.startsWith(prefixo));
  if (!achada) throw new Error(`[camposMercos] coluna do Mercos não encontrada: "${prefixo}"`);
  return achada;
};

/** Campos com regra de negócio própria — mapear muda a LEITURA, não a escrita. */
const COM_REGRA_PROPRIA: CampoMercos[] = [
  { campo: 'codigo', rotulo: 'Código do produto', coluna: col('Código do produto'), tipo: 'texto', passthrough: false, essencial: true },
  { campo: 'descricao', rotulo: 'Nome / Descrição', coluna: col('Nome do produto'), tipo: 'texto', passthrough: false, essencial: true },
  { campo: 'preco', rotulo: 'Preço de tabela', coluna: col('Preço de Tabela (obrigatório)'), tipo: 'numero', passthrough: false, essencial: true },
  { campo: 'quantidadeCaixa', rotulo: 'Quantidade na caixa', coluna: col('Múltiplo'), tipo: 'numero', passthrough: false, essencial: true },
  { campo: 'ipi', rotulo: 'IPI', coluna: col('IPI'), tipo: 'numero', passthrough: false, essencial: true },
  { campo: 'informacoesAdicionais', rotulo: 'Informações adicionais', coluna: col('Informações adicionais'), tipo: 'texto', passthrough: false },
  // Sem coluna própria no Mercos: alimentam regras internas (desconto,
  // agrupamento, conferência) e por isso continuam mapeáveis.
  { campo: 'precoPromocional', rotulo: 'Preço promocional', coluna: '', tipo: 'numero', passthrough: false, essencial: true },
  { campo: 'codigoBarras', rotulo: 'Código de barras', coluna: '', tipo: 'texto', passthrough: false },
  { campo: 'ncm', rotulo: 'NCM', coluna: '', tipo: 'texto', passthrough: false },
  { campo: 'descricaoComplementar', rotulo: 'Descrição complementar', coluna: '', tipo: 'texto', passthrough: false },
];

/** Campos que o cliente mapeia e vão CRUS da planilha para o export. */
const PASSTHROUGH: CampoMercos[] = [
  { campo: 'precoMinimo', rotulo: 'Preço mínimo', coluna: col('Preço Mínimo'), tipo: 'numero', passthrough: true },
  { campo: 'substituicaoTributaria', rotulo: 'Substituição tributária', coluna: col('Substituição Tributária'), tipo: 'numero', passthrough: true },
  { campo: 'comissao', rotulo: 'Comissão', coluna: col('Comissão'), tipo: 'numero', passthrough: true },
  { campo: 'unidade', rotulo: 'Unidade', coluna: col('Unidade'), tipo: 'texto', passthrough: true, essencial: true },
  { campo: 'estoque', rotulo: 'Quantidade em estoque', coluna: col('Quantidade em estoque'), tipo: 'numero', passthrough: true },
  { campo: 'pesoBruto', rotulo: 'Peso bruto (Kg)', coluna: col('Peso bruto'), tipo: 'numero', passthrough: true },
  { campo: 'tipoPesoDimensoes', rotulo: 'Tipo peso e dimensões', coluna: col('Tipo peso e dimensões'), tipo: 'numero', passthrough: true },
  { campo: 'largura', rotulo: 'Largura da embalagem (cm)', coluna: col('Largura da embalagem'), tipo: 'numero', passthrough: true },
  { campo: 'altura', rotulo: 'Altura da embalagem (cm)', coluna: col('Altura da embalagem'), tipo: 'numero', passthrough: true },
  { campo: 'comprimento', rotulo: 'Comprimento da embalagem (cm)', coluna: col('Comprimento da embalagem'), tipo: 'numero', passthrough: true },
  { campo: 'categoria', rotulo: 'Categoria principal', coluna: col('Categoria principal'), tipo: 'texto', passthrough: true, essencial: true },
  { campo: 'subcategoria2', rotulo: 'Subcategoria nível 2', coluna: col('Subcategoria nível 2'), tipo: 'texto', passthrough: true },
  { campo: 'subcategoria3', rotulo: 'Subcategoria nível 3', coluna: col('Subcategoria nível 3'), tipo: 'texto', passthrough: true },
  { campo: 'ativoInativo', rotulo: 'Ativo / Inativo', coluna: col('Ativo / Inativo'), tipo: 'numero', passthrough: true },
  { campo: 'exibidoEcommerce', rotulo: 'Exibir no e-commerce', coluna: col('Exibido / Não exibido no e-commerce'), tipo: 'numero', passthrough: true },
  { campo: 'tamanhos', rotulo: 'Tamanhos', coluna: col('Tamanhos'), tipo: 'texto', passthrough: true },
  { campo: 'cores', rotulo: 'Cores', coluna: col('Cores'), tipo: 'texto', passthrough: true },
];

/** Tabelas de preço extra #1..#19 (VAESO: V50, V250, V.R., retirada...). */
const TABELAS_PRECO: CampoMercos[] = Array.from({ length: MAX_TABELAS_PRECO }, (_, i) => ({
  campo: precoTabelaKey(i + 1),
  rotulo: `Tabela de preço extra #${i + 1}`,
  coluna: precoTabelaColuna(i + 1),
  tipo: 'numero' as const,
  // Escrita pelo caminho dedicado (`precosTabela`), que preserva buracos de
  // posição — #2 vazio não pode empurrar #3 para o lugar dele.
  passthrough: false,
}));

/** Todos os campos que o cliente pode mapear, na ordem em que aparecem na tela. */
export const CAMPOS_MERCOS: CampoMercos[] = [
  ...COM_REGRA_PROPRIA,
  ...PASSTHROUGH,
  ...TABELAS_PRECO,
];

const PORCAMPO = new Map(CAMPOS_MERCOS.map(c => [c.campo, c]));

export const campoMercos = (campo: string): CampoMercos | undefined => PORCAMPO.get(campo);

/** Campos que vão crus da planilha para o export. */
export const CAMPOS_PASSTHROUGH: CampoMercos[] = CAMPOS_MERCOS.filter(c => c.passthrough);

/** Colunas do Mercos que o passthrough pode preencher. */
export const COLUNAS_PASSTHROUGH: string[] = CAMPOS_PASSTHROUGH.map(c => c.coluna);

/** Campos mostrados na conferência do upload mesmo sem mapeamento. */
export const CAMPOS_ESSENCIAIS: CampoMercos[] = CAMPOS_MERCOS.filter(c => c.essencial);
