import { ProdutoNormalizado, SupplierConfig } from '../types';

/**
 * Limpa uma string removendo espaços extras e normalizando caracteres.
 */
export const cleanString = (val: any): string => {
  if (val === null || val === undefined) return '';
  return String(val).trim();
};

/**
 * Converte um valor (string, number, etc.) para um número válido.
 * Trata formatos brasileiros (1.234,56) e americanos (1,234.56).
 */
export const parseNumber = (val: any): number => {
  if (typeof val === 'number') return val;
  if (!val) return 0;

  let cleaned = String(val).trim();
  
  // Remove moedas (ex: R$), espaços e caracteres não-numéricos (exceto . e , e -)
  cleaned = cleaned.replace(/[^\d.,-]/g, '');
  
  if (!cleaned) return 0;
  
  // Se contiver vírgula e ponto, assumimos que a vírgula é separador de milhar ou decimal dependendo da posição
  if (cleaned.includes(',') && cleaned.includes('.')) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      // Padrão BR: 1.234,56 -> 1234.56
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // Padrão US: 1,234.56 -> 1234.56
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    // Apenas vírgula: 1234,56 -> 1234.56
    cleaned = cleaned.replace(',', '.');
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

/**
 * Localiza o valor de uma coluna em uma linha baseado em aliases.
 */
export const getValueByAlias = (row: Record<string, any>, aliases: string[]): any => {
  const rowKeys = Object.keys(row);
  
  for (const alias of aliases) {
    const normalizedAlias = alias.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "");
    
    const foundKey = rowKeys.find(key => {
      const normalizedKey = key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "");
      return normalizedKey === normalizedAlias;
    });

    if (foundKey !== undefined) {
      return row[foundKey];
    }
  }
  
  return undefined;
};

/**
 * Monta um ProdutoNormalizado a partir de uma linha e configuração de fornecedor.
 */
