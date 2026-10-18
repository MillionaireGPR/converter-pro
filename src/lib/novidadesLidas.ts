// Última versão cuja Central de novidades este navegador abriu — só acende o
// pontinho "tem novidade". Conveniência por aparelho (localStorage): perder isso
// só faz o pontinho voltar.
import type { Novidade } from "@/data/novidades";

const CHAVE = "conversor-novidades-vistas";

export function versaoVista(): number {
  try {
    const n = Number(localStorage.getItem(CHAVE));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function marcarComoVistas(versao: number): void {
  try { localStorage.setItem(CHAVE, String(versao)); } catch { /* sem storage: só perde o pontinho */ }
}

export function temNovidadeNaoVista(novidades: Novidade[], vista: number): boolean {
  return novidades.some(n => n.versao > vista);
}
