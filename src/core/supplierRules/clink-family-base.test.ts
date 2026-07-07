// ===================================================================
// TESTES: Funções de Nome Comercial da Família CLINK
// ===================================================================

import { describe, it, expect } from 'vitest';
import {
  buildCommercialProductName,
  hasCommercialSuffix,
  removeCommercialSuffix,
  CLINK_FAMILY_FIELD_ALIASES,
  VisualCategory,
} from './clink-family-base';

describe('buildCommercialProductName', () => {
  it('deve adicionar sufixo ***PROMOCAO*** para itens promocionais', () => {
    const nomeBase = 'ABRIDOR GARRAFA ACO INOX ACRILICO 8,5 cm X 4,5 cm';
    const result = buildCommercialProductName(nomeBase, 'promocional');

    expect(result.nomeBase).toBe(nomeBase);
    expect(result.sufixoAplicado).toBe('***PROMOCAO***');
    expect(result.nomeComercial).toBe('ABRIDOR GARRAFA ACO INOX ACRILICO 8,5 cm X 4,5 cm ***PROMOCAO***');
  });

  it('deve adicionar sufixo ***PRECO FIXO*** para itens de preço fixo', () => {
    const nomeBase = 'AFIADOR FACAS PLASTICO PP ACO INOX CERAMICA 21,5 cm X 5 cm X 5,5 cm';
    const result = buildCommercialProductName(nomeBase, 'preco-fixo');

    expect(result.nomeBase).toBe(nomeBase);
    expect(result.sufixoAplicado).toBe('***PRECO FIXO***');
    expect(result.nomeComercial).toBe('AFIADOR FACAS PLASTICO PP ACO INOX CERAMICA 21,5 cm X 5 cm X 5,5 cm ***PRECO FIXO***');
  });

  it('NÃO deve adicionar sufixo para itens padrão', () => {
    const nomeBase = 'PRODUTO NORMAL SEM DESCONTO';
    const result = buildCommercialProductName(nomeBase, 'padrao');

    expect(result.nomeBase).toBe(nomeBase);
    expect(result.sufixoAplicado).toBeNull();
    expect(result.nomeComercial).toBe(nomeBase);
  });

  it('NÃO deve adicionar sufixo para itens novidade/reposição', () => {
    const nomeBase = 'PRODUTO NOVIDADE LANÇAMENTO';
    const result = buildCommercialProductName(nomeBase, 'novidade-reposicao');

    expect(result.nomeBase).toBe(nomeBase);
    expect(result.sufixoAplicado).toBeNull();
    expect(result.nomeComercial).toBe(nomeBase);
  });

  it('deve remover sufixo antigo se categoria mudar de promocional para preco-fixo', () => {
    const nomeComSufixoAntigo = 'PRODUTO TESTE ***PROMOCAO***';
    const result = buildCommercialProductName(nomeComSufixoAntigo, 'preco-fixo');

    expect(result.nomeBase).toBe('PRODUTO TESTE');
    expect(result.sufixoAplicado).toBe('***PRECO FIXO***');
    expect(result.nomeComercial).toBe('PRODUTO TESTE ***PRECO FIXO***');
  });

  it('deve remover sufixo antigo se categoria mudar de preco-fixo para promocional', () => {
    const nomeComSufixoAntigo = 'PRODUTO TESTE ***PRECO FIXO***';
    const result = buildCommercialProductName(nomeComSufixoAntigo, 'promocional');

    expect(result.nomeBase).toBe('PRODUTO TESTE');
    expect(result.sufixoAplicado).toBe('***PROMOCAO***');
    expect(result.nomeComercial).toBe('PRODUTO TESTE ***PROMOCAO***');
  });

  it('deve manter nome inalterado se já tiver sufixo correto', () => {
    const nomeComSufixoCorreto = 'PRODUTO TESTE ***PROMOCAO***';
    const result = buildCommercialProductName(nomeComSufixoCorreto, 'promocional');

    expect(result.nomeBase).toBe('PRODUTO TESTE');
    expect(result.sufixoAplicado).toBe('***PROMOCAO***');
    expect(result.nomeComercial).toBe('PRODUTO TESTE ***PROMOCAO***');
  });

  it('deve lidar com nome vazio ou undefined', () => {
    const result = buildCommercialProductName('', 'promocional');
    expect(result.nomeComercial).toBe(' ***PROMOCAO***');
    expect(result.nomeBase).toBe('');
  });

  it('deve usar nomeOriginal como base se fornecido', () => {
    const nomeBase = 'NOME ALTERADO';
    const nomeOriginal = 'NOME ORIGINAL LIMPO';
    const result = buildCommercialProductName(nomeBase, 'promocional', nomeOriginal);

    expect(result.nomeBase).toBe(nomeOriginal);
    expect(result.nomeComercial).toBe('NOME ORIGINAL LIMPO ***PROMOCAO***');
  });

  it('deve remover sufixo com acento (PREÇO FIXO)', () => {
    const nomeComAcento = 'PRODUTO TESTE ***PREÇO FIXO***';
    const result = buildCommercialProductName(nomeComAcento, 'promocional');

    expect(result.nomeBase).toBe('PRODUTO TESTE');
    expect(result.nomeComercial).toBe('PRODUTO TESTE ***PROMOCAO***');
  });
});

