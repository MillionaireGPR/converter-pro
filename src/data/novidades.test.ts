import { describe, it, expect } from "vitest";
import { NOVIDADES } from "@/data/novidades";
import { VERSAO } from "@/lib/versao";
import { temNovidadeNaoVista } from "@/lib/novidadesLidas";

// Subiu a versão sem escrever o que mudou → quebra aqui e lembra.
// Vale para entrega só no motor de conversão (servidor) também.
describe("Central de novidades acompanha a versão do conversor", () => {
  it("a entrada mais nova é a versão atual", () => {
    expect(NOVIDADES[0].versao).toBe(Number(VERSAO));
  });
  it("ordem decrescente, sem versão repetida", () => {
    const v = NOVIDADES.map(n => n.versao);
    expect(v).toEqual([...v].sort((a, b) => b - a));
    expect(new Set(v).size).toBe(v.length);
  });
  it("toda entrada tem data e itens com texto", () => {
    for (const n of NOVIDADES) {
      expect(n.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(n.itens.length).toBeGreaterThan(0);
      for (const it of n.itens) expect(it.texto.trim().length).toBeGreaterThan(10);
    }
  });
  it("pontinho de novidade só acende com versão mais nova que a vista", () => {
    expect(temNovidadeNaoVista(NOVIDADES, 0)).toBe(true);
    expect(temNovidadeNaoVista(NOVIDADES, NOVIDADES[0].versao)).toBe(false);
  });
});
