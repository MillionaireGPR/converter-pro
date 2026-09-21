/**
 * 🔒 VAESO (retestagem 21/09): a conversão de planilha lia V50/V250/V.R. certo, mas
 * `processarArquivoV2` remontava o produto no formato de compatibilidade e jogava
 * fora `precosTabela` — as colunas "Preço de Tabela #1..#3" saíam vazias.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { processarArquivoV2 } from './engine';
import { precoTabelaKey } from './supplierRules/camposMercos';

describe('🔒 tabelas de preço extra sobrevivem ao processarArquivoV2', () => {
  it('planilha com V50/V250/V.R. mapeadas devolve precosTabela em produtos', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Código do produto', 'Nome do produto', 'Preço de Tabela', 'V50', 'V250', 'V.R.'],
      ['PS0450', 'AÇUCAREIRO E SALEIRO CORES', 12.99, 11.25, 10.75, 9.99],
      ['BA0135', 'BALDE DE PIPOCA', 5.98, 5.1, 4.9, 4.49],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Planilha1');
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const file = new File([bytes], 'vaeso.xlsx');
    (file as any).arrayBuffer = async () => (bytes as ArrayBuffer);

    const r = await processarArquivoV2(file, undefined, 'VAESO EXCEL', {
      codigo: 'Código do produto',
      nome: 'Nome do produto',
      precoBase: 'Preço de Tabela',
      [precoTabelaKey(1)]: 'V50',
      [precoTabelaKey(2)]: 'V250',
      [precoTabelaKey(3)]: 'V.R.',
    });

    const ps = r.produtos.find(p => p.codigo === 'PS0450');
    expect(ps?.precosTabela).toEqual([11.25, 10.75, 9.99]);
    expect(r.produtos.find(p => p.codigo === 'BA0135')?.precosTabela).toEqual([5.1, 4.9, 4.49]);
  });
});
