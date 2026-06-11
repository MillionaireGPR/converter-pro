/**
 * 🔒 TESTES — Template DAGIA validado contra catálogo real
 *
 * Bug reportado pelo cliente em 28/05/2026: produtos DXP1 e DXP2 estavam
 * sendo FUNDIDOS em um único produto poluído pelo parser genérico (template
 * DAGIA estava vazio). Este teste trava o blockExtractor + fieldExtractors
 * para impedir regressão.
 */
import { describe, it, expect } from 'vitest';
import { dagiaTemplate } from './dagia.template';

describe('🔒 dagiaTemplate — blockExtractor separa produtos corretamente', () => {
  it('separa DXP1 e DXP2 em blocos distintos (bug reportado)', () => {
    // Trecho REAL do catálogo DAGIA 25-03-2026 que estava fundindo produtos
    const textoColuna = `XICARAS C/ PIRES OPALINA
DXP1 Xicara C/ Pires Opalina 80 ml C/12 Pçs 6,5cm Larg 5cm Alt - Jgs CX Presente
DXP2 Xicara C/ Pires Opalina 185 ml C/12 Pçs - 8cm Larg 7cm Alt - CX C/12Jgs CX Presente R$ 33,75`;

    const blockExtractor = dagiaTemplate.blockExtractor as RegExp;
    const blocks = textoColuna.split(blockExtractor).filter(b => b.trim().length > 5);

    // Esperado: 3 blocos — cabeçalho "XICARAS..." + DXP1 + DXP2
    // (o cabeçalho fica em um bloco mas será descartado por não ter código)
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks.some(b => b.startsWith('DXP1'))).toBe(true);
    expect(blocks.some(b => b.startsWith('DXP2'))).toBe(true);
    // Crítico: DXP1 e DXP2 NÃO podem estar no MESMO bloco
    const blocoDXP1 = blocks.find(b => b.startsWith('DXP1'));
    expect(blocoDXP1).not.toContain('DXP2');
  });

  it('separa famílias secundárias (DCM, DS, DM, DV, LHSP, LX, CF)', () => {
    const texto = `DCM25 Centro de Mesa
DS10 Açucareiro
DM11 Meleira
DV31 Vaso
LHSP75 Suporte
LX15016 Item LX
CF001/L12 Conjunto especial`;

    const blockExtractor = dagiaTemplate.blockExtractor as RegExp;
    const blocks = texto.split(blockExtractor).filter(b => b.trim().length > 3);

    expect(blocks.length).toBe(7);
    expect(blocks[0]).toMatch(/^DCM25/);
    expect(blocks[1]).toMatch(/^DS10/);
    expect(blocks[2]).toMatch(/^DM11/);
    expect(blocks[3]).toMatch(/^DV31/);
    expect(blocks[4]).toMatch(/^LHSP75/);
    expect(blocks[5]).toMatch(/^LX15016/);
    expect(blocks[6]).toMatch(/^CF001/);
  });

  it('DXPD vs DXP — alternation correta (DXPD não vira DXP + D)', () => {
    const texto = `DXPD53 Conjunto especial
DXP24 Xicara avulsa`;

    const blockExtractor = dagiaTemplate.blockExtractor as RegExp;
    const blocks = texto.split(blockExtractor).filter(b => b.trim().length > 3);

    expect(blocks.length).toBe(2);
    expect(blocks[0]).toMatch(/^DXPD53/);
    expect(blocks[1]).toMatch(/^DXP24/);
  });

  it('codigo extractor captura formato completo', () => {
    const samples = [
      { texto: 'DXP24 Xicara', expected: 'DXP24' },
      { texto: 'DXPD53 Bowl', expected: 'DXPD53' },
      { texto: 'DCM25 Centro', expected: 'DCM25' },
      { texto: 'CF001/L12 Combo', expected: 'CF001/L12' },
      { texto: 'CF029A/L12 Combo', expected: 'CF029A/L12' },
    ];

    const codigoRegex = dagiaTemplate.fieldExtractors!.codigo as RegExp;
    for (const { texto, expected } of samples) {
      const match = texto.match(codigoRegex);
      expect(match?.[1], `falhou em "${texto}"`).toBe(expected);
    }
  });

  it('preco extractor captura R$ XX,XX e R$ XXX.XX (decimais obrigatórios)', () => {
    const samples = [
      { texto: 'CX C/12Jgs R$ 33,75', expected: '33,75' },
      { texto: 'preço final R$ 50.63', expected: '50.63' },
      { texto: 'apenas R$ 12,50 ', expected: '12,50' },
    ];

    const precoRegex = dagiaTemplate.fieldExtractors!.preco as RegExp;
    for (const { texto, expected } of samples) {
      const match = texto.match(precoRegex);
      expect(match?.[1], `falhou em "${texto}"`).toBe(expected);
    }
  });

  it('🔒 NÃO captura "R$ 12" SEM decimais (false positive de DXPD com EM BREVE)', () => {
    // Bug reportado: DXPD51-55 marcados como "EM BREVE..." no catálogo real
    // ficavam com R$ 12,00 vindo de match indevido em texto sem decimais.
    // Decimais obrigatórios eliminam essa captura.
    const semDecimais = ['R$ 12', 'R$ 99', 'R$ 1000', 'R$12 unidades'];
    const precoRegex = dagiaTemplate.fieldExtractors!.preco as RegExp;
    for (const texto of semDecimais) {
      const match = texto.match(precoRegex);
      expect(match, `"${texto}" NÃO deve ser tratado como preço`).toBeNull();
    }
  });

  it('quantidadeCaixa captura "CX C/N Jgs" (exige prefixo CX)', () => {
    const samples = [
      { texto: 'CX C/12Jgs', expected: '12' },
      { texto: 'CX C/8Pçs', expected: '8' },
      { texto: 'CX C/72Pçs', expected: '72' },
      { texto: 'CX C/83Jgs', expected: '83' },
    ];

    const qtdRegex = dagiaTemplate.fieldExtractors!.quantidadeCaixa as RegExp;
    for (const { texto, expected } of samples) {
      const match = texto.match(qtdRegex);
      expect(match?.[1], `falhou em "${texto}"`).toBe(expected);
    }
  });

  it('🔒 quantidadeCaixa IGNORA "C/N Pçs" do nome (sem prefixo CX)', () => {
    // Bug real (09/06/2026): LX15016 tinha nome "Copo 458 ml C/6 Pçs" e CX
    // real "CX C/8Jgs". Regex antigo aceitava ambos e o do nome ganhava → 6.
    // Fix: exigir CX como prefixo. "C/6 Pçs" sozinho NÃO casa.
    const namesOnly = [
      'Copo 458 ml C/6 Pçs',
      'Xicara C/ Pires Opalina 80 ml C/12 Pçs',
      'Bowl C/8 Pçs colorido',
    ];
    const qtdRegex = dagiaTemplate.fieldExtractors!.quantidadeCaixa as RegExp;
    for (const texto of namesOnly) {
      const match = texto.match(qtdRegex);
      expect(match, `"${texto}" NÃO deveria casar (sem prefixo CX)`).toBeNull();
    }
  });

  it('🔒 LX15016 real: extrai 8 (CX C/8Jgs), ignora 6 (C/6 Pçs do nome)', () => {
    // Texto real extraído via PyMuPDF do CATÁLOGO DAGIA 25-03-2026 pg 13
    const blocoLX15016 = `LX15016
Copo 458 ml C/6 Pçs
-
8,6cm Larg
15cm Alt
-
CX C/8Jgs
CX Presente
-
COPO
R$25,20
FINAL`;
    const qtdRegex = dagiaTemplate.fieldExtractors!.quantidadeCaixa as RegExp;
    const match = blocoLX15016.match(qtdRegex);
    expect(match?.[1]).toBe('8');
  });
});
