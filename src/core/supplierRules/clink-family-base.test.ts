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
import { momentAdapter } from './moment';
import { ProdutoBruto } from '../types/productPipeline';

const brutoMoment = (campos: Record<string, any>): ProdutoBruto => ({
  campos, linhaOrigem: 0, paginaOrigem: 1, textoBruto: '',
});

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

  it('quantidadeCaixa deve conter alias qtd cai inner (variante abreviada de inner — v54)', () => {
    expect(CLINK_FAMILY_FIELD_ALIASES.quantidadeCaixa).toContain('qtd cai inner');
  });

  it('quantidadeCaixa deve conter alias qtd cai inn (variante abreviada de inner — v54)', () => {
    expect(CLINK_FAMILY_FIELD_ALIASES.quantidadeCaixa).toContain('qtd cai inn');
  });

  it('qtd cai inner deve ter prioridade sobre qtd caixa (outer)', () => {
    const aliases = CLINK_FAMILY_FIELD_ALIASES.quantidadeCaixa;
    const innerNewIdx = aliases.indexOf('qtd cai inner');
    const outerIdx = aliases.indexOf('qtd caixa');
    expect(innerNewIdx).toBeGreaterThanOrEqual(0);
    expect(outerIdx).toBeGreaterThan(innerNewIdx);
  });
});

// ===================================================================
// TESTES DE INTEGRAÇÃO: Extração real do Moment (inner vs outer box)
// ===================================================================

describe('🔒 MOMENT — inner vs outer box (extração real via momentAdapter)', () => {
  it('formato antigo: usa "Qtd Caixa inner" (12) e NÃO "Qtd Caixa" outer (96)', () => {
    const [p] = momentAdapter.extract!([brutoMoment({
      'Codigo': 'MO12345',
      'Descricao': 'PRODUTO TESTE FORMATO ANTIGO',
      'P.Venda': 25.50,
      'Qtd Caixa inner': 12,
      'Qtd Caixa': 96,
    })], momentAdapter) as any[];
    expect(p.quantidadeCaixa).toBe(12);
  });

  it('TABELA C3B 06/07/26: usa "Qtd Caixa ini" (12) e NÃO "Qtd Cai" outer (96) — v52', () => {
    const [p] = momentAdapter.extract!([brutoMoment({
      'Codigo': 'MO12345',
      'Descricao': 'PRODUTO TESTE C3B',
      'P.Vend': 25.50,
      'Qtd Caixa ini': 12,
      'Qtd Cai': 96,
    })], momentAdapter) as any[];
    expect(p.quantidadeCaixa).toBe(12);
    expect(p.preco).toBeCloseTo(25.50);
  });

  it('variante "Qtd Cai Inner": usa inner (12) e NÃO "Qtd Caixa" outer (96) — v54', () => {
    const [p] = momentAdapter.extract!([brutoMoment({
      'Codigo': 'MO12345',
      'Descricao': 'PRODUTO TESTE CAI INNER',
      'P.Vend': 25.50,
      'Qtd Cai Inner': 12,
      'Qtd Caixa': 96,
    })], momentAdapter) as any[];
    expect(p.quantidadeCaixa).toBe(12);
  });

  it('variante "Qtd Cai Inn": usa inner (12) e NÃO "Qtd Caixa" outer (96) — v54', () => {
    const [p] = momentAdapter.extract!([brutoMoment({
      'Codigo': 'MO12345',
      'Descricao': 'PRODUTO TESTE CAI INN',
      'P.Vend': 25.50,
      'Qtd Cai Inn': 12,
      'Qtd Caixa': 96,
    })], momentAdapter) as any[];
    expect(p.quantidadeCaixa).toBe(12);
  });

  it('catalogo somente com "Qtd Cai" (sem inner): usa o único valor disponível', () => {
    const [p] = momentAdapter.extract!([brutoMoment({
      'Codigo': 'MO12345',
      'Descricao': 'PRODUTO TESTE UNICO',
      'P.Vend': 15.00,
      'Qtd Cai': 24,
    })], momentAdapter) as any[];
    expect(p.quantidadeCaixa).toBe(24);
  });
});
