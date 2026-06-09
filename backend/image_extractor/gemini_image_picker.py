"""
Gemini Vision para SELEÇÃO de imagens de produto.

PROBLEMA QUE RESOLVE:
  Heurísticas de CV (aspect, área, std de cor) não conseguem distinguir
  com confiança "caixa do kit" vs "uma peça do kit" vs "tag de preço"
  em catálogos visualmente densos (DAGIA é o caso clássico). Cliente
  reportou DXP1-N puxando xícara avulsa, DXP57 puxando tag amarela.

ESTRATÉGIA:
  1. CV detecta TODOS os candidatos plausíveis da página (xref + bbox + thumb)
  2. Pré-renderiza a página em JPEG (contexto visual)
  3. Manda Gemini Vision com:
     - Página renderizada (contexto)
     - Lista de SKUs visíveis na página
     - Lista numerada de thumbnails candidatos (com xref de id)
  4. Gemini retorna: {SKU: xref_escolhido | null}
  5. Backend salva a imagem correspondente ao xref escolhido.

CUSTO:
  ~1 chamada de Gemini 2.5 Flash por página com SKUs.
  DAGIA (18 pgs): ~$0.09 por catálogo.
  Sem inventar regex/heurística — IA decide com contexto visual real.

REUSO:
  Compartilha _ensure_initialized() / lazy import de google.generativeai
  com gemini_extractor.py. NÃO duplica configuração.
"""
import os
import json
import time
import base64
from typing import List, Dict, Any, Optional, Tuple

import cv2
import numpy as np

# Reusa init + lazy import já travado em gemini_extractor.py (IV-01)
from gemini_extractor import (
    _ensure_initialized,
    _render_page_to_jpeg,
    MODEL_FLASH,
    MODEL_PRO,
)


# ─────────────────────────────────────────────────────────────
# Prompt
# ─────────────────────────────────────────────────────────────

