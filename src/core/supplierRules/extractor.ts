// ===================================================================
// EXTRATOR GENÉRICO DE PRODUTOS
// Usa um SupplierAdapter para mapear campos brutos → ProdutoExtraido
// ===================================================================

import { ProdutoBruto, ProdutoExtraido } from '../types/productPipeline';
import { SupplierAdapter } from './types';
import { extractPrice, detectStockStatus, cleanDescription, normalizeSpaces } from '../normalizers/cleaners';

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
 * Converte valor para número
 */
const toNum = (val: any): number => {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return val;
  return extractPrice(String(val));
};

/**
 * Verifica se uma linha bruta deve ser excluída (ruído)
 */
const shouldExclude = (campos: Record<string, any>, adapter: SupplierAdapter): boolean => {
  const allText = Object.values(campos).filter(v => typeof v === 'string').join(' ');
  for (const rule of adapter.exclusionRules) {
    if (rule.campo) {
      const val = toStr(campos[rule.campo]);
      if (rule.pattern.test(val)) return true;
    } else {
      if (rule.pattern.test(allText)) return true;
    }
  }
  return false;
};

/**
 * Extrai produtos de dados brutos usando um adapter de fornecedor.
 * Se o adapter tem função extract() customizada, usa ela.
 * Caso contrário, usa a lógica genérica baseada em fieldAliases.
 */
