import { describe, it, expect } from 'vitest';
import {
  normalizeSpaces,
  removeNoise,
  extractPrice,
  parseDecimalBR,
  separateNCMAndIPI,
  isJunkText,
  cleanDescription,
  sanitizeForExport,
  deduplicateByCodigo,
} from './cleaners';

describe('normalizeSpaces', () => {
  it('remove tabs e espaços duplos', () => {
    expect(normalizeSpaces('  hello\t\t world  ')).toBe('hello world');
  });
  it('retorna vazio para null/undefined', () => {
    expect(normalizeSpaces('')).toBe('');
  });
});

describe('removeNoise', () => {
  it('remove padrão "atualizado em DD/MM/YYYY"', () => {
    expect(removeNoise('Produto X atualizado em 15/03/2024')).toBe('Produto X');
  });
  it('remove "página N"', () => {
    expect(removeNoise('Lista de preços página 3')).toBe('Lista de preços');
  });
});

describe('extractPrice', () => {
  it('extrai preço formato BR: R$ 1.234,56', () => {
    expect(extractPrice('R$ 1.234,56')).toBe(1234.56);
  });
  it('extrai preço formato BR sem R$: 1.234,56', () => {
    expect(extractPrice('1.234,56')).toBe(1234.56);
  });
  it('extrai preço formato US: 1234.56', () => {
    expect(extractPrice('1234.56')).toBe(1234.56);
  });
  it('extrai preço simples com vírgula: 10,50', () => {
    expect(extractPrice('10,50')).toBe(10.50);
  });
  it('retorna 0 para texto sem número', () => {
    expect(extractPrice('sem preço')).toBe(0);
  });
  it('retorna 0 para vazio', () => {
    expect(extractPrice('')).toBe(0);
  });
  it('funciona com número direto', () => {
    expect(extractPrice(99.9 as any)).toBe(99.9);
  });
  it('extrai preço com R$ colado', () => {
    expect(extractPrice('R$15,90')).toBe(15.90);
  });
});

describe('parseDecimalBR', () => {
  it('converte string BR para número', () => {
    expect(parseDecimalBR('1.234,56')).toBe(1234.56);
  });
  it('retorna 0 para null', () => {
    expect(parseDecimalBR(null)).toBe(0);
  });
  it('retorna número direto', () => {
    expect(parseDecimalBR(42)).toBe(42);
  });
});

describe('separateNCMAndIPI', () => {
  it('separa NCM e IPI: "8516.10.00 / 15%"', () => {
    const result = separateNCMAndIPI('8516.10.00 / 15%');
    expect(result.ncm).toBe('8516.10.00');
    expect(result.ipi).toBe(15);
  });
  it('NCM sozinho', () => {
    const result = separateNCMAndIPI('8516.10.00');
    expect(result.ncm).toBe('8516.10.00');
    expect(result.ipi).toBe(0);
  });
  it('vazio retorna defaults', () => {
    const result = separateNCMAndIPI('');
    expect(result.ncm).toBe('');
    expect(result.ipi).toBe(0);
  });
});

describe('isJunkText', () => {
  it('detecta código de barras solto', () => {
    expect(isJunkText('7891234567890')).toBe(true);
  });
  it('detecta unidade solta', () => {
    expect(isJunkText('UN')).toBe(true);
  });
  it('detecta preço solto', () => {
    expect(isJunkText('R$ 10')).toBe(true);
  });
  it('aceita texto de produto', () => {
    expect(isJunkText('Jogo de Chaves')).toBe(false);
  });
  it('rejeita texto curto', () => {
    expect(isJunkText('A')).toBe(true);
  });
});

describe('cleanDescription', () => {
  it('remove ruído e status', () => {
    expect(cleanDescription('Produto Legal ESGOTADO atualizado em 01/01/2024')).toBe('Produto Legal');
  });
});

describe('sanitizeForExport', () => {
  it('substitui aspas inteligentes', () => {
    expect(sanitizeForExport('\u201CHello\u201D')).toBe('"Hello"');
  });
  it('substitui travessão', () => {
    expect(sanitizeForExport('10\u201320')).toBe('10-20');
  });
});

describe('deduplicateByCodigo', () => {
  it('remove duplicados por código', () => {
    const items = [
      { codigo: 'ABC123', nome: 'Produto 1' },
      { codigo: 'ABC123', nome: 'Produto 1 Dup' },
      { codigo: 'DEF456', nome: 'Produto 2' },
    ];
    const result = deduplicateByCodigo(items);
    expect(result.unicos.length).toBe(2);
    expect(result.duplicados.length).toBe(1);
    expect(result.totalRemovidos).toBe(1);
  });
  it('mantém itens sem código', () => {
    const items = [
      { codigo: '', nome: 'Sem código 1' },
      { codigo: '', nome: 'Sem código 2' },
    ];
    const result = deduplicateByCodigo(items);
    expect(result.unicos.length).toBe(2);
  });
});
