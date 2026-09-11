/**
 * Trava a escolha AUTOMÁTICA da aba que contém o catálogo (11/09/2026).
 *
 * Incidente real: Petrin e Dute trocaram o formato do arquivo. A 1ª aba
 * deixou de ser o catálogo e virou o FORMULÁRIO de pedido ("Pedido"/"BLOCO",
 * com Razão Social/CNPJ/IE); os produtos foram pra 2ª aba ("Tabela", 831
 * linhas / "TABELA ATUAL", 2197 linhas). Como `readSpreadsheet` ancorava
 * sempre em `SheetNames[0]` e só anexava abas cujo cabeçalho batesse com o
 * dela, o sistema lia o formulário e ignorava o catálogo inteiro. O Josef
 * reportou: "o sistema identifica somente os campos do bloco, não da tabela".
 *
 * Escolher a aba NÃO pode depender do cliente configurar nada: se ele não
 * percebeu que o fornecedor mudou o arquivo, o sistema tem que se virar.
 */
import { describe, it, expect } from 'vitest';
import { __testables } from './importPipeline';

const { scoreProductSheet } = __testables;

describe('scoreProductSheet — reconhece a aba de catálogo sozinho', () => {
  it('aba de CATÁLOGO do Petrin ("Tabela") pontua', () => {
    const headers = ['CÓDIGO', 'DESCRIÇÃO', 'QNTD. CAIXA', 'PREÇO', 'ESTOQUE', 'STATUS'];
    expect(scoreProductSheet(headers, 831)).toBeGreaterThan(0);
  });

  it('aba de CATÁLOGO do Dute ("TABELA ATUAL") pontua', () => {
    const headers = ['Referência', 'Descrição', 'Emb', 'Embalagem', 'Valor Venda', 'Status', 'Estoque'];
    expect(scoreProductSheet(headers, 2197)).toBeGreaterThan(0);
  });

  it('FORMULÁRIO de pedido NÃO pontua — era ele que estava sendo lido', () => {
    // Rótulos soltos do bloco de pedidos; nunca formam um conjunto de produto.
    expect(scoreProductSheet(['Razão Social', 'Fantasia'], 50)).toBe(0);
    expect(scoreProductSheet(['CNPJ', 'IE'], 50)).toBe(0);
  });

  it('aba vazia ou quase vazia não pontua', () => {
    expect(scoreProductSheet([], 0)).toBe(0);
    expect(scoreProductSheet(['CÓDIGO', 'PREÇO'], 1)).toBe(0);
  });

  it('exige DOIS campos distintos — só descrição não basta', () => {
    expect(scoreProductSheet(['Descrição'], 500)).toBe(0);
  });

  it('entre duas abas de produto, a MAIOR vence (Tabela 831 > Estoque 616)', () => {
    const tabela = scoreProductSheet(['CÓDIGO', 'DESCRIÇÃO', 'QNTD. CAIXA', 'PREÇO'], 831);
    const estoque = scoreProductSheet(['Referência', 'Descrição', 'Qtd Emb (Físico)', 'Emb', 'Valor Venda'], 616);
    expect(tabela).toBeGreaterThan(estoque);
  });

  it('mais CAMPOS vence mais LINHAS — completude importa mais que volume', () => {
    // 4 campos com poucas linhas bate 2 campos com muitas: uma aba de apoio
    // gigante (só código+descrição) não pode roubar a âncora do catálogo real.
    const completa = scoreProductSheet(['Código', 'Descrição', 'Preço', 'Caixa'], 100);
    const apoioGigante = scoreProductSheet(['Código', 'Descrição'], 99_999);
    expect(completa).toBeGreaterThan(apoioGigante);
  });
});
