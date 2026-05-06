/**
 * Teste E2E: Pipeline completo de exportação
 *
 * Valida que:
 * 1. Produtos normalizados → exportação Mercos (schema fixo)
 * 2. Pedidos processados → exportação Jaweb (estrutura especial)
 * 3. Pedidos processados → exportação Nunes/Generic/ERP (formatos simples)
 *
 * Garante que ambos os formatos de saída solicitados pelo cliente
 * (Mercos para cadastro de produtos + Jaweb para conversão de pedidos)
 * gerem arquivos válidos e estruturalmente corretos.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx-js-style';

import {
  exportarPedido,
  EXPORT_FORMATS,
  type FormatoExportacao,
} from '../orders/orderExporter';
import type { PedidoProcessado, ItemPedidoNormalizado } from '../orders/orderTypes';

import { generateMercosXLSX } from '../mercos/exportMercos';
import { normalizeToMercos } from '../mercos/normalizeToMercos';
import {
  ProdutoNormalizadoV2,
  MERCOS_EXPORT_COLUMNS,
} from '../types/productPipeline';

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

const blobToWorkbook = async (blob: Blob): Promise<XLSX.WorkBook> => {
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  return XLSX.read(buf, { type: 'array' });
};

const buildProdutoExemplo = (
  codigo: string,
  nome: string,
  preco: number
): ProdutoNormalizadoV2 => ({
  fornecedor: 'Flash',
  fornecedorId: 'flash-id',
  codigo,
  codigoOriginal: codigo,
  nome,
  precoBase: preco,
  precoFinal: preco,
  ipi: 0,
  unidade: 'UN',
  quantidadeCaixa: 6,
  status: 'valido',
  origemArquivo: 'planilha-flash.xlsx',
  paginaOrigem: 1,
  linhaOrigem: 3,
  confiancaExtracao: 100,
  erros: [],
  warnings: [],
});

const buildItemPedido = (
  codigo: string,
  descricao: string,
  qtd: number,
  preco: number
): ItemPedidoNormalizado => ({
  codigo,
  descricao,
  quantidade: qtd,
  precoUnitario: preco,
  total: qtd * preco,
  observacoes: '',
  referenciaPedido: 'PED-001',
  status: 'ok',
  erros: [],
});

// ───────────────────────────────────────────────────────────────
// E2E Mercos: produtos -> XLSX padrão Mercos
// ───────────────────────────────────────────────────────────────

describe('E2E Mercos Export', () => {
  it('exporta lista de produtos preservando schema oficial Mercos (41 colunas, ordem fixa)', () => {
    const produtos: ProdutoNormalizadoV2[] = [
      buildProdutoExemplo('F0211', 'Garrafa de azeite vidro 250ml', 22.5),
      buildProdutoExemplo('F0492', 'Galheteiro vidro com base', 35.0),
      buildProdutoExemplo('F0212', 'Garrafa de azeite vidro 500ml', 28.9),
    ];

    const produtosMercos = produtos.map(normalizeToMercos);
    const result = generateMercosXLSX(produtosMercos, { download: false });

    expect(result.workbook).toBeDefined();
    expect(result.fileName).toMatch(/\.xlsx$/);
    expect(result.validationErrors).toEqual([]);

    // Verificar estrutura do workbook
    const sheet = result.workbook.Sheets[result.workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    // Linha 0 = headers (validar ordem e nomes EXATOS)
    const headers = rows[0];
    expect(headers).toHaveLength(MERCOS_EXPORT_COLUMNS.length);
    for (let i = 0; i < MERCOS_EXPORT_COLUMNS.length; i++) {
      expect(headers[i]).toBe(MERCOS_EXPORT_COLUMNS[i]);
    }

    // Linhas 1+ = 3 produtos
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows[1][0]).toBe('F0211');
    expect(rows[1][1]).toContain('Garrafa de azeite');
    expect(Number(rows[1][2])).toBe(22.5);
  });

  it('produtos invalidos sao reportados em validationErrors', () => {
    const invalido = buildProdutoExemplo('', 'Produto sem codigo', 0);
    invalido.precoBase = 0;
    invalido.precoFinal = 0;

    const m = normalizeToMercos(invalido);
    const result = generateMercosXLSX([m], { download: false });
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────────
// E2E Jaweb: pedido -> XLSX estrutura JAWEB
// ───────────────────────────────────────────────────────────────

describe('E2E Jaweb Export (Pedidos Clink/Moment/Flash)', () => {
  const buildPedidoTeste = (): PedidoProcessado => ({
    itens: [
      buildItemPedido('F0211', 'Garrafa de azeite vidro 250ml', 12, 22.5),
      buildItemPedido('F0492', 'Galheteiro vidro com base', 6, 35.0),
    ],
    bruto: {
      nomeArquivo: 'pedido-flash.xlsx',
      linhas: [],
      linhas2D: [],
      headerRowIndex: 0,
      headersDetectados: ['Código', 'Descrição', 'Qtd', 'Preço'],
    },
    mapeamento: {
      codigo: 'Código',
      descricao: 'Descrição',
      quantidade: 'Qtd',
      preco: 'Preço',
      total: null,
      observacoes: null,
      referenciaPedido: null,
    },
    stats: { totalItens: 2, itensOk: 2, itensIncompletos: 0, itensErro: 0 },
    destino: 'jaweb',
  });

  it('cabecalho "PEDIDO DE VENDA" aparece em B2', async () => {
    const pedido = buildPedidoTeste();
    const result = exportarPedido(pedido, 'jaweb');

    expect(result.format).toBe('jaweb');
    expect(result.filename).toMatch(/\.xlsx$/);

    const wb = await blobToWorkbook(result.blob);
    const sheet = wb.Sheets['Pedido'];
    expect(sheet['B2'].v).toBe('PEDIDO DE VENDA');
  });

  it('campos de cliente (FORNECEDOR, CLIENTE, CNPJ, etc) presentes nas linhas 4-13', async () => {
    const pedido = buildPedidoTeste();
    const result = exportarPedido(pedido, 'jaweb');
    const wb = await blobToWorkbook(result.blob);
    const sheet = wb.Sheets['Pedido'];

    expect(sheet['B4'].v).toBe('FORNECEDOR:');
    expect(sheet['B5'].v).toBe('CLIENTE:');
    expect(sheet['B6'].v).toBe('CNPJ:');
    expect(sheet['B7'].v).toBe('ENDEREÇO:');
    expect(sheet['B11'].v).toBe('UF:');
    expect(sheet['B13'].v).toBe('FONE:');
  });

  it('cabecalho da tabela na linha 26 e dados a partir da linha 27', async () => {
    const pedido = buildPedidoTeste();
    const result = exportarPedido(pedido, 'jaweb');
    const wb = await blobToWorkbook(result.blob);
    const sheet = wb.Sheets['Pedido'];

    // Linha 26: cabeçalhos
    expect(sheet['B26'].v).toBe('Cód Prod.');
    expect(sheet['C26'].v).toBe('Descrição');
    expect(sheet['D26'].v).toBe('Qtde');
    expect(sheet['E26'].v).toBe('%Desc');
    expect(sheet['F26'].v).toBe('Preço Unit');
    expect(sheet['G26'].v).toBe('IPI');
    expect(sheet['H26'].v).toBe('Total');

    // Linha 27: primeiro item
    expect(sheet['B27'].v).toBe('F0211');
    expect(sheet['C27'].v).toBe('Garrafa de azeite vidro 250ml');
    expect(sheet['D27'].v).toBe(12);
    expect(sheet['E27'].v).toBe(0); // %Desc fixo 0
    expect(sheet['F27'].v).toBe(22.5);
    expect(sheet['G27'].v).toBe(0); // IPI fixo 0

    // Linha 28: segundo item
    expect(sheet['B28'].v).toBe('F0492');
    expect(sheet['D28'].v).toBe(6);
  });

  it('totais em B19-B23 (SUBTOTAL, DESCONTO, IPI, FRETE, TOTAL)', async () => {
    const pedido = buildPedidoTeste();
    const result = exportarPedido(pedido, 'jaweb');
    const wb = await blobToWorkbook(result.blob);
    const sheet = wb.Sheets['Pedido'];

    expect(sheet['B19'].v).toBe('SUBTOTAL:');
    expect(sheet['B20'].v).toBe('DESCONTO:');
    expect(sheet['B21'].v).toBe('IPI:');
    expect(sheet['B22'].v).toBe('FRETE:');
    expect(sheet['B23'].v).toBe('TOTAL:');
  });
});

// ───────────────────────────────────────────────────────────────
// E2E Outros formatos (sanity check)
// ───────────────────────────────────────────────────────────────

describe('E2E Outros formatos de exportação', () => {
  const pedidoBasico: PedidoProcessado = {
    itens: [buildItemPedido('PROD001', 'Produto Teste', 5, 10.5)],
    bruto: {
      nomeArquivo: 'teste.xlsx',
      linhas: [],
      linhas2D: [],
      headerRowIndex: 0,
      headersDetectados: [],
    },
    mapeamento: {
      codigo: null,
      descricao: null,
      quantidade: null,
      preco: null,
      total: null,
      observacoes: null,
      referenciaPedido: null,
    },
    stats: { totalItens: 1, itensOk: 1, itensIncompletos: 0, itensErro: 0 },
    destino: 'nunes',
  };

  const formatos: FormatoExportacao[] = ['nunes', 'clink', 'gira', 'generic', 'erp'];
  formatos.forEach((fmt) => {
    it(`gera arquivo nao vazio para formato ${fmt}`, () => {
      const result = exportarPedido(pedidoBasico, fmt);
      expect(result.blob.size).toBeGreaterThan(0);
      expect(result.filename).toContain(fmt);
      expect(result.stats.totalItems).toBe(1);
    });
  });

  it('todos os formatos suportados estao em EXPORT_FORMATS', () => {
    expect(Object.keys(EXPORT_FORMATS).sort()).toEqual([
      'clink',
      'erp',
      'generic',
      'gira',
      'jaweb',
      'nunes',
    ]);
  });
});
