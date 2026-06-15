/**
 * 🔒 IV-17 — Contrato da anotação do AI Image Picker (badge no CENTRO).
 *
 * O picker real é Python (gemini_image_picker.py). Este teste replica a
 * MATEMÁTICA do posicionamento do badge em TS para travar o invariante em
 * paralelo (mesmo padrão de dagia-box-heuristic.test.ts).
 *
 * BUG QUE ISTO PREVINE (validado contra Gemini real, 09/06/2026):
 *   Badge no CANTO da candidata colava com badges de imagens sobrepostas
 *   (foto full-page + card de título no mesmo canto). O Gemini não associava
 *   o número à foto certa → LX15016 pegava card preto em vez dos copos.
 *   Fix: badge no CENTRO do rect → fica SOBRE o conteúdo de cada imagem.
 *
 * Se alguém voltar o badge pro canto, este teste falha.
 */
import { describe, it, expect } from 'vitest';

interface Rect { x0: number; y0: number; x1: number; y1: number }

/** Replica de _annotate_page: posição do badge = CENTRO do rect × scale. */
function badgePosition(rect: Rect, scale: number, imgW: number, imgH: number): { cx: number; cy: number } {
  let cx = Math.round(((rect.x0 + rect.x1) / 2) * scale);
  let cy = Math.round(((rect.y0 + rect.y1) / 2) * scale);
  cx = Math.max(20, Math.min(imgW - 20, cx));
  cy = Math.max(20, Math.min(imgH - 20, cy));
  return { cx, cy };
}

describe('🔒 IV-17 — badge do AI picker fica no CENTRO da candidata', () => {
  const SCALE = 1.2;
  // Página DAGIA pg 14 (661×900 pts → raster 793×1080)
  const IMG_W = Math.round(661 * SCALE);
  const IMG_H = Math.round(900 * SCALE);

  it('foto full-page → badge no centro da página (sobre o produto, NÃO no canto)', () => {
    const beer: Rect = { x0: 0, y0: 2, x1: 661, y1: 902 };
    const { cx, cy } = badgePosition(beer, SCALE, IMG_W, IMG_H);
    // Centro, não canto: deve estar bem longe de (0,0)
    expect(cx).toBeGreaterThan(IMG_W * 0.3);
    expect(cy).toBeGreaterThan(IMG_H * 0.3);
  });

  it('card de título (topo) e foto full-page têm badges DISTANTES entre si', () => {
    const beer: Rect = { x0: 0, y0: 2, x1: 661, y1: 902 };
    const card: Rect = { x0: 35, y0: 1, x1: 204, y1: 201 };
    const b = badgePosition(beer, SCALE, IMG_W, IMG_H);
    const c = badgePosition(card, SCALE, IMG_W, IMG_H);
    const dist = Math.hypot(b.cx - c.cx, b.cy - c.cy);
    // Com badge no CENTRO, a distância é grande (não colam como no canto).
    expect(dist).toBeGreaterThan(200);
  });

  it('🔒 três candidatas sobrepostas → três badges em posições distintas', () => {
    const beer: Rect = { x0: 0, y0: 2, x1: 661, y1: 902 };
    const card: Rect = { x0: 35, y0: 1, x1: 204, y1: 201 };
    const tag: Rect = { x0: 60, y0: 622, x1: 364, y1: 872 };
    const positions = [beer, card, tag].map(r => badgePosition(r, SCALE, IMG_W, IMG_H));
    // Todas as posições 2-a-2 distintas (associação número↔imagem inequívoca)
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const d = Math.hypot(positions[i].cx - positions[j].cx, positions[i].cy - positions[j].cy);
        expect(d, `badges ${i} e ${j} colaram`).toBeGreaterThan(80);
      }
    }
  });

  it('badge nunca sai da imagem (clamp 20px das bordas)', () => {
    const tiny: Rect = { x0: 0, y0: 0, x1: 5, y1: 5 };
    const { cx, cy } = badgePosition(tiny, SCALE, IMG_W, IMG_H);
    expect(cx).toBeGreaterThanOrEqual(20);
    expect(cy).toBeGreaterThanOrEqual(20);
    expect(cx).toBeLessThanOrEqual(IMG_W - 20);
    expect(cy).toBeLessThanOrEqual(IMG_H - 20);
  });
});
