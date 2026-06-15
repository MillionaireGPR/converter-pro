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
    // Export Mercos em MAIÚSCULAS (padrão do sistema do cliente)
    expect(rows[1][1]).toContain('GARRAFA DE AZEITE');
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

describe('E2E Jaweb Export (estrutura EXATA do template oficial)', () => {
  const buildPedidoTeste = (): PedidoProcessado => ({
    itens: [
      buildItemPedido('F0211', 'Garrafa de azeite vidro 250ml', 12, 22.5),
      buildItemPedido('F0492', 'Galheteiro vidro com base', 6, 35.0),
    ],
    bruto: {
      nomeArquivo: 'pedido-flash.xlsx',
      linhas: [], linhas2D: [], headerRowIndex: 0,
      headersDetectados: ['Código', 'Descrição', 'Qtd', 'Preço'],
    },
    mapeamento: {
      codigo: 'Código', descricao: 'Descrição', quantidade: 'Qtd',
      preco: 'Preço', total: null, observacoes: null, referenciaPedido: null,
    },
    cabecalho: {
      numero: '12961',
      dataEmissao: '17/04/2026',
      vendedor: 'JOSEF AMARAL',
      clienteRazaoSocial: 'COMERCIAL NG DE ARMARINHO LTDA - EPP',
      clienteCnpj: '24.934.598/0001-54',
      clienteIE: '07330791001-13',
      clienteEndereco: 'CNG 06 LOTE 02 S/N LOJA / SOBRELOJA 01',
      clienteBairro: 'TAGUATINGA',
      clienteCidade: 'BRASILIA',
      clienteUF: 'DF',
      clienteCEP: '72130-065',
      clienteTelefone: '(61) 3033-8245',
      clienteEmail: 'ngatacado@hotmail.com',
      transpNome: 'SONIC TRANSPORTE',
      transpTelefone: '11-2528-5677',
    },
    stats: { totalItens: 2, itensOk: 2, itensIncompletos: 0, itensErro: 0 },
    destino: 'jaweb',
  });

  it('"PEDIDO DE VENDA" em A1 + instrucoes em L1', async () => {
    const result = exportarPedido(buildPedidoTeste(), 'jaweb');
    const wb = await blobToWorkbook(result.blob);
    const sheet = wb.Sheets['Pedido'];
    expect(sheet['A1'].v).toBe('PEDIDO DE VENDA');
    expect(sheet['L1'].v).toContain('Campos Obrigatórios');
  });

  it('linhas 4-8: DATA, VENDEDOR, TAB.PRECO, PEDIDO EXTERNO em coluna G + valores em I', async () => {
    const result = exportarPedido(buildPedidoTeste(), 'jaweb');
    const wb = await blobToWorkbook(result.blob);
    const sheet = wb.Sheets['Pedido'];
    expect(sheet['G4'].v).toBe('DATA:*');
    expect(sheet['I4'].v).toBe('17/04/2026');
    expect(sheet['G5'].v).toBe('VENDEDOR:');
    expect(sheet['I5'].v).toBe('JOSEF AMARAL');
    expect(sheet['G7'].v).toBe('TAB.PRECO*:');
    expect(sheet['G8'].v).toBe('PEDIDO EXTERNO:');
    expect(sheet['I8'].v).toBe('12961');
  });

  it('CLIENTE em A7 + dados em linhas 8-12', async () => {
    const result = exportarPedido(buildPedidoTeste(), 'jaweb');
    const wb = await blobToWorkbook(result.blob);
    const sheet = wb.Sheets['Pedido'];
    expect(sheet['A7'].v).toBe('CLIENTE');
    expect(sheet['A8'].v).toBe('CNPJ/CPF:*');
    expect(sheet['B8'].v).toBe('24934598000154'); // sem pontuação
    expect(sheet['C8'].v).toBe('IE:');
    expect(sheet['D8'].v).toBe('07330791001-13');
    expect(sheet['A9'].v).toBe('RzSocial:');
    expect(sheet['B9'].v).toBe('COMERCIAL NG DE ARMARINHO LTDA - EPP');
    expect(sheet['A10'].v).toBe('Endereco:');
    expect(sheet['B10'].v).toContain('CNG 06');
    expect(sheet['A11'].v).toBe('Bairro:');
    expect(sheet['B11'].v).toBe('TAGUATINGA');
    expect(sheet['C11'].v).toBe('Cidade:');
    expect(sheet['F11'].v).toBe('UF:');
    expect(sheet['G11'].v).toBe('DF');
    expect(sheet['H11'].v).toBe('CEP:');
    expect(sheet['I11'].v).toBe('72130-065');
  });

  it('TRANSPORTADORA em A14 + RzSocial em B16', async () => {
    const result = exportarPedido(buildPedidoTeste(), 'jaweb');
    const wb = await blobToWorkbook(result.blob);
    const sheet = wb.Sheets['Pedido'];
    expect(sheet['A14'].v).toBe('TRANSPORTADORA');
    expect(sheet['F14'].v).toBe('Frete');
    expect(sheet['A16'].v).toBe('RzSocial:');
    expect(sheet['B16'].v).toBe('SONIC TRANSPORTE');
  });

  it('totais como FORMULAS (nao valores estaticos)', async () => {
    const result = exportarPedido(buildPedidoTeste(), 'jaweb');
    const wb = await blobToWorkbook(result.blob);
    const sheet = wb.Sheets['Pedido'];
    expect(sheet['D19'].v).toBe('Total Qtd: ');
    expect(sheet['E19'].f).toBe('SUM(E26:E64)');
    expect(sheet['I19'].f).toBe('I22-I20');
    expect(sheet['I20'].f).toBe('SUM(K26:K64)');
    expect(sheet['I22'].f).toBe('SUM(I26:I64)');
  });

  it('cabecalho da tabela na LINHA 25 (nao 26)', async () => {
    const result = exportarPedido(buildPedidoTeste(), 'jaweb');
    const wb = await blobToWorkbook(result.blob);
    const sheet = wb.Sheets['Pedido'];
    expect(sheet['A25'].v).toBe('Cód Prod.*');
    expect(sheet['B25'].v).toBe('Descrição');
    expect(sheet['E25'].v).toBe('Qtde*');
    expect(sheet['F25'].v).toBe('%Desc');
    expect(sheet['G25'].v).toBe('Preço Unit*');
    expect(sheet['H25'].v).toBe('IPI');
    expect(sheet['I25'].v).toBe('Total');
    expect(sheet['K25'].v).toBe('Tot. IPI');
  });

  it('itens comecam na LINHA 26 (nao 27) com formulas em I e K', async () => {
    const result = exportarPedido(buildPedidoTeste(), 'jaweb');
    const wb = await blobToWorkbook(result.blob);
    const sheet = wb.Sheets['Pedido'];
    // Item 1 na linha 26
    expect(sheet['A26'].v).toBe('F0211');
    expect(sheet['B26'].v).toBe('Garrafa de azeite vidro 250ml');
    expect(sheet['E26'].v).toBe(12);
    expect(sheet['G26'].v).toBe(22.5);
    // Fórmulas em I26 e K26 (idênticas ao template)
    expect(sheet['I26'].f).toBe('E26*((G26)*(1+(H26)))');
    expect(sheet['K26'].f).toBe('H26*G26');
    // Item 2 na linha 27
    expect(sheet['A27'].v).toBe('F0492');
    expect(sheet['E27'].v).toBe(6);
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
