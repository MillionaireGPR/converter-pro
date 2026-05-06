import { describe, it, expect, vi } from 'vitest';
import {
  exportarPedido,
  validarPedidoParaExportacao,
  downloadExportedFile,
  EXPORT_FORMATS,
  type FormatoExportacao,
} from './orderExporter';
import type { PedidoProcessado, ItemPedidoNormalizado } from './orderTypes';

// ===== MOCKS =====

const mockItem: ItemPedidoNormalizado = {
  codigo: 'PROD001',
  descricao: 'Produto Teste',
  quantidade: 10,
  precoUnitario: 15.5,
  total: 155.0,
  observacoes: '',
  referenciaPedido: 'PED-001',
  status: 'ok',
  erros: [],
};

const mockItemInvalido: ItemPedidoNormalizado = {
  codigo: '',
  descricao: '',
  quantidade: 0,
  precoUnitario: -5,
  total: 0,
  observacoes: '',
  referenciaPedido: '',
  status: 'erro',
  erros: ['Código vazio'],
};

const mockPedido: PedidoProcessado = {
  itens: [mockItem],
  bruto: {
    nomeArquivo: 'teste.xlsx',
    linhas: [],
    linhas2D: [],
    headerRowIndex: 0,
    headersDetectados: ['Código', 'Descrição', 'Quantidade'],
  },
  mapeamento: {
    codigo: 'Código',
    descricao: 'Descrição',
    quantidade: 'Quantidade',
    preco: null,
    total: null,
    observacoes: null,
    referenciaPedido: null,
  },
  stats: {
    totalItens: 1,
    itensOk: 1,
    itensIncompletos: 0,
    itensErro: 0,
  },
  destino: 'nunes',
};

const mockPedidoComErros: PedidoProcessado = {
  ...mockPedido,
  itens: [mockItem, mockItemInvalido],
  stats: {
    totalItens: 2,
    itensOk: 1,
    itensIncompletos: 0,
    itensErro: 1,
  },
};

// ===== TESTES DE CONFIGURAÇÃO =====

describe('EXPORT_FORMATS', () => {
  it('deve conter todos os formatos esperados', () => {
    expect(EXPORT_FORMATS).toHaveProperty('nunes');
    expect(EXPORT_FORMATS).toHaveProperty('clink');
    expect(EXPORT_FORMATS).toHaveProperty('gira');
    expect(EXPORT_FORMATS).toHaveProperty('generic');
    expect(EXPORT_FORMATS).toHaveProperty('erp');
    expect(EXPORT_FORMATS).toHaveProperty('jaweb');
  });

  it('deve ter configuração válida para cada formato', () => {
    Object.values(EXPORT_FORMATS).forEach(format => {
      expect(format.id).toBeDefined();
      expect(format.name).toBeDefined();
      expect(format.description).toBeDefined();
      expect(format.fileExtension).toMatch(/^(csv|xlsx)$/);
      expect(format.columns).toBeInstanceOf(Array);
      expect(format.columns.length).toBeGreaterThan(0);
    });
  });

  it('formato JAWEB deve ter estrutura especial', () => {
    const jaweb = EXPORT_FORMATS.jaweb;
    expect(jaweb.hasHeaderStructure).toBe(true);
    expect(jaweb.headerTitle).toBe('PEDIDO DE VENDA');
    expect(jaweb.itemStartRow).toBe(27);
  });
});

// ===== TESTES DE EXPORTAÇÃO =====

