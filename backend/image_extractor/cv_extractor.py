"""
Extrator de imagens de catálogos PDF — abordagem padrão-ouro.

ESTRATÉGIA:
1. Detecta grid via OpenCV (linhas pontilhadas → células)
2. Para cada SKU, identifica a célula correta (foto na célula atual ou acima)
3. Encontra TODAS as imagens embedadas cujo centro está na célula
4. Pega a MAIOR (resolve variações de cor: pega a foto principal)
5. Extrai via doc.extract_image() — bytes raw do PDF, qualidade perfeita
6. Decodifica corretamente (handle JPEG, PNG, BGRA, grayscale, CMYK)
7. Fallback: crop do raster apenas se extract_image falhar

SAÍDA: {sku}.jpg contendo APENAS a foto do produto (sem textos, bordas, grid)
"""
import os
import cv2
import numpy as np
import fitz
from typing import List, Tuple, Dict, Optional


# ─────────────────────────────────────────────────────────────
# Ponto de entrada público
# ─────────────────────────────────────────────────────────────

def extract_cells_via_cv(
    pdf_path: str,
    skus_list: list,
    output_folder: str,
    scale: float = 1.0,  # Reduzido de 1.5 → 1.2 (28/05/2026) → 1.0 (22/06/2026):
                        # OOM DAGIA 215 págs: cada redução de 0.2 poupa ~30% de RAM.
                        # scale=1.5 → 3.3MB/pág | scale=1.2 → 2.2MB/pág | scale=1.0 → 1.5MB/pág.
                        # Sem impacto em qualidade: imagens são extraídas via xref (PDF raw),
                        # não do raster. O raster serve só pra grid detection e fallback.
    supplier_id: Optional[str] = None,  # v21: usado para ativar Gemini Vision
                                        # como decisor de imagem (DAGIA).
    use_ai_picker: bool = False,        # v21: se True, Gemini decide qual
                                        # imagem entre candidatos representa
                                        # cada SKU (substitui heurística).
) -> Tuple[List[Dict], List[Dict]]:
    """
    Extrai a imagem do produto para cada SKU.

    Estratégia adaptativa por página:
    - Grid     : 1-10 V-lines internas → CellMap → imagem estrutural na célula
    - Embedded : 0 ou >10 V-lines → imagem mais próxima por Y-proximity

    Em ambos os casos, usa doc.extract_image() para qualidade perfeita.

    Memória (otimizado para Render Starter 512MB):
      - 1 página A4 raster @ scale=1.2 = ~2.2MB (era 3.3MB @ 1.5)
      - gc.collect() a cada 5 páginas (era a cada 10) — mais agressivo
      - del raster/pix explícito após cada página
      - Limite hard: se >300 páginas, aborta com erro claro em vez de OOM
    """
    import gc

    # Limita o store MuPDF a 50MB — default é 256MB que, somado ao heap Python
    # (~150MB), ultrapassa os 512MB do Render Starter em catálogos com fotos
    # high-res. Com 50MB o MuPDF evicta agressivamente em vez de acumular.
    fitz.TOOLS.store_maxsize = 50 * 1024 * 1024
    fitz.TOOLS.store_shrink(100)  # começa limpo

    doc = fitz.open(pdf_path)
    matches: List[Dict] = []
    unmatched: List[Dict] = []

    logo_xrefs = _detect_logo_xrefs(doc)

    # Deduplica SKUs por (sku, page)
    seen_keys: set = set()
    deduped: list = []
    for sku in skus_list:
        sc = sku.get("spatialContext")
        key = (sku.get("sku"), sc.get("page") if sc else None)
        if key not in seen_keys:
            seen_keys.add(key)
            deduped.append(sku)
    skus_list = deduped

    skus_by_page: Dict[int, list] = {}
    for sku in skus_list:
        sc = sku.get("spatialContext")
        if not sc:
            continue
        skus_by_page.setdefault(sc.get("page", 1), []).append(sku)

    total_pages = len(skus_by_page)
    print(f"[CV] {total_pages} páginas | {len(skus_list)} SKUs | logos filtrados: {len(logo_xrefs)}")

    # Hard limit: catálogos com >300 páginas com SKUs estouram 512MB do Render
    # mesmo com gc agressivo. Falha rápido com erro claro em vez de OOM
    # (que mata o container e perde o job).
    if total_pages > 300:
        doc.close()
        raise RuntimeError(
            f"Catálogo muito grande: {total_pages} páginas com SKUs excede o limite "
            f"de 300 do plano Render Starter (512MB RAM). Considere processar em "
            f"lotes ou upgrade para plano com mais RAM."
        )

    sorted_pages = sorted(skus_by_page.keys())
    for page_idx, page_num in enumerate(sorted_pages):
        page_skus = skus_by_page[page_num]
        page = doc.load_page(page_num - 1)

        # Renderizar para detecção de grid (e fallback de crop)
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
        raster = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy()
        height, width = raster.shape[:2]

        # Detectar grade
        h_lines, v_lines = _detect_lines(raster, width, height)
        h_coords = _finalize_coords([l[0] for l in h_lines], 40, min_count=2,
                                    boundary_lo=0.0, boundary_hi=float(height))
        v_coords = _finalize_coords([l[0] for l in v_lines], 40, min_count=2,
                                    boundary_lo=0.0, boundary_hi=float(width))
        n_interior_v = len(v_coords) - 2

        page_imgs = _get_page_embedded_images(page, logo_xrefs)

        pct = int((page_idx + 1) / total_pages * 100)
        print(f"[CV] [{page_idx+1}/{total_pages} {pct}%] Pág {page_num}: {n_interior_v} V-int | {len(page_imgs)} imgs", end="")

        if 1 <= n_interior_v <= 10:
            print(f" → GRID ({len(h_coords)}H×{len(v_coords)}V)")
            pm, pu = _match_via_grid(doc, page, raster, h_coords, v_coords,
                                     page_skus, page_imgs, scale, output_folder, page_num)
        else:
            print(f" → EMBEDDED")
            pm, pu = _match_via_embedded(doc, raster, page_skus, page_imgs,
                                         scale, output_folder, page_num)

        # ─── v24: GEMINI VISION PICKER memory-safe (substitui heurística) ───
        # Quando use_ai_picker=True e supplier=DAGIA, manda a página JÁ
        # renderizada (1 imagem, com números desenhados nas candidatas) pro
        # Gemini decidir qual número é a foto de cada SKU. Extrai SÓ a escolhida.
        #
        # MEMÓRIA (vs v21 que causou OOM): NÃO extrai todas as candidatas como
        # arrays. Passa só os rects + o raster que já existe. 1 cópia anotada
        # downscalada + 1 chamada Gemini por página. Footprint ~igual ao atual.
        if use_ai_picker and supplier_id and supplier_id.lower() in ("dagia", "dagía") and page_skus:
            try:
                from gemini_image_picker import pick_images_for_page

                # Candidatas para o AI Picker: lista PERMISSIVA (allow_fullpage)
                # — inclui a foto principal quando ela cobre quase a página
                # inteira (caso DAGIA pg 14, copos). Logos seguem filtrados.
                ai_page_imgs = _get_page_embedded_images(page, logo_xrefs, allow_fullpage=True)

                # Candidatas = rects (NÃO arrays). Filtra fragmentos minúsculos
                # por área do rect (sem extrair pixels ainda).
                candidates_for_ai: List[Dict] = []
                for img_info in ai_page_imgs:
                    r = img_info["rect"]
                    area_px = (r.width * scale) * (r.height * scale)
                    if area_px >= 5000:
                        candidates_for_ai.append({"xref": img_info["xref"], "rect": r})

                if candidates_for_ai:
                    skus_for_ai = [
                        {"sku": s.get("sku"), "name": s.get("name", "")}
                        for s in page_skus if s.get("sku")
                    ]
                    print(f"[CV] AI PICKER v24 (DAGIA) pág {page_num}: {len(skus_for_ai)} SKUs, {len(candidates_for_ai)} candidatas")
                    # Passa o raster já renderizado + rects. Sem extração prévia.
                    picks = pick_images_for_page(
                        raster, candidates_for_ai, page_num, skus_for_ai, scale
                    )

                    # info por xref pra extração sob demanda (só da escolhida)
                    img_info_by_xref = {p["xref"]: p for p in ai_page_imgs}
                    for sku_info in page_skus:
                        sku_code = sku_info.get("sku")
                        if not sku_code:
                            continue
                        chosen_xref = picks.get(sku_code)
                        if chosen_xref is None:
                            continue
                        chosen_info = img_info_by_xref.get(chosen_xref)
                        if not chosen_info:
                            continue
                        # Extrai APENAS a imagem escolhida (qualidade perfeita)
                        img_rgb = _extract_perfect_image(doc, chosen_info, raster, width, height, scale)
                        if img_rgb is None or img_rgb.size == 0:
                            continue
                        box_image_hires = _resize_keep_aspect(img_rgb, max_dim=1200)
                        existing = next((m for m in pm if m["sku"] == sku_code), None)
                        if existing:
                            _save_image_hires(box_image_hires, sku_code, output_folder)
                            existing["match_type"] = "ai_picker"
                            print(f"[CV] AI: override match {sku_code} → xref={chosen_xref}")
                        else:
                            filepath = _save_image_hires(box_image_hires, sku_code, output_folder)
                            pm.append(_make_match(sku_info, page_num, filepath, "ai_picker"))
                            pu = [u for u in pu if u.get("sku") != sku_code]
                            print(f"[CV] AI: novo match {sku_code} → xref={chosen_xref}")
                        del img_rgb, box_image_hires  # libera imediatamente
            except Exception as e:
                print(f"[CV] AI Picker falhou pág {page_num}: {str(e)[:200]} — usando heurística fallback")

        # ─── KIT BOX IMAGE (heurística): SKUs DAGIA DZ + DXPD ───
        # FALLBACK: roda só se AI Picker não rodou ou não decidiu pra esse SKU.
        # Cliente reportou (v17): colagem ficou com baixa resolução + faltavam
        # peças. Sugestão dele: usar a imagem da CAIXA (que já mostra o kit
        # montado com todas as peças). Estratégia v18: pegar a MAIOR imagem
        # da página (em pixels) que tipicamente é a foto da caixa do kit.
        import re as _re
        kit_skus_raw = [s for s in page_skus
                        if s.get("sku") and _re.match(r"^(DZ|DXPD)\d+", str(s["sku"]).upper())]
        # Se AI Picker já decidiu para este SKU, NÃO sobrescreve com heurística
        ai_decided_skus = {m["sku"] for m in pm if m.get("match_type") == "ai_picker"}
        kit_skus = [s for s in kit_skus_raw if s.get("sku") not in ai_decided_skus]
        if kit_skus and page_imgs:
            print(f"[CV] KIT detectado em pág {page_num}: {len(kit_skus)} SKU(s), buscando imagem maior (caixa)")

            # Heurística refinada (v20) para identificar a CAIXA do kit DAGIA:
            # Análise empírica de páginas reais 4-10 do catálogo:
            #   - Pratos: aspect h/w ≈ 0.97-1.01 (quadrados perfeitos)
            #   - Caixas (3D em perspectiva): aspect h/w ≈ 0.65-0.90 (mais larga)
            #   - Peças avulsas: aspect ≈ 0.95-1.05
            # Logo: BÔNUS FORTE para aspect 0.65-0.90, PENALIDADE para ~1.0.
            def _box_score(img: np.ndarray) -> float:
                h, w = img.shape[:2]
                if h == 0 or w == 0:
                    return -1.0
                ratio = h / w
                if 0.65 <= ratio <= 0.90:
                    aspect_score = 1.0  # zona ouro da caixa
                elif 0.55 <= ratio < 0.65 or 0.90 < ratio <= 1.05:
                    aspect_score = 0.6  # zona ambígua
                elif 0.40 <= ratio < 0.55 or 1.05 < ratio <= 1.30:
                    aspect_score = 0.3  # menos provável
                else:
                    aspect_score = 0.1  # quase certo não é caixa
                try:
                    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
                    std_dev = float(np.std(gray)) / 255.0
                except Exception:
                    std_dev = 0.3
                import math as _math
                size_score = min(_math.log10(max(h * w, 1)) / 6.0, 1.0)
                return aspect_score * 0.55 + std_dev * 0.30 + size_score * 0.15

            # ─── STREAMING anti-OOM (23/06/2026) ──────────────────────────
            # NÃO acumula todas as imagens da página como arrays. Em DZ01 (pág 36)
            # isso chegava a ~65MB de arrays VIVOS de uma vez → OOM no Render
            # 512MB. fitz.store_shrink/malloc_trim (v44/v45) NÃO liberam refs
            # vivas — por isso não resolveram. Aqui mantemos só o MELHOR array
            # por vez (pico ~2 imagens). Re-honra IV-16 (não materializar todas
            # as candidatas antes de decidir). Medido: 65MB → ~5MB de pico.
            best_img = None          # melhor candidata (área >= 20000)
            best_score = -1.0
            fallback_img = None      # maior área entre TODAS (se nenhuma >= 20000)
            fallback_area = -1
            for img_info in page_imgs:
                try:
                    arr = _extract_perfect_image(doc, img_info, raster, width, height, scale)
                except Exception as e:
                    print(f"[CV] kit: falha ao extrair imagem (xref={img_info.get('xref')}): {e}")
                    continue
                if arr is None or arr.size == 0:
                    continue
                h, w = arr.shape[:2]
                area = h * w
                keep = False
                if area >= 20000:  # ignora fragmentos (ícones/badges/logos)
                    sc = _box_score(arr)
                    if sc > best_score:
                        best_score = sc
                        best_img = arr  # rebinda: best antigo perde ref e é coletado
                        keep = True
                elif area > fallback_area:
                    fallback_area = area
                    fallback_img = arr
                    keep = True
                if not keep:
                    del arr  # libera imediatamente (não é melhor nem fallback)

            box_image = best_img if best_img is not None else fallback_img
            if box_image is not None:
                h0, w0 = box_image.shape[:2]
                print(f"[CV] kit: escolhida imagem aspect={h0/max(w0,1):.2f}, área={h0*w0}, score={best_score:.2f}")
                # max_dim 1200 pra kit (preserva qualidade da foto da caixa)
                box_image_hires = _resize_keep_aspect(box_image, max_dim=1200)
                del best_img, fallback_img, box_image  # libera os full-res
                for kit_sku in kit_skus:
                    sku_code = kit_sku["sku"]
                    existing = next((m for m in pm if m["sku"] == sku_code), None)
                    if existing:
                        _save_image_hires(box_image_hires, sku_code, output_folder)
                        existing["match_type"] = "kit_box"
                        print(f"[CV] kit box salvo (1200px): {sku_code}")
                    else:
                        filepath = _save_image_hires(box_image_hires, sku_code, output_folder)
                        pm.append(_make_match(kit_sku, page_num, filepath, "kit_box"))
                        pu = [u for u in pu if u.get("sku") != sku_code]
                        print(f"[CV] kit box (novo match): {sku_code}")
                del box_image_hires
                gc.collect()

        matches.extend(pm)
        unmatched.extend(pu)

        # Libera memória explicitamente (Render Starter 512MB é apertado)
        del raster, pix, page_imgs, h_lines, v_lines
        page = None
        # gc.collect() a cada 5 páginas (era 10) — mais agressivo após OOM
        # confirmado em catálogo DAGIA (apenas 24 páginas com imagens pesadas).
        if (page_idx + 1) % 5 == 0:
            gc.collect()
            fitz.TOOLS.store_shrink(100)
            print(f"[CV] gc+store_shrink em pág {page_idx+1}/{total_pages}")

    doc.close()
    fitz.TOOLS.store_shrink(100)
    gc.collect()
    print(f"[CV] Total: {len(matches)} matches | {len(unmatched)} unmatched")
    return matches, unmatched