describe('hasCommercialSuffix', () => {
  it('deve detectar sufixo ***PROMOCAO***', () => {
    expect(hasCommercialSuffix('PRODUTO ***PROMOCAO***')).toBe(true);
  });

  it('deve detectar sufixo ***PRECO FIXO***', () => {
    expect(hasCommercialSuffix('PRODUTO ***PRECO FIXO***')).toBe(true);
  });

  it('deve retornar false para nome sem sufixo', () => {
    expect(hasCommercialSuffix('PRODUTO NORMAL')).toBe(false);
  });

  it('deve retornar false para string vazia', () => {
    expect(hasCommercialSuffix('')).toBe(false);
  });
});

describe('removeCommercialSuffix', () => {
  it('deve remover sufixo ***PROMOCAO***', () => {
    expect(removeCommercialSuffix('PRODUTO ***PROMOCAO***')).toBe('PRODUTO');
  });

  it('deve remover sufixo ***PRECO FIXO***', () => {
    expect(removeCommercialSuffix('PRODUTO ***PRECO FIXO***')).toBe('PRODUTO');
  });

  it('deve manter nome sem sufixo inalterado', () => {
    expect(removeCommercialSuffix('PRODUTO NORMAL')).toBe('PRODUTO NORMAL');
  });

  it('deve retornar string vazia para input vazio', () => {
    expect(removeCommercialSuffix('')).toBe('');
  });
});

// ===================================================================
// TESTES: Cobertura de aliases — variantes abreviadas Moment TABELA C3B
// Garante que novos nomes de colunas introduzidos em 06/07/26 são reconhecidos.
// ===================================================================

describe('CLINK_FAMILY_FIELD_ALIASES — variantes abreviadas Moment TABELA C3B (06/07/26)', () => {
  it('preco deve conter alias p.vend (nova abreviação Moment)', () => {
    expect(CLINK_FAMILY_FIELD_ALIASES.preco).toContain('p.vend');
  });

  it('preco deve conter alias pvend (normalizado de p.vend)', () => {
    expect(CLINK_FAMILY_FIELD_ALIASES.preco).toContain('pvend');
  });

  it('quantidadeCaixa deve conter alias qtd cai (nova abreviação Moment)', () => {
    expect(CLINK_FAMILY_FIELD_ALIASES.quantidadeCaixa).toContain('qtd cai');
  });

  it('quantidadeCaixa deve conter alias qtdcai (normalizado de qtd cai)', () => {
    expect(CLINK_FAMILY_FIELD_ALIASES.quantidadeCaixa).toContain('qtdcai');
  });

  it('quantidadeCaixa deve conter alias qtd caixa ini (inner abreviado Moment)', () => {
    expect(CLINK_FAMILY_FIELD_ALIASES.quantidadeCaixa).toContain('qtd caixa ini');
  });

  it('inner box aliases devem ter prioridade sobre outer box aliases (invariante Moment)', () => {
    const aliases = CLINK_FAMILY_FIELD_ALIASES.quantidadeCaixa;
    const innerIdx = aliases.indexOf('qtd caixa inner');
    const outerIdx = aliases.indexOf('qtd caixa');
    expect(innerIdx).toBeGreaterThanOrEqual(0);
    expect(outerIdx).toBeGreaterThan(innerIdx);
  });
});
