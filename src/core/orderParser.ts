import * as XLSX from 'xlsx';
import {
  PedidoBruto,
  ItemPedidoNormalizado,
  OrderColumnMapping,
  PedidoProcessado,
  StatusItemPedido,
} from './types/orderTypes';

// ===== ALIASES PARA COLUNAS DE PEDIDO =====

const ORDER_ALIASES: Record<keyof OrderColumnMapping, string[]> = {
  codigo: ['codigo', 'cod', 'sku', 'referencia', 'ref', 'item', 'codigoproduto', 'codproduto', 'partnumber'],
  descricao: ['descricao', 'descr', 'produto', 'nome', 'nomeproduto', 'description', 'desc'],
  quantidade: ['qtd', 'quantidade', 'qtde', 'qty', 'quant', 'qnt'],
  preco: ['preco', 'precounitario', 'valorunitario', 'vlunit', 'unitario', 'vlrunit', 'precoun', 'unit'],
  total: ['total', 'valortotal', 'vlrtotal', 'subtotal', 'totalliquido'],
  observacoes: ['observacao', 'observacoes', 'obs', 'nota', 'notas', 'comentario'],
  referenciaPedido: ['pedido', 'numeropedido', 'numpedido', 'referenciapedido', 'nropedido', 'nrpedido', 'nfpedido'],
};

// ===== NORMALIZAÇÃO DE HEADER =====

const normalizeHeader = (header: string): string => {
  if (!header) return '';
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
};

// ===== DETECÇÃO DA LINHA DE CABEÇALHO =====

const ORDER_KEYWORDS = [
  'codigo', 'cod', 'sku', 'referencia',
  'descricao', 'produto', 'nome',
  'qtd', 'quantidade', 'qtde',
  'preco', 'valor', 'unitario', 'total',
  'observacao', 'obs', 'pedido',
];

export const detectarCabecalhoPedido = (rawRows: any[][]): number => {
  let bestScore = -1;
  let bestIndex = 0;
  const maxRows = Math.min(rawRows.length, 20);

  for (let i = 0; i < maxRows; i++) {
    const row = rawRows[i];
    if (!row || !Array.isArray(row)) continue;

    const filledCells = row.filter(
      (cell) => cell && typeof cell === 'string' && cell.trim().length > 0
    );
    if (filledCells.length < 2) continue;

    let rowScore = filledCells.length;

    for (const cell of filledCells) {
      const normCell = normalizeHeader(String(cell));
      if (
        ORDER_KEYWORDS.some(
          (keyword) => normCell.includes(keyword) && keyword.length > 2
        )
      ) {
        rowScore += 10;
      }
    }

    console.log(
      `[Order Parser] Candidata L${i + 1} | Células: ${filledCells.length} | Score: ${rowScore} | Preview:`,
      row.slice(0, 6)
    );

    if (rowScore > bestScore) {
      bestScore = rowScore;
      bestIndex = i;
    }
  }

  console.log(`[Order Parser] Linha de cabeçalho detectada: L${bestIndex + 1}`);
  return bestIndex;
};

// ===== MAPEAMENTO DE COLUNAS =====

export const mapearColunasPedido = (headers: string[]): OrderColumnMapping => {
  const mapping: OrderColumnMapping = {
    codigo: null,
    descricao: null,
    quantidade: null,
    preco: null,
    total: null,
    observacoes: null,
    referenciaPedido: null,
  };

  const normalizedHeaders = headers.map((h) => ({
    original: h,
    norm: normalizeHeader(h),
  }));

  for (const [field, aliases] of Object.entries(ORDER_ALIASES)) {
    // 1. Match exato
    let matched = normalizedHeaders.find((h) => aliases.includes(h.norm));

    // 2. Match parcial (contains)
    if (!matched) {
      matched = normalizedHeaders.find((h) =>
        aliases.some((alias) => h.norm.includes(alias) && alias.length > 2)
      );
    }

    if (matched) {
      (mapping as any)[field] = matched.original;
    }
  }

  console.log('[Order Parser] Mapeamento de colunas detectado:', mapping);
  return mapping;
};

// ===== LEITURA DO ARQUIVO =====

