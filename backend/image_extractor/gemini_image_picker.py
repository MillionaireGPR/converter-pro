"""
Gemini Vision para SELEÇÃO de imagem de produto — v24 MEMORY-SAFE.

═══════════════════════════════════════════════════════════════════════
POR QUE ESTE REDESENHO (lição do v21 que causou OOM em produção)
═══════════════════════════════════════════════════════════════════════

v21 (REVERTIDO): por página, extraía TODAS as imagens candidatas como
arrays RGB + gerava N miniaturas JPEG + mandava tudo inline pro Gemini.
Tudo na RAM ao mesmo tempo × N páginas = OOM no Render Starter (512MB).
Backend reiniciava → 502 → job perdido.

v24 (este): manda UMA imagem só — a página JÁ renderizada (que o
cv_extractor tem em mãos) com NÚMEROS desenhados sobre cada candidata.
O Gemini vê a página inteira e responde qual NÚMERO é a foto do produto.
Só então o caller extrai a UMA imagem escolhida.

Footprint por página:
  - 1 raster da página (já existe no cv_extractor, não duplica)
  - 1 cópia anotada downscalada p/ ~1100px (~250KB, liberada após a chamada)
  - 1 chamada HTTP Gemini (sem imagens inline extras)
  = praticamente o mesmo que o cv_extractor já usa hoje.

CUSTO: 1 chamada Flash por página com SKUs (~$0.005). DAGIA ~18 pgs ≈ $0.09.
"""
import os
import json
import time
from typing import List, Dict, Any, Optional, Tuple

import cv2
import numpy as np

# Reusa init/lazy-import já travado em gemini_extractor.py (IV-01)
from gemini_extractor import _ensure_initialized, MODEL_FLASH


# ─────────────────────────────────────────────────────────────
# Prompt
# ─────────────────────────────────────────────────────────────

PROMPT_TEMPLATE = """Você é um especialista em catálogos B2B brasileiros de utensílios domésticos.

A imagem é UMA página de catálogo. Cada imagem de produto candidata foi marcada
com um NÚMERO dentro de um círculo VERMELHO (1, 2, 3, ...).

Produtos desta página (código: nome):
{skus_list}

Para CADA produto, responda qual NÚMERO marca a melhor FOTO COMERCIAL do produto.

PREFERÊNCIAS (nesta ordem):
1. Se é um KIT/JOGO/CONJUNTO (várias peças), escolha a CAIXA ou EMBALAGEM que
   mostra o conjunto completo (geralmente uma caixa colorida com a marca).
2. Se não houver caixa, escolha a imagem que mostra o produto mais completo.
3. Se é item individual, a foto principal do produto.

REJEITE SEMPRE (nunca escolha estes números):
- Etiquetas/tags de preço (retângulos amarelos ou vermelhos com "R$" ou "FINAL")
- Logos da marca, ícones de "CX C/N", "CX Presente"
- Fundos/banners decorativos, faixas de cor sólida, títulos
- Números soltos sem produto

Retorne APENAS JSON puro (sem markdown):
{{
  "escolhas": {{
    "CODIGO1": 3,
    "CODIGO2": 7,
    "CODIGO3": null
  }}
}}

Use null se NENHUM número marca uma foto adequada do produto.
"""


# ─────────────────────────────────────────────────────────────
# Anotação da página (desenha números sobre as candidatas)
# ─────────────────────────────────────────────────────────────

