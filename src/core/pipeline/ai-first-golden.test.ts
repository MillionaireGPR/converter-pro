/**
 * 🔒 v23 AI-FIRST — Golden tests com fixture REAL do spike DAGIA
 *
 * A fixture __fixtures__/dagia-ai-extraction.json é a resposta REAL do
 * Gemini 2.5 Flash para o CATÁLOGO DAGIA 25-03-2026 (spike de 09/06/2026
 * que aprovou o pivô AI-first: 100% códigos, 100% preços, 5/5 EM BREVE).
 *
 * FILOSOFIA DOS GOLDEN TESTS:
 *   Travam o COMPORTAMENTO (28 produtos, estes códigos, estes preços),
 *   não a implementação. Se alguém mexer no mapeamento AI→ProdutoBruto
 *   ou no pipeline e quebrar o resultado, estes testes acusam.
 */
import { describe, it, expect } from 'vitest';
import { mapAiProductsToBrutos, AiProduto } from './aiFirstExtractionApi';
import fixture from './__fixtures__/dagia-ai-extraction.json';

const produtos = fixture.produtos as AiProduto[];

describe('🔒 v23 AI-first — golden DAGIA (fixture real do Gemini)', () => {
  it('fixture tem exatamente 28 produtos (catálogo completo)', () => {
    expect(produtos).toHaveLength(28);
  });

  it('mapAiProductsToBrutos converte todos os 28', () => {
    const brutos = mapAiProductsToBrutos(produtos);
    expect(brutos).toHaveLength(28);
  });

  it('🔒 todos os 28 códigos do catálogo presentes', () => {
    const expectedCodes = [
      'DXP1', 'DXP2', 'DXP3', 'DXP24', 'DXP25',
      'DXPD51', 'DXPD52', 'DXPD53', 'DXPD54', 'DXPD55',
      'DZ01', 'DZ02', 'DZ03', 'DZ04', 'LHSP75',
      'DXP57', 'CF026/L12', 'CF029A/L12', 'CF001/L12', 'DXP15',
      'LX15016', 'DPB01', 'DPB02', 'DCM25', 'DCM26',
      'DS10', 'DM11', 'DV31',
    ];
    const brutos = mapAiProductsToBrutos(produtos);
    const codes = brutos.map(b => b.campos['codigo']);
    for (const expected of expectedCodes) {
      expect(codes, `código ${expected} ausente`).toContain(expected);
    }
  });

  it('🔒 preços críticos corretos (casos que regex errava)', () => {
    const brutos = mapAiProductsToBrutos(produtos);
    const byCode = Object.fromEntries(brutos.map(b => [b.campos['codigo'], b.campos]));

    // CF029A/L12 = 26.60 — regex pegava 33.00 do DXP57 (bug histórico)
    expect(parseFloat(byCode['CF029A/L12']['preco'])).toBeCloseTo(26.6, 2);
    // DXP57 = 33.00
    expect(parseFloat(byCode['DXP57']['preco'])).toBeCloseTo(33.0, 2);
    // DZ01 = 155.00
    expect(parseFloat(byCode['DZ01']['preco'])).toBeCloseTo(155.0, 2);
    // LX15016 = 25.20
    expect(parseFloat(byCode['LX15016']['preco'])).toBeCloseTo(25.2, 2);
    // LHSP75 = 4.38
    expect(parseFloat(byCode['LHSP75']['preco'])).toBeCloseTo(4.38, 2);
  });

  it('🔒 DXPD51-55 (EM BREVE) mapeiam com __emBreve e SEM preço', () => {
    // Fixture v23 (com hints): Gemini retorna emBreve=true explícito.
    const brutos = mapAiProductsToBrutos(produtos);
    const emBreveCodes = ['DXPD51', 'DXPD52', 'DXPD53', 'DXPD54', 'DXPD55'];
    for (const code of emBreveCodes) {
      const bruto = brutos.find(b => b.campos['codigo'] === code);
      expect(bruto, `${code} não encontrado`).toBeDefined();
      expect(bruto!.campos['preco'], `${code} não deveria ter preço`).toBeUndefined();
      expect(bruto!.campos['__emBreve'], `${code} deveria ter __emBreve`).toBe(true);
      expect(bruto!.campos['informacoesAdicionais']).toBe('EM BREVE');
    }
  });

  it('🔒 qty CAIXA 100% correta (28/28 — validado contra etiquetas CX C/N Jgs)', () => {
    // Re-spike v23 com hints: 28/28 (era 12/28 sem hints).
    // Ground truth = etiquetas "CX C/N Jgs" lidas manualmente do catálogo.
    const GT_CX: Record<string, number> = {
      'DXP1': 12, 'DXP2': 12, 'DXP3': 12, 'DXP24': 12, 'DXP25': 8,
      'DXPD51': 12, 'DXPD52': 12, 'DXPD53': 12, 'DXPD54': 12, 'DXPD55': 12,
      'DZ01': 2, 'DZ02': 2, 'DZ03': 2, 'DZ04': 2, 'LHSP75': 72,
      'DXP57': 6, 'CF026/L12': 8, 'CF029A/L12': 8, 'CF001/L12': 8, 'DXP15': 8,
      'LX15016': 8, 'DPB01': 8, 'DPB02': 12, 'DCM25': 4, 'DCM26': 4,
      'DS10': 24, 'DM11': 24, 'DV31': 36,
    };
    const brutos = mapAiProductsToBrutos(produtos);
    for (const [code, cx] of Object.entries(GT_CX)) {
      const bruto = brutos.find(b => b.campos['codigo'] === code);
      expect(bruto, `${code} não encontrado`).toBeDefined();
      expect(bruto!.campos['cx'], `${code}: qty caixa errada`).toBe(String(cx));
    }
  });

  it('produto com emBreve=true explícito seta __emBreve + informacoesAdicionais', () => {
    const aiProds: AiProduto[] = [{
      codigo: 'TEST01',
      nome: 'Produto Futuro',
      preco: null,
      emBreve: true,
      paginaOrigem: 3,
    }];
    const brutos = mapAiProductsToBrutos(aiProds);
    expect(brutos).toHaveLength(1);
    expect(brutos[0].campos['__emBreve']).toBe(true);
    expect(brutos[0].campos['informacoesAdicionais']).toBe('EM BREVE');
    expect(brutos[0].campos['preco']).toBeUndefined();
  });

  it('🔒 __postProcessed=true em TODOS (bloqueia heurística "menor numérico = preço")', () => {
    const brutos = mapAiProductsToBrutos(produtos);
    for (const b of brutos) {
      expect(b.campos['__postProcessed'], `${b.campos['codigo']} sem __postProcessed`).toBe(true);
    }
  });

  it('paginaOrigem preservada (necessária pra extração de imagens)', () => {
    const brutos = mapAiProductsToBrutos(produtos);
    const dz01 = brutos.find(b => b.campos['codigo'] === 'DZ01');
    expect(dz01!.paginaOrigem).toBe(7);
    const lx = brutos.find(b => b.campos['codigo'] === 'LX15016');
    expect(lx!.paginaOrigem).toBe(14);
  });

  it('quantidadeCaixa mapeada nas chaves "cx" E "quantidadecaixa" (compat aliases)', () => {
    const brutos = mapAiProductsToBrutos(produtos);
    const dxp1 = brutos.find(b => b.campos['codigo'] === 'DXP1');
    expect(dxp1!.campos['cx']).toBe('12');
    expect(dxp1!.campos['quantidadecaixa']).toBe('12');
  });

  it('produto sem código é descartado (não vira lixo no pipeline)', () => {
    const aiProds: AiProduto[] = [
      { codigo: '', nome: 'Sem código', preco: 10 },
      { codigo: 'OK01', nome: 'Com código', preco: 10 },
    ];
    const brutos = mapAiProductsToBrutos(aiProds);
    expect(brutos).toHaveLength(1);
    expect(brutos[0].campos['codigo']).toBe('OK01');
  });
});
