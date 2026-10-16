// Pedido da Michelle (16/10/2026): MOMENT mostra as duas caixas — inner (o
// múltiplo de venda) e master — lado a lado no texto de quantidade do Mercos.
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { runImportPipeline } from '../pipeline/importPipeline';
import { normalizeToMercos } from '../mercos/normalizeToMercos';
import { momentAdapter } from './moment';
import { clinkAdapter } from './clink';

const COL_INFO = 'Informações adicionais (opcional - neste campo coloca-se qualquer detalhe extra do produto. Não aparece no pedido)';

const planilha = (linhas: Record<string, unknown>[], nome = 'MOMENT.xlsx'): File => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Tabela');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  // jsdom não tem File.arrayBuffer — o pipeline só usa name + arrayBuffer.
  return { name: nome, arrayBuffer: async () => buf } as unknown as File;
};

const info = async (linhas: Record<string, unknown>[], adapter = momentAdapter) => {
  const r = await runImportPipeline(planilha(linhas), { forceAdapter: adapter });
  return r.produtosNormalizados.map(p => ({
    codigo: p.codigo,
    qcx: p.quantidadeCaixa,
    info: String(normalizeToMercos(p)[COL_INFO] ?? ''),
  }));
};

describe('MOMENT — caixa inner e master lado a lado', () => {
  it('inner 12 e master 96: as duas no texto; múltiplo continua a inner', async () => {
    const [p] = await info([{ Codigo: 'MO12345', Descricao: 'CANECA TESTE', 'P.Venda': 25.5, 'Qtd Caixa': 96, 'Qtd Caixa inner': 12 }]);
    expect(p.qcx).toBe(12);
    expect(p.info).toBe('Cx inner c/ 12 unidades | Cx master c/ 96 unidades');
  });

  it('variante abreviada "Qtd Cai" / "Qtd Caixa ini"', async () => {
    const [p] = await info([{ Codigo: 'MO12346', Descricao: 'COPO TESTE', 'P.Vend': 10, 'Qtd Cai': 48, 'Qtd Caixa ini': 6 }]);
    expect(p.info).toContain('Cx inner c/ 6 unidades | Cx master c/ 48 unidades');
  });

  it('"NÃO POSSUI CX INNER": só a caixa (master), como antes', async () => {
    const [p] = await info([{ Codigo: 'CB3804', Descricao: 'PRATO TESTE', 'P.Venda': 9, 'Qtd Caixa': 24, 'Qtd Caixa inner': 'NÃO POSSUI CX INNER' }]);
    expect(p.qcx).toBe(24);
    expect(p.info).toContain('Cx c/ 24 unidades');
    expect(p.info).not.toContain('master');
  });

  it('Clink (sem coluna inner) não muda', async () => {
    const [p] = await info([{ Codigo: 'CK1000', Descricao: 'PANELA TESTE', 'P.Venda': 30, 'Qtd Caixa': 12 }], clinkAdapter);
    expect(p.info).toContain('Cx c/ 12 unidades');
    expect(p.info).not.toContain('inner');
  });
});