export const lerArquivoPedido = (
  file: File
): Promise<PedidoBruto> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) {
          reject(new Error('Arquivo vazio ou não legível.'));
          return;
        }

        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheet];

        // Extrai como array 2D (todas as linhas)
        const linhas2D: any[][] = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: '',
        });

        // Detecta o cabeçalho real
        const headerRowIndex = detectarCabecalhoPedido(linhas2D);
        const headerRow = linhas2D[headerRowIndex];
        const headersDetectados = headerRow.map((h: any) => String(h || '').trim());

        // Converte as linhas abaixo do header em objetos
        const dataRows = linhas2D.slice(headerRowIndex + 1);
        const linhas: Record<string, any>[] = dataRows
          .filter((row) => row.some((cell: any) => cell !== '' && cell != null))
          .map((row) => {
            const obj: Record<string, any> = {};
            headersDetectados.forEach((header: string, idx: number) => {
              if (header) {
                obj[header] = row[idx] !== undefined ? row[idx] : '';
              }
            });
            return obj;
          });

        console.log(`[Order Parser] Arquivo "${file.name}" lido. ${linhas.length} linhas de dados.`);
        console.log(`[Order Parser] Headers detectados:`, headersDetectados.filter(Boolean));
        console.log(`[Order Parser] Preview 5 primeiras linhas:`, linhas.slice(0, 5));

        resolve({
          nomeArquivo: file.name,
          linhas,
          linhas2D,
          headerRowIndex,
          headersDetectados: headersDetectados.filter(Boolean),
        });
      } catch (err) {
        reject(new Error(`Erro ao processar o arquivo: ${err}`));
      }
    };

    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
};

// ===== NORMALIZAR ITENS DO PEDIDO =====

const parseNumber = (val: any): number => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const str = String(val)
    .replace(/[R$\s]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
};

export const normalizarItensPedido = (
  linhas: Record<string, any>[],
  mapping: OrderColumnMapping
): ItemPedidoNormalizado[] => {
  return linhas.map((row, index) => {
    const erros: string[] = [];

    const codigo = mapping.codigo ? String(row[mapping.codigo] || '').trim() : '';
    const descricao = mapping.descricao ? String(row[mapping.descricao] || '').trim() : '';
    const quantidade = mapping.quantidade ? parseNumber(row[mapping.quantidade]) : 0;
    const precoUnitario = mapping.preco ? parseNumber(row[mapping.preco]) : 0;
    const totalLido = mapping.total ? parseNumber(row[mapping.total]) : 0;
    const observacoes = mapping.observacoes ? String(row[mapping.observacoes] || '').trim() : '';
    const referenciaPedido = mapping.referenciaPedido
      ? String(row[mapping.referenciaPedido] || '').trim()
      : '';

    // Calcula total: prioriza o lido, senão calcula qty * preço
    const total = totalLido > 0 ? totalLido : +(quantidade * precoUnitario).toFixed(2);

    // Validações
    if (!codigo) erros.push('Código não encontrado');
    if (!descricao) erros.push('Descrição não encontrada');
    if (quantidade <= 0) erros.push('Quantidade inválida');
    if (precoUnitario <= 0 && totalLido <= 0) erros.push('Preço ou total não encontrado');

    let status: StatusItemPedido = 'ok';
    if (erros.length > 0 && (codigo || descricao)) {
      status = 'incompleto';
    }
    if (!codigo && !descricao) {
      status = 'erro';
    }

    if (index < 5) {
      console.log(`[Order Parser] Item ${index + 1}:`, {
        codigo,
        descricao,
        quantidade,
        precoUnitario,
        total,
        status,
        erros,
      });
    }

    return {
      codigo,
      descricao,
      quantidade,
      precoUnitario,
      total,
      observacoes,
      referenciaPedido,
      status,
      erros,
    };
  });
};

// ===== FUNÇÃO PRINCIPAL: PROCESSAR PEDIDO COMPLETO =====

export const processarPedido = async (
  file: File,
  destino: string
): Promise<PedidoProcessado> => {
  const bruto = await lerArquivoPedido(file);
  const mapeamento = mapearColunasPedido(bruto.headersDetectados);
  const itens = normalizarItensPedido(bruto.linhas, mapeamento);

  const stats = itens.reduce(
    (acc, item) => {
      acc.totalItens++;
      if (item.status === 'ok') acc.itensOk++;
      else if (item.status === 'incompleto') acc.itensIncompletos++;
      else acc.itensErro++;
      return acc;
    },
    { totalItens: 0, itensOk: 0, itensIncompletos: 0, itensErro: 0 }
  );

  console.log('[Order Parser] Estatísticas finais:', stats);
  console.log('[Order Parser] Destino selecionado:', destino || '(nenhum)');

  return { bruto, mapeamento, itens, stats, destino };
};
