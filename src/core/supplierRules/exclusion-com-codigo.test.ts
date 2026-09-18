/**
 * 🔒 Regressão 18/09/2026 — produto COM código não é linha de total.
 *
 * Dute (retestagem do Josef): 31 códigos ativos com preço sumiam da
 * exportação (medido: 37 de 651). A regra `total|subtotal|soma` (sem âncora,
 * copiada em Dute/Petrin/Levivan) rodava contra o texto inteiro do produto e
 * casava com "(Total 144 UND)" na observação de caixa.
 */
import { describe, it, expect } from 'vitest';
import { extractProducts } from './extractor';
import { duteAdapter } from './dute';
import { petrinAdapter } from './petrin';
import { ProdutoBruto } from '../types/productPipeline';

const bruto = (campos: Record<string, any>): ProdutoBruto => ({
  campos,
  linhaOrigem: 0,
  paginaOrigem: 1,
  textoBruto: '',
});

describe('🔒 exclusão de linha de total não derruba produto com código', () => {
  for (const adapter of [duteAdapter, petrinAdapter]) {
    it(`${adapter.nome}: "(Total 144 UND)" na observação não exclui o produto`, () => {
      const r = extractProducts(
        [
          bruto({
            codigo: 'DTY1183',
            descricao: 'BOLHA DE SABAO BICHINHOS',
            preco: '4.3',
            observacoes: 'Quant. na caixa: 6 Displays c/ 24 UND (Total 144 UND)',
          }),
        ],
        adapter,
        'catalogo.pdf'
      );
      expect(r).toHaveLength(1);
      expect(r[0].codigo).toBe('DTY1183');
    });

    it(`${adapter.nome}: linha de total real (sem código) continua excluída`, () => {
      const r = extractProducts(
        [bruto({ descricao: 'TOTAL GERAL', preco: '9999' })],
        adapter,
        'planilha.xlsx'
      );
      expect(r).toHaveLength(0);
    });

    it(`${adapter.nome}: código "TOTAL" na coluna de código continua excluído`, () => {
      const r = extractProducts(
        [bruto({ codigo: 'TOTAL', descricao: 'x', preco: '10' })],
        adapter,
        'planilha.xlsx'
      );
      expect(r).toHaveLength(0);
    });
  }
});
