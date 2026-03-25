import { ProdutoNormalizado, SupplierConfig } from './types';
import { getSupplierConfig } from './rules/suppliers';
import { mapRowToProduto } from './normalizers/utils';
import { validarProduto } from './validators';
import { detectColumnMapping } from './autoMapper';

export interface ConversionResult {
  produtos: ProdutoNormalizado[];
  stats: {
    total: number;
    validados: number;
    erros: number;
    pendentes: number;
  };
}

/**
 * Motor principal do conversor.
 * Recebe uma lista de objetos (linhas da planilha) e o ID do fornecedor.
 */
export const processarArquivo = (
  rawData: Record<string, any>[],
  supplierId: string,
  supplierName?: string,
  rawRows2D?: any[][]
): ConversionResult => {
  let config = getSupplierConfig(supplierId) || (supplierName ? getSupplierConfig(supplierName) : undefined);
  const headers = rawData.length > 0 ? Object.keys(rawData[0]) : [];
  
  if (!config) {
    console.warn(`[Flow MVP] Configuração não encontrada para: ${supplierName || supplierId}. Tentando Auto-Mapeamento com headers originais:`, headers);
    config = detectColumnMapping(headers, supplierId, supplierName || supplierId);
  } else {
    console.log(`[Flow MVP] Regra hardcoded '${config.id}' localizada. Headers da planilha:`, headers);
  }

  console.log(`[Flow MVP] Preview 5 linhas brutas da planilha:`, rawData.slice(0, 5));
  console.log(`[Flow MVP] Mapeamento utilizado (Aliases):`, config.columnAliases);

  // Mapa espacial: Mapeia o alias original purificado para o seu índice posicional físico
  const positionMap: Record<string, number> = {};
  if (rawRows2D && rawRows2D.length > 0) {
    const structuralHeader = rawRows2D[0];
    structuralHeader.forEach((colRawName, idx) => {
      if (typeof colRawName === 'string') {
        const normalized = colRawName.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, "");
        positionMap[normalized] = idx;
      }
    });
    console.log(`[Flow MVP] Mapa Espacial Posicional do Header 2D (Colunas):`, positionMap);
  }

  // Armazena as linhas extraídas sem validação, apenas pra log
  const produtosBaseBrutos: ReturnType<typeof mapRowToProduto>[] = [];
  
  const errosDetalhados = {
    semCodigo: 0,
    semNome: 0,
    semPreco: 0,
    precoInvalido: 0,
  };

  const produtos: ProdutoNormalizado[] = rawData.map((row, index) => {
    const isClink = config!.id === 'clink' || config!.name.toLowerCase().includes('clink');
    
    if (isClink && index < 10) {
      console.log(`\n[Flow MVP] --- CLINK INSIGHT L${index + 1} ---`);
      console.log(`[Flow MVP] Objeto Bruto Lide:`, row);
      console.log(`[Flow MVP] Chaves Reais Disponíveis:`, Object.keys(row));
    }

    // 1. Mapeia a linha para o tipo base usando Leitura Híbrida
    const raw2DLine = rawRows2D ? rawRows2D[index + 1] : undefined;
    const produtoBase = mapRowToProduto(row, config!, index, raw2DLine, positionMap);
    produtosBaseBrutos.push(produtoBase);
    
    if (isClink && index < 10) {
      console.log(`[Flow MVP] Valores Finais Extraídos L${index + 1}:`, {
        codigo: produtoBase.codigo,
        nome: produtoBase.nome,
        precoBase: produtoBase.precoBase,
        quantidadeCaixa: produtoBase.quantidadeCaixa
      });
    }

    // 2. Valida o produto
    const validado = validarProduto(produtoBase);

    // Detalhar erros individualizados para o log
    if (validado.status !== 'validado') {
      if (!validado.codigo && !validado.codigoOriginal) errosDetalhados.semCodigo++;
      if (!validado.nome) errosDetalhados.semNome++;
      if (validado.precoBase === undefined || validado.precoBase === null) errosDetalhados.semPreco++;
      else if (validado.precoBase <= 0) errosDetalhados.precoInvalido++;
    }

    return validado;
  });

  console.log(`[Flow MVP] Preview 5 linhas Extraídas (Mapeamento direto, sem validação):`, produtosBaseBrutos.slice(0, 5));
  console.log(`[Flow MVP] Preview 5 linhas ProdutoNormalizado (Final, c/ Erros resolvidos):`, produtos.slice(0, 5));
  
  // Calcula estatísticas
  const stats = produtos.reduce(
    (acc, p) => {
      acc.total++;
      if (p.status === 'validado') acc.validados++;
      else if (p.status === 'erro') acc.erros++;
      else acc.pendentes++;
      return acc;
    },
    { total: 0, validados: 0, erros: 0, pendentes: 0 }
  );

  console.log(`[Flow MVP] Breakdown de Falhas/Erros:`, errosDetalhados);

  return {
    produtos,
    stats,
  };
};