PROMPT_TEMPLATE = """Você é um especialista em catálogos B2B brasileiros de utensílios domésticos.

Você receberá:
1. A PÁGINA inteira de um catálogo (primeira imagem)
2. Uma lista de THUMBNAILS numerados de TODAS as imagens detectadas na página

Sua tarefa: para cada SKU listado abaixo, escolha QUAL thumbnail (pelo número)
representa MELHOR a foto do produto comercial.

PREFERÊNCIAS (nesta ordem):
1. Se o produto é um KIT (jogo, conjunto, com várias peças), prefira a CAIXA/EMBALAGEM
   que mostra o conjunto completo.
2. Se não houver caixa visível, escolha a imagem que mostra o produto mais completo
   (ex: jogo com várias peças em vez de 1 peça avulsa).
3. Se for produto individual (1 unidade), escolha a foto principal do produto.

REJEITE EXPLICITAMENTE:
- Tags/etiquetas de preço (amarelas, vermelhas, formato de plaquinha)
- Logos, ícones de "CX C/N PÇS", "CX Presente"
- Decorações de fundo
- Texto solto

SKUs a mapear nesta página:
{skus_list}

Retorne APENAS JSON puro (sem markdown, sem comentários):
{{
  "escolhas": {{
    "SKU1": 3,
    "SKU2": 7,
    "SKU3": null
  }}
}}

Onde o número é o ÍNDICE do thumbnail (começando em 1). Use null se NENHUM
thumbnail representa o produto adequadamente.
"""


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def _img_to_jpeg_bytes(img_rgb: np.ndarray, max_dim: int = 400, quality: int = 80) -> bytes:
    """Converte numpy RGB -> JPEG bytes (thumbnail para enviar ao Gemini).

    max_dim 400 = suficiente para Gemini ver detalhes da imagem e classificar.
    quality 80 = compromisso tamanho/clareza para vision.
    """
    h, w = img_rgb.shape[:2]
    if h > max_dim or w > max_dim:
        s = max_dim / max(h, w)
        img_rgb = cv2.resize(img_rgb, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    ok, encoded = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        return b""
    return encoded.tobytes()


# ─────────────────────────────────────────────────────────────
# API pública
# ─────────────────────────────────────────────────────────────

def pick_images_for_page(
    pdf_path: str,
    page_num: int,
    skus: List[Dict[str, Any]],
    candidates: List[Dict[str, Any]],
    model_name: str = MODEL_FLASH,
) -> Dict[str, Optional[int]]:
    """
    Pede ao Gemini para escolher qual candidato representa cada SKU.

    Args:
      pdf_path: caminho do PDF (para renderizar a página de contexto)
      page_num: número 1-based da página
      skus: [{"sku": "DXP1", "name": "Xícara C/ Pires Opalina 80ml C/12 Pçs"}, ...]
      candidates: [{"xref": 123, "image_rgb": np.ndarray}, ...]
                  Cada candidato é uma imagem já extraída do PDF (RGB array).

    Returns:
      {sku: xref_escolhido | None}
      Ex: {"DXP1": 7, "DXP2": 7, "DXP3": null}
    """
    if not skus or not candidates:
        return {s.get("sku"): None for s in skus}

    if not _ensure_initialized():
        # Falha graciosa: não bloqueia, só não decide
        print(f"[GeminiPick] Pág {page_num}: Gemini não inicializado, devolvendo sem escolhas")
        return {s.get("sku"): None for s in skus}

    # Lazy import (genai já configurado em _ensure_initialized via gemini_extractor)
    import google.generativeai as genai

    start = time.time()

    # 1. Página renderizada (contexto visual)
    page_jpeg = _render_page_to_jpeg(pdf_path, page_num, dpi=110)
    if not page_jpeg:
        print(f"[GeminiPick] Pág {page_num}: falha ao renderizar página, abortando")
        return {s.get("sku"): None for s in skus}

    # 2. Encoda candidatos como thumbnails JPEG (numerados 1..N na ordem)
    parts: List[Any] = [
        {"mime_type": "image/jpeg", "data": page_jpeg},
    ]
    xref_by_index: Dict[int, int] = {}
    for i, cand in enumerate(candidates, start=1):
        img_rgb = cand.get("image_rgb")
        xref = cand.get("xref")
        if img_rgb is None or img_rgb.size == 0:
            continue
        thumb = _img_to_jpeg_bytes(img_rgb, max_dim=400, quality=80)
        if not thumb:
            continue
        xref_by_index[i] = xref
        # Adiciona o thumbnail com um header de texto identificando o número
        parts.append(f"Thumbnail #{i} (xref={xref}):")
        parts.append({"mime_type": "image/jpeg", "data": thumb})

    if not xref_by_index:
        print(f"[GeminiPick] Pág {page_num}: nenhum thumbnail válido, abortando")
        return {s.get("sku"): None for s in skus}

    # 3. Monta prompt com SKUs
    skus_text = "\n".join(
        f"- {s.get('sku')}: {s.get('name', '(sem descrição)')}"
        for s in skus
    )
    prompt = PROMPT_TEMPLATE.format(skus_list=skus_text)
    parts.append(prompt)

    # 4. Chama Gemini
    try:
        model = genai.GenerativeModel(model_name)
        generation_config = genai.GenerationConfig(
            temperature=0.0,
            response_mime_type="application/json",
            max_output_tokens=2048,
        )
        response = model.generate_content(
            parts,
            generation_config=generation_config,
            request_options={"timeout": 60},
        )
        raw = (response.text or "").strip()
        if raw.startswith("```"):
            raw = raw.strip("`")
            if raw.startswith("json"):
                raw = raw[4:].strip()
        data = json.loads(raw)
        escolhas = data.get("escolhas", {})
        elapsed = time.time() - start

        # 5. Converte índice -> xref
        result: Dict[str, Optional[int]] = {}
        for sku_info in skus:
            sku_code = sku_info.get("sku")
            idx = escolhas.get(sku_code)
            if idx is None:
                result[sku_code] = None
                continue
            try:
                idx_int = int(idx)
                result[sku_code] = xref_by_index.get(idx_int)
            except (TypeError, ValueError):
                result[sku_code] = None

        chosen = sum(1 for v in result.values() if v is not None)
        print(f"[GeminiPick] Pág {page_num}: {chosen}/{len(skus)} SKUs mapeados em {elapsed:.1f}s")
        return result

    except json.JSONDecodeError as e:
        print(f"[GeminiPick] Pág {page_num}: JSON inválido: {e}")
        return {s.get("sku"): None for s in skus}
    except Exception as e:
        print(f"[GeminiPick] Pág {page_num}: erro Gemini: {str(e)[:200]}")
        return {s.get("sku"): None for s in skus}
