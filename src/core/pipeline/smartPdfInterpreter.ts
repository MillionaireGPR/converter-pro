import { ProdutoBruto } from '../types/productPipeline';
import { PdfTemplate } from '../pdfTemplates/types';
import { PdfPageData, PdfTextItem } from './pdfParser';

/**
 * Encontra o item de texto PDF.js que contém (ou cobre) um SKU.
 * Lida com fragmentação do PDF.js: o SKU pode estar em 1 item ("NX020"),
 * espalhado em 2-3 items adjacentes ("NX" + "020"), ou ter um prefixo
 * concatenado com texto vizinho ("CD:NX020" ou "Ref:GC0220").
 *
 * Estratégia em 4 camadas:
 *   1. Match exato em um único item (it.str.includes(sku))
 *   2. Concatenação posicional de TODOS os items da página com mapeamento
 *      char-índice → item-índice
 *   3. Match pela parte numérica do SKU (4+ dígitos)
 *   4. Match case-insensitive
 */
const findItemForSku = (
  items: PdfTextItem[],
  sku: string
): PdfTextItem | undefined => {
  if (!sku || !items || items.length === 0) return undefined;

  // Camada 1: match exato
  let item = items.find(it => it.str && it.str.includes(sku));
  if (item) return item;

  // Camada 2: concatenação posicional
  let joined = '';
  const charToItemIdx: number[] = [];
  for (let k = 0; k < items.length; k++) {
    const s = items[k].str || '';
    for (let c = 0; c < s.length; c++) charToItemIdx.push(k);
    joined += s;
  }

  let skuIdx = joined.indexOf(sku);
  if (skuIdx < 0) {
    // Camada 4: case-insensitive
    skuIdx = joined.toLowerCase().indexOf(sku.toLowerCase());
  }
  if (skuIdx >= 0) return items[charToItemIdx[skuIdx]];

  // Camada 3: parte numérica (3+ dígitos, para NX020 → "020")
  const digits = sku.match(/\d{3,}/)?.[0];
  if (digits) {
    const digitsIdx = joined.indexOf(digits);
    if (digitsIdx >= 0) return items[charToItemIdx[digitsIdx]];
  }

  return undefined;
};

/**
 * Motor semântico para interpretar páginas de PDF e convertê-las em blocos de ProdutoBruto.
 * Tenta usar um template se fornecido, senão aplica heurísticas genéricas baseadas na estrutura de catálogos.
 */
