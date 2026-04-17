// ===================================================================
// TESTES: Funções de Nome Comercial da Família CLINK
// ===================================================================

import { describe, it, expect } from 'vitest';
import {
  buildCommercialProductName,
  hasCommercialSuffix,
  removeCommercialSuffix,
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
