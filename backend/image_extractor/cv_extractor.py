"""
Extrator de imagens de catálogos PDF via OpenCV.

Estratégia adaptativa por página:
  - Grid (1-4 V-lines internas detectadas): detecta células por linhas pontilhadas
  - Embedded (0 ou >4 V-lines): extrai imagens embutidas e associa por Y-proximity

Suporta: GIRA, BM36, NixHouse, Lila Home, Goal, Clink, Dagia, FastNeo e similares.
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
    scale: float = 2.0
) -> Tuple[List[Dict], List[Dict]]:
    """
    Extrai imagens de produto para cada SKU.

    Seleciona automaticamente a estratégia por página:
    - Grid: quando 1-4 linhas verticais interiores são detectadas (catálogos visuais)
    - Embedded: quando 0 ou >4 linhas (tabelas ou PDFs sem grade visível)

    Args:
        pdf_path: caminho do PDF
        skus_list: SKUs com spatialContext {x, y, page} em coords PyMuPDF
        output_folder: diretório de saída
        scale: fator de renderização (2.0 = 150 DPI)

    Returns:
        (matches, unmatched)
    """
    doc = fitz.open(pdf_path)
    matches: List[Dict] = []
    unmatched: List[Dict] = []

    # Detectar logos (xrefs que aparecem em ≥3 páginas)
    logo_xrefs = _detect_logo_xrefs(doc)

    # Deduplica SKUs por (code, page) — PDFs com texto duplicado enviariam 2x o mesmo SKU
    seen_sku_keys: set = set()
    deduped: list = []
    for sku in skus_list:
        sc = sku.get("spatialContext")
        key = (sku.get("sku"), sc.get("page") if sc else None)
        if key in seen_sku_keys:
            continue
        seen_sku_keys.add(key)
        deduped.append(sku)
    skus_list = deduped

    # Agrupar SKUs por página
    skus_by_page: Dict[int, list] = {}
    for sku in skus_list:
        sc = sku.get("spatialContext")
        if not sc:
            continue
        pg = sc.get("page", 1)
        skus_by_page.setdefault(pg, []).append(sku)

    print(f"[CV] {len(skus_by_page)} páginas | {len(skus_list)} SKUs | logos filtrados: {len(logo_xrefs)}")

    for page_num in sorted(skus_by_page.keys()):
        page_skus = skus_by_page[page_num]
        page = doc.load_page(page_num - 1)
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat)
        raster = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n).copy()
        if pix.n == 4:
            raster = cv2.cvtColor(raster, cv2.COLOR_RGBA2RGB)
        height, width = raster.shape[:2]

        # Detectar linhas
        h_lines, v_lines = _detect_lines(raster, width, height)
        h_coords = _finalize_coords([l[0] for l in h_lines], 40, min_count=2, boundary_lo=0.0, boundary_hi=float(height))
        v_coords = _finalize_coords([l[0] for l in v_lines], 40, min_count=2, boundary_lo=0.0, boundary_hi=float(width))
        n_interior_v = len(v_coords) - 2  # excluindo bordas 0 e width

        print(f"[CV] Página {page_num}: {width}x{height}px | {n_interior_v} V-internas", end="")

        if 1 <= n_interior_v <= 4:
            print(f" → GRID ({len(h_coords)}H×{len(v_coords)}V)")
            pm, pu = _match_via_grid(raster, h_coords, v_coords, page_skus, scale, output_folder, page_num)
        else:
            print(f" → EMBEDDED (0 ou >4 V-lines)")
            pm, pu = _match_via_embedded(page, raster, page_skus, logo_xrefs, scale, output_folder, page_num)

        matches.extend(pm)
        unmatched.extend(pu)

    doc.close()
    print(f"[CV] Total: {len(matches)} matches | {len(unmatched)} unmatched")
    return matches, unmatched


# ─────────────────────────────────────────────────────────────
# Detecção de linhas via OpenCV
# ─────────────────────────────────────────────────────────────

def _detect_lines(raster: np.ndarray, width: int, height: int) -> Tuple[list, list]:
    """Canny + HoughLinesP com filtro de orientação e comprimento mínimo."""
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
    """Cluster + filtro de contagem + bordas de página."""
    if not raw:
        return [boundary_lo, boundary_hi]
    clusters = _cluster_coords(raw, tolerance)
    counts = _count_segments_per_cluster(
        [(v, 0, 0) for v in raw], clusters, tolerance
    )
    filtered = [c for c, cnt in zip(clusters, counts) if cnt >= min_count]
    return sorted(set([boundary_lo] + filtered + [boundary_hi]))


# ─────────────────────────────────────────────────────────────
# Estratégia A: Grid
# ─────────────────────────────────────────────────────────────

def _match_via_grid(
    raster: np.ndarray,
    h_coords: List[float],
    v_coords: List[float],
    page_skus: list,
    scale: float,
    output_folder: str,
    page_num: int
) -> Tuple[List[Dict], List[Dict]]:
    """Match SKU → célula do grid → crop do raster."""
    height, width = raster.shape[:2]
    h_s = sorted(h_coords)
    v_s = sorted(v_coords)

    # Construir células indexadas
    cells = []
    for i in range(len(h_s) - 1):
        for j in range(len(v_s) - 1):
            cells.append({
                "h_idx": i, "v_idx": j,
                "y_min": int(h_s[i]), "y_max": int(h_s[i + 1]),
                "x_min": int(v_s[j]), "x_max": int(v_s[j + 1]),
            })

    matches, unmatched = [], []

    for sku in page_skus:
        sc = sku.get("spatialContext", {})
        sku_x, sku_y = sc.get("x"), sc.get("y")
        if sku_x is None or sku_y is None:
            unmatched.append({"sku": sku.get("sku"), "page": page_num, "reason": "no_coords"})
            continue

        sx, sy = sku_x * scale, sku_y * scale

        matched_cell = next(
            (c for c in cells if c["x_min"] <= sx <= c["x_max"] and c["y_min"] <= sy <= c["y_max"]),
            None
        )
        if not matched_cell:
            unmatched.append({"sku": sku.get("sku"), "page": page_num, "reason": "outside_grid"})
            continue

        # Expandir para cima se a célula for pequena (zona de texto sem imagem)
        crop_y_min = matched_cell["y_min"]
        if (matched_cell["y_max"] - matched_cell["y_min"]) < 150 and matched_cell["h_idx"] > 0:
            above = next((c for c in cells
                          if c["h_idx"] == matched_cell["h_idx"] - 1
                          and c["v_idx"] == matched_cell["v_idx"]), None)
            if above:
                crop_y_min = above["y_min"]

        cell_img = raster[crop_y_min:matched_cell["y_max"],
                          matched_cell["x_min"]:matched_cell["x_max"]]
        if cell_img.size == 0:
            unmatched.append({"sku": sku.get("sku"), "page": page_num, "reason": "empty_crop"})
            continue

        filepath = _save_image(cell_img, sku.get("sku", "UNKNOWN"), page_num, output_folder)
        matches.append(_make_match(sku, page_num, filepath, "grid"))

    return matches, unmatched


# ─────────────────────────────────────────────────────────────
# Estratégia B: Embedded Images
# ─────────────────────────────────────────────────────────────

def _match_via_embedded(
    page: fitz.Page,
    raster: np.ndarray,
    page_skus: list,
    logo_xrefs: set,
    scale: float,
    output_folder: str,
    page_num: int
) -> Tuple[List[Dict], List[Dict]]:
    """Match SKU → imagem embedada mais próxima (Y-proximity + X-region)."""
    height, width = raster.shape[:2]

    # Coletar posições de imagens embedadas
    img_positions = []
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
        # Filtrar ícones muito pequenos e imagens de página inteira
        page_w, page_h = page.rect.width, page.rect.height
        if iw < 20 or ih < 20:
            continue
        if iw > page_w * 0.85 and ih > page_h * 0.85:
            continue
        img_positions.append({"xref": xref, "rect": rect,
                               "cx": (rect.x0 + rect.x1) / 2,
                               "cy": (rect.y0 + rect.y1) / 2,
                               "area": iw * ih})

    if not img_positions:
        result = []
        for sku in page_skus:
            result.append({"sku": sku.get("sku"), "page": page_num, "reason": "no_embedded_imgs"})
        return [], result

    matches, unmatched = [], []
    used_xrefs: set = set()

    # Ordenar SKUs por Y para matching sequencial (cima→baixo)
    sorted_skus = sorted(page_skus,
                         key=lambda s: s.get("spatialContext", {}).get("y", 0))

    for sku in sorted_skus:
        sc = sku.get("spatialContext", {})
        sku_x, sku_y = sc.get("x"), sc.get("y")
        if sku_x is None or sku_y is None:
            unmatched.append({"sku": sku.get("sku"), "page": page_num, "reason": "no_coords"})
            continue

        # Candidatas: ainda não usadas
        candidates = [p for p in img_positions if p["xref"] not in used_xrefs]
        if not candidates:
            unmatched.append({"sku": sku.get("sku"), "page": page_num, "reason": "no_img_left"})
            continue

        # Score: distância Y (peso 2) + distância X (peso 1) em PDF-points
        def score(p):
            dy = abs(p["cy"] - sku_y)
            dx = abs(p["cx"] - sku_x)
            return dy * 2 + dx

        best = min(candidates, key=score)
        used_xrefs.add(best["xref"])

        # Crop do raster (converter de PDF-points para pixels)
        rect = best["rect"]
        x0 = max(0, int(rect.x0 * scale))
        x1 = min(width, int(rect.x1 * scale))
        y0 = max(0, int(rect.y0 * scale))
        y1 = min(height, int(rect.y1 * scale))

        cell_img = raster[y0:y1, x0:x1]
        if cell_img.size == 0:
            unmatched.append({"sku": sku.get("sku"), "page": page_num, "reason": "empty_crop"})
            continue

        filepath = _save_image(cell_img, sku.get("sku", "UNKNOWN"), page_num, output_folder)
        matches.append(_make_match(sku, page_num, filepath, "embedded"))

    return matches, unmatched


# ─────────────────────────────────────────────────────────────
# Utilitários
# ─────────────────────────────────────────────────────────────

def _detect_logo_xrefs(doc: fitz.Document) -> set:
    """Xrefs que aparecem em ≥3 páginas são logos/cabeçalhos — ignorar."""
    xref_pages: Dict[int, set] = {}
    for i in range(len(doc)):
        for img in doc.load_page(i).get_images(full=True):
            xref_pages.setdefault(img[0], set()).add(i)
    return {x for x, pgs in xref_pages.items() if len(pgs) >= 3}


def _save_image(img: np.ndarray, sku_code: str, page_num: int, output_folder: str) -> str:
    """Salva PNG e retorna caminho."""
    clean = "".join(c for c in sku_code if c.isalnum() or c in ("-", "_"))
    filename = f"{clean}_page{page_num}.png"
    filepath = os.path.join(output_folder, filename)
    bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    cv2.imwrite(filepath, bgr)
    return filepath


def _make_match(sku: dict, page_num: int, filepath: str, match_type: str) -> Dict:
    sku_code = sku.get("sku", "UNKNOWN")
    filename = os.path.basename(filepath)
    return {
        "sku": sku_code,
        "product_name": sku.get("name", ""),
        "page": page_num,
        "local_path": filepath,
        "final_image_name": filename,
        "match_type": match_type,
        "match_confidence": 1.0,
        "status": "matched",
    }


def _cluster_coords(coords: List[float], tolerance: float = 10) -> List[float]:
    """Agrupa coordenadas próximas (dentro de tolerance) em um único valor (média)."""
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
    """Conta quantos segmentos caem em cada cluster."""
    counts = [0] * len(clusters)
    for line in lines:
        coord = line[0]
        for i, cluster in enumerate(clusters):
            if abs(coord - cluster) <= tolerance:
                counts[i] += 1
                break
    return counts