# ─────────────────────────────────────────────────────────────
# Detecção de grade via OpenCV
# ─────────────────────────────────────────────────────────────

def _detect_lines(raster: np.ndarray, width: int, height: int) -> Tuple[list, list]:
    gray = cv2.cvtColor(raster, cv2.COLOR_RGB2GRAY)
    min_hl = int(width * 0.15)
    min_vl = int(height * 0.15)
    edges = cv2.Canny(gray, 50, 150)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, 60,
                             minLineLength=max(50, min_hl // 3), maxLineGap=20)
    h_lines, v_lines = [], []
    if lines is None:
        return h_lines, v_lines
    for line in lines:
        x1, y1, x2, y2 = line[0]
        dx, dy = x2 - x1, y2 - y1
        angle = np.arctan2(dy, dx) * 180 / np.pi
        if angle < 0:
            angle += 180
        seg_len = np.sqrt(dx * dx + dy * dy)
        if (angle < 2 or angle > 178) and seg_len >= min_hl:
            h_lines.append(((y1 + y2) / 2, min(x1, x2), max(x1, x2)))
        elif 88 < angle < 92 and seg_len >= min_vl:
            v_lines.append(((x1 + x2) / 2, min(y1, y2), max(y1, y2)))
    return h_lines, v_lines


def _finalize_coords(raw: list, tolerance: float, min_count: int,
                     boundary_lo: float, boundary_hi: float) -> List[float]:
    if not raw:
        return [boundary_lo, boundary_hi]
    clusters = _cluster_coords(raw, tolerance)
    counts = _count_segments_per_cluster([(v, 0, 0) for v in raw], clusters, tolerance)
    filtered = [c for c, cnt in zip(clusters, counts) if cnt >= min_count]
    return sorted(set([boundary_lo] + filtered + [boundary_hi]))


# ─────────────────────────────────────────────────────────────
# Estratégia A: Column-First (catálogos com layout em grid)
# ─────────────────────────────────────────────────────────────

def _cluster_coords(coords: List[float], tolerance: float = 20.0) -> List[float]:
    """Agrupa coordenadas X próximas e retorna os centros de cada grupo."""
    if not coords:
        return []
    sorted_coords = sorted(coords)
    clusters = []
    current_cluster = [sorted_coords[0]]
    
    for x in sorted_coords[1:]:
        if x - current_cluster[-1] <= tolerance:
            current_cluster.append(x)
        else:
            clusters.append(sum(current_cluster) / len(current_cluster))
            current_cluster = [x]
    if current_cluster:
        clusters.append(sum(current_cluster) / len(current_cluster))
        
    return clusters

def _match_via_grid(
    doc: fitz.Document,
    page: fitz.Page,
    raster: np.ndarray,
    h_coords: List[float],
    v_coords: List[float],
    page_skus: list,
    page_imgs: List[Dict],
    scale: float,
    output_folder: str,
    page_num: int
) -> Tuple[List[Dict], List[Dict]]:
    """
    Estratégia Column-First:
    1. Usa posições X dos SKUs (confiáveis) para descobrir colunas
    2. Atribui cada imagem à coluna mais próxima
    3. Dentro de cada coluna, emparelha SKU↔Imagem pela ordem Y
       (imagem mais próxima acima do SKU = match correto)

    Não depende da detecção de grid do OpenCV para emparelhamento.
    """
    height, width = raster.shape[:2]

    # ═══════════════════════════════════════════════════════
    # FASE 1: Filtrar SKUs válidos
    # ═══════════════════════════════════════════════════════
    valid_skus: list = []
    unmatched: List[Dict] = []
    for sku in page_skus:
        sc = sku.get("spatialContext", {})
        if sc.get("x") is not None and sc.get("y") is not None:
            valid_skus.append(sku)
        else:
            unmatched.append({"sku": sku.get("sku"), "page": page_num, "reason": "no_coords"})

    if not valid_skus:
        return [], unmatched

    # ═══════════════════════════════════════════════════════
    # FASE 2: Descobrir colunas via clustering de X (SKUs + Imagens)
    # ═══════════════════════════════════════════════════════
    all_xs = [s["spatialContext"]["x"] for s in valid_skus] + [img["cx"] for img in page_imgs]
    col_centers = _cluster_coords(all_xs, tolerance=60)
    n_cols = len(col_centers)

    if n_cols == 0:
        return [], [{"sku": s.get("sku"), "page": page_num, "reason": "no_columns"} for s in valid_skus]

    # ═══════════════════════════════════════════════════════
    # FASE 3: Atribuir SKUs e imagens às colunas
    # ═══════════════════════════════════════════════════════
    col_skus: Dict[int, list] = {i: [] for i in range(n_cols)}
    col_imgs: Dict[int, list] = {i: [] for i in range(n_cols)}

    for sku in valid_skus:
        x = sku["spatialContext"]["x"]
        col = min(range(n_cols), key=lambda i: abs(col_centers[i] - x))
        col_skus[col].append(sku)

    for img in page_imgs:
        col = min(range(n_cols), key=lambda i: abs(col_centers[i] - img["cx"]))
        col_imgs[col].append(img)

    total_imgs = sum(len(v) for v in col_imgs.values())
    print(f"  [ColMatch] {n_cols} colunas | {len(valid_skus)} SKUs | {total_imgs} imgs")

    # ═══════════════════════════════════════════════════════
    # FASE 4: Emparelhar SKU↔Imagem dentro de cada coluna
    # Regra: para cada SKU, a imagem correta é a mais
    # próxima ACIMA dele na mesma coluna.
    # Processa SKUs de cima para baixo para evitar conflitos.
    # ═══════════════════════════════════════════════════════
    matches: List[Dict] = []

    # Helper: detecta SKUs que são VARIAÇÕES do mesmo produto base
    # (ex: NX445-A, NX445-P, NX445-V compartilham a imagem do NX445)
    import re as _re
    def _base_sku(code: str) -> str:
        # Remove sufixos comuns: -A, -P, -V, -01, /A, etc.
        return _re.sub(r"[-_/][A-Z0-9]{1,3}$", "", str(code))

    # Pool global de imagens usadas (para detectar conflitos cross-column)
    used_xrefs_global: set = set()
    # Mapa: sku_code → imagem matched (para variantes pegarem a mesma)
    variant_cache: Dict[str, Dict] = {}

    for col_idx in range(n_cols):
        skus_sorted = sorted(col_skus[col_idx],
                             key=lambda s: s["spatialContext"]["y"])
        imgs_sorted = sorted(col_imgs[col_idx],
                             key=lambda p: p["cy"])

        for sku in skus_sorted:
            sku_y = sku["spatialContext"]["y"]
            sku_code = sku.get("sku", "UNKNOWN")
            base = _base_sku(sku_code)

            # FAST-PATH para variantes: se o base já recebeu uma imagem na página,
            # reaproveita a mesma imagem para a variante (ex: NX445-A,-P,-V)
            if base != sku_code and base in variant_cache:
                cached = variant_cache[base]
                img_arr_var = _extract_perfect_image(doc, cached, raster, width, height, scale)
                if img_arr_var is not None and img_arr_var.size > 0:
                    fp = _save_image(img_arr_var, sku_code, output_folder)
                    matches.append(_make_match(sku, page_num, fp, "variant_share"))
                    continue

            # Encontrar imagem mais próxima acima (ou na mesma altura)
            # Tolerância aumentada de -30 para -100 (catálogo NIX tem balões
            # de SKU sobrepondo a imagem com Y praticamente igual)
            best_img = None
            best_dist = float("inf")

            def _try_match(candidates):
                nonlocal best_img, best_dist
                for img in candidates:
                    if img["xref"] in used_xrefs_global:
                        continue
                    dy = sku_y - img["cy"]
                    if dy < -100:  # imagem MUITO abaixo do SKU → pular
                        continue
                    dist = abs(dy)
                    if dist < best_dist:
                        best_dist = dist
                        best_img = img

            _try_match(imgs_sorted)

            # FALLBACK CROSS-COLUMN: se nenhuma imagem na coluna do SKU,
            # busca em colunas adjacentes (±1) pela imagem mais próxima.
            if not best_img:
                for nearby_col in (col_idx - 1, col_idx + 1):
                    if 0 <= nearby_col < n_cols:
                        _try_match(col_imgs[nearby_col])
                if best_img:
                    print(f"    [ColMatch] {sku_code}: match cross-col (col_idx={col_idx})")

            # LAST-RESORT: catálogos de lista exportados de planilha (ex: UNIVERSAL)
            # onde imagens ficam numa coluna separada dos SKUs por mais de 1 coluna
            # de distância (UNIVERSAL: imagem x≈109, SKU x≈339, col_2 não alcança
            # col_0 pelo ±1 acima). Tenta qualquer imagem não usada na página pela
            # proximidade Y — só ativa quando todos os outros métodos falharam.
            if not best_img:
                all_page_imgs = [img for imgs in col_imgs.values() for img in imgs]
                _try_match(all_page_imgs)
                if best_img:
                    print(f"    [ColMatch] {sku_code}: match last-resort Y-proximity (col_idx={col_idx})")

            if not best_img:
                unmatched.append({"sku": sku_code, "page": page_num, "reason": "no_img_in_col"})
                continue

            used_xrefs_global.add(best_img["xref"])
            variant_cache[base] = best_img

            # Verificar variações (múltiplas imagens agrupadas no mesmo Y)
            grouped = [best_img]
            for other in imgs_sorted:
                if other["xref"] in used_xrefs_global:
                    continue
                if abs(other["cy"] - best_img["cy"]) < 15:
                    grouped.append(other)
                    used_xrefs_global.add(other["xref"])

            if len(grouped) >= 2:
                # Composição: crop do bounding box de todas as imagens
                union = fitz.Rect(grouped[0]["rect"])
                for g in grouped[1:]:
                    union |= g["rect"]
                img_arr = _crop_raster_at_pdf_rect(union, raster, width, height, scale)
                match_type = "col_composition"
            else:
                img_arr = _extract_perfect_image(doc, best_img, raster, width, height, scale)
                match_type = "col_match"

            if img_arr is not None and img_arr.size > 0:
                filepath = _save_image(img_arr, sku_code, output_folder)
                matches.append(_make_match(sku, page_num, filepath, match_type))
            else:
                unmatched.append({"sku": sku_code, "page": page_num, "reason": "extract_failed"})

    print(f"  [ColMatch] Resultado: {len(matches)} matches | {len(unmatched)} unmatched")
    return matches, unmatched


# ─────────────────────────────────────────────────────────────
# Estratégia B: Embedded (catálogos sem grid visual)
# ─────────────────────────────────────────────────────────────

def _match_via_embedded(
    doc: fitz.Document,
    raster: np.ndarray,
    page_skus: list,
    page_imgs: List[Dict],
    scale: float,
    output_folder: str,
    page_num: int
) -> Tuple[List[Dict], List[Dict]]:
    height, width = raster.shape[:2]

    if not page_imgs:
        return [], [{"sku": s.get("sku"), "page": page_num, "reason": "no_embedded_imgs"} for s in page_skus]

    matches, unmatched = [], []
    used_xrefs: set = set()

    sorted_skus = sorted(page_skus, key=lambda s: s.get("spatialContext", {}).get("y", 0))

    for sku in sorted_skus:
        sc = sku.get("spatialContext", {})
        sku_x, sku_y = sc.get("x"), sc.get("y")
        if sku_x is None or sku_y is None:
            unmatched.append({"sku": sku.get("sku"), "page": page_num, "reason": "no_coords"})
            continue

        candidates = [p for p in page_imgs if p["xref"] not in used_xrefs]
        if not candidates:
            unmatched.append({"sku": sku.get("sku"), "page": page_num, "reason": "no_img_left"})
            continue

        # Score: distância Y (peso 2) + distância X (peso 1)
        def score(p):
            return abs(p["cy"] - sku_y) * 2 + abs(p["cx"] - sku_x)

        best = min(candidates, key=score)
        used_xrefs.add(best["xref"])

        img_arr = _extract_perfect_image(doc, best, raster, width, height, scale)
        if img_arr is None or img_arr.size == 0:
            unmatched.append({"sku": sku.get("sku"), "page": page_num, "reason": "extract_failed"})
            continue

        filepath = _save_image(img_arr, sku.get("sku", "UNKNOWN"), output_folder)
        matches.append(_make_match(sku, page_num, filepath, "embedded"))

    return matches, unmatched


def _crop_raster_at_pdf_rect(rect: fitz.Rect, raster: np.ndarray,
                              width: int, height: int, scale: float) -> Optional[np.ndarray]:
    """Helper: crop do raster usando rect em PDF-points."""
    x0 = max(0, int(rect.x0 * scale))
    x1 = min(width, int(rect.x1 * scale))
    y0 = max(0, int(rect.y0 * scale))
    y1 = min(height, int(rect.y1 * scale))
    if x1 <= x0 or y1 <= y0:
        return None
    crop = raster[y0:y1, x0:x1]
    return crop if crop.size > 0 else None


def _decode_with_white_bg(decoded: np.ndarray, doc: fitz.Document, smask_xref: int) -> np.ndarray:
    """
    Decodifica imagem em RGB compondo qualquer transparência sobre fundo BRANCO.

    PDF storage cases handled:
    - Grayscale (1 channel) → RGB direto
    - BGR (3 channels) sem alpha → RGB direto
    - BGR (3 channels) com SMask externo → composita SMask como alpha sobre branco
    - BGRA (4 channels) → composita alpha sobre branco
    """
    # Caso 1: grayscale puro
    if len(decoded.shape) == 2:
        return cv2.cvtColor(decoded, cv2.COLOR_GRAY2RGB)

    if decoded.shape[2] == 4:
        # BGRA — composita alpha sobre branco
        bgr = decoded[:, :, :3].astype(np.float32)
        alpha = decoded[:, :, 3:4].astype(np.float32) / 255.0
        white = np.full_like(bgr, 255.0)
        composited = bgr * alpha + white * (1.0 - alpha)
        rgb = cv2.cvtColor(composited.astype(np.uint8), cv2.COLOR_BGR2RGB)
        return rgb

    # decoded tem 3 canais (BGR). Verifica se há SMask externo (alpha channel separado)
    bgr = decoded
    if smask_xref and smask_xref > 0:
        try:
            smask_data = doc.extract_image(smask_xref)
            if smask_data and smask_data.get("image"):
                mask_arr = np.frombuffer(smask_data["image"], dtype=np.uint8)
                mask = cv2.imdecode(mask_arr, cv2.IMREAD_UNCHANGED)
                if mask is not None:
                    # Reduz mask a 1 canal se necessário
                    if len(mask.shape) == 3:
                        mask = cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY)
                    # Resize se dimensões não baterem
                    if mask.shape[:2] != bgr.shape[:2]:
                        mask = cv2.resize(mask, (bgr.shape[1], bgr.shape[0]),
                                          interpolation=cv2.INTER_LINEAR)
                    alpha = mask.astype(np.float32) / 255.0
                    alpha = alpha[:, :, np.newaxis]
                    bgr_f = bgr.astype(np.float32)
                    white = np.full_like(bgr_f, 255.0)
                    composited = bgr_f * alpha + white * (1.0 - alpha)
                    bgr = composited.astype(np.uint8)
        except Exception:
            pass

    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


