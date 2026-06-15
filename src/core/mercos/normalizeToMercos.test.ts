import { describe, it, expect } from 'vitest';
import {
  normalizeToMercos,
  batchNormalizeToMercos,
  validateMercosProduct,
  getMercosColumnOrder,
  buildInformacoesAdicionais,
} from './normalizeToMercos';
import {
  ProdutoNormalizadoV2,
  MERCOS_EXPORT_COLUMNS,
  MERCOS_ALLOWED_FILLED_COLUMNS,
} from '../types/productPipeline';

const makeProduto = (overrides: Partial<ProdutoNormalizadoV2> = {}): ProdutoNormalizadoV2 => ({
  fornecedor: 'Test',
  codigo: 'TST-001',
  codigoOriginal: 'TST-001',
  nome: 'Produto Teste',
  precoBase: 100,
  precoFinal: 85,
  unidade: 'UN',
  quantidadeCaixa: 6,
  status: 'validado',
  erros: [],
  warnings: [],
  ...overrides,
});

describe('normalizeToMercos', () => {
  it('1) cabeçalho igual ao modelo Mercos', () => {
    const headers = getMercosColumnOrder();
    expect(headers).toEqual(MERCOS_EXPORT_COLUMNS);
  });

  it('2) quantidade total de colunas igual ao modelo', () => {
    const headers = getMercosColumnOrder();
    expect(headers.length).toBe(42); // A até AP
  });

  it('3) somente 5 colunas preenchidas', () => {
    const p = makeProduto({ ipi: 13 });
    const mercos = normalizeToMercos(p);

    const filled = Object.entries(mercos)
      .filter(([, v]) => v !== '' && v !== null && v !== undefined)
      .map(([k]) => k);

    for (const col of MERCOS_EXPORT_COLUMNS) {
      expect(mercos).toHaveProperty(col);
      if (!MERCOS_ALLOWED_FILLED_COLUMNS.includes(col as (typeof MERCOS_ALLOWED_FILLED_COLUMNS)[number])) {
        expect(mercos[col]).toBe('');
      }
    }

    expect(filled.sort()).toEqual([
      'Código do produto (recomendado)',
      'Nome do produto (obrigatório)',
      'Preço de Tabela (obrigatório)',
      'IPI (opcional - não informar o símbolo %)',
      'Informações adicionais (opcional - neste campo coloca-se qualquer detalhe extra do produto. Não aparece no pedido)',
      // P3 (11/06/2026): Múltiplo = qtd por caixa (sempre preenchido, >=1)
      'Múltiplo (opcional)',
    ].sort());
  });

  it('mapeia A/B/C/E/H corretamente', () => {
    const p = makeProduto({
      codigo: 'ABC-123',
      nome: 'Caneca Porcelana',
      precoFinal: 29.90,
      ipi: 5,
      fornecedor: 'Lila Home',
      quantidadeCaixa: 24,
    });

    const mercos = normalizeToMercos(p);
    expect(mercos['Código do produto (recomendado)']).toBe('ABC-123');
    // Nome SEMPRE em MAIÚSCULAS no export (padrão do sistema do cliente).
    expect(mercos['Nome do produto (obrigatório)']).toBe('CANECA PORCELANA');
    // 🔒 trava: qualquer entrada minúscula/mista sai 100% maiúscula
    const lower = normalizeToMercos(makeProduto({ codigo: 'X1', nome: 'jogo de jantar opalina flor', precoFinal: 5 }));
    expect(lower['Nome do produto (obrigatório)']).toBe('JOGO DE JANTAR OPALINA FLOR');
    expect(mercos['Preço de Tabela (obrigatório)']).toBe(29.90);
    expect(mercos['IPI (opcional - não informar o símbolo %)']).toBe(5);
    expect(String(mercos['Informações adicionais (opcional - neste campo coloca-se qualquer detalhe extra do produto. Não aparece no pedido)'])).toContain('Cx c/ 24 unidades');
    // P3: Múltiplo = qtd por caixa
    expect(mercos['Múltiplo (opcional)']).toBe(24);
  });

  it('🔒 P3 — produto em UNIDADE: Múltiplo=1 e "Cx c/ 1 unidade" no info adicional', () => {
    // CLINK/MOMENT/FLASH (reunião): unidade vinha zerada; cliente usa como ref.
    const p = makeProduto({ codigo: 'F0001', nome: 'Caneca Avulsa', precoFinal: 9.9, quantidadeCaixa: 1 });
    const m = normalizeToMercos(p);
    expect(m['Múltiplo (opcional)']).toBe(1);
    expect(String(m['Informações adicionais (opcional - neste campo coloca-se qualquer detalhe extra do produto. Não aparece no pedido)'])).toContain('Cx c/ 1 unidade');
  });

  it('🔒 P3 — qtd ausente/0 vira Múltiplo=1 (nunca vazio)', () => {
    const p = makeProduto({ codigo: 'X9', nome: 'Item', precoFinal: 5, quantidadeCaixa: 0 });
    const m = normalizeToMercos(p);
    expect(m['Múltiplo (opcional)']).toBe(1);
  });

  it('4) campo IPI sem %', () => {
    const p = makeProduto({ ipi: 13 });
    const mercos = normalizeToMercos(p);
    expect(mercos['IPI (opcional - não informar o símbolo %)']).toBe(13);
    expect(String(mercos['IPI (opcional - não informar o símbolo %)'])).not.toContain('%');
  });

  it('usa precoBase quando precoFinal é zero', () => {
    const p = makeProduto({ precoBase: 50, precoFinal: 0 });
    const mercos = normalizeToMercos(p);
    expect(mercos['Preço de Tabela (obrigatório)']).toBe(50);
  });

  it('5) informações adicionais contém CX quando existir', () => {
    const p = makeProduto({ quantidadeCaixa: 120 });
    const info = buildInformacoesAdicionais(p);
    expect(info).toContain('Cx c/ 120 unidades');
  });

  it('7) exportação de item sem caixa', () => {
    const p = makeProduto({ quantidadeCaixa: 1, material: 'Cerâmica' });
    const mercos = normalizeToMercos(p);
    const info = String(mercos['Informações adicionais (opcional - neste campo coloca-se qualquer detalhe extra do produto. Não aparece no pedido)']);
    expect(info).not.toContain('CX:');
    expect(info).toContain('Cerâmica');
  });

  it('8) exportação com caixa + material + medida', () => {
    const p = makeProduto({
      quantidadeCaixa: 48,
      dimensoes: '10x20cm',
      material: 'Aço inox',
      cor: 'Branco',
    });
    const info = buildInformacoesAdicionais(p);
    expect(info).toContain('Cx c/ 48 unidades');
    expect(info).toContain('10x20cm');
    expect(info).toContain('Aço inox');
    expect(info).toContain('Branco');
  });
});

