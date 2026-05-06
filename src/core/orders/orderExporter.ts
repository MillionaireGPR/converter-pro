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
 * Cria worksheet especial para JAWEB
 */
const criarWorksheetJAWEB = (
  dataRows: Record<string, any>[],
  format: ExportFormat
): XLSX.WorkSheet => {
  const worksheet: XLSX.WorkSheet = {};
  
  // === LINHA 2: TÍTULO PEDIDO DE VENDA ===
  worksheet['B2'] = { v: 'PEDIDO DE VENDA', t: 's' };
  
  // === SEÇÃO DE DADOS DO CLIENTE (linhas 4-13) ===
  worksheet['B4'] = { v: 'FORNECEDOR:', t: 's' };
  worksheet['C4'] = { v: format.name, t: 's' };
  
  worksheet['B5'] = { v: 'CLIENTE:', t: 's' };
  worksheet['C5'] = { v: '', t: 's' }; // A ser preenchido
  
  worksheet['B6'] = { v: 'CNPJ:', t: 's' };
  worksheet['C6'] = { v: '', t: 's' }; // A ser preenchido
  
  worksheet['B7'] = { v: 'ENDEREÇO:', t: 's' };
  worksheet['C7'] = { v: '', t: 's' };
  
  worksheet['B8'] = { v: 'BAIRRO:', t: 's' };
  worksheet['C8'] = { v: '', t: 's' };
  
  worksheet['B9'] = { v: 'CIDADE:', t: 's' };
  worksheet['C9'] = { v: '', t: 's' };
  
  worksheet['B10'] = { v: 'CEP:', t: 's' };
  worksheet['C10'] = { v: '', t: 's' };
  
  worksheet['B11'] = { v: 'UF:', t: 's' };
  worksheet['C11'] = { v: '', t: 's' };
  
  worksheet['B12'] = { v: 'IE:', t: 's' };
  worksheet['C12'] = { v: '', t: 's' };
  
  worksheet['B13'] = { v: 'FONE:', t: 's' };
  worksheet['C13'] = { v: '', t: 's' };
  
  // === SEÇÃO DE TRANSPORTADORA (linhas 15-17) ===
  worksheet['B15'] = { v: 'TRANSPORTADORA:', t: 's' };
  worksheet['C15'] = { v: '', t: 's' };
  
  worksheet['B16'] = { v: 'FRETE:', t: 's' };
  worksheet['C16'] = { v: '', t: 's' };
  
  worksheet['B17'] = { v: 'CONTATO:', t: 's' };
  worksheet['C17'] = { v: '', t: 's' };
  
  // === SEÇÃO DE TOTAIS (linhas 19-23) ===
  worksheet['B19'] = { v: 'SUBTOTAL:', t: 's' };
  worksheet['C19'] = { v: 0, t: 'n' };
  
  worksheet['B20'] = { v: 'DESCONTO:', t: 's' };
  worksheet['C20'] = { v: 0, t: 'n' };
  
  worksheet['B21'] = { v: 'IPI:', t: 's' };
  worksheet['C21'] = { v: 0, t: 'n' };
  
  worksheet['B22'] = { v: 'FRETE:', t: 's' };
  worksheet['C22'] = { v: 0, t: 'n' };
  
  worksheet['B23'] = { v: 'TOTAL:', t: 's' };
  worksheet['C23'] = { v: 0, t: 'n' };
  
  // === CONTATO DO VENDEDOR (linha 24) ===
  worksheet['B24'] = { v: 'VENDEDOR/CONTATO:', t: 's' };
  worksheet['C24'] = { v: '', t: 's' };
  
  // === LINHA 26: CABEÇALHO DA TABELA ===
  const headers = format.columns.map(col => col.header);
  headers.forEach((header, index) => {
    const col = String.fromCharCode(66 + index); // Começa na coluna B
    worksheet[`${col}26`] = { v: header, t: 's' };
  });
  
  // === LINHAS 27+: DADOS DOS ITENS ===
  dataRows.forEach((row, rowIndex) => {
    const excelRow = 27 + rowIndex;
    format.columns.forEach((col, colIndex) => {
      const excelCol = String.fromCharCode(66 + colIndex);
      const value = row[col.header];
      const cellRef = `${excelCol}${excelRow}`;
      
      if (col.format === 'number' || col.format === 'integer' || col.format === 'currency') {
        worksheet[cellRef] = { v: Number(value) || 0, t: 'n' };
      } else {
        worksheet[cellRef] = { v: String(value || ''), t: 's' };
      }
    });
  });
  
  // Definir range da planilha
  worksheet['!ref'] = 'A1:J50';
  
  // Configurar larguras das colunas
  worksheet['!cols'] = [
    { wch: 3 },  // A - vazia
    { wch: 20 }, // B - labels
    { wch: 15 }, // C - Cód Prod
    { wch: 45 }, // D - Descrição
    { wch: 10 }, // E - Qtde
    { wch: 10 }, // F - %Desc
    { wch: 15 }, // G - Preço Unit
    { wch: 12 }, // H - IPI
    { wch: 15 }, // I - Total
    { wch: 3 },  // J - vazia
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
      worksheet = criarWorksheetJAWEB(dataRows, format);
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
