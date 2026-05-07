// ===================================================================
// ADAPTER: FREECOM
// Estrutura sem header, dados posicionais (B=código, C=descrição,
// D=categoria/promo, E=qtde caixa, F=preço unit).
//
// REGRA DE PRECIFICAÇÃO (do nome do arquivo "VALOR X2 -20% (PROMO SÓ X2 - VERMELHOS)"):
//  - Produtos com fonte VERMELHA (FF0000) = PROMO GERAL  → precoBase = preço_planilha × 2
//  - Produtos PRETOS (padrão) → precoBase = preço_planilha × 2 × 0.80 (× 1.60)
//
// Cor de fonte vermelha = bloqueia desconto adicional (já está em promo).
// ===================================================================
import { SupplierAdapter } from './types';
import { ProdutoBruto, ProdutoExtraido } from '../types/productPipeline';
import { CellStyleInfo } from '../pipeline/importPipeline';

const FREECOM_RED_HEXES = ['FF0000', 'FFFF0000', 'C00000', 'A00000'];

const isRed = (hex: string | undefined): boolean => {
  if (!hex) return false;
  const normalized = hex.toUpperCase().replace('#', '');
  return FREECOM_RED_HEXES.some(red => normalized.endsWith(red));
};

// Detecta categoria visual a partir das células de uma linha
const detectIsPromo = (
  cellStyles: Map<string, CellStyleInfo> | undefined,
  linhaReal: number | undefined
): boolean => {
  if (!cellStyles || !linhaReal) return false;
  // Verifica colunas A-F (códigos das células: A{row}, B{row}, ...)
  for (const colLetter of ['A', 'B', 'C', 'D', 'E', 'F']) {
    const style = cellStyles.get(`${colLetter}${linhaReal}`);
    if (style?.fontColor && isRed(style.fontColor)) return true;
  }
  return false;
};

// Chaves de METADATA interna do pipeline (não são dados da planilha)
const META_KEYS = new Set(['__cellStyles', '__linhaReal', '__headerRowIndex', '__rows2D', '__sheetName']);

// Pega valores em ordem POSICIONAL (Object.values) — útil quando não há header
// IMPORTANTE: SheetJS produz chaves como `__EMPTY`, `__EMPTY_1`, ... quando o header
// está vazio. Essas SÃO dados da planilha e devem ser preservadas. Filtramos apenas
// as chaves de metadata que o pipeline injeta posteriormente.
const getPositionalValues = (campos: Record<string, any>): any[] => {
  return Object.entries(campos)
    .filter(([k]) => !META_KEYS.has(k))
    .map(([, v]) => v);
};

const looksLikeCode = (val: any): boolean => {
  if (val === null || val === undefined) return false;
  const s = String(val).trim();
  // Códigos FREECOM: alfanuméricos 4-15 chars, sem espaços, podem ter hífen
  return /^[A-Z0-9-]{4,15}$/i.test(s);
};

const toNum = (val: any): number => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/[^\d,.\-]/g, '').replace(',', '.');
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
};

const toStr = (val: any): string => {
  if (val === null || val === undefined) return '';
  return String(val).trim();
};

