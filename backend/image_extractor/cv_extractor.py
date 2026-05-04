"""
Extrator de imagens de catálogos PDF via OpenCV.

Estratégia adaptativa por página:
  - Grid (1-4 V-lines internas): localiza célula do SKU, extrai imagem embarcada via crop do raster
  - Embedded (0 ou >4 V-lines): imagem mais próxima por Y-proximity, crop do raster

SAÍDA: {sku}.png com apenas a foto do produto (sem textos, sem bordas)
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
    scale: float = 3.0
) -> Tuple[List[Dict], List[Dict]]:
    """
    Extrai a imagem de produto (somente a foto) para cada SKU.

    Seleciona automaticamente a estratégia por página:
    - Grid  : 1-4 V-lines interiores → localiza célula, busca imagem embedada nela
    - Embedded : 0 ou >4 V-lines → imagem mais próxima por Y-proximity

    Sempre usa crop do raster renderizado nos coords de get_image_rects() —
    nunca usa doc.extract_image() (que retorna o arquivo raw com orientação/resolução
    diferente do que aparece na página).

    scale=3.0 → 216 DPI para boa qualidade no crop final.
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

    print(f"[CV] {len(skus_by_page)} páginas | {len(skus_list)} SKUs | logos filtrados: {len(logo_xrefs)}")

    for page_num in sorted(skus_by_page.keys()):
        page_skus = skus_by_page[page_num]
        page = doc.load_page(page_num - 1)

        # Renderizar página completa em alta resolução
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

        # Coletar imagens embedadas da página uma vez só
        page_imgs = _get_page_embedded_images(page, logo_xrefs)

        print(f"[CV] Página {page_num}: {width}x{height}px | {n_interior_v} V-internas | {len(page_imgs)} imgs", end="")

        if 1 <= n_interior_v <= 4:
            print(f" → GRID ({len(h_coords)}H×{len(v_coords)}V)")
            pm, pu = _match_via_grid(page, raster, h_coords, v_coords,
                                     page_skus, page_imgs, scale, output_folder, page_num)
        else:
            print(f" → EMBEDDED")
            pm, pu = _match_via_embedded(raster, page_skus, page_imgs,
                                         scale, output_folder, page_num)

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
# Estratégia A: Grid
# ─────────────────────────────────────────────────────────────

