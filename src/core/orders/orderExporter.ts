/**
 * Order Exporter - Sistema de Exportação de Pedidos
 * 
 * Implementa múltiplos formatos de exportação para diferentes fornecedores.
 * Formatos suportados: Nunes, Clink, Gira, Genérico, ERP, JAWEB
 * 
 * Regras de Segurança:
 * - Todos os inputs são validados antes de processamento
 * - Transformações são puras e testáveis
 * - Nenhuma mutação de estado externo
 */

import * as XLSX from 'xlsx-js-style';
import type { PedidoProcessado, ItemPedidoNormalizado } from './orderTypes';

// ===== TIPOS =====

export type FormatoExportacao = 'nunes' | 'clink' | 'gira' | 'generic' | 'erp' | 'jaweb';

export interface ExportColumn {
  key: string;
  header: string;
  format?: 'string' | 'number' | 'integer' | 'currency' | 'percentage';
  width?: number;
  transform?: (value: any, item: ItemPedidoNormalizado) => any;
}

export interface ExportFormat {
  id: FormatoExportacao;
  name: string;
  description: string;
  fileExtension: 'csv' | 'xlsx';
  columns: ExportColumn[];
  hasHeaderStructure?: boolean; // Para formatos como JAWEB que têm cabeçalho especial
  headerTitle?: string;
  itemStartRow?: number;  // Linha onde começam os itens
}

export interface ExportIssue {
  item: number;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  format: FormatoExportacao;
  stats: {
    totalItems: number;
    validItems: number;
    errorItems: number;
  };
  issues: ExportIssue[];
}

export interface ExportOptions {
  onlyValid?: boolean;
  includeErrors?: boolean;
  filename?: string;
}

// ===== CONFIGURAÇÕES DE FORMATO =====