export const freecomAdapter: SupplierAdapter = {
  id: 'freecom',
  nome: 'FreeCom',
  aliases: ['freecom', 'free com', 'free-com'],

  detectionPatterns: [
    /freecom/i,
    /free\s*com/i,
    /catalogo\s*freecom/i,
  ],

  // Códigos FREECOM têm formato variado: 03SH5J01, 1909227, 2109088, 04S20P21
  codigoPattern: /^(?:[A-Z0-9]{4,15}|\d{4,8}-?\d?)$/i,

  // Aliases vazios — adapter usa extração posicional via .extract
  fieldAliases: {
    codigo: ['codigo', 'cod', 'sku'],
    descricao: ['descricao', 'descrição', 'desc', 'nome', 'produto'],
    preco: ['preco', 'preço', 'valor'],
    quantidadeCaixa: ['qtde', 'qtd', 'caixa', 'cx'],
    categoria: ['categoria', 'tag', 'promo'],
  },

  exclusionRules: [
    { pattern: /^total/i, descricao: 'Linha de total' },
    { pattern: /^subtotal/i, descricao: 'Linha de subtotal' },
    { pattern: /^\s*$/, descricao: 'Linha vazia' },
  ],

  // Extração custom: dados posicionais sem header
  extract: (brutos: ProdutoBruto[], _adapter: SupplierAdapter): ProdutoExtraido[] => {
    const produtos: ProdutoExtraido[] = [];
    let totalRed = 0;
    let totalBlack = 0;

    for (const bruto of brutos) {
      const campos = bruto.campos;
      const cellStyles = (campos as any).__cellStyles as Map<string, CellStyleInfo> | undefined;
      const linhaReal = (campos as any).__linhaReal as number | undefined;

      // Pega valores em ordem posicional (B, C, D, E, F)
      const valores = getPositionalValues(campos);
      if (valores.length < 4) continue; // linha sem dados suficientes

      // Identifica os campos por POSIÇÃO + heurística
      // B = código (deve ser primeiro string que pareça código)
      // C = descrição (string longa)
      // D = categoria opcional (PROMO GERAL ou similar)
      // E = qtde caixa (int)
      // F = preço (float)

      // Filtra valores vazios para não quebrar a busca por posição
      const isEmpty = (v: any) => v === null || v === undefined || v === '' ||
                                  (typeof v === 'string' && v.trim() === '');

      let codigo = '';
      let descricao = '';
      let categoria = '';
      let qtdeCaixa = 0;
      let precoPlanilha = 0;

      let idx = 0;
      // 1. Código: primeiro valor que passa no looksLikeCode (ignora vazios)
      while (idx < valores.length && (isEmpty(valores[idx]) || !looksLikeCode(valores[idx]))) idx++;
      if (idx >= valores.length) continue;
      codigo = toStr(valores[idx]);
      idx++;

      // 2. Descrição: próxima string não-vazia
      while (idx < valores.length && isEmpty(valores[idx])) idx++;
      if (idx < valores.length && typeof valores[idx] === 'string') {
        descricao = toStr(valores[idx]);
        idx++;
      }

      // 3. Categoria opcional: string contendo PROMO/GERAL/etc — só consome se casar
      while (idx < valores.length && isEmpty(valores[idx])) idx++;
      if (idx < valores.length && typeof valores[idx] === 'string' &&
          /promo|geral|reposição|reposicao|novidade/i.test(String(valores[idx]))) {
        categoria = toStr(valores[idx]);
        idx++;
      }

      // 4. Qtde caixa: próximo numérico inteiro
      while (idx < valores.length && isEmpty(valores[idx])) idx++;
      if (idx < valores.length) {
        const qtdN = toNum(valores[idx]);
        if (qtdN > 0 && Number.isInteger(qtdN)) {
          qtdeCaixa = qtdN;
          idx++;
        }
      }

      // 5. Preço: próximo numérico (pode ser float)
      while (idx < valores.length && isEmpty(valores[idx])) idx++;
      if (idx < valores.length) {
        precoPlanilha = toNum(valores[idx]);
      }

      // Validação mínima
      if (!codigo || precoPlanilha <= 0) continue;

      // === Limpa descrição: remove prefixo redundante do código ===
      if (descricao.startsWith(codigo)) {
        descricao = descricao.slice(codigo.length).trim();
      }

      // === Aplica regra de precificação ===
      const isPromo = detectIsPromo(cellStyles, linhaReal);
      let precoBase: number;
      let descontoPercentual = 0;
      let bloqueiaDesconto = false;

      if (isPromo) {
        // Vermelho (PROMO): apenas × 2
        precoBase = precoPlanilha * 2;
        bloqueiaDesconto = true; // não aplica desconto adicional
        totalRed++;
      } else {
        // Padrão (preto): × 2 com -20%
        precoBase = precoPlanilha * 2;
        descontoPercentual = 20;
        totalBlack++;
      }

      const precoFinal = precoBase * (1 - descontoPercentual / 100);

      produtos.push({
        fornecedor: 'FreeCom',
        codigo,
        codigoOriginal: codigo,
        nome: descricao || codigo,
        descricao: descricao || codigo,
        descricaoComplementar: '',
        categoria: categoria || (isPromo ? 'PROMO GERAL' : ''),
        precoBase,
        preco: precoFinal,
        precoFinal: precoFinal !== precoBase ? precoFinal : undefined,
        ipi: 0,
        unidade: 'UN',
        quantidadeCaixa: qtdeCaixa || 1,
        observacoes: isPromo ? 'PROMO GERAL (× 2)' : 'Padrão (× 2 com -20%)',
        statusEstoque: 'disponivel',
        // Campos extras tipados como any
        ...(isPromo ? { isPromotional: true, bloqueiaDesconto: true } : { descontoAutomatico: 20 }),
        informacoesAdicionais: qtdeCaixa > 1 ? `Cx c/ ${qtdeCaixa} unidades` : '',
        origemArquivo: bruto.origemArquivo || '',
        paginaOrigem: bruto.paginaOrigem,
        linhaOrigem: bruto.linhaOrigem,
        confiancaExtracao: 100,
        erros: [],
        warnings: [],
      } as ProdutoExtraido);
    }

    console.log(`[FreeCom] Extração: ${produtos.length} produtos | Vermelhos (PROMO ×2): ${totalRed} | Pretos (×2 -20%): ${totalBlack}`);
    return produtos;
  },
};