# ─────────────────────────────────────────────────────────────
# Extração padrão-ouro: doc.extract_image com fallback raster
# ─────────────────────────────────────────────────────────────

def _extract_perfect_image(
    doc: fitz.Document,
    img_info: Dict,
    raster: np.ndarray,
    width: int,
    height: int,
    scale: float
) -> Optional[np.ndarray]:
    """
    Extrai a imagem com qualidade perfeita.

    Prioridade:
    1. doc.extract_image() — bytes raw do PDF, decode para RGB
       Verifica se a imagem extraída tem proporção compatível com o display rect
       (rejeita partial/mask/sub-images com aspect ratio muito diferente)
    2. Fallback: crop do raster renderizado no rect de display

    Retorna numpy array RGB ou None se ambos falharem.
    """
    xref = img_info["xref"]
    rect = img_info["rect"]
    display_w = max(1.0, rect.width)
    display_h = max(1.0, rect.height)
    display_aspect = display_w / display_h

    # Tentativa 1: doc.extract_image (qualidade perfeita)
    try:
        img_data = doc.extract_image(xref)
        if img_data and img_data.get("image"):
            raw = img_data["image"]
            arr = np.frombuffer(raw, dtype=np.uint8)
            decoded = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
            if decoded is not None and decoded.size > 0:
                # Tentar máscara/SMask explícita do PDF (alpha channel separado)
                smask_xref = img_data.get("smask", 0)
                rgb = _decode_with_white_bg(decoded, doc, smask_xref)

                # Sanidade: aspect ratio do extraído deve bater com o display
                ext_h, ext_w = rgb.shape[:2]
                if ext_w > 0 and ext_h > 0:
                    ext_aspect = ext_w / ext_h
                    aspect_ratio = max(ext_aspect, display_aspect) / min(ext_aspect, display_aspect)
                    if aspect_ratio < 1.4:  # aspecto compatível
                        return rgb
                    # senão: cai no fallback raster
    except Exception as e:
        pass  # cai no fallback

    # Fallback: crop do raster no rect de display
    inset = 2 / scale
    x0 = max(0, int((rect.x0 + inset) * scale))
    x1 = min(width, int((rect.x1 - inset) * scale))
    y0 = max(0, int((rect.y0 + inset) * scale))
    y1 = min(height, int((rect.y1 - inset) * scale))
    if x1 <= x0 or y1 <= y0:
        return None
    crop = raster[y0:y1, x0:x1]
    return crop if crop.size > 0 else None


