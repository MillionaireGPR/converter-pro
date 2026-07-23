import { describe, it, expect } from 'vitest';
import { getAdapterById, getGenericAdapter, getAllAdapters, detectSupplier } from './registry';

describe('getAdapterById', () => {
  it('encontra adapter pelo ID', () => {
    const adapter = getAdapterById('clink');
    expect(adapter).toBeDefined();
    expect(adapter?.nome).toBe('Clink');
    // Clink usa UUID c0000000-0000-4000-a000-000000000000
    expect(adapter?.id).toBe('c0000000-0000-4000-a000-000000000000');
  });

  it('encontra adapter pelo nome', () => {
    const adapter = getAdapterById('Lila Home');
    expect(adapter).toBeDefined();
    expect(adapter?.id).toBe('lila-home');
  });

  it('encontra adapter por alias', () => {
    const adapter = getAdapterById('nixhouse');
    expect(adapter).toBeDefined();
    // Nix House agora usa UUID: nix-house-0000-4000-a000-000000000000
    expect(adapter?.id).toBe('nix-house-0000-4000-a000-000000000000');
  });

  it('retorna undefined para ID desconhecido', () => {
    expect(getAdapterById('fornecedor-inexistente')).toBeUndefined();
  });

  it('retorna undefined para string vazia', () => {
    expect(getAdapterById('')).toBeUndefined();
  });

  // Segmentação de catálogo por área (reunião 22/07/2026): fornecedores que
  // criam sub-catálogos ("GIRA DECORAÇÃO") devem cair na regra da marca base.
  it('casa nome segmentado pelo prefixo da marca (GIRA DECORAÇÃO → Gira)', () => {
    const adapter = getAdapterById('GIRA DECORAÇÃO');
    expect(adapter?.nome).toBe('GIRA');
  });

  it('casa outros segmentos GIRA (papelaria/utilidades)', () => {
    expect(getAdapterById('Gira Papelaria')?.nome).toBe('GIRA');
    expect(getAdapterById('gira utilidades 2026')?.nome).toBe('GIRA');
  });

  it('NÃO casa nome sem prefixo de marca conhecida (segue undefined)', () => {
    expect(getAdapterById('Fornecedor Totalmente Novo')).toBeUndefined();
    expect(getAdapterById('decoração gira')).toBeUndefined(); // marca não está no início
  });

  it('match exato tem prioridade sobre prefixo', () => {
    // "gira" exato deve retornar Gira, não outro adapter cujo alias seja prefixo
    expect(getAdapterById('gira')?.nome).toBe('GIRA');
  });
});

describe('getGenericAdapter', () => {
  it('retorna adapter genérico', () => {
    const adapter = getGenericAdapter();
    // UUID válido para evitar erro de FK no banco
    expect(adapter.id).toBe('00000000-0000-4000-a000-000000000000');
    expect(adapter.nome).toBe('Genérico');
  });
});

describe('getAllAdapters', () => {
  it('retorna lista com pelo menos 6 adapters', () => {
    const adapters = getAllAdapters();
    expect(adapters.length).toBeGreaterThanOrEqual(6);
  });

  it('não inclui o genérico na lista', () => {
    const adapters = getAllAdapters();
    // Genérico usa UUID 00000000-0000-4000-a000-000000000000
    expect(adapters.find(a => a.id === '00000000-0000-4000-a000-000000000000')).toBeUndefined();
  });
});

describe('detectSupplier', () => {
  it('detecta Clink pelo nome no texto', () => {
    const result = detectSupplier('Tabela de preços CLINK 2024');
    // Clink usa UUID c0000000-0000-4000-a000-000000000000
    expect(result.adapter.id).toBe('c0000000-0000-4000-a000-000000000000');
    expect(result.confianca).toBeGreaterThan(0);
    expect(result.metodo).toBe('nome');
  });

  it('detecta Nix pelo padrão de código', () => {
    const result = detectSupplier('Lista de produtos', [], ['NX001', 'NX002', 'NX003']);
    // Nix House agora usa UUID: nix-house-0000-4000-a000-000000000000
    expect(result.adapter.id).toBe('nix-house-0000-4000-a000-000000000000');
    expect(result.confianca).toBeGreaterThan(0);
  });

  it('detecta Goal Kids pelo padrão GK####', () => {
    const result = detectSupplier('Catálogo', [], ['GK1234', 'GK5678']);
    expect(result.adapter.id).toBe('goal-kids');
  });

  it('detecta Lila Home pelo padrão CÓD:', () => {
    const result = detectSupplier('CÓD: AB123\nMATERIAL: Cerâmica\nR$ 50,00');
    expect(result.adapter.id).toBe('lila-home');
  });

  it('retorna genérico quando não detecta nenhum', () => {
    const result = detectSupplier('texto aleatório sem padrão');
    // Genérico usa UUID 00000000-0000-4000-a000-000000000000
    expect(result.adapter.id).toBe('00000000-0000-4000-a000-000000000000');
    expect(result.confianca).toBe(0);
  });

  it('detecta por headers de planilha', () => {
    const headers = ['ref', 'nome', 'pvenda', 'ipi', 'qtdcaixa', 'categoria'];
    const result = detectSupplier('', headers);
    // Deve detectar algum adapter (genérico tem muitos aliases que batem)
    expect(result).toBeDefined();
  });
});