export const mapRowToProduto = (
  row: Record<string, any>,
  config: SupplierConfig,
  index: number = -1,
  rawRow2D?: any[],
  positionMap?: Record<string, number>
): ProdutoNormalizado => {
  const find = (aliases: string[]) => getValueByAlias(row, aliases);

  const codigo = cleanString(find(config.columnAliases.codigo));
  let nome = cleanString(find(config.columnAliases.nome));
  let precoBaseRaw = find(config.columnAliases.precoBase);
  let precoBase = parseNumber(precoBaseRaw);
  const ipi = parseNumber(find(config.columnAliases.ipi));
  const unidade = cleanString(find(config.columnAliases.unidade)) || 'UN';
  let quantidadeCaixa = parseNumber(find(config.columnAliases.quantidadeCaixa)) || 1;
  const categoria = cleanString(find(config.columnAliases.categoria));
  
  // ==========================================
  // PÓS-PROCESSAMENTO ESPECÍFICO DE FORNECEDOR
  // ==========================================
  const isClink = config.id === 'clink' || config.name.toLowerCase().includes('clink');
  const isDebugRow = index >= 0 && index < 10;

  if (isClink) {
    if (isDebugRow) {
      console.log(`\n[CLINK PRICE FIX] ==== BLOCO EXECUTADO ====`);
      console.log(`- Fornecedor recebido ID:`, config.id);
      console.log(`- Nome normalizado/usado:`, config.name);
      console.log(`- Chave principal de preço usada pelo config:`, config.columnAliases.precoBase);
      console.log(`- Lista das chaves brutas da linha ${index + 1}:`, Object.keys(row));
      console.log(`[CLINK PRICE FIX] Valores bruto P.Venda ->`, row['P.Venda'], `| (p.venda):`, row['p.venda'], `| (pvenda):`, row['pvenda']);
    }

    // 1. Correção de Extração do Nome (Forçamento de alias)
    if (!nome) {
      const clinkNome = getValueByAlias(row, ['Descr Compl', 'descr compl', 'descricaocomplementar']);
      if (clinkNome) nome = cleanString(clinkNome);
    }
    
    // 2. Correção de Quantidade de Caixa
    if (quantidadeCaixa === 1) { // 1 é o valor de fallback
       const clinkQtd = parseNumber(getValueByAlias(row, ['Qtd Caixa', 'qtd caixa']));
       if (clinkQtd > 0) quantidadeCaixa = clinkQtd;
    }

    // 3. Correção de Extração do Preço Quebrado (Novo Parser Estrutural Espacial 2D)
    if (precoBase === 0) {
      if (rawRow2D && positionMap) {
        // Encontra o index exato da coluna física principal de preço
        const pVendaIndex = positionMap['pvenda'] ?? positionMap['preco'];
        
        if (pVendaIndex !== undefined) {
          const mainCell = rawRow2D[pVendaIndex];
          
          if (isDebugRow) {
            console.log(`[CLINK PRICE FIX] (Parser 2D) Coluna 'P.Venda' detectada fisicamente no index 2D:`, pVendaIndex);
            console.log(`[CLINK PRICE FIX] (Parser 2D) Valor bruto exato da célula principal na matriz 2D:`, mainCell);
          }

          let encontrouValorNumber = false;

          // Se for string pura com R$, varre fisicamente a matriz adjacente +1, +2, +3
          if (typeof mainCell === 'string' && mainCell.trim().toUpperCase() === 'R$') {
            for (let offset = 1; offset <= 3; offset++) {
              if (pVendaIndex + offset < rawRow2D.length) {
                const adjCell = rawRow2D[pVendaIndex + offset];
                const parsedPossible = parseNumber(adjCell);
                
                if (parsedPossible > 0) {
                  precoBase = parsedPossible;
                  encontrouValorNumber = true;
                  if (isDebugRow) {
                    console.log(`[CLINK PRICE FIX] (Parser 2D) Vizinho +${offset} lido com sucesso na matriz 2D! Valor isolado adjacente:`, adjCell, `| Convertido final numérico >`, precoBase);
                  }
                  break;
                }
              }
            }
          } else {
            // Tenta resolver a célula principal diretamente caso já tenha vindo completa ou numerica
            const parsedMain = parseNumber(mainCell);
            if (parsedMain > 0) {
              precoBase = parsedMain;
              encontrouValorNumber = true;
            }
          }

          if (!encontrouValorNumber && isDebugRow) {
            console.log(`[CLINK PRICE FIX] Falha no Parser 2D de Preço: Célula principal e/ou os 3 vizinhos puros não retornaram nenhum numeral decimal válido.`);
          }
        } else {
          if (isDebugRow) {
            console.log(`[CLINK PRICE FIX] ALERTA: Map Locator não encontrou 'pvenda' nas colunas estruturais normalizadas detectadas:`, Object.keys(positionMap));
          }
        }
      } else {
        if (isDebugRow) console.log(`[CLINK PRICE FIX] Dados Espaciais rawRow2D não passados ao mapa. Pós-processamento estrutural ignorado.`);
      }
    } else {
      if (isDebugRow) {
         console.log(`[CLINK PRICE FIX] PrecoBase original já veio > 0:`, precoBase);
      }
    }
  }

  // 4. Detecção automática de imagem (heurística)
  const imageAliases = ['foto', 'imagem', 'image', 'img', 'url', 'link', 'photo'];
  const imagemUrl = cleanString(getValueByAlias(row, imageAliases));

  return {
    fornecedor: config.name,
    fornecedorId: config.id,
    codigoOriginal: codigo,
    codigo: codigo,
    nome: nome,
    precoBase: precoBase,
    precoFinal: precoBase, // Inicialmente igual, pode ser calculado depois
    ipi: ipi,
    unidade: unidade,
    quantidadeCaixa: quantidadeCaixa,
    categoria: categoria,
    status: 'pendente',
    erros: [],
    imagemUrl: imagemUrl,
    temImagem: !!imagemUrl
  };
};