# ─────────────────────────────────────────────────────────────
# Utilitários
# ─────────────────────────────────────────────────────────────

def _is_barcode_like(img_bgr: np.ndarray) -> bool:
    """Detecta CÓDIGO DE BARRAS (EAN) p/ NÃO escolher a barra no lugar da foto
    do produto (Lila: barra colada/sobreposta à imagem). Assinatura: baixa
    saturação (preto/branco) + alta densidade de transições verticais (barras)
    + largo. Limiares validados nas imagens reais da Lila (30 barras pegas,
    0 fotos de produto). Fail-open: erro → não é barra."""
    try:
        h, w = img_bgr.shape[:2]
        if h < 8 or w < 8:
            return False
        sat = float(np.mean(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)[:, :, 1])) / 255.0
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        _, binr = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        trans = [int(np.count_nonzero(np.diff(binr[int(h * f), :].astype(np.int16)) != 0))
                 for f in (0.3, 0.5, 0.7)]
        dens = (sum(trans) / len(trans)) / max(w, 1)
        aspect = w / max(h, 1)
        return dens >= 0.15 and sat <= 0.08 and aspect >= 1.5
    except Exception:
        return False


def _get_page_embedded_images(page: fitz.Page, logo_xrefs: set,
                              allow_fullpage: bool = False) -> List[Dict]:
    """Retorna imagens válidas da página com posição (PDF-points) e xref.

    allow_fullpage (v24): por padrão descarta imagens que cobrem >85% da
    página (são fundos/decorações no matching por coluna). MAS para o AI
    Picker, a foto PRINCIPAL do produto às vezes É uma imagem quase
    full-page (ex: DAGIA pg 14 — foto dos 6 copos cobre a página inteira,
    com título e tag SOBREPOSTOS como imagens separadas). Nesses casos
    o filtro >85% descartava a melhor candidata e o Gemini só via tag/título.
    Com allow_fullpage=True mantemos a imagem grande; logos (que repetem em
    várias páginas) seguem filtrados por logo_xrefs, então fundos decorativos
    recorrentes continuam fora.
    """
    page_w, page_h = page.rect.width, page.rect.height
    result = []
    seen = set()
    for img_info in page.get_images(full=True):
        xref = img_info[0]
        if xref in seen or xref in logo_xrefs:
            continue
        seen.add(xref)
        rects = page.get_image_rects(xref)
        if not rects:
            continue
        rect = rects[0]
        iw, ih = rect.width, rect.height
        if iw < 20 or ih < 20:
            continue
        if not allow_fullpage and iw > page_w * 0.85 and ih > page_h * 0.85:
            continue
        # CÓDIGO DE BARRAS: gate pelo aspect dos PIXELS (não do rect, que pode
        # estar escalado). extract_image traz width/height sem decodificar; só
        # imdecode as LARGAS (barras são largas/baixas; fotos são quadradas/
        # retrato). Evita escolher a barra colada na foto (Lila). Memory-safe:
        # decodifica 1 por vez e descarta (não acumula arrays — IV-16).
        try:
            ext = page.parent.extract_image(xref)
            pw, ph = ext.get("width", 0), ext.get("height", 1)
            is_bar = False
            if pw / max(ph, 1) >= 1.5:
                arr = cv2.imdecode(np.frombuffer(ext["image"], np.uint8), cv2.IMREAD_COLOR)
                is_bar = arr is not None and _is_barcode_like(arr)
                del arr
            del ext  # libera bytes raw imediatamente (fotos DAGIA ~1-5MB cada)
            if is_bar:
                continue
        except Exception:
            pass
        result.append({
            "xref": xref,
            "rect": rect,
            "cx": (rect.x0 + rect.x1) / 2,
            "cy": (rect.y0 + rect.y1) / 2,
            "area": iw * ih,
        })
    return result