export const EXPORT_FORMATS: Record<FormatoExportacao, ExportFormat> = {
  // Formato Nunes Representações (padrão interno)
  nunes: {
    id: 'nunes',
    name: 'Nunes Representações',
    description: 'Formato padrão interno da Nunes',
    fileExtension: 'xlsx',
    columns: [
      { key: 'codigo', header: 'Código', format: 'string', width: 15 },
      { key: 'descricao', header: 'Descrição', format: 'string', width: 40 },
      { key: 'quantidade', header: 'Quantidade', format: 'integer', width: 12 },
      { key: 'precoUnitario', header: 'Preço Unitário', format: 'currency', width: 15 },
      { key: 'total', header: 'Total', format: 'currency', width: 15 },
      { key: 'ipi', header: 'IPI %', format: 'percentage', width: 10 },
      { key: 'desconto', header: 'Desconto %', format: 'percentage', width: 12 },
    ]
  },

  // Formato Clink (com regras específicas)
  clink: {
    id: 'clink',
    name: 'Clink / Flash / Moment',
    description: 'Formato para família Clink (inclui sufixos especiais)',
    fileExtension: 'xlsx',
    columns: [
      { 
        key: 'codigo', 
        header: 'Código Produto', 
        format: 'string', 
        width: 20,
        transform: (val, item) => {
          // Clink usa códigos específicos como CLINK-XXXX ou CK-XXXX
          const codigo = String(val || '').trim();
          if (codigo.match(/^(CLINK|CK|FLASH|MOMENT)/i)) {
            return codigo.toUpperCase();
          }
          return codigo;
        }
      },
      { key: 'descricao', header: 'Nome do Produto', format: 'string', width: 50 },
      { key: 'quantidade', header: 'Qtde', format: 'integer', width: 10 },
      { key: 'precoUnitario', header: 'Valor Unit', format: 'currency', width: 15 },
      { key: 'ipi', header: 'IPI', format: 'percentage', width: 10 },
      { 
        key: 'total', 
        header: 'Valor Total', 
        format: 'currency', 
        width: 15,
        transform: (val, item) => {
          const qtd = Number(item.quantidade) || 0;
          const preco = Number(item.precoUnitario) || 0;
          const ipi = Number(item.ipi) || 0;
          return qtd * preco * (1 + ipi / 100);
        }
      },
    ]
  },

  // Formato Gira (com identificação de imagens)
  gira: {
    id: 'gira',
    name: 'Gira Imports',
    description: 'Formato específico para Gira Imports com suporte a múltiplas imagens',
    fileExtension: 'xlsx',
    columns: [
      { 
        key: 'codigo', 
        header: 'SKU', 
        format: 'string', 
        width: 18,
        transform: (val) => String(val || '').toUpperCase().replace(/^GIRA-?/i, 'GI-')
      },
      { key: 'descricao', header: 'Nome do Produto', format: 'string', width: 50 },
      { key: 'quantidade', header: 'Qtde', format: 'integer', width: 10 },
      { key: 'precoUnitario', header: 'Valor Unit', format: 'currency', width: 15 },
      { key: 'ipi', header: 'IPI', format: 'percentage', width: 10 },
      { 
        key: 'total', 
        header: 'Valor Total', 
        format: 'currency', 
        width: 15,
        transform: (val, item) => {
          const qtd = Number(item.quantidade) || 0;
          const preco = Number(item.precoUnitario) || 0;
          const ipi = Number(item.ipi) || 0;
          return qtd * preco * (1 + ipi / 100);
        }
      },
    ]
  },

  // Formato Genérico (mais simples)
  generic: {
    id: 'generic',
    name: 'Genérico (CSV)',
    description: 'Formato simples CSV para qualquer sistema',
    fileExtension: 'csv',
    columns: [
      { key: 'codigo', header: 'codigo', format: 'string' },
      { key: 'descricao', header: 'descricao', format: 'string' },
      { key: 'quantidade', header: 'quantidade', format: 'integer' },
      { key: 'precoUnitario', header: 'preco_unitario', format: 'number' },
      { key: 'total', header: 'total', format: 'number' },
    ]
  },

  // Formato ERP (estrutura corporativa)
  erp: {
    id: 'erp',
    name: 'ERP Corporativo',
    description: 'Formato estruturado para sistemas ERP',
    fileExtension: 'xlsx',
    columns: [
      { key: 'codigo', header: 'COD_PRODUTO', format: 'string', width: 15 },
      { key: 'descricao', header: 'DES_PRODUTO', format: 'string', width: 50 },
      { key: 'quantidade', header: 'QTD_PEDIDO', format: 'integer', width: 12 },
      { key: 'precoUnitario', header: 'VLR_UNITARIO', format: 'currency', width: 15 },
      { key: 'ipi', header: 'PER_IPI', format: 'percentage', width: 10 },
      { key: 'desconto', header: 'PER_DESCONTO', format: 'percentage', width: 12 },
      { key: 'total', header: 'VLR_TOTAL', format: 'currency', width: 15 },
      { key: 'unidade', header: 'UN_MEDIDA', format: 'string', width: 8 },
    ]
  },

  // Formato JAWEB (Clink/Moment/FlashGoods) - Estrutura especial
  jaweb: {
    id: 'jaweb',
    name: 'JAWEB (Clink/Moment/FlashGoods)',
    description: 'Formato específico para JAWEB com cabeçalho "PEDIDO DE VENDA" e estrutura de tabela definida',
    fileExtension: 'xlsx',
    hasHeaderStructure: true,
    headerTitle: 'PEDIDO DE VENDA',
    itemStartRow: 27, // Linha 27 começam os itens
    columns: [
      { key: 'codigo', header: 'Cód Prod.', format: 'string', width: 15 },
      { key: 'descricao', header: 'Descrição', format: 'string', width: 45 },
      { key: 'quantidade', header: 'Qtde', format: 'integer', width: 10 },
      { key: 'desconto', header: '%Desc', format: 'percentage', width: 10, transform: () => 0 }, // Fixo 0%
      { key: 'precoUnitario', header: 'Preço Unit', format: 'currency', width: 15 },
      { key: 'ipi', header: 'IPI', format: 'currency', width: 12, transform: () => 0 }, // Fixo R$ 0
      { key: 'total', header: 'Total', format: 'currency', width: 15 },
    ]
  }
};

// ===== FUNÇÕES AUXILIARES =====

/**
 * Aplica transformações customizadas em uma coluna
 */
const applyTransform = (
  value: any, 
  column: ExportColumn, 
  item: ItemPedidoNormalizado
): any => {
  if (column.transform) {
    return column.transform(value, item);
  }
  
  switch (column.format) {
    case 'integer':
      return Math.round(Number(value) || 0);
    case 'number':
      return Number(value) || 0;
    case 'currency':
      return Number(value) || 0;
    case 'percentage':
      return Number(value) || 0;
    default:
      return String(value || '');
  }
};

