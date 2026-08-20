/**
 * Ponta a ponta dos campos que o CLIENTE mapeia (reunião Josef, 20/08/2026):
 * coluna da planilha → extração → linha do Mercos.
 *
 * Testar só o catálogo de campos não bastaria: o valor atravessa extractor,
 * pipeline e normalizador, e já aconteceu de um campo existir na tela e não
 * chegar ao arquivo (a tela de Regras salvava só no useState e sumia no
 * reload). Aqui a asserção é na CÉLULA final.
 */
import { describe, it, expect } from 'vitest';
import { extractProducts } from './extractor';
import { getGenericAdapter } from './registry';
import { normalizeToMercos } from '../mercos/normalizeToMercos';
import { ProdutoBruto, ProdutoNormalizadoV2 } from '../types/productPipeline';

const bruto = (campos: Record<string, any>): ProdutoBruto => ({
  campos,
  linhaOrigem: 0,
  textoBruto: JSON.stringify(campos),
});

/** Planilha fictícia com os dados que antes não tinham destino. */
const LINHA = {
  'Codigo': 'ABC-123',
  'Descricao': 'caneca esmaltada 300ml',
  'Preco': '19,90',
  'Peso': '0,450',
  'Larg': '10,5',
  'Alt': '9',
  'Compr': '12,25',
  'Saldo': '0',
  'Comis': '7,5',
  'Grade': 'P;M;G',
  'Cor': 'AZUL;VERMELHO',
  'Situacao': 'SOB CONSULTA',
};

const MAPEAMENTO = {
  codigo: 'Codigo',
  descricao: 'Descricao',
  preco: 'Preco',
  pesoBruto: 'Peso',
  largura: 'Larg',
  altura: 'Alt',
  comprimento: 'Compr',
  estoque: 'Saldo',
  comissao: 'Comis',
  tamanhos: 'Grade',
  cores: 'Cor',
};

const paraMercos = (mapeamento: Record<string, string>) => {
  const [p] = extractProducts([bruto(LINHA)], getGenericAdapter(), 'teste.xlsx', [], mapeamento);
  const normalizado: ProdutoNormalizadoV2 = {
    fornecedor: 'TESTE',
    codigo: p.codigo,
    codigoOriginal: p.codigo,
    nome: p.descricao,
    precoBase: p.preco,
    precoFinal: p.preco,
    quantidadeCaixa: p.quantidadeCaixa,
    camposMercos: p.camposMercos,
  };
  return { extraido: p, row: normalizeToMercos(normalizado) };
};

describe('campos mapeados pelo cliente chegam à célula certa do Mercos', () => {
  it('peso, dimensões, comissão, tamanhos e cores saem nas colunas oficiais', () => {
    const { row } = paraMercos(MAPEAMENTO);

    expect(row['Peso bruto (em Kg) (até três casas decimais)']).toBe(0.45);
    expect(row['Largura da embalagem (em centímetros, com até 5 casas decimais - obrigatório se as colunas Altura e Comprimento também estiverem preenchidas)']).toBe(10.5);
    expect(row['Altura da embalagem (em centímetros, com até 5 casas decimais - obrigatório se as colunas Largura e Comprimento também estiverem preenchidas)']).toBe(9);
    expect(row['Comprimento da embalagem (em centímetros, com até 5 casas decimais - obrigatório se as colunas Largura e Altura também estiverem preenchidas)']).toBe(12.25);
    expect(row['Comissão (opcional - não informar o símbolo %)']).toBe(7.5);
    expect(row['Tamanhos (opcional - tamanhos separados por ponto e vírgula)']).toBe('P;M;G');
    expect(row['Cores (opcional - cores separadas por ponto e vírgula)']).toBe('AZUL;VERMELHO');
  });

  it('estoque ZERO é preenchido — zero é informação, não campo vazio', () => {
    const { row } = paraMercos(MAPEAMENTO);
    expect(row['Quantidade em estoque (opcional - preencha com um número maior ou igual a 0)']).toBe(0);
  });

  it('texto numa coluna numérica é descartado (não vira 0 silencioso)', () => {
    // "SOB CONSULTA" no lugar do estoque: o cliente errou a coluna. Escrever 0
    // seria pior que não escrever — o Mercos aceitaria e zeraria o estoque.
    const { extraido } = paraMercos({ ...MAPEAMENTO, estoque: 'Situacao' });
    expect(extraido.camposMercos?.estoque).toBeUndefined();
  });

  it('sem mapeamento nada é adivinhado, mesmo com a coluna ali na planilha', () => {
    const { extraido, row } = paraMercos({ codigo: 'Codigo', descricao: 'Descricao', preco: 'Preco' });
    expect(extraido.camposMercos).toBeUndefined();
    expect(row['Peso bruto (em Kg) (até três casas decimais)']).toBe('');
    expect(row['Cores (opcional - cores separadas por ponto e vírgula)']).toBe('');
  });

  it('mapeamento não atropela as regras de negócio do nome e do preço', () => {
    // O nome vai SEMPRE em maiúsculas no Mercos; o preço passa pela regra de
    // desconto/bloqueio. Nenhum campo mapeado pode reescrever essas células.
    const { row } = paraMercos(MAPEAMENTO);
    expect(row['Nome do produto (obrigatório)']).toBe('CANECA ESMALTADA 300ML');
    expect(row['Preço de Tabela (obrigatório)']).toBe(19.9);
  });
});