def _find_image_above_sku(page_imgs: List[Dict],
                           sku_x: float, sku_y: float,
                           x_min: float, x_max: float,
                           used_xrefs: set) -> Optional[Dict]:
    """Imagem cujo centro está acima do SKU, na mesma coluna, ainda não usada."""
    x_margin = (x_max - x_min) * 0.2
    candidates = [
        p for p in page_imgs
        if p["xref"] not in used_xrefs
        and p["cy"] < sku_y
        and (x_min - x_margin) <= p["cx"] <= (x_max + x_margin)
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda p: sku_y - p["cy"])


def _detect_logo_xrefs(doc: fitz.Document) -> set:
    """
    Xrefs em ≥3 páginas amostradas = logos/cabeçalhos.
    Amostra até 40 páginas distribuídas para evitar timeout em PDFs grandes.
    """
    n = len(doc)
    if n <= 40:
        sample = list(range(n))
    else:
        step = max(1, n // 30)
        sample = sorted(set(
            list(range(0, min(n, 10))) +
            list(range(0, n, step))[:25] +
            list(range(max(0, n - 5), n))
        ))
    xref_pages: Dict[int, set] = {}
    for i in sample:
        for img in doc.load_page(i).get_images(full=True):
            xref_pages.setdefault(img[0], set()).add(i)
    return {x for x, pgs in xref_pages.items() if len(pgs) >= 3}


def _create_kit_collage(images_rgb: List[np.ndarray], max_dim: int = 800) -> Optional[np.ndarray]:
    """
    Cria colagem em grid das imagens de um kit (ex: Jogo de Jantar DAGIA DZ\\d+).

    Cliente Nunes precisa enxergar o kit completo no cadastro Mercos, não
    apenas 1 das peças (xícara avulsa). Esta colagem agrupa todas as imagens
    da página em um grid balanceado (~sqrt N), com padding branco.

    Args:
      images_rgb: lista de numpy RGB arrays (1 ou mais)
      max_dim: dimensão máxima do arquivo final

    Returns:
      np.ndarray RGB com a colagem, ou None se lista vazia.
    """
    import math
    n = len(images_rgb)
    if n == 0:
        return None
    if n == 1:
        return images_rgb[0]

    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    cell_h = max_dim // max(rows, 2)

    # Redimensiona cada imagem mantendo proporção (altura igual)
    resized: List[np.ndarray] = []
    for img in images_rgb:
        h, w = img.shape[:2]
        if h <= 0:
            continue
        scale_f = cell_h / h
        new_w = max(1, int(w * scale_f))
        resized.append(cv2.resize(img, (new_w, cell_h), interpolation=cv2.INTER_AREA))

    if not resized:
        return None

    # Monta linhas: agrupa cols imagens, padding branco pra alinhar
    row_images: List[np.ndarray] = []
    for r in range(rows):
        row_items = resized[r * cols:(r + 1) * cols]
        if not row_items:
            continue
        # Pad em largura: completa células faltantes com branco
        while len(row_items) < cols:
            row_items.append(np.full((cell_h, max(1, cell_h), 3), 255, dtype=np.uint8))
        max_w = max(img.shape[1] for img in row_items)
        padded = []
        for img in row_items:
            h, w = img.shape[:2]
            if w < max_w:
                pad = np.full((h, max_w - w, 3), 255, dtype=np.uint8)
                img = np.hstack([img, pad])
            padded.append(img)
        row_images.append(np.hstack(padded))

    # Combina linhas verticalmente — todas têm mesma largura (cols * max_w)
    max_row_w = max(img.shape[1] for img in row_images)
    final_rows: List[np.ndarray] = []
    for img in row_images:
        h, w = img.shape[:2]
        if w < max_row_w:
            pad = np.full((h, max_row_w - w, 3), 255, dtype=np.uint8)
            img = np.hstack([img, pad])
        final_rows.append(img)
    return np.vstack(final_rows)


def _resize_keep_aspect(img_rgb: np.ndarray, max_dim: int) -> np.ndarray:
    """Redimensiona mantendo aspect ratio se algum lado > max_dim."""
    h, w = img_rgb.shape[:2]
    if h <= max_dim and w <= max_dim:
        return img_rgb
    s = max_dim / max(h, w)
    return cv2.resize(img_rgb, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)


def _save_image_hires(img_rgb: np.ndarray, sku_code: str, output_folder: str) -> str:
    """Variante de _save_image para kits — preserva resolução alta (1200px).

    Sanitização do nome igual a _save_image. Quality JPEG 92 (melhor que 85
    do default) porque a imagem é da caixa do produto e o cliente cadastra
    no Mercos.
    """
    pre = sku_code.replace("/", "_").replace("\\", "_")
    clean = "".join(c for c in pre if c.isalnum() or c in ("-", "_"))
    filepath = os.path.join(output_folder, f"{clean}.jpg")
    bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    h, w = bgr.shape[:2]
    if h > 1200 or w > 1200:
        scale_f = 1200 / max(h, w)
        bgr = cv2.resize(bgr, (int(w * scale_f), int(h * scale_f)), interpolation=cv2.INTER_AREA)
    cv2.imwrite(filepath, bgr, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return filepath


def _save_image(img_rgb: np.ndarray, sku_code: str, output_folder: str) -> str:
    """Salva {sku}.jpg. img_rgb é numpy array RGB.

    Sanitização do nome:
      - barra "/" vira "_" (ex: CF001/L12 -> CF001_L12.jpg) para preservar
        legibilidade do código quando aberto fora do app
      - outros caracteres não-alfanuméricos viram nada

    Qualidade (v19): max_dim 600→1000, JPEG 85→90 (cliente Nunes cadastra no
    Mercos e precisa de imagem clara). Tamanho ainda OK pra Supabase Storage.
    """
    pre = sku_code.replace("/", "_").replace("\\", "_")
    clean = "".join(c for c in pre if c.isalnum() or c in ("-", "_"))
    filepath = os.path.join(output_folder, f"{clean}.jpg")
    bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)

    max_dim = 1000  # era 600
    h, w = bgr.shape[:2]
    if h > max_dim or w > max_dim:
        scale = max_dim / max(h, w)
        bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    cv2.imwrite(filepath, bgr, [cv2.IMWRITE_JPEG_QUALITY, 90])  # era 85
    return filepath


def _make_match(sku: dict, page_num: int, filepath: str, match_type: str) -> Dict:
    return {
        "sku": sku.get("sku", "UNKNOWN"),
        "product_name": sku.get("name", ""),
        "page": page_num,
        "local_path": filepath,
        "final_image_name": os.path.basename(filepath),
        "match_type": match_type,
        "match_confidence": 1.0,
        "status": "matched",
    }


def _cluster_coords(coords: List[float], tolerance: float = 10) -> List[float]:
    if not coords:
        return []
    coords_sorted = sorted(set(coords))
    clusters, current = [], [coords_sorted[0]]
    for coord in coords_sorted[1:]:
        if coord - current[-1] <= tolerance:
            current.append(coord)
        else:
            clusters.append(sum(current) / len(current))
            current = [coord]
    clusters.append(sum(current) / len(current))
    return clusters


def _count_segments_per_cluster(lines: List[tuple], clusters: List[float],
                                  tolerance: float = 20) -> List[int]:
    counts = [0] * len(clusters)
    for line in lines:
        coord = line[0]
        for i, cluster in enumerate(clusters):
            if abs(coord - cluster) <= tolerance:
                counts[i] += 1
                break
    return counts