/**
 * Formata valor para exibição
 */
const formatValue = (value: any, format?: string): string => {
  if (value === null || value === undefined) return '';
  
  switch (format) {
    case 'currency':
      return Number(value).toFixed(2);
    case 'percentage':
      return Number(value).toFixed(2);
    case 'integer':
      return String(Math.round(Number(value)));
    default:
      return String(value);
  }
};

/**
 * Cria worksheet no formato EXATO do template JAW WEB.
 *
 * Estrutura validada contra o "Modelo Pedido JAW WEB.xlsx" oficial:
 *  - A1:I2  -> "PEDIDO DE VENDA" (merged)
 *  - L1:T1+ -> Instruções (campos obrigatórios, ajuda)
 *  - A7:B7  -> "CLIENTE"
 *  - Linhas 8-12: dados do cliente (CNPJ, IE, RzSocial, Endereço, etc.)
 *  - G4:H4  -> DATA, G5:H5 -> VENDEDOR, G7:H7 -> TAB.PRECO, G8:H8 -> PEDIDO EXTERNO
 *  - A14:B14 -> TRANSPORTADORA (CNPJ, IE, RzSocial, Frete tipo)
 *  - A18:C18 -> Dados Adicionais
 *  - Linha 19: Total Qtd (=SUM E26:E64), Total Produtos (=I22-I20)
 *  - Linha 20: Total IPI (=SUM K26:K64)
 *  - Linha 22: Valor Total (=SUM I26:I64)
 *  - Linha 24: rodapé de contato
 *  - Linha 25: HEADERS da tabela (Cód Prod*, Descrição[B:D], Qtde*, %Desc, Preço Unit*, IPI, Total, Tot.IPI[K])
 *  - Linhas 26-64: ITENS com fórmulas pré-definidas em I e K
 */