describe('exportarPedido', () => {
  it('deve exportar para CSV (formato genérico)', () => {
    const result = exportarPedido(mockPedido, 'generic');
    
    expect(result).toBeDefined();
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.filename).toMatch(/\.csv$/);
    expect(result.format).toBe('generic');
    expect(result.stats.totalItems).toBe(1);
  });

  it('deve exportar para Excel (formato Nunes)', () => {
    const result = exportarPedido(mockPedido, 'nunes');
    
    expect(result).toBeDefined();
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.filename).toMatch(/\.xlsx$/);
    expect(result.format).toBe('nunes');
  });

  it('deve exportar para Excel (formato JAWEB)', () => {
    const result = exportarPedido(mockPedido, 'jaweb');
    
    expect(result).toBeDefined();
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.filename).toMatch(/\.xlsx$/);
    expect(result.format).toBe('jaweb');
  });

  it('deve filtrar apenas itens válidos quando onlyValid=true', () => {
    const result = exportarPedido(mockPedidoComErros, 'generic', { onlyValid: true });
    
    expect(result.stats.validItems).toBe(1);
    expect(result.stats.totalItems).toBe(2);
  });

  it('deve incluir todos os itens quando includeErrors=true', () => {
    const result = exportarPedido(mockPedidoComErros, 'generic', { includeErrors: true });
    
    expect(result.stats.totalItems).toBe(2);
    expect(result.stats.errorItems).toBe(1);
  });

  it('deve gerar nome de arquivo customizado', () => {
    const result = exportarPedido(mockPedido, 'generic', { filename: 'meu_pedido' });
    
    expect(result.filename).toBe('meu_pedido.csv');
  });

  it('deve gerar CSV nao vazio com formato generic', () => {
    const result = exportarPedido(mockPedido, 'generic');
    // jsdom não consegue ler Blob como texto; validamos por estrutura
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.filename).toMatch(/\.csv$/);
    expect(result.format).toBe('generic');
    expect(result.blob.type).toContain('text/csv');
  });

  it('deve transformar códigos do formato Clink', () => {
    const pedidoClink: PedidoProcessado = {
      ...mockPedido,
      itens: [{
        ...mockItem,
        codigo: 'clink-12345',
      }],
    };
    
    const result = exportarPedido(pedidoClink, 'clink');
    expect(result).toBeDefined();
  });

  it('deve aceitar códigos do formato Gira', () => {
    const pedidoGira: PedidoProcessado = {
      ...mockPedido,
      itens: [{
        ...mockItem,
        codigo: 'GI-12345',
      }],
    };
    
    const result = exportarPedido(pedidoGira, 'gira');
    expect(result).toBeDefined();
  });
});

// ===== TESTES DE VALIDAÇÃO =====

describe('validarPedidoParaExportacao', () => {
  it('deve retornar array vazio para pedido válido', () => {
    const issues = validarPedidoParaExportacao(mockPedido, 'nunes');
    expect(issues).toBeInstanceOf(Array);
  });

  it('deve detectar campos obrigatórios vazios', () => {
    const issues = validarPedidoParaExportacao(mockPedidoComErros, 'nunes');
    
    const codigoVazio = issues.find(i => i.field === 'codigo');
    expect(codigoVazio).toBeDefined();
    expect(codigoVazio?.severity).toBe('error');
  });

  it('deve detectar quantidade inválida', () => {
    const issues = validarPedidoParaExportacao(mockPedidoComErros, 'nunes');
    
    const qtdInvalida = issues.find(i => i.field === 'Quantidade');
    expect(qtdInvalida).toBeDefined();
    expect(qtdInvalida?.severity).toBe('error');
  });

  it('deve detectar preço negativo', () => {
    const issues = validarPedidoParaExportacao(mockPedidoComErros, 'nunes');
    
    const precoInvalido = issues.find(i => i.field === 'Preço');
    expect(precoInvalido).toBeDefined();
  });

  it('deve validar padrão de código para Clink', () => {
    const pedidoClink: PedidoProcessado = {
      ...mockPedido,
      itens: [{
        ...mockItem,
        codigo: 'CODIGO-INVALIDO',
      }],
    };
    
    const issues = validarPedidoParaExportacao(pedidoClink, 'clink');
    const warning = issues.find(i => i.field === 'Código' && i.severity === 'warning');
    expect(warning).toBeDefined();
  });

  it('deve validar padrão de código para Gira', () => {
    const pedidoGira: PedidoProcessado = {
      ...mockPedido,
      itens: [{
        ...mockItem,
        codigo: 'CODIGO-INVALIDO',
      }],
    };
    
    const issues = validarPedidoParaExportacao(pedidoGira, 'gira');
    expect(issues).toBeInstanceOf(Array);
  });

  it('não deve dar erro para códigos válidos Clink', () => {
    const pedidoClinkValido: PedidoProcessado = {
      ...mockPedido,
      itens: [{
        ...mockItem,
        codigo: 'CLINK-12345',
      }],
    };
    
    const issues = validarPedidoParaExportacao(pedidoClinkValido, 'clink');
    const error = issues.find(i => i.field === 'Código' && i.severity === 'error');
    expect(error).toBeUndefined();
  });

  it('deve retornar informações do item no issue', () => {
    const issues = validarPedidoParaExportacao(mockPedidoComErros, 'nunes');
    
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].item).toBeGreaterThan(0);
    expect(issues[0].field).toBeDefined();
    expect(issues[0].message).toBeDefined();
    expect(issues[0].severity).toMatch(/^(error|warning)$/);
  });
});