export const extractProducts = (
  brutos: ProdutoBruto[],
  adapter: SupplierAdapter,
  nomeArquivo: string
): ProdutoExtraido[] => {
  // Se o adapter tem extração customizada, delega
  if (adapter.extract) {
    return adapter.extract(brutos, adapter);
  }

  // Extração genérica
  const produtos: ProdutoExtraido[] = [];
  const fa = adapter.fieldAliases;

  for (const bruto of brutos) {
    const campos = bruto.campos;

    // Verifica exclusão
    if (shouldExclude(campos, adapter)) continue;

    const erros: string[] = [];
    const warnings: string[] = [];

    // Extrai campos usando aliases
    const codigo = toStr(findValue(campos, fa.codigo));
    const codigoBarras = fa.codigoBarras ? toStr(findValue(campos, fa.codigoBarras)) : '';
    const codigoInterno = fa.codigoInterno ? toStr(findValue(campos, fa.codigoInterno)) : '';
    let descricao = toStr(findValue(campos, fa.descricao));
    const descricaoComplementar = fa.descricaoComplementar ? toStr(findValue(campos, fa.descricaoComplementar)) : '';
    const categoria = fa.categoria ? toStr(findValue(campos, fa.categoria)) : '';

    // Preço: tenta campo principal, depois verifica prioridade
    let preco = toNum(findValue(campos, fa.preco));
    const precoPromocional = fa.precoPromocional ? toNum(findValue(campos, fa.precoPromocional)) : undefined;

    // Se o smart PDF interpreter já calculou o preço (postProcess), usar diretamente
    if (preco === 0 && campos['preco'] !== undefined && campos['preco'] !== null) {
      const precoFromSmart = parseFloat(String(campos['preco']).replace(',', '.'));
      if (!isNaN(precoFromSmart) && precoFromSmart > 0) {
        preco = precoFromSmart;
      }
    }

    // Heurística de fallback para PDFs Tabulares (onde as chaves são col_0, col_1...) ou itens sem preço
    // IMPORTANTE: Não rodar se campos['__postProcessed'] estiver true (já tratado pelo postProcess do fornecedor)
    if (preco === 0 && !campos['__postProcessed']) {
      // 1. Procura primeiro nas strings puras algum padrão de moeda explícito
      const values = Object.values(campos).map(String);
      const precoMatch = values.find(v => /R?\$\s*[\d.,]+/.test(v) || /^[\d.,]+\s*$/.test(v));
      if (precoMatch && extractPrice(precoMatch) > 0) {
        preco = extractPrice(precoMatch);
        warnings.push('Preço detectado por heurística visual');
      } else {
        // 2. Se falhar, tenta todos os numéricos maiores que zero
        const numericValues = Object.values(campos)
          .map(v => toNum(v))
          .filter(n => n > 0);
        if (numericValues.length === 1) {
          preco = numericValues[0];
          warnings.push('Preço extraído por heurística (único valor numérico)');
        } else if (numericValues.length > 1) {
          preco = Math.min(...numericValues);
          warnings.push(`Múltiplos numéricos. Assumindo o menor como preço: ${preco}`);
        }
      }
    }

    // Heurística de fallback para Código em PDFs tabulares (col_X)
    let finalCodigo = codigo;
    // Se postProcessed, usar o campo direto do smartPdfInterpreter
    if (!finalCodigo && campos['codigo']) {
      finalCodigo = toStr(campos['codigo']);
    }
    if (!finalCodigo && !campos['__postProcessed']) {
      const values = Object.values(campos).map(String);
      const possibleCodes = values.filter(v => 
        /^[A-Z]{2,}\d{3,}$/i.test(v) || 
        /^\d{4,8}$/.test(v) || 
        /^[A-Za-z0-9-]{4,15}$/.test(v)
      );
      
      if (possibleCodes.length > 0) {
        finalCodigo = toStr(possibleCodes.find(c => !c.includes(' ')) || possibleCodes[0]);
        warnings.push('Código detectado por heurística visual');
      }
    }

    // Heurística de fallback para Descrição em PDFs tabulares (col_X)
    let finalDescricao = descricao;
    // Se postProcessed, usar o campo direto do smartPdfInterpreter
    if (!finalDescricao && campos['descricao']) {
      finalDescricao = toStr(campos['descricao']);
    }
    if (!finalDescricao && !campos['__postProcessed']) {
      const values = Object.values(campos).map(String);
      const possibleDescList = values.filter(v => v.length > 8 && /[A-Za-z]{3,}/.test(v) && v.includes(' '));
      const possibleDesc = possibleDescList.sort((a, b) => b.length - a.length)[0];
      
      if (possibleDesc) {
        finalDescricao = toStr(possibleDesc);
        warnings.push('Descrição detectada por heurística');
      } else if (values.length > 0) {
          const allStrs = values.filter(v => v.length > 5 && isNaN(Number(v.replace(/[^\d.-]/g, ''))));
          if(allStrs.length > 0) {
              finalDescricao = toStr(allStrs.join(' '));
              warnings.push('Descrição compilada de colunas combinadas');
          }
      }
    }

    const unidade = (fa.unidade ? toStr(findValue(campos, fa.unidade)) : '') || adapter.defaultUnidade || 'UN';
    let quantidadeCaixa = toNum(findValue(campos, fa.quantidadeCaixa));
    // Leitura direta do campo 'cx' se existir (preenchido pelo smartPdfInterpreter)
    if (quantidadeCaixa <= 0 && campos['cx']) {
      quantidadeCaixa = toNum(campos['cx']);
    }
    if (quantidadeCaixa <= 0) quantidadeCaixa = adapter.defaultQuantidadeCaixa || 1;

    const embalagem = fa.embalagem ? toStr(findValue(campos, fa.embalagem)) : '';
    const ncm = fa.ncm ? toStr(findValue(campos, fa.ncm)) : (campos['ncm'] ? toStr(campos['ncm']) : '');
    let ipi = fa.ipi ? toNum(findValue(campos, fa.ipi)) : 0;
    // Leitura direta do campo 'ipi' se existir (preenchido pelo smartPdfInterpreter)
    if (ipi <= 0 && campos['ipi']) {
      ipi = toNum(campos['ipi']);
    }
    const dimensoes = fa.dimensoes ? toStr(findValue(campos, fa.dimensoes)) : '';
    const material = fa.material ? toStr(findValue(campos, fa.material)) : '';
    const cor = fa.cor ? toStr(findValue(campos, fa.cor)) : '';
    const volume = fa.volume ? toStr(findValue(campos, fa.volume)) : '';
    let observacoes = fa.observacoes ? toStr(findValue(campos, fa.observacoes)) : '';
    // Leitura direta do campo 'observacoes' (preenchido pelo postProcess)
    if (!observacoes && campos['observacoes']) {
      observacoes = toStr(campos['observacoes']);
    }

    // Detecção de status de estoque
    const allText = Object.values(campos).filter(v => typeof v === 'string').join(' ');
    const statusEstoque = detectStockStatus(allText) as ProdutoExtraido['statusEstoque'];

    // Limpa descrição
    finalDescricao = cleanDescription(finalDescricao);

    // Validações básicas
    if (!finalCodigo) erros.push('Código não encontrado');
    if (!finalDescricao) erros.push('Descrição não encontrada');
    if (preco <= 0) erros.push('Preço não encontrado ou inválido');
    if (finalDescricao && finalDescricao.length < 3) warnings.push('Descrição muito curta');

    // Calcula confiança
    let confianca = 100;
    if (!finalCodigo) confianca -= 30;
    if (!finalDescricao) confianca -= 30;
    if (preco <= 0) confianca -= 20;
    if (warnings.length > 0) confianca -= warnings.length * 5;
    confianca = Math.max(0, confianca);

    produtos.push({
      fornecedor: adapter.nome,
      codigo: finalCodigo,
      codigoBarras,
      codigoInterno,
      descricao: finalDescricao,
      descricaoComplementar,
      categoria,
      preco,
      precoPromocional: precoPromocional && precoPromocional > 0 ? precoPromocional : undefined,
      unidade,
      quantidadeCaixa,
      embalagem,
      ncm,
      ipi,
      dimensoes,
      material,
      cor,
      volume,
      observacoes,
      statusEstoque,
      origemArquivo: nomeArquivo,
      paginaOrigem: bruto.paginaOrigem,
      linhaOrigem: bruto.linhaOrigem,
      confiancaExtracao: confianca,
      erros,
      warnings,
    });
  }

  return produtos;
};