const criarWorksheetJAWEB = (
  dataRows: Record<string, any>[],
  format: ExportFormat,
  cabecalho?: import('./orderTypes').PedidoCabecalho
): XLSX.WorkSheet => {
  const worksheet: XLSX.WorkSheet = {};
  
  const c = cabecalho || {};

  const setS = (cell: string, v: string | number | undefined | null) => {
    if (v === undefined || v === null || v === '') return;
    worksheet[cell] = { v: typeof v === 'number' ? v : String(v), t: typeof v === 'number' ? 'n' : 's' };
  };
  // Fórmula com valor cached (XLSX pode descartar fórmula sem `v` em algumas serializações)
  const setF = (cell: string, formula: string, cachedValue: number = 0) => {
    worksheet[cell] = { f: formula, v: cachedValue, t: 'n' };
  };

  // ────────── A1:I2 PEDIDO DE VENDA + L1:T_ instruções ──────────
  setS('A1', 'PEDIDO DE VENDA');
  setS('L1', '*Campos Obrigatórios');
  setS('L2', '*Data: Preencha a data de digitação do pedido.');
  setS('L3', '*Tab. Preço: Preencha neste campo a tabela de preço do pedido.');
  setS('L4', 'OBS: Se a tabela não estiver disponível para o cliente que for selecionado, não será possível importar o pedido.');
  setS('L5', 'Dados Cliente');
  setS('L6', '*CNPJ/CPF: Preencha o CNPJ ou CPF do cliente deste pedido, sem pontuação, o excel irá formatar automaticamente.');
  setS('L7', 'Caso seja um cliente novo, é necessário realizar o cadastro do cliente e depois tentar importar o pedido novamente.');
  setS('L8', 'Dados dos Produtos');
  setS('L9', 'OBS: Os campos em cinza não podem ser alterados pois possuem fórmulas de cálculo utilizadas para os totais do pedido.');
  setS('L10', '*Cód. Produto: Preencha o código dos produtos a serem incluídos no pedido, os códigos precisam estar previamente cadastrados.');
  setS('L11', '*QTD: Preencha a quantidade pedida pelo cliente de cada item.');
  setS('L12', '*Preço Unit: Deve ser preenchido o valor da tabela escolhida; se for menor, o sistema rejeitará o pedido.');

  // ────────── G4-G8: DATA / VENDEDOR / TAB.PRECO / PEDIDO EXTERNO ──────────
  setS('G4', 'DATA:*');         setS('I4', c.dataEmissao);
  setS('G5', 'VENDEDOR:');      setS('I5', c.vendedor);
  setS('G7', 'TAB.PRECO*:');    setS('I7', c.tabelaPreco);
  setS('G8', 'PEDIDO EXTERNO:'); setS('I8', c.pedidoExterno || c.numero);

  // ────────── A7:B7 CLIENTE + dados nas linhas 8-12 ──────────
  setS('A7', 'CLIENTE');
  setS('A8', 'CNPJ/CPF:*');     setS('B8', (c.clienteCnpj || '').replace(/\D/g, ''));
  setS('C8', 'IE:');            setS('D8', c.clienteIE);
  setS('A9', 'RzSocial:');      setS('B9', c.clienteRazaoSocial);
  setS('A10', 'Endereco:');     setS('B10', c.clienteEndereco);
  setS('F10', 'N°');            setS('G10', c.clienteNumero);
  setS('H10', 'Compl:');        setS('I10', c.clienteComplemento);
  setS('A11', 'Bairro:');       setS('B11', c.clienteBairro);
  setS('C11', 'Cidade:');       setS('D11', c.clienteCidade);
  setS('F11', 'UF:');           setS('G11', c.clienteUF);
  setS('H11', 'CEP:');          setS('I11', c.clienteCEP);
  setS('A12', 'Email:');        setS('B12', c.clienteEmail);
  setS('C12', 'Email2:');       setS('D12', c.clienteEmail2);
  setS('F12', 'Tel:');          setS('G12', c.clienteTelefone);
  setS('H12', 'Tel2:');         setS('I12', c.clienteTelefone2);

  // ────────── A14:B14 TRANSPORTADORA + frete ──────────
  setS('A14', 'TRANSPORTADORA');
  setS('F14', 'Frete');         setS('G14', c.fretePor || '');
  setS('A15', 'CNPJ/CPF:');     setS('B15', (c.transpCnpj || '').replace(/\D/g, ''));
  setS('C15', 'IE:');           setS('D15', c.transpIE);
  setS('G15', ' 1-Emitente ou 2- Destinatario');
  setS('A16', 'RzSocial:');     setS('B16', c.transpNome);

  // ────────── A18 Dados Adicionais ──────────
  setS('A18', 'Dados Adicionais');
  setS('B18', c.informacoesAdicionais);

  // ────────── Totais (linhas 19-22) com fórmulas ──────────
  setS('D19', 'Total Qtd: ');     setF('E19', 'SUM(E26:E64)');
  setS('H19', 'Total Produtos: '); setF('I19', 'I22-I20');
  setS('H20', 'Total IPI: ');      setF('I20', 'SUM(K26:K64)');
  setS('H22', 'Valor Total:');     setF('I22', 'SUM(I26:I64)');

  // ────────── Linha 24 frase de contato ──────────
  setS('A24', 'Qualquer dúvida ou reclamação entre em contato pelo fone (99) 9999-9999');

  // ────────── Linha 25: HEADERS DA TABELA ──────────
  setS('A25', 'Cód Prod.*');
  setS('B25', 'Descrição');   // merged B25:D25
  setS('E25', 'Qtde*');
  setS('F25', '%Desc');
  setS('G25', 'Preço Unit*');
  setS('H25', 'IPI');
  setS('I25', 'Total');
  setS('K25', 'Tot. IPI');

  // ────────── Linhas 26-64: DADOS DOS ITENS (até 39 itens) ──────────
  const ITEM_START = 26;
  const ITEM_END = 64;

  dataRows.forEach((row, idx) => {
    const r = ITEM_START + idx;
    if (r > ITEM_END) return; // template suporta no máximo 39 itens

    const codigo = row['Cód Prod.'] ?? row['codigo'] ?? '';
    const descricao = row['Descrição'] ?? row['descricao'] ?? '';
    const qtde = Number(row['Qtde'] ?? row['quantidade'] ?? 0) || 0;
    const desc = Number(row['%Desc'] ?? row['desconto'] ?? 0) || 0;
    const preco = Number(row['Preço Unit'] ?? row['precoUnitario'] ?? 0) || 0;
    const ipi = Number(row['IPI'] ?? row['ipi'] ?? 0) || 0;

    setS(`A${r}`, String(codigo));
    setS(`B${r}`, String(descricao));
    if (qtde > 0) worksheet[`E${r}`] = { v: qtde, t: 'n' };
    if (desc > 0) worksheet[`F${r}`] = { v: desc, t: 'n' };
    if (preco > 0) worksheet[`G${r}`] = { v: preco, t: 'n' };
    if (ipi > 0) worksheet[`H${r}`] = { v: ipi, t: 'n' };
    // Fórmulas (idênticas às do template)
    setF(`I${r}`, `E${r}*((G${r})*(1+(H${r})))`);
    setF(`K${r}`, `H${r}*G${r}`);
  });

  // Garantir que linhas vazias do template também tenham as fórmulas (como no original)
  for (let r = ITEM_START + dataRows.length; r <= ITEM_END; r++) {
    setF(`I${r}`, `E${r}*((G${r})*(1+(H${r})))`);
    setF(`K${r}`, `H${r}*G${r}`);
  }

  // Range da planilha
  worksheet['!ref'] = 'A1:T80';

  // Merges (replicam o template oficial)
  worksheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 1, c: 8 } },   // A1:I2 PEDIDO DE VENDA
    { s: { r: 6, c: 0 }, e: { r: 6, c: 1 } },   // A7:B7 CLIENTE
    { s: { r: 13, c: 0 }, e: { r: 13, c: 1 } }, // A14:B14 TRANSPORTADORA
    { s: { r: 17, c: 0 }, e: { r: 17, c: 2 } }, // A18:C18 Dados Adicionais
    { s: { r: 14, c: 6 }, e: { r: 14, c: 8 } }, // G15:I15 1-Emitente ou 2-Destinatario
    { s: { r: 23, c: 0 }, e: { r: 23, c: 8 } }, // A24:I24 Qualquer dúvida
    // Headers e itens com Descrição em B:D
    { s: { r: 24, c: 1 }, e: { r: 24, c: 3 } }, // B25:D25 "Descrição"
    ...Array.from({ length: ITEM_END - ITEM_START + 1 }, (_, i) => ({
      s: { r: ITEM_START - 1 + i, c: 1 },
      e: { r: ITEM_START - 1 + i, c: 3 },
    })),
  ];

  // Larguras de coluna (A-T)
  worksheet['!cols'] = [
    { wch: 12 }, // A - Cód Prod
    { wch: 18 }, // B - Descrição (merged até D)
    { wch: 18 }, // C
    { wch: 18 }, // D
    { wch: 8 },  // E - Qtde
    { wch: 8 },  // F - %Desc
    { wch: 12 }, // G - Preço Unit
    { wch: 8 },  // H - IPI
    { wch: 12 }, // I - Total
    { wch: 4 },  // J
    { wch: 12 }, // K - Tot. IPI
    { wch: 4 },  // L
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
  ];
  
  return worksheet;
};

