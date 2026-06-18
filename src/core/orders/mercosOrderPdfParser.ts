// ===================================================================
// PARSER DE PEDIDO PDF DO MERCOS → JAW WEB
// Estratégia: análise POSICIONAL (X/Y) das spans extraídas pelo PDF.js
// O PDF do Mercos tem layout tabular com cada item em ~3 linhas próximas:
//   - linha A (texto x≈147): primeira parte da descrição
//   - linha B (anchor, x=39 #, x=51 código, x≈344 qtde, x≈384 desc%, x≈480 preço, x≈537 subtotal)
//   - linha C (x≈147): segunda parte da descrição
// Agrupamos por Y (com tolerância) e identificamos o anchor pelo padrão
// "número-código no início da linha".
// ===================================================================

import type {
  PedidoProcessado,
  PedidoCabecalho,
  ItemPedidoNormalizado,
} from './orderTypes';

// PDF.js dinâmico
let pdfjsLib: any = null;
const loadPdfJs = async (): Promise<any> => {
  if (pdfjsLib) return pdfjsLib;
  const version = '5.6.205';
  const cdnUrl = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.mjs`;
  const pdfjs = await import(/* @vite-ignore */ cdnUrl);
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
  pdfjsLib = pdfjs;
  return pdfjs;
};

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

export const parseDescPercent = (raw: string): number => {
  if (!raw) return 0;
  const pcts = Array.from(raw.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g))
    .map(m => Number(m[1].replace(',', '.')) / 100)
    .filter(n => !isNaN(n));
  if (pcts.length === 0) return 0;
  return 1 - pcts.reduce((acc, p) => acc * (1 - p), 1);
};

export const parseBRL = (raw: string): number => {
  if (!raw) return 0;
  const cleaned = raw
    .replace(/R\$\s*/gi, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.\-]/g, '');
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
};

const UF_MAP: Record<string, string> = {
  'Acre': 'AC', 'Alagoas': 'AL', 'Amapá': 'AP', 'Amazonas': 'AM',
  'Bahia': 'BA', 'Ceará': 'CE', 'Distrito Federal': 'DF', 'Espírito Santo': 'ES',
  'Goiás': 'GO', 'Maranhão': 'MA', 'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS',
  'Minas Gerais': 'MG', 'Pará': 'PA', 'Paraíba': 'PB', 'Paraná': 'PR',
  'Pernambuco': 'PE', 'Piauí': 'PI', 'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN',
  'Rio Grande do Sul': 'RS', 'Rondônia': 'RO', 'Roraima': 'RR', 'Santa Catarina': 'SC',
  'São Paulo': 'SP', 'Sergipe': 'SE', 'Tocantins': 'TO',
};

interface Span {
  x: number;     // x0 (esquerda)
  y: number;     // y já normalizado (top-down style: maior y = mais embaixo)
  str: string;
}

// ───────────────────────────────────────────────────────────────
// Extração spatial do PDF
// ───────────────────────────────────────────────────────────────

const extractSpans = async (file: File | ArrayBuffer): Promise<Span[][]> => {
  const data = file instanceof File ? await file.arrayBuffer() : file;
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: Span[][] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.0 });
    const content = await page.getTextContent();
    const spans: Span[] = [];
    for (const it of content.items as any[]) {
      const str = (it.str || '').trim();
      if (!str) continue;
      const x = it.transform[4];
      // PDF.js Y é bottom-up; convertemos para top-down (para ordenação intuitiva)
      const y = viewport.height - it.transform[5];
      spans.push({ x, y, str });
    }
    spans.sort((a, b) => a.y - b.y || a.x - b.x);
    pages.push(spans);
  }
  return pages;
};

// ───────────────────────────────────────────────────────────────
// Parser de itens via posição (X/Y)
// ───────────────────────────────────────────────────────────────

interface ItemRaw {
  numero: string;
  codigo: string;
  descricao: string;
  qtde: number;
  descontoStr: string;
  preco: number;
  subtotal: number;
}

// Agrupa spans em LINHAS (por Y) e devolve o texto de cada linha (spans
// ordenados por X, juntos por espaço). Reconstrói a leitura natural do PDF.
const spansToLines = (spans: Span[]): string[] => {
  const sorted = [...spans].sort((a, b) => a.y - b.y || a.x - b.x);
  const linhas: { y: number; spans: Span[] }[] = [];
  const TOL_Y = 2.5;
  for (const s of sorted) {
    const bucket = linhas.length > 0 ? linhas[linhas.length - 1] : null;
    if (bucket && Math.abs(bucket.y - s.y) <= TOL_Y) bucket.spans.push(s);
    else linhas.push({ y: s.y, spans: [s] });
  }
  return linhas.map(l =>
    l.spans.sort((a, b) => a.x - b.x).map(s => s.str).join(' ').replace(/\s+/g, ' ').trim()
  ).filter(Boolean);
};

// Padrões de item (independente de posição X — robusto a layouts diferentes
// do Mercos, com ou sem coluna de Desconto%, Foto etc.).
const RE_NUM_COD = /^(\d{1,3})\s+([A-Z]{1,4}\d{2,8})$/;   // "10 CB4904" juntos
const RE_COD = /^[A-Z]{1,4}\d{2,8}$/;                      // código sozinho
const RE_INT = /^\d{1,5}$/;                                // qtde (ou # sozinho)
const RE_RS = /^R\$\s*[\d.,]+$/;                           // "R$ 7,99"

/**
 * Parser de itens BASEADO EM LINHA (não em posição X). O PDF do Mercos tem
 * cada item como uma sequência regular de linhas:
 *   [#]  CÓDIGO  →  descrição (1-2 linhas)  →  Qtde  →  R$ preço  →  R$ subtotal
 * O "#" e o CÓDIGO podem vir na MESMA linha ("10 CB4904") ou em linhas
 * separadas ("7" / "CB3912") — ambos suportados. Validado no Pedido #13136:
 * 18/18 itens, soma dos subtotais = total do pedido.
 */
export const parseItensFromLines = (lines: string[]): ItemRaw[] => {
  const startItem = (i: number): { numero: string; codigo: string; next: number } | null => {
    const m = RE_NUM_COD.exec(lines[i]);
    if (m) return { numero: m[1], codigo: m[2], next: i + 1 };
    if (RE_INT.test(lines[i]) && i + 1 < lines.length && RE_COD.test(lines[i + 1])) {
      return { numero: lines[i], codigo: lines[i + 1], next: i + 2 };
    }
    return null;
  };

  const itens: ItemRaw[] = [];
  let i = 0;
  while (i < lines.length) {
    const st = startItem(i);
    if (!st) { i++; continue; }
    const { numero, codigo } = st;
    i = st.next;
    // descrição: linhas até a qtde (inteiro), um preço (R$) ou o próximo item
    const desc: string[] = [];
    while (i < lines.length && !RE_INT.test(lines[i]) && !RE_RS.test(lines[i]) && !startItem(i)) {
      desc.push(lines[i]); i++;
    }
    let qtde = 0;
    if (i < lines.length && RE_INT.test(lines[i])) { qtde = Number(lines[i]); i++; }
    let preco = 0;
    if (i < lines.length && RE_RS.test(lines[i])) { preco = parseBRL(lines[i]); i++; }
    let subtotal = 0;
    if (i < lines.length && RE_RS.test(lines[i])) { subtotal = parseBRL(lines[i]); i++; }
    itens.push({
      numero, codigo,
      descricao: desc.join(' ').replace(/\s+/g, ' ').trim(),
      qtde, descontoStr: '', preco, subtotal,
    });
  }
  return itens;
};

// ───────────────────────────────────────────────────────────────
// Cabeçalho (regex-based no texto da primeira página)
// ───────────────────────────────────────────────────────────────

const buildPageText = (spans: Span[]): string => {
  // Reconstrói linhas por Y para parser de cabeçalho
  const linhas: { y: number; spans: Span[] }[] = [];
  for (const s of spans) {
    const linha = linhas.find(l => Math.abs(l.y - s.y) <= 3);
    if (linha) linha.spans.push(s);
    else linhas.push({ y: s.y, spans: [s] });
  }
  linhas.sort((a, b) => a.y - b.y);
  return linhas
    .map(l => l.spans.sort((a, b) => a.x - b.x).map(s => s.str).join(' '))
    .join('\n');
};

const parseCabecalho = (text: string): PedidoCabecalho => {
  const cab: PedidoCabecalho = {};

  cab.numero = text.match(/Pedido\s*N[ºo]?\s*([\d]+)/i)?.[1];

  cab.fornecedorNome = text.match(/Representada:\s*(.+?)(?=\n|CNPJ:)/i)?.[1]?.trim();

  const cnpjs = Array.from(text.matchAll(/CNPJ:\s*([\d./\-]+)/gi)).map(m => m[1].trim());
  cab.fornecedorCnpj = cnpjs[0];
  cab.clienteCnpj = cnpjs[1];

  const telefones = Array.from(text.matchAll(/Telefone:\s*([(\d).\s\-)]+)/gi)).map(m => m[1].trim());
  cab.fornecedorTelefone = telefones[0];
  cab.clienteTelefone = telefones[1];
  cab.transpTelefone = telefones[2];

  cab.clienteRazaoSocial = text.match(/Cliente:\s*(.+?)(?=\s*Nome Fantasia:|\n)/i)?.[1]?.trim();
  cab.clienteNomeFantasia = text.match(/Nome\s+Fantasia:\s*(.+?)(?=\n|CNPJ:)/i)?.[1]?.trim();
  cab.clienteIE = text.match(/Inscri[çc][ãa]o\s+Estadual:\s*([\d./\-]+)/i)?.[1]?.trim();
  cab.clienteEndereco = text.match(/Endere[çc]o:\s*(.+?)(?=\nBairro:|\sBairro:)/i)?.[1]?.trim();
  cab.clienteBairro = text.match(/Bairro:\s*(.+?)(?=\s*CEP:|\n)/i)?.[1]?.trim();
  cab.clienteCEP = text.match(/CEP:\s*([\d\-]+)/i)?.[1]?.trim();
  cab.clienteCidade = text.match(/Cidade:\s*(.+?)(?=\s*Estado:|\n)/i)?.[1]?.trim();
  const estado = text.match(/Estado:\s*(.+?)(?=\nTelefone:|\sTelefone:|\n)/i)?.[1]?.trim();
  if (estado) cab.clienteUF = UF_MAP[estado] || (estado.length === 2 ? estado : '');
  cab.clienteEmail = text.match(/E-?mail:\s*([\w.\-+]+@[\w.\-]+\.\w+)/i)?.[1]?.trim();
  cab.clienteContato = text.match(/Contato:\s*(.+?)(?=\n|#)/i)?.[1]?.trim();

  cab.vendedor = text.match(/Vendedor:\s*(.+?)(?=\n|Transportadora)/i)?.[1]?.trim();
  cab.dataEmissao = text.match(/Data\s+de\s+Emiss[ãa]o:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1];
  cab.condicaoPagamento = text.match(/Condi[çc][ãa]o\s+de\s+Pagamento:\s*(.+?)(?=\n|Data)/i)?.[1]?.trim();
  cab.transpNome = text.match(/Transportadora:\s*(.+?)(?=\n|Telefone:)/i)?.[1]?.trim();

  const infoMatch = text.match(/Informa[çc][õo]es\s+adicionais:\s*([\s\S]+?)(?=N[ÃA]O\s+RESPONDER|SAC|$)/i);
  if (infoMatch) cab.informacoesAdicionais = infoMatch[1].trim().replace(/\s+/g, ' ');

  const valorMatch = text.match(/Valor\s+total:\s*R?\$\s*([\d.,]+)/i);
  if (valorMatch) cab.valorTotal = parseBRL(valorMatch[1]);

  return cab;
};

// ───────────────────────────────────────────────────────────────
// Função pública
// ───────────────────────────────────────────────────────────────

export const parseMercosOrderPdf = async (
  file: File | ArrayBuffer
): Promise<PedidoProcessado> => {
  const pages = await extractSpans(file);

  // Cabeçalho: extrair de TODAS as páginas concatenadas (texto reconstituído)
  const allText = pages.map(buildPageText).join('\n');
  const cabecalho = parseCabecalho(allText);

  // Itens: reconstrói TODAS as linhas (todas as páginas, em ordem) e parseia
  // por padrão de linha — robusto a layouts e a cabeçalhos repetidos por página.
  const allLines = pages.flatMap(spansToLines);
  const rawItens = parseItensFromLines(allLines);
  // Ordena pelo número do item para garantir sequência correta
  rawItens.sort((a, b) => Number(a.numero) - Number(b.numero));

  const itens: ItemPedidoNormalizado[] = rawItens.map(r => ({
    codigo: r.codigo,
    descricao: r.descricao,
    quantidade: r.qtde,
    precoUnitario: r.preco,
    total: r.subtotal,
    desconto: parseDescPercent(r.descontoStr),
    ipi: 0,
    observacoes: r.descontoStr ? `Desc.: ${r.descontoStr}` : '',
    referenciaPedido: cabecalho.numero || '',
    status: r.codigo && r.qtde > 0 && r.preco > 0 ? 'ok' : 'incompleto',
    erros: [],
  }));

  const stats = {
    totalItens: itens.length,
    itensOk: itens.filter(i => i.status === 'ok').length,
    itensIncompletos: itens.filter(i => i.status === 'incompleto').length,
    itensErro: itens.filter(i => i.status === 'erro').length,
  };

  return {
    bruto: {
      nomeArquivo: file instanceof File ? file.name : 'mercos-pedido.pdf',
      linhas: [],
      linhas2D: [],
      headerRowIndex: 0,
      headersDetectados: ['#', 'Código', 'Produto', 'Qtde', 'Desc', 'Preço', 'Subtotal'],
    },
    mapeamento: {
      codigo: 'Código',
      descricao: 'Produto',
      quantidade: 'Qtde',
      preco: 'Preço',
      total: 'Subtotal',
      observacoes: null,
      referenciaPedido: null,
    },
    itens,
    cabecalho,
    stats,
    destino: 'jaweb',
  };
};

// Compat com testes anteriores
export const extractMercosOrderText = async (file: File | ArrayBuffer): Promise<string> => {
  const pages = await extractSpans(file);
  return pages.map(buildPageText).join('\n\n--- PAGE ---\n\n');
};