export const interpretPdfSemantically = (
  pages: PdfPageData[],
  template?: PdfTemplate
): ProdutoBruto[] => {
  const produtos: ProdutoBruto[] = [];

  for (const page of pages) {
    const text = page.text || '';
    if (text.trim().length < 20) continue;

    // 1. Tenta extrair usando o separador de blocos do template
    if (template && template.blockExtractor) {
      const blocks = typeof template.blockExtractor === 'function' 
        ? template.blockExtractor(text)
        : text.split(template.blockExtractor).filter(b => b.trim().length > 10);
      
      const pageStartIdx = produtos.length;
      
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const campos = applyTemplateExtractors(block, template);
          const prod: ProdutoBruto = {
            campos,
            linhaOrigem: i,
            paginaOrigem: page.pageNum,
            textoBruto: block.trim(),
          };

          // Buscar coordenadas do SKU (lookup robusto compartilhado)
          if (campos['codigo']) {
            const item = findItemForSku(page.items, campos['codigo'] as string);
            if (item) {
              prod.spatialContext = {
                x: item.x,
                y: item.y,
                width: item.w,
                height: item.h,
                page: page.pageNum
              };
            }
          }

          produtos.push(prod);
        }
      
      // ── Pass de enriquecimento POSICIONAL de PREÇO ──
      // Em catálogos grid (NIX, similar), PDF.js extrai texto fora de ordem.
      // O bloco do produto pode não conter o seu próprio "R$ X,XX".
      // Solução: para cada produto sem preço, busca nos page.items o item
      // com texto de preço mais PRÓXIMO ESPACIALMENTE do SKU (mesma coluna X
      // + abaixo ou próximo do Y do SKU).
      const pageProductsForPrice = produtos.slice(pageStartIdx);
      const semPreco = pageProductsForPrice.filter(p => {
        const v = p.campos['preco'];
        if (v === undefined || v === null || v === '') return true;
        const num = parseFloat(String(v).replace(/[^\d.,]/g, '').replace(',', '.'));
        return !num || num <= 0;
      });
      if (semPreco.length > 0 && page.items && page.items.length > 0) {
        // Coleta items que parecem ser preços com posição.
        // Aceita "R$ 6,99", "R$6,99", "6,99 unid", "6,99/unid"
        const priceItems: { x: number; y: number; value: number }[] = [];
        for (const it of page.items) {
          if (!it.str) continue;
          const s = String(it.str);
          const m = s.match(/R\s*\$\s*(\d{1,4}(?:\.\d{3})*[.,]\d{2})|(\d{1,4}(?:\.\d{3})*[.,]\d{2})\s*\/?\s*(?:unid|UNID|un\b|UN\b)/);
          if (!m) continue;
          const raw = (m[1] || m[2]).replace(/\./g, '').replace(',', '.');
          const num = parseFloat(raw);
          if (!isNaN(num) && num >= 0.10 && num <= 9999.99) {
            priceItems.push({ x: it.x, y: it.y, value: num });
          }
        }

        if (priceItems.length > 0) {
          // Para cada produto sem preço, encontra preço mais próximo do SKU.
          // Critério de proximidade:
          //   - mesma coluna X (tolerância 80pt) PESO ALTO
          //   - abaixo do SKU (Y menor em PDF.js bottom-up) PESO MÉDIO
          //   - distância euclidiana PESO BAIXO
          const usedPriceIdx: Set<number> = new Set();
          for (const prod of semPreco) {
            const sc = prod.spatialContext;
            if (!sc || sc.x === undefined || sc.y === undefined) continue;

            let bestIdx = -1;
            let bestScore = Infinity;
            for (let pi = 0; pi < priceItems.length; pi++) {
              if (usedPriceIdx.has(pi)) continue;
              const p = priceItems[pi];
              const dx = Math.abs(p.x - sc.x);
              const dy = sc.y - p.y; // positivo = preço abaixo do SKU (PDF.js Y-up)
              // Rejeita se muito longe horizontalmente OU muito acima do SKU
              if (dx > 100) continue;
              if (dy < -20) continue; // preço acima do SKU (improvável)
              // Score: prioriza mesma coluna, depois abaixo, depois distância
              const score = dx * 1.5 + Math.max(0, dy) * 0.5 + Math.max(0, -dy) * 3;
              if (score < bestScore) {
                bestScore = score;
                bestIdx = pi;
              }
            }
            if (bestIdx >= 0) {
              usedPriceIdx.add(bestIdx);
              const p = priceItems[bestIdx];
              // Formato compatível com adapter: string com vírgula
              prod.campos['preco'] = p.value.toFixed(2).replace('.', ',');
            }
          }
        }
      }

      // ── GIRA: Reparação de IPI por página (grid-layout PDF) ──
      // No layout em grid, PDF.js lê TP codes na linha 1 e IPI na linha 3.
      // O blockExtractor corta no próximo TP, então blocos da coluna 1 e 2
      // ficam SEM os dados de IPI/CX que estão abaixo no texto.
      // Solução: buscar todos os IPIs no texto COMPLETO da página e preencher.
      if (template.supplierName?.toUpperCase().includes('GIRA')) {
        const pageProducts = produtos.slice(pageStartIdx);
        
        // Coletar TODOS os valores de IPI do texto completo da página
        const pageIpis: string[] = [];
        const ipiPageRegex = /IP[I]?\s*(\d+(?:[.,]\d+)?)\s*%/gi;
        let ipiPageMatch;
        while ((ipiPageMatch = ipiPageRegex.exec(text)) !== null) {
          pageIpis.push(ipiPageMatch[1]);
        }
        
        // Encontrar o IPI dominante da página (mais frequente)
        if (pageIpis.length > 0) {
          const ipiCount: Record<string, number> = {};
          pageIpis.forEach(v => { ipiCount[v] = (ipiCount[v] || 0) + 1; });
          const dominantIpi = Object.entries(ipiCount)
            .sort((a, b) => b[1] - a[1])[0][0];
          
          // Preencher IPI ausente nos produtos desta página
          for (const prod of pageProducts) {
            if (!prod.campos['ipi'] || prod.campos['ipi'] === undefined) {
              prod.campos['ipi'] = dominantIpi;
            }
          }
        }
      }
      
      continue;
    }

    // 2. Fallback: Heurísticas Genéricas de Separação de Blocos (Catálogos)
    // Muitos catálogos separam produtos por Código, Preço, ou quebra de item.
    // Vamos tentar fatiar o texto a cada vez que encontrar um Padrão de Código ou "R$"
    
    // Heurística de fatiamento: Encontrar códigos de fornecedores
    // Padrões: 2-4 letras + 2-8 dígitos (ex: DXP24, NX020, NX12345, CL2024001)
    // Suporta também: 1 letra + 3-7 dígitos (ex: A123, N12345)
    const codeAnchorRegex = /\b([A-Z]{1,4}[-]?\d{2,8}(?:[-]?\d{1,4})?)\b/g;
    let match;
    let codeMatches: { index: number; code: string }[] = [];
    while ((match = codeAnchorRegex.exec(text)) !== null) {
      codeMatches.push({ index: match.index, code: match[1] });
    }

    if (codeMatches.length > 0) {
      for (let i = 0; i < codeMatches.length; i++) {
        const start = codeMatches[i].index;
        const end = i < codeMatches.length - 1 ? codeMatches[i + 1].index : text.length;
        const blockText = text.substring(start, end).trim();
        
        if (blockText.length > 10) {
          const campos = extractFieldsByHeuristics(blockText, codeMatches[i].code);
          const prod: ProdutoBruto = {
            campos,
            linhaOrigem: i,
            paginaOrigem: page.pageNum,
            textoBruto: blockText,
          };

          // Buscar coordenadas do SKU (lookup robusto compartilhado)
          const item = findItemForSku(page.items, codeMatches[i].code);
          if (item) {
            prod.spatialContext = {
              x: item.x,
              y: item.y,
              width: item.w,
              height: item.h,
              page: page.pageNum
            };
          }

          produtos.push(prod);
        }
      }
    } else {
      // Se não achou códigos evidentes, tenta separar por "R$" (preços)
      const priceAnchorRegex = /R\$\s*?\d/g;
      let priceMatches: number[] = [];
      while ((match = priceAnchorRegex.exec(text)) !== null) {
        priceMatches.push(match.index);
      }
      
      if (priceMatches.length > 0) {
        // Tenta retroceder um pouco o índice para capturar a descrição antes do R$
        for (let i = 0; i < priceMatches.length; i++) {
          const start = i === 0 ? 0 : priceMatches[i] - 50 > priceMatches[i-1] ? priceMatches[i] - 50 : priceMatches[i-1];
          const end = i < priceMatches.length - 1 ? priceMatches[i + 1] : text.length;
          const blockText = text.substring(start, end).trim();
          
          if (blockText.length > 10) {
            const campos = extractFieldsByHeuristics(blockText);
            produtos.push({
              campos,
              linhaOrigem: i,
              paginaOrigem: page.pageNum,
              textoBruto: blockText,
            });
          }
        }
      }
    }
  }

  return produtos;
};