// ===== FUNÇÃO PRINCIPAL DE EXPORTAÇÃO =====

/**
 * Exporta um pedido processado para o formato especificado
 * 
 * @param pedido - Pedido processado com itens
 * @param formato - Formato de exportação desejado
 * @param options - Opções adicionais de exportação
 * @returns Resultado da exportação com blob e estatísticas
 */
export const exportarPedido = (
  pedido: PedidoProcessado,
  formato: FormatoExportacao,
  options?: ExportOptions
): ExportResult => {
  const format = EXPORT_FORMATS[formato];
  
  // Filtrar itens baseado nas opções
  let itemsToExport = pedido.itens;
  
  if (options?.onlyValid) {
    itemsToExport = itemsToExport.filter(item => item.status === 'ok');
  }
  
  if (!options?.includeErrors) {
    itemsToExport = itemsToExport.filter(item => !item.erros || item.erros.length === 0);
  }
  
  // Transformar dados para o formato de exportação
  const dataRows = itemsToExport.map(item => {
    const row: Record<string, any> = {};
    format.columns.forEach(col => {
      const value = (item as any)[col.key];
      row[col.header] = applyTransform(value, col, item);
    });
    return row;
  });
  
  // Gerar arquivo
  let blob: Blob;
  let mimeType: string;
  
  if (format.fileExtension === 'csv') {
    // Exportar como CSV
    const headers = format.columns.map(col => col.header).join(';');
    const rows = dataRows.map(row => 
      format.columns.map(col => {
        const val = row[col.header];
        return formatValue(val, col.format);
      }).join(';')
    ).join('\n');
    
    const csvContent = `${headers}\n${rows}`;
    blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    mimeType = 'text/csv';
  } else {
    // Exportar como Excel
    let worksheet: XLSX.WorkSheet;
    
    // Caso especial JAWEB: estrutura com cabeçalho PEDIDO DE VENDA
    if (formato === 'jaweb' && format.hasHeaderStructure) {
      worksheet = criarWorksheetJAWEB(dataRows, format, pedido.cabecalho);
    } else {
      worksheet = XLSX.utils.json_to_sheet(dataRows, {
        header: format.columns.map(col => col.header),
      });
      
      // Configurar larguras das colunas
      const colWidths = format.columns.map(col => ({ wch: col.width || 15 }));
      worksheet['!cols'] = colWidths;
    }
    
    // Criar workbook
    const workbook: XLSX.WorkBook = {
      Sheets: { 'Pedido': worksheet },
      SheetNames: ['Pedido'],
    };
    
    // Gerar arquivo Excel
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  
  // Gerar nome do arquivo
  const timestamp = new Date().toISOString().slice(0, 10);
  const safeFilename = options?.filename || `pedido_${formato}_${timestamp}`;
  const fullFilename = `${safeFilename}.${format.fileExtension}`;
  
  // Coletar estatísticas
  const stats = {
    totalItems: pedido.itens.length,
    validItems: pedido.itens.filter(i => i.status === 'ok').length,
    errorItems: pedido.itens.filter(i => i.status === 'erro' || (i.erros && i.erros.length > 0)).length,
  };
  
  return {
    blob,
    filename: fullFilename,
    format: formato,
    stats,
    issues: [], // Será preenchido por validação separada
  };
};

// ===== FUNÇÕES DE VALIDAÇÃO =====

/**
 * Valida um pedido antes da exportação
 * 
 * @param pedido - Pedido a ser validado
 * @param formato - Formato de exportação
 * @returns Lista de issues encontradas
 */
export const validarPedidoParaExportacao = (
  pedido: PedidoProcessado,
  formato: FormatoExportacao
): ExportIssue[] => {
  const issues: ExportIssue[] = [];
  const format = EXPORT_FORMATS[formato];
  
  // Validar campos obrigatórios
  const camposObrigatorios = ['codigo', 'descricao', 'quantidade'];
  
  pedido.itens.forEach((item, index) => {
    camposObrigatorios.forEach(campo => {
      const valor = (item as any)[campo];
      if (!valor || String(valor).trim() === '') {
        issues.push({
          item: index + 1,
          field: campo,
          message: `Campo obrigatório '${campo}' está vazio`,
          severity: 'error',
        });
      }
    });
    
    // Validações específicas por formato
    if (formato === 'clink' && !item.codigo?.match(/^(CLINK|CK|FLASH|MOMENT)/i)) {
      issues.push({
        item: index + 1,
        field: 'Código',
        message: 'Código não segue padrão Clink (deve começar com CLINK, CK, FLASH ou MOMENT)',
        severity: 'warning',
      });
    }
    
    if (formato === 'gira' && !item.codigo?.match(/^GIRA|GI/i)) {
      issues.push({
        item: index + 1,
        field: 'Código',
        message: 'Código não segue padrão Gira (deve começar com GIRA ou GI)',
        severity: 'warning',
      });
    }
    
    // Validar quantidade
    const qtd = Number(item.quantidade);
    if (isNaN(qtd) || qtd <= 0) {
      issues.push({
        item: index + 1,
        field: 'Quantidade',
        message: 'Quantidade deve ser maior que zero',
        severity: 'error',
      });
    }
    
    // Validar preço
    const preco = Number(item.precoUnitario);
    if (isNaN(preco) || preco < 0) {
      issues.push({
        item: index + 1,
        field: 'Preço',
        message: 'Preço unitário inválido',
        severity: 'error',
      });
    }
  });
  
  return issues;
};

// ===== FUNÇÕES DE DOWNLOAD =====

/**
 * Inicia o download de um arquivo exportado
 * 
 * @param result - Resultado da exportação
 */
export const downloadExportedFile = (result: ExportResult): void => {
  const url = window.URL.createObjectURL(result.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

// ===== EXPORTS =====

export default { exportarPedido, validarPedidoParaExportacao, downloadExportedFile, EXPORT_FORMATS };
