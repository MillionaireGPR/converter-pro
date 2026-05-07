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

const parseItensFromSpans = (allSpans: Span[]): ItemRaw[] => {
  // Agrupa por Y com CENTRO FIXO (não média móvel — evitava mesclar linhas
  // próximas de itens distintos quando a média gradualmente se deslocava).
  const sorted = [...allSpans].sort((a, b) => a.y - b.y || a.x - b.x);
  const linhas: { y: number; spans: Span[] }[] = [];
  const TOL_Y = 2.5;
  for (const s of sorted) {
    let bucket = linhas.length > 0 ? linhas[linhas.length - 1] : null;
    if (bucket && Math.abs(bucket.y - s.y) <= TOL_Y) {
      bucket.spans.push(s);
    } else {
      linhas.push({ y: s.y, spans: [s] }); // y FIXO ao primeiro span do bucket
    }
  }
  linhas.forEach(l => l.spans.sort((a, b) => a.x - b.x));

  // ── Detecta limites verticais da TABELA de itens ──
  // Topo: linha contendo "# Código Produto Qtde Desc Preço" (cabeçalho da tabela)
  // Fundo: linha contendo "Valor total" (rodapé do pedido)
  let yTabelaTop = -Infinity;
  let yTabelaBottom = Infinity;
  for (const linha of linhas) {
    const texto = linha.spans.map(s => s.str).join(' ').toLowerCase();
    if (
      texto.includes('código') &&
      texto.includes('produto') &&
      texto.includes('qtde') &&
      yTabelaTop === -Infinity
    ) {
      yTabelaTop = linha.y;
    }
    if (texto.includes('valor total') && linha.y > yTabelaTop) {
      yTabelaBottom = Math.min(yTabelaBottom, linha.y);
    }
  }

  // ── Detecta anchors apenas DENTRO da tabela ──
  const anchorIdxs: number[] = [];
  for (let i = 0; i < linhas.length; i++) {
    if (linhas[i].y <= yTabelaTop || linhas[i].y >= yTabelaBottom) continue;
    const sp = linhas[i].spans;
    if (sp.length < 2) continue;
    const s0 = sp[0], s1 = sp[1];
    if (
      s0.x < 50 && /^\d{1,3}$/.test(s0.str) &&
      s1.x < 80 && /^[A-Z]{1,4}\d{2,8}$/i.test(s1.str)
    ) {
      anchorIdxs.push(i);
    }
  }

  // Ordena anchors por Y para definir as faixas de descrição corretamente
  anchorIdxs.sort((a, b) => linhas[a].y - linhas[b].y);

  const itens: ItemRaw[] = [];

  for (let ai = 0; ai < anchorIdxs.length; ai++) {
    const anchorLine = linhas[anchorIdxs[ai]];
    const sp = anchorLine.spans;

    const numero = sp[0].str;
    const codigo = sp[1].str;

    const qtdeSpan = sp.find(s => s.x >= 330 && s.x <= 365 && /^\d+$/.test(s.str));
    const descSpan = sp.filter(s => s.x >= 370 && s.x <= 410 && /%/.test(s.str));
    const precoSpan = sp.find(s => s.x >= 450 && s.x <= 510 && /R\$/.test(s.str));
    const subtotalSpan = sp.find(s => s.x >= 510 && s.x <= 560 && /R\$/.test(s.str));

    // Faixa Y da descrição: do meio do anchor anterior até o meio do próximo
    const prevAnchor = ai > 0 ? linhas[anchorIdxs[ai - 1]] : null;
    const nextAnchor = ai < anchorIdxs.length - 1 ? linhas[anchorIdxs[ai + 1]] : null;
    const yMin = prevAnchor ? (prevAnchor.y + anchorLine.y) / 2 : anchorLine.y - 35;
    const yMax = nextAnchor ? (anchorLine.y + nextAnchor.y) / 2 : anchorLine.y + 35;

    const descParts: { y: number; text: string }[] = [];
    for (const linha of linhas) {
      if (linha.y <= yMin || linha.y >= yMax) continue;
      // INCLUI o anchor: alguns itens têm a descrição inline (mesma linha do código)
      // O filtro X (140-320) já garante que não pegamos número/qtde/preço.
      // Filtro X restrito: 140-320 (descrição-só, exclui colunas numéricas)
      for (const s of linha.spans) {
        if (s.x >= 140 && s.x <= 320) {
          descParts.push({ y: linha.y, text: s.str });
        }
      }
    }
    descParts.sort((a, b) => a.y - b.y);
    const descricao = descParts.map(p => p.text).join(' ').replace(/\s+/g, ' ').trim();

    itens.push({
      numero,
      codigo,
      descricao,
      qtde: qtdeSpan ? Number(qtdeSpan.str) : 0,
      descontoStr: descSpan.map(s => s.str).join(' ').trim(),
      preco: precoSpan ? parseBRL(precoSpan.str) : 0,
      subtotal: subtotalSpan ? parseBRL(subtotalSpan.str) : 0,
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

  // Itens: processa CADA página separadamente (Y se repete entre páginas)
  // depois agrega na ordem correta usando o # de cada item.
  const rawItens: ItemRaw[] = [];
  for (const pageSpans of pages) {
    rawItens.push(...parseItensFromSpans(pageSpans));
  }
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
