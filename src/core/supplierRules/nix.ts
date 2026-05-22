// ===================================================================
// ADAPTER: NIX HOUSE / NIX GLASS
// Padrão: Planilha Excel com colunas específicas:
//   - Referencia (código/SKU)
//   - Descricao (nome do produto)
//   - Inativo (status - filtrar se verdadeiro)
//   - GRUPO/SUBGRUPO/LINHA (categorias)
//   - PRECO (preço base)
//   - Valor Promocional (prioridade sobre PRECO)
//   - PCS/CX (quantidade por caixa → informações adicionais)
//   - IPI (percentual sem %)
//   - NCM, CEST, EANs, DUN-14, Códigos internos
// ===================================================================

import { SupplierAdapter } from './types';
import { ProdutoBruto, ProdutoExtraido } from '../types/productPipeline';
import { extractPrice, cleanDescription, normalizeSpaces } from '../normalizers/cleaners';

// UUID dummy válido para o banco
const NIX_ADAPTER_ID = 'nix-house-0000-4000-a000-000000000000';

/**
 * Normaliza um header para comparação (remove acentos, espaços, pontuação)
 */
const norm = (s: string): string => {
  if (!s) return '';
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
};

/**
 * Busca o valor de um campo em um objeto bruto usando aliases.
 * Retorna o primeiro match encontrado.
 */
const findValue = (campos: Record<string, any>, aliases: string[]): any => {
  const keys = Object.keys(campos);
  for (const alias of aliases) {
    const normalizedAlias = norm(alias);
    const foundKey = keys.find(k => norm(k) === normalizedAlias);
    if (foundKey !== undefined && campos[foundKey] !== undefined && campos[foundKey] !== '') {
      return campos[foundKey];
    }
  }
  return undefined;
};

/**
 * Converte valor para string limpa
 */
const toStr = (val: any): string => {
  if (val === null || val === undefined) return '';
  return normalizeSpaces(String(val));
};

/**
 * Converte valor para número (trata formatos BR e US)
 */
const toNum = (val: any): number => {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return val;
  return extractPrice(String(val));
};

/**
 * Busca valor em campos usando nomes exatos das colunas (case-insensitive)
 * Útil para planilhas com nomes específicos como 'REFERÊNCIA', 'DESCRIÇÃO', etc.
 */
const getNixValue = (campos: Record<string, any>, possibleNames: string[]): any => {
  const keys = Object.keys(campos);
  for (const name of possibleNames) {
    // Busca case-insensitive
    const foundKey = keys.find(k => k.toLowerCase().trim() === name.toLowerCase().trim());
    if (foundKey !== undefined && campos[foundKey] !== undefined && campos[foundKey] !== '') {
      return campos[foundKey];
    }
  }
  return undefined;
};

/**
 * Verifica se o produto está inativo
 */
const isInativo = (campos: Record<string, any>): boolean => {
  // Usa getNixValue para buscar com nomes exatos
  const inativoVal = getNixValue(campos, ['inativo', 'status', 'ativo', 'situação', 'situacao', 'PROMOÇÃO?', 'PROMOCAO?']);
  if (!inativoVal) return false;
  
  const strVal = String(inativoVal).toLowerCase().trim();
  // Considera inativo: "sim", "true", "1", "yes", "inativo", "x"
  return ['sim', 'true', '1', 'yes', 'inativo', 'x'].includes(strVal);
};

/**
 * Extrai IPI limpo (sem símbolo %)
 * Se o valor vier em decimal (ex: 0.065), converte para percentual (6.5)
 * Nome exato na planilha: IPI
 */
const extractIPI = (campos: Record<string, any>): number => {
  // Busca com nome exato primeiro
  const ipiVal = getNixValue(campos, ['IPI', 'ipi', 'PERCIPI', 'ALIQUOTAIPI']);
  if (!ipiVal) return 0;
  
  let strVal = String(ipiVal).trim();
  // Remove símbolo % se existir
  strVal = strVal.replace(/%/g, '');
  // Troca vírgula por ponto para parse
  strVal = strVal.replace(',', '.');
  
  let num = parseFloat(strVal);
  if (isNaN(num)) return 0;
  
  // Se o valor é decimal (menor que 1), converte para percentual
  // Ex: 0.065 → 6.5, 0.12 → 12
  if (num > 0 && num < 1) {
    num = num * 100;
  }
  
  return num;
};

/**
 * Extrai quantidade por caixa (PCS/CX)
 * Nome exato na planilha: PCS/CX
 */