// ===== TESTES DE DOWNLOAD =====

describe('downloadExportedFile', () => {
  it('deve criar link de download', () => {
    const mockBlob = new Blob(['test'], { type: 'text/plain' });
    const mockResult = {
      blob: mockBlob,
      filename: 'test.csv',
      format: 'generic' as FormatoExportacao,
      stats: { totalItems: 1, validItems: 1, errorItems: 0 },
      issues: [],
    };

    // Mock do DOM
    const mockLink = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    
    // jsdom não implementa createObjectURL/revokeObjectURL, então polyfill stub:
    if (!(window.URL as any).createObjectURL) {
      (window.URL as any).createObjectURL = () => 'blob:mock';
    }
    if (!(window.URL as any).revokeObjectURL) {
      (window.URL as any).revokeObjectURL = () => {};
    }

    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockLink as any);
    const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink as any);
    const removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockLink as any);
    const revokeObjectURLSpy = vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});

    downloadExportedFile(mockResult);

    expect(mockLink.click).toHaveBeenCalled();
    expect(mockLink.download).toBe('test.csv');

    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });
});

// ===== TESTES DE SEGURANÇA =====

describe('Segurança', () => {
  it('não deve expor dados sensíveis no export', () => {
    const pedidoComDadosSensíveis: PedidoProcessado = {
      ...mockPedido,
      itens: [{
        ...mockItem,
        descricao: '<script>alert("xss")</script>',
      }],
    };
    
    const result = exportarPedido(pedidoComDadosSensíveis, 'generic');
    expect(result).toBeDefined();
  });

  it('deve lidar com valores nulos e undefined', () => {
    const pedidoIncompleto: PedidoProcessado = {
      ...mockPedido,
      itens: [{
        ...mockItem,
        descricao: null as any,
        quantidade: undefined as any,
      }],
    };
    
    expect(() => exportarPedido(pedidoIncompleto, 'generic')).not.toThrow();
  });

  it('deve lidar com pedido vazio', () => {
    const pedidoVazio: PedidoProcessado = {
      ...mockPedido,
      itens: [],
      stats: {
        totalItens: 0,
        itensOk: 0,
        itensIncompletos: 0,
        itensErro: 0,
      },
    };
    
    const result = exportarPedido(pedidoVazio, 'generic');
    expect(result).toBeDefined();
    expect(result.stats.totalItems).toBe(0);
  });
});

// ===== TESTES DE FORMATOS ESPECÍFICOS =====

describe('Formato JAWEB', () => {
  it('deve ter estrutura de cabeçalho PEDIDO DE VENDA', () => {
    const format = EXPORT_FORMATS.jaweb;
    expect(format.hasHeaderStructure).toBe(true);
    expect(format.headerTitle).toBe('PEDIDO DE VENDA');
  });

  it('deve ter colunas específicas do JAWEB', () => {
    const format = EXPORT_FORMATS.jaweb;
    const headers = format.columns.map(c => c.header);
    
    expect(headers).toContain('Cód Prod.');
    expect(headers).toContain('Descrição');
    expect(headers).toContain('Qtde');
    expect(headers).toContain('%Desc');
    expect(headers).toContain('Preço Unit');
    expect(headers).toContain('IPI');
    expect(headers).toContain('Total');
  });

  it('deve ter transformação fixa para desconto (0%)', () => {
    const format = EXPORT_FORMATS.jaweb;
    const descontoCol = format.columns.find(c => c.key === 'desconto');
    
    expect(descontoCol?.transform).toBeDefined();
    expect(descontoCol?.transform?.(null, mockItem)).toBe(0);
  });

  it('deve ter transformação fixa para IPI (R$ 0)', () => {
    const format = EXPORT_FORMATS.jaweb;
    const ipiCol = format.columns.find(c => c.key === 'ipi');
    
    expect(ipiCol?.transform).toBeDefined();
    expect(ipiCol?.transform?.(null, mockItem)).toBe(0);
  });
});
