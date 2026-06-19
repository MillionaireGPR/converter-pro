/**
 * 🔒 REGRAS DE MÚLTIPLO/CAIXA por fornecedor (reunião 18/06/2026):
 * - MOMENT: múltiplo = "Qtd Caixa inner" (col H), não a "Qtd Caixa" cheia (col G).
 * - LILA: aviso "caixa fracionável (1/3 ou 1/2)".
 * - FORTAL: aviso "abre caixa (mín R$100)" só p/ itens >= R$100.
 */
import { describe, it, expect } from 'vitest';
import { momentAdapter } from './moment';
import { normalizeToMercos } from '../mercos/normalizeToMercos';
import { ProdutoBruto } from '../types/productPipeline';

const bruto = (campos: Record<string, any>): ProdutoBruto => ({
  campos, linhaOrigem: 0, paginaOrigem: 1, textoBruto: '',
});

const prod = (over: Record<string, any>): any => ({
  codigo: 'X1', nome: 'PRODUTO', precoBase: 10, precoFinal: 10, quantidadeCaixa: 1,
  unidade: 'UN', status: 'validado', erros: [], fornecedor: '', ...over,
});

describe('🔒 MOMENT — múltiplo = Qtd Caixa inner (col H)', () => {
  it('usa 18 (inner), NÃO 36 (caixa cheia)', () => {
    const [p] = momentAdapter.extract!([bruto({
      'Código': 'CB3885', 'Descr Compl': 'ADESIVO PROTETOR SOFÁ',
      'P.Venda': '9,86', 'Qtd Caixa': 36, 'Qtd Caixa inner': 18,
    })], momentAdapter) as any[];
    expect(p.quantidadeCaixa).toBe(18);
  });
});

describe('🔒 Notas de múltiplo no export Mercos', () => {
  const infoCol = 'Informações adicionais (opcional - neste campo coloca-se qualquer detalhe extra do produto. Não aparece no pedido)';

  it('LILA → aviso de caixa fracionável', () => {
    const row = normalizeToMercos(prod({ fornecedor: 'LILA HOME' }));
    expect(String(row[infoCol])).toContain('fracionável');
  });
  it('FORTAL >= R$100 → aviso de abre caixa', () => {
    const row = normalizeToMercos(prod({ fornecedor: 'FORTAL', precoBase: 150 }));
    expect(String(row[infoCol])).toContain('Abre caixa');
  });
  it('FORTAL < R$100 → SEM aviso de abre caixa', () => {
    const row = normalizeToMercos(prod({ fornecedor: 'FORTAL', precoBase: 50 }));
    expect(String(row[infoCol])).not.toContain('Abre caixa');
  });
});