const extractQtdCaixa = (campos: Record<string, any>): number => {
  // Tenta nomes exatos primeiro
  const qtdVal = getNixValue(campos, ['PCS/CX', 'pcs/cx', 'PCSCX', 'pcscx', 'QTD CAIXA', 'qtd caixa']);
  if (qtdVal) {
    const num = toNum(qtdVal);
    return num > 0 ? num : 1;
  }
  
  // Fallback para findValue
  const qtdValFallback = findValue(campos, [
    'pccx', 'pçs/cx', 'pecascaixa', 'qtdcaixa', 
    'qtcaixa', 'quantidadecaixa', 'cx', 'caixa'
  ]);
  if (!qtdValFallback) return 1;
  
  const num = toNum(qtdValFallback);
  return num > 0 ? num : 1;
};

/**
 * Formata informações adicionais no padrão Nix House
 * "Cx c/ {PCS/CX} unidades"
 */
const formatInformacoesAdicionais = (qtdCaixa: number, campos: Record<string, any>): string => {
  if (qtdCaixa <= 1) return '';
  return `Cx c/ ${Math.round(qtdCaixa)} unidades`;
};

/**
 * Função customizada de extração para Nix House
 * Aplica todas as regras de negócio específicas
 */
const extractNixProducts = (
  brutos: ProdutoBruto[],
  adapter: SupplierAdapter
): ProdutoExtraido[] => {
  const produtos: ProdutoExtraido[] = [];
  const fa = adapter.fieldAliases;

  for (const bruto of brutos) {
    const campos = bruto.campos;

    // REGRA 4: Se Inativo = verdadeiro → IGNORAR produto
    if (isInativo(campos)) {
      continue;
    }

    // PRÉ-FILTRO: rejeitar brutos sem código E sem descrição reconhecíveis.
    // Quando vindo do PDF parser, blocos espúrios (rodapés/cabeçalhos/quebras)
    // criavam ~172 "produtos com erro" que poluíam o resultado final.
    const codigoPreliminar = toStr(getNixValue(campos, [
      'REFERÊNCIA', 'referência', 'referencia', 'ref', 'codigo', 'código', 'cod'
    ]));
    if (!codigoPreliminar) {
      // tentativa via fallback do bruto.textoBruto (PDF parser preenche)
      const textoBruto = (bruto as any).textoBruto || '';
      const m = String(textoBruto).match(/\bNX\d{2,6}\b/i);
      if (!m) {
        continue; // SEM código NX → não é produto, descarta silenciosamente
      }
    }

    const erros: string[] = [];
    const warnings: string[] = [];

    // Extrai código (Referencia) usando nomes exatos da planilha
    const codigo = toStr(getNixValue(campos, ['REFERÊNCIA', 'referência', 'referencia', 'ref', 'codigo', 'código', 'cod']));
    
    // Extrai descrição usando nomes exatos da planilha
    let descricao = toStr(getNixValue(campos, ['DESCRIÇÃO', 'descrição', 'descricao', 'desc', 'nome', 'produto']));
    descricao = cleanDescription(descricao);

    // REGRA 1: Prioridade de Preço
    // Nomes exatos na planilha: 'PREÇO CATALOGO', 'PREÇO DA PROMOÇÃO'
    let preco = 0;
    
    // Busca preço promocional primeiro (prioridade)
    const precoPromocionalVal = getNixValue(campos, ['PREÇO DA PROMOÇÃO', 'PREÇO DA PROMOCAO', 'preco da promocao', 'preco promocional', 'valorpromocional']);
    const precoPromocional = toNum(precoPromocionalVal);
    
    // Busca preço base/catalogo
    const precoBaseVal = getNixValue(campos, ['PREÇO CATALOGO', 'PREÇO CATÁLOGO', 'PRECO CATALOGO', 'preco catalogo', 'preco']);
    const precoBase = toNum(precoBaseVal);
    
    console.log('[NIX DEBUG] Preço Promocional:', precoPromocionalVal, '→', precoPromocional);
    console.log('[NIX DEBUG] Preço Base:', precoBaseVal, '→', precoBase);
    
    if (precoPromocional > 0) {
      preco = precoPromocional;
      warnings.push(`Usando preço promocional: R$ ${preco.toFixed(2)}`);
    } else if (precoBase > 0) {
      preco = precoBase;
    } else {
      // Tentativa 1: procurar em todas as chaves por valor numérico que pareça preço
      for (const [key, value] of Object.entries(campos)) {
        const keyNorm = norm(key);
        if (keyNorm.includes('prec') || keyNorm.includes('valor') || keyNorm.includes('vlr')) {
          const valNum = toNum(value);
          if (valNum > 0) {
            preco = valNum;
            warnings.push(`Preço encontrado no campo ${key}: R$ ${preco.toFixed(2)}`);
            break;
          }
        }
      }

      // Tentativa 2 (PDF): scan no textoBruto exigindo CONTEXTO de preço.
      // Aceita APENAS números que tenham 'R$' antes OU 'unid'/'un' depois,
      // evitando casar com NCM (8211.92.10 viraria preço de R$ 8211).
      if (preco <= 0) {
        const textoBruto = String((bruto as any).textoBruto || '');
        // (grupo 1) R$ prefix  OR  (grupo 2) seguido de "unid"/"un"
        const re = /R\s*\$\s*(\d{1,4}(?:\.\d{3})*[.,]\d{2})|(\d{1,4}(?:\.\d{3})*[.,]\d{2})\s*\/?\s*(?:unid|UNID|un\b|UN\b)/g;
        let match;
        while ((match = re.exec(textoBruto)) !== null) {
          const raw = (match[1] || match[2]).replace(/\./g, '').replace(',', '.');
          const num = parseFloat(raw);
          if (!isNaN(num) && num >= 0.10 && num <= 9999.99) {
            preco = num;
            warnings.push(`Preço extraido do texto: R$ ${preco.toFixed(2)}`);
            break;
          }
        }
      }
    }

    // Extrai categoria e subcategorias
    const categoria = toStr(findValue(campos, ['grupo', 'categoria']));
    const subgrupo = toStr(findValue(campos, ['subgrupo']));
    const linha = toStr(findValue(campos, ['linha', 'linha']));

    // REGRA 2: Informações adicionais formatadas
    const qtdCaixa = extractQtdCaixa(campos);
    const observacoes = formatInformacoesAdicionais(qtdCaixa, campos);

    // REGRA 3: IPI limpo sem %
    const ipi = extractIPI(campos);

    // Extrai NCM usando nome exato
    const ncm = toStr(getNixValue(campos, ['NCM', 'ncm']));

    // Extrai código de barras usando nome exato
    const codigoBarras = toStr(getNixValue(campos, ['COD. BARRAS', 'COD.BARRAS', 'codbarras']));
    const codigoInterno = toStr(getNixValue(campos, ['DUN 14', 'DUN14', 'dun 14']));
    
    // Define unidade padrão
    const unidade = 'UN';

    // Validações
    if (!codigo) erros.push('Código (Referencia) não encontrado');
    if (!descricao) erros.push('Descrição não encontrada');
    if (preco <= 0) erros.push('Preço não encontrado ou inválido');

    // Calcula confiança
    let confianca = 100;
    if (!codigo) confianca -= 30;
    if (!descricao) confianca -= 30;
    if (preco <= 0) confianca -= 20;
    if (warnings.length > 0) confianca -= warnings.length * 5;
    confianca = Math.max(0, confianca);

    produtos.push({
      fornecedor: adapter.nome,
      codigo,
      codigoBarras: codigoBarras || codigoInterno,
      codigoInterno: codigoInterno || codigo,
      descricao,
      descricaoComplementar: subgrupo || linha || '',
      categoria: categoria || linha || '',
      preco,
      precoPromocional: precoPromocional > 0 ? precoPromocional : undefined,
      unidade,
      quantidadeCaixa: qtdCaixa,
      embalagem: '',
      ncm,
      ipi,
      dimensoes: '',
      material: '',
      cor: '',
      volume: '',
      observacoes,
      statusEstoque: 'disponivel',
      origemArquivo: 'Planilha Nix House',
      paginaOrigem: bruto.paginaOrigem,
      linhaOrigem: bruto.linhaOrigem,
      confiancaExtracao: confianca,
      erros,
      warnings,
    });
  }

  return produtos;
};

