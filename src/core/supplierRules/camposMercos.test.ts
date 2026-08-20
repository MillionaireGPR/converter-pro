/**
 * Trava o catálogo de campos mapeáveis do Mercos (reunião Josef, 20/08/2026).
 *
 * Motivação real: a tela de mapeamento só oferecia os campos obrigatórios.
 * Fornecedor que trazia peso, dimensões, estoque, comissão, tamanhos/cores ou
 * mais de três tabelas de preço não tinha para onde mandar o dado — e virava
 * pedido de código novo, exatamente o que trava a operação sem o desenvolvedor.
 *
 * O risco de errar aqui é silencioso: um nome de coluna com uma letra fora do
 * modelo oficial não quebra nada no nosso lado, o Mercos é que recusa o arquivo
 * na hora da importação — já com o cliente esperando.
 */
import { describe, it, expect } from 'vitest';
import {
  CAMPOS_MERCOS,
  CAMPOS_PASSTHROUGH,
  CAMPOS_ESSENCIAIS,
  MAX_TABELAS_PRECO,
  campoMercos,
  precoTabelaKey,
} from './camposMercos';
import { MERCOS_EXPORT_COLUMNS } from '../types/productPipeline';

/** Colunas que as regras de negócio montam sozinhas — o mapeamento do cliente
 *  não pode escrever nelas (nome em maiúsculas, preço com bloqueio de desconto,
 *  múltiplo por fornecedor, marcador de EM BREVE...). */
const COLUNAS_COM_REGRA_PROPRIA = [
  'Código do produto (recomendado)',
  'Nome do produto (obrigatório)',
  'Preço de Tabela (obrigatório)',
  'IPI (opcional - não informar o símbolo %)',
  'Múltiplo (opcional)',
];

describe('CAMPOS_MERCOS — catálogo de campos mapeáveis', () => {
  it('toda coluna declarada existe, letra por letra, no modelo oficial', () => {
    const oficiais = new Set<string>(MERCOS_EXPORT_COLUMNS as readonly string[]);
    const forasteiras = CAMPOS_MERCOS.filter(c => c.coluna && !oficiais.has(c.coluna));
    expect(forasteiras.map(c => `${c.campo} -> ${c.coluna}`)).toEqual([]);
  });

  it('não repete chave de campo (uma sobrescreveria a outra em column_mappings)', () => {
    const chaves = CAMPOS_MERCOS.map(c => c.campo);
    expect(chaves.length).toBe(new Set(chaves).size);
  });

  it('não repete coluna de destino (dois campos brigando pela mesma célula)', () => {
    const colunas = CAMPOS_MERCOS.map(c => c.coluna).filter(Boolean);
    expect(colunas.length).toBe(new Set(colunas).size);
  });

  it('o passthrough NÃO alcança colunas que têm regra de negócio própria', () => {
    const invasoras = CAMPOS_PASSTHROUGH
      .filter(c => COLUNAS_COM_REGRA_PROPRIA.includes(c.coluna))
      .map(c => c.campo);
    expect(invasoras).toEqual([]);
  });

  it('cobre TODAS as colunas do modelo — era a queixa do Josef', () => {
    const cobertas = new Set(CAMPOS_MERCOS.map(c => c.coluna).filter(Boolean));
    const descobertas = (MERCOS_EXPORT_COLUMNS as readonly string[]).filter(c => !cobertas.has(c));
    expect(descobertas).toEqual([]);
  });

  it('as 19 tabelas de preço do modelo são mapeáveis (eram 3 na tela, 12 no código)', () => {
    expect(MAX_TABELAS_PRECO).toBe(19);
    for (let n = 1; n <= MAX_TABELAS_PRECO; n++) {
      const def = campoMercos(precoTabelaKey(n));
      expect(def, `tabela #${n} não é mapeável`).toBeTruthy();
      expect(def!.coluna).toBe(`Preço de Tabela #${n} (opcional)`);
      // Escrita pelo caminho dedicado, que preserva buracos de posição.
      expect(def!.passthrough).toBe(false);
    }
  });

  it('os essenciais são poucos — a conferência do upload não pode virar lista de 40 linhas', () => {
    expect(CAMPOS_ESSENCIAIS.length).toBeGreaterThan(3);
    expect(CAMPOS_ESSENCIAIS.length).toBeLessThan(12);
    expect(CAMPOS_ESSENCIAIS.map(c => c.campo)).toEqual(
      expect.arrayContaining(['codigo', 'descricao', 'preco', 'quantidadeCaixa'])
    );
  });
});