def _annotate_page(
    raster_rgb: np.ndarray,
    candidates: List[Dict[str, Any]],
    scale: float,
) -> np.ndarray:
    """
    Desenha um badge numerado (círculo vermelho + número branco) no canto
    superior-esquerdo de cada candidata, sobre uma CÓPIA da página.

    candidates: [{"index": 1, "rect": fitz.Rect (PDF points), ...}]
    scale: fator raster = pixels / PDF-point.

    Retorna a cópia anotada (RGB). NÃO modifica o raster original (o caller
    precisa dele intacto para extrair a imagem escolhida em alta qualidade).
    """
    annotated = raster_rgb.copy()
    h_img, w_img = annotated.shape[:2]
    for cand in candidates:
        idx = cand["index"]
        rect = cand["rect"]
        # canto superior-esquerdo da candidata em pixels
        x = int(rect.x0 * scale)
        y = int(rect.y0 * scale)
        # leve deslocamento pra dentro pra não cortar o badge
        cx = max(18, min(w_img - 18, x + 22))
        cy = max(18, min(h_img - 18, y + 22))
        radius = 17
        # círculo vermelho preenchido + borda branca
        cv2.circle(annotated, (cx, cy), radius, (220, 30, 30), -1)
        cv2.circle(annotated, (cx, cy), radius, (255, 255, 255), 2)
        label = str(idx)
        font = cv2.FONT_HERSHEY_SIMPLEX
        fscale = 0.7 if len(label) == 1 else 0.55
        (tw, th), _ = cv2.getTextSize(label, font, fscale, 2)
        cv2.putText(
            annotated, label,
            (cx - tw // 2, cy + th // 2),
            font, fscale, (255, 255, 255), 2, cv2.LINE_AA,
        )
    return annotated


def _to_jpeg(img_rgb: np.ndarray, max_dim: int = 1100, quality: int = 82) -> bytes:
    """Downscale + encode JPEG. max_dim 1100 = Gemini lê números nítidos
    com poucos tokens. Libera a cópia grande implicitamente."""
    h, w = img_rgb.shape[:2]
    if h > max_dim or w > max_dim:
        s = max_dim / max(h, w)
        img_rgb = cv2.resize(img_rgb, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    ok, enc = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return enc.tobytes() if ok else b""


# ─────────────────────────────────────────────────────────────
# API pública
# ─────────────────────────────────────────────────────────────

def pick_images_for_page(
    raster_rgb: np.ndarray,
    candidates: List[Dict[str, Any]],
    page_num: int,
    skus: List[Dict[str, Any]],
    scale: float,
    model_name: str = MODEL_FLASH,
    _gemini_call=None,  # injeção p/ teste (mock); produção usa o real
) -> Dict[str, Optional[int]]:
    """
    Decide qual candidata (por XREF) é a foto de cada SKU, usando UMA
    chamada Gemini sobre a página anotada.

    Args:
      raster_rgb: página JÁ renderizada (RGB) — reaproveitada do cv_extractor
      candidates: [{"xref": int, "rect": fitz.Rect (PDF points)}]
      page_num: 1-based (só p/ logs)
      skus: [{"sku": "DXP1", "name": "..."}]
      scale: pixels / PDF-point do raster
      _gemini_call: opcional, função(jpeg_bytes, prompt)->str (mock em teste)

    Returns:
      {sku: xref_escolhido | None}

    MEMÓRIA: não extrai nenhuma candidata aqui. Só anota a página (1 cópia),
    downscala, manda. O caller extrai só a escolhida.
    """
    result: Dict[str, Optional[int]] = {s.get("sku"): None for s in skus}
    if raster_rgb is None or raster_rgb.size == 0 or not candidates or not skus:
        return result

    # Numera candidatas 1..N (mapa index→xref)
    numbered = []
    xref_by_index: Dict[int, int] = {}
    for i, c in enumerate(candidates, start=1):
        numbered.append({"index": i, "rect": c["rect"]})
        xref_by_index[i] = c["xref"]

    # Página anotada → JPEG (única imagem enviada)
    annotated = _annotate_page(raster_rgb, numbered, scale)
    jpeg = _to_jpeg(annotated)
    del annotated  # libera a cópia grande imediatamente
    if not jpeg:
        return result

    skus_text = "\n".join(f"- {s.get('sku')}: {s.get('name', '(sem nome)')}" for s in skus)
    prompt = PROMPT_TEMPLATE.format(skus_list=skus_text)

    # Chamada Gemini (real ou mock)
    try:
        if _gemini_call is not None:
            raw = _gemini_call(jpeg, prompt)
        else:
            if not _ensure_initialized():
                print(f"[GeminiPick v24] pág {page_num}: Gemini não inicializado")
                return result
            import google.generativeai as genai
            model = genai.GenerativeModel(model_name)
            cfg = genai.GenerationConfig(
                temperature=0.0,
                response_mime_type="application/json",
                max_output_tokens=2048,
            )
            t0 = time.time()
            resp = model.generate_content(
                [{"mime_type": "image/jpeg", "data": jpeg}, prompt],
                generation_config=cfg,
                request_options={"timeout": 60},
            )
            raw = resp.text or ""
            print(f"[GeminiPick v24] pág {page_num}: Gemini respondeu em {time.time()-t0:.1f}s")
    except Exception as e:
        print(f"[GeminiPick v24] pág {page_num}: erro Gemini: {str(e)[:160]}")
        return result

    # Parse
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:].strip()
    try:
        escolhas = json.loads(raw).get("escolhas", {})
    except json.JSONDecodeError:
        print(f"[GeminiPick v24] pág {page_num}: JSON inválido: {raw[:120]}")
        return result

    chosen = 0
    for s in skus:
        code = s.get("sku")
        num = escolhas.get(code)
        if num is None:
            continue
        try:
            xref = xref_by_index.get(int(num))
            if xref is not None:
                result[code] = xref
                chosen += 1
        except (TypeError, ValueError):
            pass
    print(f"[GeminiPick v24] pág {page_num}: {chosen}/{len(skus)} SKUs mapeados ({len(candidates)} candidatas)")
    return result