export const nixAdapter: SupplierAdapter = {
  id: NIX_ADAPTER_ID,
  nome: 'Nix House',
  aliases: ['nix', 'nixhouse', 'nix house', 'nixglass', 'nix glass', 'nix glass house'],

  fieldAliases: {
    // Coluna A: Referencia → Código do produto (SKU principal)
    // Nomes reais na planilha: REFERÊNCIA
    codigo: [
      'referencia', 'ref', 'codigo', 'cod', 'sku', 'item', 'codigoproduto',
      'código', 'cód', 'cod. produto', 'cod.produto', 'referência', 'referÊncia',
      'referencia', 'ref.', 'cód. produto'
    ],
    
    // Coluna B: Descricao → Nome completo do produto
    // Nomes reais na planilha: DESCRIÇÃO
    descricao: [
      'descricao', 'desc', 'nome', 'produto', 'nomproduto', 'description',
      'descrição', 'descriÇÃo', 'nomeproduto', 'nome produto', 'descrição produto',
      'descr.', 'desc.'
    ],
    
    // Colunas de código de barras
    // Nome real na planilha: COD. BARRAS
    codigoBarras: ['ean13unitario', 'eanunitario', 'ean13', 'ean', 'codbarras', 'cdebarras', 'cod barras', 'cod. barras'],
    codigoInterno: ['codbarrasistemafutura', 'codinterno', 'codigosistema', 'codfutura', 'cod interno'],
    
    // Preços - REGRA 1: PREÇO DA PROMOÇÃO tem prioridade sobre PREÇO CATALOGO
    // Nomes reais na planilha: PREÇO CATALOGO, PREÇO DA PROMOÇÃO
    preco: [
      'preco', 'precobase', 'valor', 'vlr', 'tabela', 'preço', 'preçobase',
      'preco base', 'preço base', 'preco tabela', 'preço tabela', 'p. venda',
      'pvenda', 'p.venda', 'preco venda', 'preço venda', 'valor venda',
      'preÇo catalogo', 'preço catalogo', 'preço catálogo', 'preco catalogo',
      'p. catalogo', 'p.catalogo', 'catalogo', 'catálogo'
    ],
    precoPromocional: [
      'valorpromocional', 'promocional', 'valorpromo', 'precopromo',
      'promoção', 'promocao', 'valor promocional', 'preco promocional',
      'preço promocional', 'p. promocional', 'p.promocional', 'promo',
      'preÇo da promoÇÃo', 'preço da promoção', 'preco da promocao',
      'preço da promoçao', 'preco promocional', 'preço promocional'
    ],
    
    // Quantidade por caixa - REGRA 2: Vai para informações adicionais
    // Nome real na planilha: PCS/CX
    quantidadeCaixa: [
      'pcscx', 'pccx', 'pcs/cx', 'pçs/cx', 'pecascaixa', 'qtdcaixa', 'qtcaixa',
      'pcs cx', 'pçs cx', 'peças caixa', 'pecas caixa', 'qtd caixa',
      'quantidade caixa', 'quantidadecaixa', 'pcs/cx', 'pçs/cx'
    ],
    
    // Categorias
    categoria: ['grupo', 'categoria', 'familia', 'família', 'departamento', 'setor', 'subgrupo', 'sub-grupo', 'linha', 'line'],
    
    // Campos fiscais
    // Nome real na planilha: IPI
    ncm: ['ncm', 'classificacaofiscal', 'classificação fiscal', 'classificacao fiscal'],
    ipi: ['ipi', 'percipi', 'aliquotaipi', 'alíquota ipi', 'aliquota ipi', '% ipi'],
    
    // Unidade
    unidade: ['un', 'unidade', 'und', 'u.m.', 'um', 'uni'],
    
    // Observações gerais
    observacoes: ['obs', 'observacao', 'observacoes', 'complemento', 'observação', 'observações', 'info'],
    
    // Campos de embalagem
    embalagem: ['embalagem', 'tipoembalagem', 'tipo embalagem', 'pack'],
    
    // Dimensões
    dimensoes: ['dimensoes', 'dimensões', 'dim', 'medidas', 'medida', 'tamanho'],
    
    // Material
    material: ['material', 'materia', 'matéria', 'composicao', 'composição'],
  },

  codigoPattern: /^NX\d{3,5}/i,
  precoFormat: 'BR',
  defaultQuantidadeCaixa: 1,
  defaultUnidade: 'UN',

  exclusionRules: [
    { pattern: /^p[aá]gina\s*\d/i, descricao: 'Número de página' },
    { pattern: /tabela\s+de\s+pre[cç]os/i, descricao: 'Cabeçalho de tabela' },
    { pattern: /^total/i, descricao: 'Linha de total' },
    { pattern: /^subtotal/i, descricao: 'Linha de subtotal' },
  ],

  detectionPatterns: [
    'NIX HOUSE',
    'NIX GLASS',
    'Nix House',
    'Nix Glass',
    /\bNX\d{3}/,
    /nix\s+house/i,
    /nix\s+glass/i,
    // Headers específicos da planilha Nix
    'Referencia',
    'PCS/CX',
    'Valor Promocional',
  ],

  // Usa função de extração customizada
  extract: extractNixProducts,

  blockSeparator: /(?=NX\d{3})/i,
};