def _match_via_grid(
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
    height, width = raster.shape[:2]
    h_s = sorted(h_coords)
    v_s = sorted(v_coords)

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

        # Célula que contém o SKU
        sku_cell = next(
            (c for c in cells if c["x_min"] <= sx <= c["x_max"] and c["y_min"] <= sy <= c["y_max"]),
            None
        )
        if not sku_cell:
            unmatched.append({"sku": sku.get("sku"), "page": page_num, "reason": "outside_grid"})
            continue

        # Construir lista de células a pesquisar: começa na célula atual, sobe até encontrar imagem
        search_cells = [sku_cell]
        hi = sku_cell["h_idx"]
        vi = sku_cell["v_idx"]
        for steps_up in range(1, len(h_s)):
            above_h = hi - steps_up
            if above_h < 0:
                break
            above_cell = next((c for c in cells if c["h_idx"] == above_h and c["v_idx"] == vi), None)
            if above_cell:
                search_cells.append(above_cell)

        # Para cada célula candidata, busca imagem embedada
        best_img = None
        img_cell_pdf = None  # bounds da célula onde a imagem foi encontrada
        for candidate_cell in search_cells:
            cell_pdf = fitz.Rect(
                candidate_cell["x_min"] / scale,
                candidate_cell["y_min"] / scale,
                candidate_cell["x_max"] / scale,
                candidate_cell["y_max"] / scale,
            )
            found = _find_best_image_in_rect(page_imgs, cell_pdf)
            if found:
                best_img = found
                img_cell_pdf = cell_pdf
                break

        if best_img:
            # Intersecta o rect da imagem com os limites da célula-de-foto.
            # Garante que pegamos só a área da foto, mesmo que a imagem embedada
            # no PDF tenha rect maior (cobrindo texto acima/abaixo).
            crop_rect = best_img["rect"] & img_cell_pdf
            # Se a interseção for muito pequena (<20% da área da imagem), usa o rect completo
            min_area = best_img["area"] * 0.20
            inter_area = max(0, crop_rect.width) * max(0, crop_rect.height)
            if crop_rect.is_empty or crop_rect.is_infinite or inter_area < min_area:
                crop_rect = best_img["rect"]
            # Pequeno inset para não capturar linhas pontilhadas da borda da célula
            inset = 3 / scale
            crop_rect = fitz.Rect(
                crop_rect.x0 + inset, crop_rect.y0 + inset,
                crop_rect.x1 - inset, crop_rect.y1 - inset,
            )
            img_arr = _crop_raster_at_rect(crop_rect, raster, width, height, scale)
        else:
            # Fallback: nenhuma imagem embedada encontrada — tenta a mais próxima acima do SKU
            best_img = _find_image_above_sku(page_imgs, sku_x, sku_y,
                                             sku_cell["x_min"] / scale,
                                             sku_cell["x_max"] / scale)
            if best_img:
                img_arr = _crop_raster_at_rect(best_img["rect"], raster, width, height, scale)
            else:
                unmatched.append({"sku": sku.get("sku"), "page": page_num, "reason": "no_img_in_cell"})
                continue

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

        def score(p):
            dy = abs(p["cy"] - sku_y)
            dx = abs(p["cx"] - sku_x)
            return dy * 2 + dx

        best = min(candidates, key=score)
        used_xrefs.add(best["xref"])

        # Pequeno inset para não capturar bordas/linhas do PDF
        inset = 3 / scale
        rect = best["rect"]
        crop_rect = fitz.Rect(rect.x0 + inset, rect.y0 + inset,
                               rect.x1 - inset, rect.y1 - inset)
        img_arr = _crop_raster_at_rect(crop_rect, raster, width, height, scale)
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
    """Retorna imagens válidas da página com posição (em PDF-points) e xref."""
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


def _find_best_image_in_rect(page_imgs: List[Dict], cell_pdf: fitz.Rect) -> Optional[Dict]:
    """
    Retorna a melhor imagem para a célula.
    Prioridade: centro dentro da célula → maior área de sobreposição.
    """
    # 1. Centro dentro da célula
    inside = [
        p for p in page_imgs
        if cell_pdf.x0 <= p["cx"] <= cell_pdf.x1 and cell_pdf.y0 <= p["cy"] <= cell_pdf.y1
    ]
    if inside:
        return max(inside, key=lambda p: p["area"])

    # 2. Maior sobreposição com a célula
    best_overlap = 0.0
    best_img = None
    cell_area = (cell_pdf.x1 - cell_pdf.x0) * (cell_pdf.y1 - cell_pdf.y0)
    for p in page_imgs:
        r = p["rect"]
        ox = max(0.0, min(r.x1, cell_pdf.x1) - max(r.x0, cell_pdf.x0))
        oy = max(0.0, min(r.y1, cell_pdf.y1) - max(r.y0, cell_pdf.y0))
        overlap = ox * oy
        # Aceitar se sobreposição > 15% da célula OU 15% da imagem
        if overlap > best_overlap and overlap > min(cell_area, p["area"]) * 0.15:
            best_overlap = overlap
            best_img = p

    return best_img


def _find_image_above_sku(page_imgs: List[Dict],
                           sku_x: float, sku_y: float,
                           x_min: float, x_max: float) -> Optional[Dict]:
    """
    Fallback: imagem cujo centro está ACIMA do SKU e na mesma faixa X.
    Margin X expandida em 20% para pegar imagens que ultrapassem a borda da célula.
    """
    x_margin = (x_max - x_min) * 0.2
    candidates = [
        p for p in page_imgs
        if p["cy"] < sku_y                          # acima do SKU
        and (x_min - x_margin) <= p["cx"] <= (x_max + x_margin)   # mesma coluna (aproximada)
    ]
    if not candidates:
        return None
    # Escolhe a mais próxima verticalmente (mais perto do SKU, em cima)
    return min(candidates, key=lambda p: sku_y - p["cy"])


def _crop_raster_at_rect(rect: fitz.Rect, raster: np.ndarray,
                          width: int, height: int, scale: float) -> Optional[np.ndarray]:
    """
    Crop do raster renderizado nas coordenadas de display (PDF-points × scale).
    Esta é a única fonte de verdade — captura exatamente o que aparece na página.
    """
    x0 = max(0, int(rect.x0 * scale))
    x1 = min(width, int(rect.x1 * scale))
    y0 = max(0, int(rect.y0 * scale))
    y1 = min(height, int(rect.y1 * scale))
    if x1 <= x0 or y1 <= y0:
        return None
    crop = raster[y0:y1, x0:x1]
    return crop if crop.size > 0 else None


def _detect_logo_xrefs(doc: fitz.Document) -> set:
    """
    Xrefs presentes em ≥3 páginas amostradas = logos/cabeçalhos → ignorar.
    Amostra até 40 páginas distribuídas pelo PDF para não escanear catálogos
    grandes página por página (evita timeout em PDFs com 150+ páginas).
    """
    n = len(doc)
    # Amostra: início, meio e fim do documento
    if n <= 40:
        sample = list(range(n))
    else:
        step = max(1, n // 30)
        sample = sorted(set(
            list(range(0, min(n, 10))) +          # primeiras 10
            list(range(0, n, step))[:25] +         # distribuídas
            list(range(max(0, n - 5), n))          # últimas 5
        ))
    xref_pages: Dict[int, set] = {}
    for i in sample:
        for img in doc.load_page(i).get_images(full=True):
            xref_pages.setdefault(img[0], set()).add(i)
    return {x for x, pgs in xref_pages.items() if len(pgs) >= 3}


def _save_image(img: np.ndarray, sku_code: str, output_folder: str) -> str:
    """Salva {sku}.png em RGB → BGR para cv2."""
    clean = "".join(c for c in sku_code if c.isalnum() or c in ("-", "_"))
    filepath = os.path.join(output_folder, f"{clean}.png")
    bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    cv2.imwrite(filepath, bgr)
    return filepath


def _make_match(sku: dict, page_num: int, filepath: str, match_type: str) -> Dict:
    sku_code = sku.get("sku", "UNKNOWN")
    return {
        "sku": sku_code,
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
