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
    scale: float = 1.5
) -> Tuple[List[Dict], List[Dict]]:
    """
    Extrai a imagem do produto para cada SKU.

    Estratégia adaptativa por página:
    - Grid     : 1-10 V-lines internas → CellMap → imagem estrutural na célula
    - Embedded : 0 ou >10 V-lines → imagem mais próxima por Y-proximity

    Em ambos os casos, usa doc.extract_image() para qualidade perfeita.
    """
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

        matches.extend(pm)
        unmatched.extend(pu)

    doc.close()
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

    for col_idx in range(n_cols):
        skus_sorted = sorted(col_skus[col_idx],
                             key=lambda s: s["spatialContext"]["y"])
        imgs_sorted = sorted(col_imgs[col_idx],
                             key=lambda p: p["cy"])
        used_xrefs: set = set()

        for sku in skus_sorted:
            sku_y = sku["spatialContext"]["y"]
            sku_code = sku.get("sku", "UNKNOWN")

            # Encontrar imagem mais próxima acima (ou na mesma altura)
            best_img = None
            best_dist = float("inf")

            for img in imgs_sorted:
                if img["xref"] in used_xrefs:
                    continue
                dy = sku_y - img["cy"]  # positivo = imagem acima do SKU
                if dy < -30:  # imagem muito abaixo do SKU → pular
                    continue
                dist = abs(dy)
                if dist < best_dist:
                    best_dist = dist
                    best_img = img

            if not best_img:
                unmatched.append({"sku": sku_code, "page": page_num, "reason": "no_img_in_col"})
                continue

            used_xrefs.add(best_img["xref"])

            # Verificar variações (múltiplas imagens agrupadas no mesmo Y)
            grouped = [best_img]
            for other in imgs_sorted:
                if other["xref"] in used_xrefs:
                    continue
                if abs(other["cy"] - best_img["cy"]) < 15:
                    grouped.append(other)
                    used_xrefs.add(other["xref"])

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

def _get_page_embedded_images(page: fitz.Page, logo_xrefs: set) -> List[Dict]:
    """Retorna imagens válidas da página com posição (PDF-points) e xref."""
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
        if iw > page_w * 0.85 and ih > page_h * 0.85:
            continue
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


def _save_image(img_rgb: np.ndarray, sku_code: str, output_folder: str) -> str:
    """Salva {sku}.jpg. img_rgb é numpy array RGB."""
    clean = "".join(c for c in sku_code if c.isalnum() or c in ("-", "_"))
    filepath = os.path.join(output_folder, f"{clean}.jpg")
    bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    
    # Redimensiona mantendo proporção se for muito grande (evitar limites do Supabase)
    max_dim = 600
    h, w = bgr.shape[:2]
    if h > max_dim or w > max_dim:
        scale = max_dim / max(h, w)
        bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        
    cv2.imwrite(filepath, bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])
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