// === FUNÇÕES AUXILIARES ===

/**
 * Extrai campos de um bloco de texto usando os regex definidos no template do fornecedor.
 * Se o template tiver um campo, ele tem PRIORIDADE sobre a heurística genérica.
 */
const applyTemplateExtractors = (block: string, template: PdfTemplate): Record<string, any> => {
  const campos: Record<string, any> = {};
  campos['__textoBruto'] = block;

  // --- 1. Extrair todos os campos via regex do template ---
  if (template.fieldExtractors.codigo) {
    const match = block.match(template.fieldExtractors.codigo);
    if (match) campos['codigo'] = match[1] || match[0];
  }

  if (template.fieldExtractors.descricao) {
    const match = block.match(template.fieldExtractors.descricao);
    if (match) campos['descricao'] = match[1] || match[0];
  }

  if (template.fieldExtractors.preco) {
    const match = block.match(template.fieldExtractors.preco);
    if (match) campos['preco'] = match[1] || match[0];
  }

  if (template.fieldExtractors.quantidadeCaixa) {
    const match = block.match(template.fieldExtractors.quantidadeCaixa);
    if (match) campos['cx'] = match[1] || match[0];
  }

  if (template.fieldExtractors.codigoBarras) {
    const match = block.match(template.fieldExtractors.codigoBarras);
    if (match) campos['ean'] = match[1] || match[0];
  }

  if (template.fieldExtractors.ncm) {
    const match = block.match(template.fieldExtractors.ncm);
    if (match) campos['ncm'] = match[1] || match[0];
  }

  if (template.fieldExtractors.ipi) {
    const match = block.match(template.fieldExtractors.ipi);
    if (match) campos['ipi'] = match[1] || match[0];
  }

  // --- 2. Pós-processamento específico por fornecedor ---
  postProcessBySupplier(campos, block, template);

  // --- 3. Fallback genérico APENAS para campos que o template NÃO preencheu ---
  // Se postProcessBySupplier já tratou tudo (marcou __postProcessed), não roda heurísticas.
  // Isso evita que, por exemplo, o EAN vire preço ou NCM contamine o título.
  if (!campos['__postProcessed']) {
    if (!campos['descricao'] || !campos['preco'] || !campos['codigo']) {
      const heuristic = extractFieldsByHeuristics(block);
      for (const k in heuristic) {
        if (!campos[k]) {
          if (k === 'preco' && campos['ean'] && heuristic[k] === campos['ean']) continue;
          campos[k] = heuristic[k];
        }
      }
    }
  }

  return campos;
};

