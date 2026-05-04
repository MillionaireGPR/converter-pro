"""
Extrator de imagens de catálogos PDF via OpenCV.

Estratégia adaptativa por página:
  - Grid (1-4 V-lines internas): localiza célula do SKU, extrai imagem embedada da célula
  - Embedded (0 ou >4 V-lines): associa imagens por Y-proximity

Saída: {sku}.png  (apenas foto do produto, sem textos/descrições)
Suporta: GIRA, BM36, NixHouse, Lila Home, Goal, Clink, Dagia, FastNeo e similares.
"""
import os
import cv2
import numpy as np
import fitz
from typing import List, Tuple, Dict


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
    Extrai a imagem de produto para cada SKU.

    Seleciona automaticamente a estratégia por página:
    - Grid: 1-4 V-lines interiores → localiza célula pelo grid, extrai imagem embedada da célula
    - Embedded: 0 ou >4 V-lines → imagem embedada mais próxima por Y-proximity

    Args:
        pdf_path: caminho do PDF
        skus_list: SKUs com spatialContext {x, y, page} em coords PyMuPDF
        output_folder: diretório de saída
        scale: fator de renderização para detecção de grid (não afeta qualidade da imagem extraída)

    Returns:
        (matches, unmatched)
    """
    doc = fitz.open(pdf_path)
    matches: List[Dict] = []
    unmatched: List[Dict] = []

    logo_xrefs = _detect_logo_xrefs(doc)

    # Deduplica SKUs por (sku, page) — proteção para PDFs com texto duplicado
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

        h_lines, v_lines = _detect_lines(raster, width, height)
        h_coords = _finalize_coords([l[0] for l in h_lines], 40, min_count=2,
                                    boundary_lo=0.0, boundary_hi=float(height))
        v_coords = _finalize_coords([l[0] for l in v_lines], 40, min_count=2,
                                    boundary_lo=0.0, boundary_hi=float(width))
        n_interior_v = len(v_coords) - 2

        print(f"[CV] Página {page_num}: {width}x{height}px | {n_interior_v} V-internas", end="")

        if 1 <= n_interior_v <= 4:
            print(f" → GRID ({len(h_coords)}H×{len(v_coords)}V)")
            pm, pu = _match_via_grid(doc, page, raster, h_coords, v_coords,
                                     page_skus, logo_xrefs, scale, output_folder, page_num)
        else:
            print(f" → EMBEDDED")
            pm, pu = _match_via_embedded(doc, page, raster, page_skus,
                                         logo_xrefs, scale, output_folder, page_num)

        matches.extend(pm)
        unmatched.extend(pu)

    doc.close()
    print(f"[CV] Total: {len(matches)} matches | {len(unmatched)} unmatched")
    return matches, unmatched


# ─────────────────────────────────────────────────────────────
# Detecção de linhas via OpenCV
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
# Estratégia A: Grid → extrai imagem embedada da célula
# ─────────────────────────────────────────────────────────────

def _match_via_grid(
    doc: fitz.Document,
    page: fitz.Page,
    raster: np.ndarray,
    h_coords: List[float],
    v_coords: List[float],
    page_skus: list,
    logo_xrefs: set,
    scale: float,
    output_folder: str,
    page_num: int
) -> Tuple[List[Dict], List[Dict]]:
    height, width = raster.shape[:2]
    h_s = sorted(h_coords)
    v_s = sorted(v_coords)

    # Construir células
    cells = []
    for i in range(len(h_s) - 1):
        for j in range(len(v_s) - 1):
            cells.append({
                "h_idx": i, "v_idx": j,
                "y_min": int(h_s[i]), "y_max": int(h_s[i + 1]),
                "x_min": int(v_s[j]), "x_max": int(v_s[j + 1]),
            })

    # Pré-computar imagens embedadas da página com suas posições (em PDF-points)
    page_imgs = _get_page_embedded_images(page, logo_xrefs)

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

        # Se cair em célula muito pequena (zona de texto), expandir para célula acima
        if matched_cell and (matched_cell["y_max"] - matched_cell["y_min"]) < 150 and matched_cell["h_idx"] > 0:
            above = next((c for c in cells
                          if c["h_idx"] == matched_cell["h_idx"] - 1
                          and c["v_idx"] == matched_cell["v_idx"]), None)
            if above:
                matched_cell = above

        if not matched_cell:
            unmatched.append({"sku": sku.get("sku"), "page": page_num, "reason": "outside_grid"})
            continue

        # Converter célula de pixels → PDF-points para busca de imagens
        cell_pdf = fitz.Rect(
            matched_cell["x_min"] / scale,
            matched_cell["y_min"] / scale,
            matched_cell["x_max"] / scale,
            matched_cell["y_max"] / scale,
        )

        # Encontrar a maior imagem embedada cujo centro cai dentro da célula
        best = _find_best_image_in_rect(page_imgs, cell_pdf)

        if best:
            img_arr = _extract_image_array(doc, best["xref"], best["rect"], raster, width, height, scale)
        else:
            # Fallback: crop da parte superior da célula (onde normalmente fica a foto)
            cell_h = matched_cell["y_max"] - matched_cell["y_min"]
            crop_y_max = matched_cell["y_min"] + int(cell_h * 0.65)
            img_arr = raster[matched_cell["y_min"]:crop_y_max,
                             matched_cell["x_min"]:matched_cell["x_max"]]

        if img_arr is None or img_arr.size == 0:
            unmatched.append({"sku": sku.get("sku"), "page": page_num, "reason": "empty_crop"})
            continue

        filepath = _save_image(img_arr, sku.get("sku", "UNKNOWN"), output_folder)
        matches.append(_make_match(sku, page_num, filepath, "grid"))

    return matches, unmatched


# ─────────────────────────────────────────────────────────────
# Estratégia B: Embedded Images
# ─────────────────────────────────────────────────────────────

def _match_via_embedded(
    doc: fitz.Document,
    page: fitz.Page,
    raster: np.ndarray,
    page_skus: list,
    logo_xrefs: set,
    scale: float,
    output_folder: str,
    page_num: int
) -> Tuple[List[Dict], List[Dict]]:
    height, width = raster.shape[:2]

    page_imgs = _get_page_embedded_images(page, logo_xrefs)

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

        def score(p):
            dy = abs(p["cy"] - sku_y)
            dx = abs(p["cx"] - sku_x)
            return dy * 2 + dx

        best = min(candidates, key=score)
        used_xrefs.add(best["xref"])

        img_arr = _extract_image_array(doc, best["xref"], best["rect"], raster, width, height, scale)
        if img_arr is None or img_arr.size == 0:
            unmatched.append({"sku": sku.get("sku"), "page": page_num, "reason": "empty_crop"})
            continue

        filepath = _save_image(img_arr, sku.get("sku", "UNKNOWN"), output_folder)
        matches.append(_make_match(sku, page_num, filepath, "embedded"))

    return matches, unmatched


# ─────────────────────────────────────────────────────────────
# Utilitários de imagem
# ─────────────────────────────────────────────────────────────

def _get_page_embedded_images(page: fitz.Page, logo_xrefs: set) -> List[Dict]:
    """Retorna lista de imagens válidas da página com posição e xref."""
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


def _find_best_image_in_rect(page_imgs: List[Dict], cell_pdf: fitz.Rect) -> Dict:
    """Retorna a maior imagem cujo centro está dentro de cell_pdf."""
    inside = [
        p for p in page_imgs
        if cell_pdf.x0 <= p["cx"] <= cell_pdf.x1 and cell_pdf.y0 <= p["cy"] <= cell_pdf.y1
    ]
    if not inside:
        return None
    return max(inside, key=lambda p: p["area"])


def _extract_image_array(
    doc: fitz.Document,
    xref: int,
    rect: fitz.Rect,
    raster: np.ndarray,
    width: int,
    height: int,
    scale: float
) -> np.ndarray:
    """
    Extrai a imagem em array RGB.
    Tenta primeiro via doc.extract_image (foto pura do PDF).
    Fallback: crop do raster renderizado.
    """
    try:
        img_data = doc.extract_image(xref)
        if img_data and img_data.get("image"):
            arr = np.frombuffer(img_data["image"], dtype=np.uint8)
            decoded = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if decoded is not None:
                # cv2 decodifica em BGR, converter para RGB
                return cv2.cvtColor(decoded, cv2.COLOR_BGR2RGB)
    except Exception:
        pass

    # Fallback: crop do raster
    x0 = max(0, int(rect.x0 * scale))
    x1 = min(width, int(rect.x1 * scale))
    y0 = max(0, int(rect.y0 * scale))
    y1 = min(height, int(rect.y1 * scale))
    crop = raster[y0:y1, x0:x1]
    return crop if crop.size > 0 else None


def _detect_logo_xrefs(doc: fitz.Document) -> set:
    """Xrefs que aparecem em ≥3 páginas são logos/cabeçalhos."""
    xref_pages: Dict[int, set] = {}
    for i in range(len(doc)):
        for img in doc.load_page(i).get_images(full=True):
            xref_pages.setdefault(img[0], set()).add(i)
    return {x for x, pgs in xref_pages.items() if len(pgs) >= 3}


def _save_image(img: np.ndarray, sku_code: str, output_folder: str) -> str:
    """Salva PNG com nome {sku}.png e retorna caminho."""
    clean = "".join(c for c in sku_code if c.isalnum() or c in ("-", "_"))
    filepath = os.path.join(output_folder, f"{clean}.png")
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
