// ===================================================================
// INTERFACE BASE PARA SUPPLIER ADAPTERS
// Cada fornecedor implementa um adapter que sabe como extrair
// produtos a partir dos dados brutos do seu formato específico.
// ===================================================================

import { ProdutoBruto, ProdutoExtraido } from '../types/productPipeline';

/** Regra de exclusão: linhas/blocos que batem com esses padrões são ignorados */
export interface ExclusionRule {
  /** Campo ou texto a verificar */
  campo?: string;
  /** Padrão regex para identificar ruído */
  pattern: RegExp;
  /** Descrição da regra (para debug) */
  descricao: string;
}

/** Alias de campo: mapeia nome padrão → possíveis nomes encontrados no arquivo */
export interface FieldAliases {
  codigo: string[];
  codigoBarras?: string[];
  codigoInterno?: string[];
  descricao: string[];
  descricaoComplementar?: string[];
  preco: string[];
  precoPromocional?: string[];
  unidade?: string[];
  quantidadeCaixa: string[];
  embalagem?: string[];
  categoria?: string[];
  ncm?: string[];
  ipi?: string[];
  dimensoes?: string[];
  material?: string[];
  cor?: string[];
  volume?: string[];
  observacoes?: string[];
}

/** Configuração completa de um supplier adapter */
export interface SupplierAdapter {
  /** ID único do adapter (slug) */
  id: string;
  /** Nome de exibição do fornecedor */
  nome: string;
  /** Aliases alternativos para detecção automática */
  aliases: string[];

  /** Aliases de campo para mapeamento de colunas */
  fieldAliases: FieldAliases;

  /** Padrão de código esperado (regex). Ex: /^NX\d{3}$/ */
  codigoPattern?: RegExp;

  /** Padrão de preço. Ex: 'BR' para R$ 1.234,56 */
  precoFormat?: 'BR' | 'US';

  /** Regra padrão de quantidade por caixa (se não encontrar no arquivo) */
  defaultQuantidadeCaixa?: number;

  /** Regra padrão de unidade (se não encontrar no arquivo) */
  defaultUnidade?: string;

  /** Regras de exclusão de ruído */
  exclusionRules: ExclusionRule[];

  /** Prioridade entre campos quando houver conflito */
  fieldPriority?: Record<string, string[]>;

  /**
   * Função de extração customizada.
   * Transforma produtos brutos em produtos extraídos usando as regras
   * específicas deste fornecedor.
   * Se não fornecida, o pipeline usa o extrator genérico.
   */
  extract?: (brutos: ProdutoBruto[], adapter: SupplierAdapter) => ProdutoExtraido[];

  /**
   * Padrões textuais para detecção automática do fornecedor.
   * Palavras-chave ou regex que, se encontradas no documento,
   * indicam que este adapter deve ser usado.
   */
  detectionPatterns: (string | RegExp)[];

  /**
   * Para PDFs: regra de quebra de bloco por produto.
   * Define como separar um bloco contínuo de texto em produtos individuais.
   */
  blockSeparator?: RegExp;

  /** Se o fornecedor tem múltiplas tabelas de preço (ex: Clink especial/final) */
  hasMultiplePriceTables?: boolean;

  /** Labels das tabelas de preço, se houver múltiplas */
  priceTableLabels?: string[];
}

/** Resultado da detecção automática de fornecedor */
export interface SupplierDetectionResult {
  adapter: SupplierAdapter;
  confianca: number;       // 0 a 100
  metodo: 'nome' | 'padrao-visual' | 'prefixo-codigo' | 'estrutura' | 'manual';
  evidencias: string[];
}
