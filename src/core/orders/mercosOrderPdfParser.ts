// ===================================================================
// PARSER DE PEDIDO PDF DO MERCOS → JAW WEB
// Recebe o PDF "Pedido modelo de exportação do Mercos" e extrai:
//  - Cabeçalho (cliente, fornecedor, transportadora, datas)
//  - Itens (código, descrição, qtde, desconto, preço, subtotal)
// Saída: PedidoProcessado pronto para exportação em formato JAW WEB.
// ===================================================================

import type {
  PedidoProcessado,
  PedidoCabecalho,
  ItemPedidoNormalizado,
} from './orderTypes';

// Carregamento dinâmico do PDF.js (mesma lib usada no pdfParser principal)
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

/**
 * Extrai o texto bruto concatenado de todas as páginas, preservando quebras
 * de linha aproximadas via análise de coordenadas Y.
 */
export const extractMercosOrderText = async (file: File | ArrayBuffer): Promise<string> => {
  const data = file instanceof File ? await file.arrayBuffer() : file;
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data }).promise;
  const linhas: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Agrupa items por Y (linha) com tolerância
    const itemsByY: Map<number, { x: number; str: string }[]> = new Map();
    for (const it of content.items as any[]) {
      const y = Math.round(it.transform[5]);
      if (!itemsByY.has(y)) itemsByY.set(y, []);
      itemsByY.get(y)!.push({ x: it.transform[4], str: it.str });
    }
    // Ordena Y descendente (PDF tem origem inferior-esquerda)
    const ys = Array.from(itemsByY.keys()).sort((a, b) => b - a);
    for (const y of ys) {
      const itemsX = itemsByY.get(y)!.sort((a, b) => a.x - b.x);
      linhas.push(itemsX.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim());
    }
    linhas.push(''); // separador entre páginas
  }
  return linhas.join('\n');
};

// ───────────────────────────────────────────────────────────────
// Helpers de parsing
// ───────────────────────────────────────────────────────────────

const matchAfter = (text: string, label: RegExp, until: RegExp = /\n|$/): string => {
  const re = new RegExp(label.source + '\\s*(.+?)(?=' + until.source + ')', 'i');
  const m = text.match(re);
  return m ? m[1].trim() : '';
};

const parseDescPercent = (raw: string): number => {
  // "30%" => 0.30 ; "30% + 15%" => 1 - (1-0.30)*(1-0.15) = 0.405
  if (!raw) return 0;
  const pcts = Array.from(raw.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g))
    .map(m => Number(m[1].replace(',', '.')) / 100)
    .filter(n => !isNaN(n));
  if (pcts.length === 0) return 0;
  // Composto cumulativo
  return 1 - pcts.reduce((acc, p) => acc * (1 - p), 1);
};

const parseBRL = (raw: string): number => {
  if (!raw) return 0;
  const cleaned = raw
    .replace(/R\$\s*/gi, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.\-]/g, '');
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
};

// ───────────────────────────────────────────────────────────────
// Parser principal
// ───────────────────────────────────────────────────────────────