describe('batchNormalizeToMercos', () => {
  it('separa válidos e inválidos', () => {
    const produtos = [
      makeProduto({ codigo: 'OK-1', nome: 'Produto OK', precoFinal: 10 }),
      makeProduto({ codigo: '', nome: '', precoFinal: 0 }), // inválido
      makeProduto({ codigo: 'OK-2', nome: 'Outro OK', precoFinal: 20 }),
    ];

    const result = batchNormalizeToMercos(produtos);
    expect(result.validos.length).toBe(2);
    expect(result.invalidos.length).toBe(1);
    expect(result.total).toBe(3);
  });

  it('exclui esgotados por padrão', () => {
    const produtos = [
      makeProduto({ statusEstoque: 'esgotado', precoFinal: 10 }),
    ];
    const result = batchNormalizeToMercos(produtos);
    expect(result.validos.length).toBe(0);
    expect(result.invalidos.length).toBe(1);
  });

  it('inclui esgotados quando solicitado', () => {
    const produtos = [
      makeProduto({ statusEstoque: 'esgotado', precoFinal: 10 }),
    ];
    const result = batchNormalizeToMercos(produtos, { incluirEsgotados: true });
    expect(result.validos.length).toBe(1);
  });
});

describe('validateMercosProduct', () => {
  it('valida produto completo sem erros', () => {
    const p = makeProduto();
    const mercos = normalizeToMercos(p);
    const erros = validateMercosProduct(mercos);
    expect(erros).toHaveLength(0);
  });

  it('detecta código vazio', () => {
    const p = makeProduto({ codigo: '', codigoOriginal: '' });
    const mercos = normalizeToMercos(p);
    const erros = validateMercosProduct(mercos);
    expect(erros.some(e => e.includes('Código'))).toBe(true);
  });

  it('detecta descrição vazia', () => {
    const p = makeProduto({ nome: '' });
    const mercos = normalizeToMercos(p);
    const erros = validateMercosProduct(mercos);
    expect(erros.some(e => e.includes('Nome do produto'))).toBe(true);
  });

  it('valida que nenhuma coluna fora das 5 permitidas foi preenchida', () => {
    const p = makeProduto();
    const mercos = normalizeToMercos(p);
    mercos['Unidade (opcional – exemplo: Kg para produtos em quilo, Cx para caixas)'] = 'CX';
    const erros = validateMercosProduct(mercos);
    expect(erros.some(e => e.includes('Coluna não permitida'))).toBe(true);
  });
});

describe('getMercosColumnOrder', () => {
  it('retorna a ordem fixa de colunas', () => {
    const cols = getMercosColumnOrder();
    expect(cols[0]).toBe('Código do produto (recomendado)');
    expect(cols[1]).toBe('Nome do produto (obrigatório)');
    expect(cols[2]).toBe('Preço de Tabela (obrigatório)');
    expect(cols.length).toBe(42);
  });
});

describe('fornecedor sem contaminação Clink', () => {
  const fornecedores = ['Goal Kids', 'Lila Home', 'Nix', 'BM36', 'Neo Festas', 'Clink'];

  it('6,9-14) fornecedor não contamina outros itens na exportação', () => {
    const produtos = fornecedores.map((fornecedor, i) => makeProduto({
      fornecedor,
      codigo: `COD-${i + 1}`,
      codigoOriginal: `COD-${i + 1}`,
      nome: `Produto ${fornecedor}`,
      precoFinal: 10 + i,
      quantidadeCaixa: 12,
    }));

    const result = batchNormalizeToMercos(produtos);
    expect(result.validos).toHaveLength(fornecedores.length);

    for (let i = 0; i < result.validos.length; i++) {
      const row = result.validos[i];
      expect(row['Código do produto (recomendado)']).toBe(`COD-${i + 1}`);
      // Nome exportado em MAIÚSCULAS (padrão do sistema do cliente)
      expect(String(row['Nome do produto (obrigatório)'])).toContain(fornecedores[i].toUpperCase());
      expect(row['Preço de Tabela (obrigatório)']).toBe(10 + i);
    }
  });
});