/**
 * Pós-processamento específico por fornecedor.
 * Ajusta campos que precisam de tratamento especial após a extração por regex.
 *
 * GIRA IMPORTS: O texto do PDF vem como string contínua SEM quebras de linha confiáveis.
 * Estratégia: extrair e REMOVER campos estruturados (EAN, NCM, IPI, CX, GC/GU) primeiro,
 * depois interpretar o que sobra como "CÓDIGO - NOME DIMENSÕES PREÇO".
 */
const postProcessBySupplier = (
  campos: Record<string, any>,
  block: string,
  template: PdfTemplate
): void => {
  const supplierName = template.supplierName.toUpperCase();

  // ═══════════════════════════════════════════════════
  // GIRA IMPORTS — Regras específicas
  // ═══════════════════════════════════════════════════
  if (supplierName.includes('GIRA')) {
    // Limpar todos os campos vindos do template regex (vamos recalcular tudo aqui)
    delete campos['preco'];
    delete campos['descricao'];

    // ── PASSO 0: Normalizar quirks do PDF.js ──
    let text = block
      // 1. Separar CX de IPI quando colados: "CX40IPI" → "CX40 IPI"
      .replace(/CX(\d{1,3})(IP)/gi, 'CX$1 $2')
      // 2. Juntar CX com dígitos isolados: "CX 1 2 0" ou "CX1 2 0" → "CX120"
      .replace(/CX\s*(\d)\s+(\d)\s+(\d)(?!\d)/gi, 'CX$1$2$3')
      // 3. Juntar CX com 2 dígitos isolados: "CX3 0" ou "CX 3 0" → "CX30"
      .replace(/CX\s*(\d)\s+(\d)(?!\d)/gi, 'CX$1$2')
      // 4. Remover espaço simples entre CX e número: "CX 48" → "CX48" ou se o PDF pular letra "C X 48"
      .replace(/C\s*X\s*(\d{1,4})(?!\d)/gi, 'CX$1')
      // 5. Corrigir preços começados com zero quebrados por espaço, ex: "0 690" -> "0690", "00 17900" -> "0017900"
      // Evita juntar se o número for parte de CM ou MM (ex: "0 20cm") usando negative lookahead.
      .replace(/\b(00?)\s+(\d{2,5})\b(?!\s*(?:cm|mm|m|%|vol|pc|p[cç]s?))/gi, '$1$2')
      // 6. NCM com espaço entre grupos: "NCM 6913 9000" → "NCM 6913.9000"
      .replace(/NCM\s*(\d{4})\s+(\d{2,6})/gi, 'NCM $1.$2')
      // 7. Normaliza todo espaço para espaço simples
      .replace(/\s+/g, ' ')
      .trim();

    // ── PASSO 1: Detectar se há sub-produtos (GC/GU codes) ──
    const subProductSplit = text.split(/\s+G[CU]\d{3,5}\s*[-–]\s*/i);
    const mainBlock = subProductSplit[0].trim();
    const subProducts = subProductSplit.slice(1);

    // ── PASSO 2: Extrair campos ESTRUTURADOS (com labels) do bloco principal ──

    // EAN: "EAN 7908100214589" (13 dígitos)
    const eanMatch = mainBlock.match(/EAN\s*(\d{13})/i);
    if (eanMatch) campos['ean'] = eanMatch[1];

    // NCM: "NCM 7013.9900", "NCM 3406.0000" (já normalizado no passo 0)
    const allNcm = mainBlock.match(/NCM\s*\d{4}\.?\d{2,6}/gi) || [];
    const ncmMatch = mainBlock.match(/NCM\s*(\d{4}\.?\d{2,6})/i);
    if (ncmMatch) campos['ncm'] = ncmMatch[1];

    // IPI: "IP 9,75 %", "IPI 9,75%", "IPI 13%", "IPI 0" (% OPCIONAL)
    const ipiMatch = mainBlock.match(/IP[I]?\s*(\d+[.,]\d+)\s*%?/i)
                  || mainBlock.match(/IP[I]?\s*(\d+)\s*%?\b/i);
    if (ipiMatch) campos['ipi'] = ipiMatch[1];

    // CX: "CX8", "CX48", "CX80", "CX120", "CX144" (pode estar colado com texto, mas não número)
    const cxMatch = mainBlock.match(/CX\s*(\d{1,4})(?!\d)/i);
    if (cxMatch) campos['cx'] = cxMatch[1];

    // GC/GU codes no bloco principal
    const gcCodes = mainBlock.match(/\bG[CU]\d{3,5}\b/gi) || [];

    // KIT patterns: "KIT 4 PÇS", "KIT 4 pçs"
    const kitMatches = mainBlock.match(/KIT\s*\d+\s*p[cç]s?\b/gi) || [];

    // ── PASSO 3: REMOVER todos os campos estruturados do texto ──
    let stripped = mainBlock;

    // Remover todos os NCMs encontrados (com label)
    allNcm.forEach(m => { stripped = stripped.replace(m, ' '); });
    // Remover EAN com label
    if (eanMatch) stripped = stripped.replace(eanMatch[0], ' ');
    // Remover IPI com label (match exato encontrado)
    if (ipiMatch) stripped = stripped.replace(ipiMatch[0], ' ');
    // Remover CX (com dígitos, mesmo se estiver grudado)
    if (cxMatch) stripped = stripped.replace(new RegExp('CX\\s*' + cxMatch[1] + '(?!\\d)', 'i'), ' ');
    // Remover GC/GU codes
    gcCodes.forEach(m => { stripped = stripped.replace(m, ' '); });
    // Remover KIT patterns
    kitMatches.forEach(m => { stripped = stripped.replace(m, ' '); });

    // Remover EANs soltos (13 dígitos sem label)
    stripped = stripped.replace(/\b\d{13}\b/g, ' ');
    // Remover NCMs soltos (####.#### com ou sem ponto)
    stripped = stripped.replace(/\b\d{4}\.\d{2,6}\b/g, ' ');
    // Remover "NCM" texto solto que sobrou
    stripped = stripped.replace(/\bNCM\b/gi, ' ');
    // Remover "EAN" texto solto sem número
    stripped = stripped.replace(/\bEAN\b/gi, ' ');
    // Remover resíduos de IPI (QUALQUER posição, sem exigir \b no início)
    // Captura "IPI 9,75%", "IP 13%", "IPI0", "IPI" sozinho, inclusive dentro de texto colado
    stripped = stripped.replace(/IP[I]?\s*\d*[.,]?\d*\s*%?/gi, ' ');
    // Remover CX residual (qualquer dígito, 1+)
    stripped = stripped.replace(/\bCX\s*\d+/gi, ' ');
    // Remover % solto
    stripped = stripped.replace(/\s%\s/g, ' ');
    // Remover "jogo X pçs" residual (label de embalagem, não é nome)
    stripped = stripped.replace(/jogo\s*\d+\s*p[cç]s?/gi, ' ');
    // Normalizar espaços
    stripped = stripped.replace(/\s+/g, ' ').trim();

    // ── PASSO 4: Extrair CÓDIGO do texto limpo ──
    // Rejeitamos explicitamente jargões, para que "NCM3926" não vire código
    const codeMatch = stripped.match(/\b(?!(?:NCM|EAN|IPI?|CX))([A-Z]{2,4}\d{3,5})\s*[-–]?\s*/i);
    if (codeMatch) {
      campos['codigo'] = codeMatch[1];
      stripped = stripped.replace(codeMatch[0], '').trim();
    }

    // ── PASSO 5: Extrair PREÇO ──
    // REGRA GIRA: Preços SEMPRE começam com 0, podendo ter zeros múltiplos (ex: 0690→6.90, 0017900→179.00)
    // Isso evita confundir com CX (8, 36, 72, 120) ou NCM residual (9000, 3406)
    const allPriceNums = [...stripped.matchAll(/(?<![.,\d])(0+\d{2,6})(?![.,\d*xcmm])/gi)];

    if (allPriceNums.length > 0) {
      // Pegar o ÚLTIMO número começado com 0 (preço vem após dimensões)
      const priceRaw = allPriceNums[allPriceNums.length - 1][1];
      const priceNum = parseInt(priceRaw, 10);
      if (priceNum > 0 && priceNum < 100000) {
        campos['preco'] = (priceNum / 100).toFixed(2);
      }
      // Remover o preço do texto
      const lastIdx = stripped.lastIndexOf(priceRaw);
      if (lastIdx >= 0) {
        stripped = (stripped.substring(0, lastIdx) + stripped.substring(lastIdx + priceRaw.length)).trim();
      }
    }

    // ── PASSO 6: Montar DESCRIÇÃO limpa ──
    stripped = stripped
      .replace(/CX\s*\d+/gi, '')             // CX remanescente (qualquer dígito)
      .replace(/IP[I]?\s*\d*[.,]?\d*%?/gi, '') // IPI remanescente (última barreira)
      .replace(/\b0{2,}\b/g, '')              // zeros órfãos múltiplos
      .replace(/\b0\b\s*$/g, '')              // zero órfão SOZINHO grudado no fim da string
      .replace(/\b\d{4}\b/g, '')              // Números de 4 dígitos soltos (NCM residuais)
      .replace(/^\s*[-–]\s*/, '')             // hífen/travessão inicial
      .replace(/\s*[-–]\s*$/, '')             // hífen/travessão final
      .replace(/\s+/g, ' ')
      .trim();

    if (stripped.length > 3) {
      campos['descricao'] = stripped;
    }

    // ── PASSO 7: Informações adicionais ──
    const extras: string[] = [];

    // Quantidade por caixa
    if (campos['cx']) {
      extras.push(`Cx c/ ${campos['cx']} unidades`);
    }

    // Cores (ex: "3 CORES", "4 CORES", "7 CORES")
    const coresMatch = block.match(/(\d+)\s*CORES?/i);
    if (coresMatch) {
      extras.push(`${coresMatch[1]} cores`);
    }

    // Estampas (ex: "4 ESTAMPAS")
    const estampasMatch = block.match(/(\d+)\s*ESTAMPAS?/i);
    if (estampasMatch) {
      extras.push(`${estampasMatch[1]} estampas`);
    }

    // Formatos
    const formatoMatch = block.match(/(\d+)\s*FORMATOS?/i);
    if (formatoMatch) {
      extras.push(`${formatoMatch[1]} formatos`);
    }

    // Sub-produtos detectados (GC/GU variants)
    if (subProducts.length > 0) {
      extras.push(`+ ${subProducts.length} variante(s)`);
    }

    if (extras.length > 0) {
      campos['observacoes'] = extras.join(' | ');
    }

    campos['__postProcessed'] = true;
    return; // Sai sem aplicar fallback genérico — tudo foi tratado aqui
  }

  // ═══════════════════════════════════════════════════
  // BM36 / WORLD CLASSIC — Regras específicas
  // Estrutura por bloco (5 linhas):
  //   1. DESCRIÇÃO + SKU (às vezes truncado)
  //   2. CD: <EAN_13_DIGITOS>
  //   3. CD: <SKU_COMPLETO>  ← fonte de verdade do SKU
  //   4. CX: <NUMERO>
  //   5. B<base>B<margem>     ← preço base em centavos
  // ═══════════════════════════════════════════════════
  if (supplierName.includes('BM36') || supplierName.includes('WORLD CLASSIC')) {
    delete campos['preco'];
    delete campos['descricao'];

    // Normaliza espaços
    let text = block.replace(/\s+/g, ' ').trim();

    // ── PASSO 1: SKU completo via segunda linha "CD: BM/WC#####" ──
    const skuMatch = text.match(/CD:\s*((?:BM|WC)\d{4,8})/i);
    if (skuMatch) campos['codigo'] = skuMatch[1].toUpperCase();

    // ── PASSO 2: EAN (13 dígitos após primeira "CD:") ──
    const eanMatch = text.match(/CD:\s*(\d{13})/);
    if (eanMatch) campos['ean'] = eanMatch[1];

    // ── PASSO 3: Quantidade por caixa ──
    const cxMatch = text.match(/CX:?\s*(\d{1,4})/i);
    if (cxMatch) campos['cx'] = cxMatch[1];

    // ── PASSO 4: Preço (B<base>B<margem> → base em centavos) ──
    const priceMatch = text.match(/B(\d{2,5})B(\d{2,5})/i);
    if (priceMatch) {
      const cents = parseInt(priceMatch[1], 10);
      if (cents > 0 && cents < 1_000_000) {
        campos['preco'] = (cents / 100).toFixed(2);
      }
    }

    // ── PASSO 5: Descrição = texto antes do primeiro "CD:" ──
    // Remove o SKU truncado/completo do final da descrição
    const beforeCd = text.split(/\bCD:/i)[0].trim();
    let descricao = beforeCd
      // Remove cabeçalho de seção colado (COZINHA & UD, etc.)
      .replace(/^(COZINHA\s*&?\s*UD|MESA\s*&?\s*BAR|BANHO|DECOR(?:ACAO|AÇÃO)?|UTILIDADES?)\s+/i, '')
      // Remove SKU truncado/completo no final
      .replace(/\s*(?:BM|WC)\d{0,8}\s*$/i, '')
      // Remove "Pag: 001" ou similar que vaza
      .replace(/Pag:\s*\d+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (descricao.length >= 3) campos['descricao'] = descricao;

    // ── PASSO 6: Observações ──
    const extras: string[] = [];
    if (campos['cx']) extras.push(`Cx c/ ${campos['cx']} unidades`);
    if (extras.length > 0) campos['observacoes'] = extras.join(' | ');

    campos['__postProcessed'] = true;
    return;
  }
};

/**
 * Extrai campos de um bloco usando heurísticas genéricas baseadas na estrutura comum de catálogos.
 * Esta função é usada como fallback quando não há template específico.
 */
const extractFieldsByHeuristics = (block: string, anchorCode?: string): Record<string, any> => {
  const campos: Record<string, any> = {};
  campos['__textoBruto'] = block;
  
  if (anchorCode) campos['codigo'] = anchorCode;
  
  // Tentar preço: R$ 1.234,56 ou R$33,75
  const priceMatch = block.match(/R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/);
  if (priceMatch) campos['preco'] = priceMatch[1];
  
  // Tentar EAN: 13 dígitos seguidos ou "EAN \d+"
  const eanMatch = block.match(/EAN\s*(\d{13})\b/i);
  if (eanMatch) campos['ean'] = eanMatch[1];
  // Fallback: 13 dígitos soltos (só se não achou com label)
  if (!campos['ean']) {
    const eanFallback = block.match(/\b(\d{13})\b/);
    if (eanFallback) campos['ean'] = eanFallback[1];
  }
  
  // Tentar NCM: "NCM 7013.9900" ou "7013\.9900"
  const ncmMatch = block.match(/\b(\d{4}\.\d{2}(?:\.\d{2})?)\b/);
  if (ncmMatch) campos['ncm'] = ncmMatch[1];
  
  // Tentar IPI: "IP 9,75 %" ou "IPI:6,5"
  const ipiMatch = block.match(/IPI\s*[:\s]*(\d+(?:[.,]\d+)?)\s*%?/i) || block.match(/IP\s+(\d+(?:[.,]\d+)?)\s*%/i);
  if (ipiMatch) campos['ipi'] = ipiMatch[1];
  
  // Tentar Caixa/Quantidade: "CX48", "CX: 24", "PEÇAS/CXS: 96", "Cx. c/50"
  const cxMatch = block.match(/(?:CX|CAIXA|PCT|KITS?|JGS)\s*(?:\.|:|\/|C\/|C\/)?\s*?(\d{1,4})/i) ||
                  block.match(/CXS?[:\s]*(\d+)/i) ||
                  block.match(/C\/(\d+)\s*(?:UN|P[CÇ]S|JGS)/i);
  if (cxMatch) campos['cx'] = cxMatch[1];

  // Identificar descrição. É geralmente um texto alfabético mais longo no bloco.
  const cleanBlock = block
    .replace(anchorCode || '', '')
    .replace(priceMatch?.[0] || '', '')
    .replace(eanMatch?.[0] || '', '')
    .replace(ncmMatch?.[0] || '', '')
    .replace(ipiMatch?.[0] || '', '')
    .replace(cxMatch?.[0] || '', '')
    .trim();
    
  const possibleDescLines = cleanBlock.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 5 && /[A-Za-z]{3,}/.test(l));
    
  if (possibleDescLines.length > 0) {
    campos['descricao'] = possibleDescLines[0];
  } else if (!campos['descricao']) {
    const upperMatch = block.match(/\n?([A-ZÀ-Ú0-9\s\-\/\+]{10,})\n?/);
    if (upperMatch && upperMatch[1].trim().length > 5) {
      campos['descricao'] = upperMatch[1].trim();
    }
  }

  return campos;
};