export const parseMercosOrderPdf = async (
  file: File | ArrayBuffer
): Promise<PedidoProcessado> => {
  const text = await extractMercosOrderText(file);

  // ── Cabeçalho ──
  const cab: PedidoCabecalho = {};

  // Pedido Nº
  const numMatch = text.match(/Pedido\s*N[ºo]?\s*([\d]+)/i);
  if (numMatch) cab.numero = numMatch[1];

  // Representada (fornecedor)
  const repMatch = text.match(/Representada:\s*(.+?)(?=\n|CNPJ:)/i);
  if (repMatch) cab.fornecedorNome = repMatch[1].trim();

  // CNPJ do fornecedor (primeiro CNPJ depois de "Representada:")
  const cnpjs = Array.from(text.matchAll(/CNPJ:\s*([\d./\-]+)/gi)).map(m => m[1].trim());
  if (cnpjs[0]) cab.fornecedorCnpj = cnpjs[0];
  if (cnpjs[1]) cab.clienteCnpj = cnpjs[1];

  // Telefone do fornecedor (primeiro Telefone)
  const telefones = Array.from(text.matchAll(/Telefone:\s*([(\d).\s\-]+)/gi)).map(m => m[1].trim());
  if (telefones[0]) cab.fornecedorTelefone = telefones[0];
  if (telefones[1]) cab.clienteTelefone = telefones[1];

  // Cliente (Razão Social)
  const cliMatch = text.match(/Cliente:\s*(.+?)(?=\s*Nome Fantasia:|\n)/i);
  if (cliMatch) cab.clienteRazaoSocial = cliMatch[1].trim();

  const fantasiaMatch = text.match(/Nome\s+Fantasia:\s*(.+?)(?=\n|CNPJ:)/i);
  if (fantasiaMatch) cab.clienteNomeFantasia = fantasiaMatch[1].trim();

  // IE
  const ieMatch = text.match(/Inscri[çc][ãa]o\s+Estadual:\s*([\d./\-]+)/i);
  if (ieMatch) cab.clienteIE = ieMatch[1].trim();

  // Endereço, Bairro, CEP, Cidade, Estado
  const enderecoMatch = text.match(/Endere[çc]o:\s*(.+?)(?=\nBairro:|\sBairro:)/i);
  if (enderecoMatch) cab.clienteEndereco = enderecoMatch[1].trim();

  const bairroMatch = text.match(/Bairro:\s*(.+?)(?=\s*CEP:|\n)/i);
  if (bairroMatch) cab.clienteBairro = bairroMatch[1].trim();

  const cepMatch = text.match(/CEP:\s*([\d\-]+)/i);
  if (cepMatch) cab.clienteCEP = cepMatch[1].trim();

  const cidadeMatch = text.match(/Cidade:\s*(.+?)(?=\s*Estado:|\n)/i);
  if (cidadeMatch) cab.clienteCidade = cidadeMatch[1].trim();

  const estadoMatch = text.match(/Estado:\s*(.+?)(?=\nTelefone:|\sTelefone:|\n)/i);
  if (estadoMatch) {
    const estado = estadoMatch[1].trim();
    // Mapeamento UF
    const ufMap: Record<string, string> = {
      'Acre': 'AC', 'Alagoas': 'AL', 'Amapá': 'AP', 'Amazonas': 'AM',
      'Bahia': 'BA', 'Ceará': 'CE', 'Distrito Federal': 'DF', 'Espírito Santo': 'ES',
      'Goiás': 'GO', 'Maranhão': 'MA', 'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS',
      'Minas Gerais': 'MG', 'Pará': 'PA', 'Paraíba': 'PB', 'Paraná': 'PR',
      'Pernambuco': 'PE', 'Piauí': 'PI', 'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN',
      'Rio Grande do Sul': 'RS', 'Rondônia': 'RO', 'Roraima': 'RR', 'Santa Catarina': 'SC',
      'São Paulo': 'SP', 'Sergipe': 'SE', 'Tocantins': 'TO',
    };
    cab.clienteUF = ufMap[estado] || (estado.length === 2 ? estado : '');
  }

  // Email do cliente
  const emails = Array.from(text.matchAll(/E-?mail:\s*([\w.\-+]+@[\w.\-]+\.\w+)/gi)).map(m => m[1].trim());
  if (emails[0]) cab.clienteEmail = emails[0];

  // Contato
  const contatoMatch = text.match(/Contato:\s*(.+?)(?=\n|#)/i);
  if (contatoMatch) cab.clienteContato = contatoMatch[1].trim();

  // Vendedor
  const vendedorMatch = text.match(/Vendedor:\s*(.+?)(?=\n|Transportadora)/i);
  if (vendedorMatch) cab.vendedor = vendedorMatch[1].trim();

  // Data Emissão
  const dataMatch = text.match(/Data\s+de\s+Emiss[ãa]o:\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (dataMatch) cab.dataEmissao = dataMatch[1];

  // Condição de Pagamento
  const pagMatch = text.match(/Condi[çc][ãa]o\s+de\s+Pagamento:\s*(.+?)(?=\n|Data)/i);
  if (pagMatch) cab.condicaoPagamento = pagMatch[1].trim();

  // Transportadora
  const transpMatch = text.match(/Transportadora:\s*(.+?)(?=\n|Telefone:)/i);
  if (transpMatch) cab.transpNome = transpMatch[1].trim();

  // Telefone da transportadora (vem depois de Transportadora:)
  if (telefones[2]) cab.transpTelefone = telefones[2];

  // Informações adicionais
  const infoMatch = text.match(/Informa[çc][õo]es\s+adicionais:\s*(.+?)(?=N[ÃA]O\s+RESPONDER|SAC|$)/is);
  if (infoMatch) cab.informacoesAdicionais = infoMatch[1].trim().replace(/\s+/g, ' ');

  // Valor total (para conferência)
  const valorMatch = text.match(/Valor\s+total:\s*R?\$\s*([\d.,]+)/i);
  if (valorMatch) cab.valorTotal = parseBRL(valorMatch[1]);

  // ── Itens ──
  const itens: ItemPedidoNormalizado[] = [];

  // Padrão: linha começa com número (#), depois código, descrição, qtde, desc, preço, subtotal
  // Ex: "1 F0189 BOMBONIERE 500ML... 180 30% R$ 8,90 R$ 1.601,46"
  // No texto extraído o PDF.js às vezes quebra entre linhas; vamos reagrupar.

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  // Buffer para reagrupar descrição multi-linha
  let buffer: string | null = null;

  const itemRegex = /^(\d+)\s+([A-Z0-9]{2,12})\s+(.+?)\s+(\d+)\s+([\d%+\s]+%)\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)$/;

  for (const raw of lines) {
    const line = (buffer ? buffer + ' ' : '') + raw;
    const m = line.match(itemRegex);
    if (m) {
      const [, , codigo, descricao, qtdStr, descStr, precoStr, subtotalStr] = m;
      const quantidade = Number(qtdStr) || 0;
      const desconto = parseDescPercent(descStr);
      const precoUnitario = parseBRL(precoStr);
      const total = parseBRL(subtotalStr);
      itens.push({
        codigo: codigo.trim(),
        descricao: descricao.trim().replace(/\s+/g, ' '),
        quantidade,
        precoUnitario,
        total,
        desconto,
        ipi: 0,
        observacoes: '',
        referenciaPedido: cab.numero || '',
        status: 'ok',
        erros: [],
      });
      buffer = null;
    } else {
      // Linha não casou inteira — pode ser fragmento da próxima descrição
      // Mantém em buffer para tentar com a próxima
      if (/^\d+\s+[A-Z0-9]/.test(line)) {
        buffer = line;
      } else if (buffer) {
        buffer = line; // sobrescreve com nova tentativa
      }
    }
  }

  // ── PedidoProcessado completo ──
  const stats = {
    totalItens: itens.length,
    itensOk: itens.filter(i => i.status === 'ok').length,
    itensIncompletos: 0,
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
    cabecalho: cab,
    stats,
    destino: 'jaweb',
  };
};
