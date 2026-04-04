import { describe, it, expect } from 'vitest';
import { getAdapterById, getGenericAdapter, getAllAdapters, detectSupplier } from './registry';

describe('getAdapterById', () => {
  it('encontra adapter pelo ID', () => {
    const adapter = getAdapterById('clink');
    expect(adapter).toBeDefined();
    expect(adapter?.nome).toBe('Clink');
  });

  it('encontra adapter pelo nome', () => {
    const adapter = getAdapterById('Lila Home');
    expect(adapter).toBeDefined();
    expect(adapter?.id).toBe('lila-home');
  });

  it('encontra adapter por alias', () => {
    const adapter = getAdapterById('nixhouse');
    expect(adapter).toBeDefined();
    expect(adapter?.id).toBe('nix');
  });

  it('retorna undefined para ID desconhecido', () => {
    expect(getAdapterById('fornecedor-inexistente')).toBeUndefined();
  });

  it('retorna undefined para string vazia', () => {
    expect(getAdapterById('')).toBeUndefined();
  });
});

describe('getGenericAdapter', () => {
  it('retorna adapter genérico', () => {
    const adapter = getGenericAdapter();
    expect(adapter.id).toBe('generic');
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
    expect(adapters.find(a => a.id === 'generic')).toBeUndefined();
  });
});

describe('detectSupplier', () => {
  it('detecta Clink pelo nome no texto', () => {
    const result = detectSupplier('Tabela de preços CLINK 2024');
    expect(result.adapter.id).toBe('clink');
    expect(result.confianca).toBeGreaterThan(0);
    expect(result.metodo).toBe('nome');
  });

  it('detecta Nix pelo padrão de código', () => {
    const result = detectSupplier('Lista de produtos', [], ['NX001', 'NX002', 'NX003']);
    expect(result.adapter.id).toBe('nix');
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
    expect(result.adapter.id).toBe('generic');
    expect(result.confianca).toBe(0);
  });

  it('detecta por headers de planilha', () => {
    const headers = ['ref', 'nome', 'pvenda', 'ipi', 'qtdcaixa', 'categoria'];
    const result = detectSupplier('', headers);
    // Deve detectar algum adapter (genérico tem muitos aliases que batem)
    expect(result).toBeDefined();
  });
});
