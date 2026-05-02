import os
import uuid
import fitz
import cv2
import numpy as np
from typing import List, Tuple, Dict


def extract_cells_via_cv(
    pdf_path: str,
    skus_list: list,
    output_folder: str,
    scale: float = 2.0
) -> Tuple[List[Dict], List[Dict]]:
    """
    Extrai células de produto via OpenCV detectando linhas pontilhadas.

    Algoritmo (6 passos por página):
    1. Render página em 150 DPI → array NumPy
    2. Canny edge detection + HoughLinesP (maxLineGap=15)
    3. Filtro orientação: ±2° de 0° (horizontal) ou 90° (vertical)
    4. Clustering de linhas próximas (tolerância 10px) → coordenadas grid
    5. Construção de células via interseções consecutivas
    6. Match SKU por posição + crop raster → salvar PNG

    Args:
        pdf_path: str, caminho do PDF
        skus_list: list, SKUs com spatialContext (x, y, page)
        output_folder: str, diretório de saída
        scale: float, escala de renderização (2.0 = 2x resolução)

    Returns:
        (matches, unmatched): listas de dicts match_record
    """
    doc = fitz.open(pdf_path)
    matches = []
    unmatched = []

    # Agrupar SKUs por página para processamento eficiente
    skus_by_page = {}
    for sku in skus_list:
        if not sku.get("spatialContext"):
            continue
        page_num = sku.get("spatialContext", {}).get("page", 1)
        if page_num not in skus_by_page:
            skus_by_page[page_num] = []
        skus_by_page[page_num].append(sku)

    print(f"[CV Extractor] Processando {len(skus_by_page)} páginas com SKUs")

    for page_num in sorted(skus_by_page.keys()):
        page_skus = skus_by_page[page_num]

        # Step 1: Render página em 150 DPI
        mat = fitz.Matrix(scale, scale)
        page = doc.load_page(page_num - 1)
        pix = page.get_pixmap(matrix=mat)
        raster = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)

        if pix.n == 4:
            raster = cv2.cvtColor(raster, cv2.COLOR_RGBA2RGB)
        # pix.n == 3: já é RGB, não precisa converter

        height, width = raster.shape[:2]
        print(f"[CV Extractor] Página {page_num}: {width}x{height} px (scale={scale})")

        # Step 2 & 3: Canny + HoughLinesP com filtro de orientação e comprimento mínimo
        gray = cv2.cvtColor(raster, cv2.COLOR_RGB2GRAY)

        # Canny com thresholds para linhas pontilhadas
        edges = cv2.Canny(gray, 50, 150)

        # HoughLinesP: segmentos de linha mínimo 15% da dimensão da página
        min_h_length = int(width * 0.15)   # H-line deve cruzar 15% da largura
        min_v_length = int(height * 0.15)  # V-line deve cruzar 15% da altura

        lines = cv2.HoughLinesP(
            edges,
            rho=1,
            theta=np.pi / 180,
            threshold=60,
            minLineLength=max(50, min_h_length // 3),
            maxLineGap=20
        )

        if lines is None:
            print(f"[CV Extractor] Nenhuma linha detectada na página {page_num}")
            for sku in page_skus:
                unmatched.append({
                    "sku": sku.get("sku"),
                    "page": page_num,
                    "reason": "no_lines_detected"
                })
            continue

        # Step 4: Filtrar por orientação (±2°) E comprimento mínimo (15% da dim. da página)
        # Isso elimina bordas de texto/imagem que são curtas
        h_lines = []  # (y_coord, x_start, x_end)
        v_lines = []  # (x_coord, y_start, y_end)

        for line in lines:
            x1, y1, x2, y2 = line[0]

            dx, dy = x2 - x1, y2 - y1
            angle = np.arctan2(dy, dx) * 180 / np.pi
            if angle < 0:
                angle += 180

            seg_len = np.sqrt(dx * dx + dy * dy)
            is_horizontal = (angle < 2 or angle > 178)
            is_vertical = (88 < angle < 92)

            # Linhas H: devem ter comprimento mínimo horizontal
            if is_horizontal and seg_len >= min_h_length:
                h_lines.append(((y1 + y2) / 2, min(x1, x2), max(x1, x2)))
            # Linhas V: devem ter comprimento mínimo vertical
            elif is_vertical and seg_len >= min_v_length:
                v_lines.append(((x1 + x2) / 2, min(y1, y2), max(y1, y2)))

        # Step 5: Cluster linhas próximas (tolerância 40px para agrupar bordas de células)
        h_coords = _cluster_coords([l[0] for l in h_lines], tolerance=40)
        v_coords = _cluster_coords([l[0] for l in v_lines], tolerance=40)

        # Filtrar clusters com menos de 2 segmentos (ruído isolado)
        if h_lines:
            h_counts = _count_segments_per_cluster(h_lines, h_coords, tolerance=40)
            h_coords = [c for c, cnt in zip(h_coords, h_counts) if cnt >= 2]
        if v_lines:
            v_counts = _count_segments_per_cluster(v_lines, v_coords, tolerance=40)
            v_coords = [c for c, cnt in zip(v_coords, v_counts) if cnt >= 2]

        # Adicionar bordas da página ao grid (limites implícitos)
        h_coords = sorted(set([0.0] + list(h_coords) + [float(height)]))
        v_coords = sorted(set([0.0] + list(v_coords) + [float(width)]))

        print(f"[CV Extractor] Página {page_num}: {len(h_coords)} H-lines, {len(v_coords)} V-lines")

        if len(h_coords) < 2 or len(v_coords) < 2:
            print(f"[CV Extractor] Grid incompleto na página {page_num}")
            for sku in page_skus:
                unmatched.append({
                    "sku": sku.get("sku"),
                    "page": page_num,
                    "reason": "incomplete_grid"
                })
            continue

        # Construir células a partir de interseções
        cells = []
        h_coords_sorted = sorted(h_coords)
        v_coords_sorted = sorted(v_coords)

        for i in range(len(h_coords_sorted) - 1):
            for j in range(len(v_coords_sorted) - 1):
                cell = {
                    "h_idx": i,   # índice da linha H (para encontrar célula acima)
                    "v_idx": j,
                    "y_min": int(h_coords_sorted[i]),
                    "y_max": int(h_coords_sorted[i + 1]),
                    "x_min": int(v_coords_sorted[j]),
                    "x_max": int(v_coords_sorted[j + 1])
                }
                cells.append(cell)

        print(f"[CV Extractor] Grid: {len(h_coords_sorted)} H × {len(v_coords_sorted)} V → {len(cells)} células")

        # Step 6: Match SKU + crop + save
        for sku in page_skus:
            sc = sku.get("spatialContext", {})
            sku_x = sc.get("x")
            sku_y = sc.get("y")

            if sku_x is None or sku_y is None:
                unmatched.append({
                    "sku": sku.get("sku"),
                    "page": page_num,
                    "reason": "no_spatial_context"
                })
                continue

            # Scale coordinates (frontend em pontos PDF.js, aqui em pixels raster)
            scaled_x = sku_x * scale
            scaled_y = sku_y * scale

            # Encontrar célula que contém o SKU
            matched_cell = None
            for cell in cells:
                if (cell["x_min"] <= scaled_x <= cell["x_max"] and
                    cell["y_min"] <= scaled_y <= cell["y_max"]):
                    matched_cell = cell
                    break

            if not matched_cell:
                unmatched.append({
                    "sku": sku.get("sku"),
                    "page": page_num,
                    "reason": "sku_outside_grid"
                })
                continue

            # Se a célula do SKU é uma zona de texto pequena (<150px), expande para
            # incluir a célula de imagem acima (mesma coluna). Em catálogos tipo GIRA
            # a estrutura é: [imagem grande ~380px] + [texto/SKU pequeno ~100px]
            cell_height = matched_cell["y_max"] - matched_cell["y_min"]
            crop_y_min = matched_cell["y_min"]

            if cell_height < 150 and matched_cell["h_idx"] > 0:
                # Procurar célula acima na mesma coluna
                above_cell = next(
                    (c for c in cells
                     if c["h_idx"] == matched_cell["h_idx"] - 1
                     and c["v_idx"] == matched_cell["v_idx"]),
                    None
                )
                if above_cell:
                    crop_y_min = above_cell["y_min"]

            crop_region = {
                "y_min": crop_y_min,
                "y_max": matched_cell["y_max"],
                "x_min": matched_cell["x_min"],
                "x_max": matched_cell["x_max"]
            }

            # Extrair e salvar célula
            try:
                cell_image = raster[
                    crop_region["y_min"]:crop_region["y_max"],
                    crop_region["x_min"]:crop_region["x_max"]
                ]

                # Normalizar fundo (branco)
                cell_image = _normalize_background(cell_image)

                # Salvar como PNG
                filename = f"{sku.get('sku', 'UNKNOWN')}_page{page_num}.png"
                filepath = os.path.join(output_folder, filename)

                cv2.imwrite(filepath, cv2.cvtColor(cell_image, cv2.COLOR_RGB2BGR))

                matches.append({
                    "sku": sku.get("sku"),
                    "page": page_num,
                    "local_path": filepath,
                    "final_image_name": filename,
                    "match_type": "cv_cell_detection",
                    "match_confidence": 1.0
                })

            except Exception as e:
                print(f"[CV Extractor] Erro ao extrair célula {sku.get('sku')}: {e}")
                unmatched.append({
                    "sku": sku.get("sku"),
                    "page": page_num,
                    "reason": f"extraction_error: {str(e)}"
                })

    doc.close()

    print(f"[CV Extractor] Resultado: {len(matches)} matches, {len(unmatched)} unmatch")
    return matches, unmatched


def _count_segments_per_cluster(lines: List[tuple], clusters: List[float], tolerance: float = 20) -> List[int]:
    """Conta quantos segmentos de linha caem em cada cluster (para filtrar ruído)."""
    counts = [0] * len(clusters)
    for line in lines:
        coord = line[0]
        for i, cluster in enumerate(clusters):
            if abs(coord - cluster) <= tolerance:
                counts[i] += 1
                break
    return counts


def _cluster_coords(coords: List[float], tolerance: float = 10) -> List[float]:
    """Agrupa coordenadas próximas (dentro de tolerance) em um único valor (média)."""
    if not coords:
        return []

    coords_sorted = sorted(set(coords))
    clusters = []
    current_cluster = [coords_sorted[0]]

    for coord in coords_sorted[1:]:
        if coord - current_cluster[-1] <= tolerance:
            current_cluster.append(coord)
        else:
            clusters.append(sum(current_cluster) / len(current_cluster))
            current_cluster = [coord]

    clusters.append(sum(current_cluster) / len(current_cluster))
    return clusters


def _normalize_background(image: np.ndarray) -> np.ndarray:
    """
    Normaliza fundo branco/claro da imagem.
    Se média de luminância está acima de 200, aumenta contraste.
    """
    if image is None or image.size == 0:
        return image

    # Converter para HSV para avaliar luminância
    hsv = cv2.cvtColor(image, cv2.COLOR_RGB2HSV)
    v_channel = hsv[:, :, 2]
    mean_brightness = v_channel.mean()

    if mean_brightness > 150:
        # Fundo claro: aumentar contraste
        lab = cv2.cvtColor(image, cv2.COLOR_RGB2LAB)
        l, a, b = cv2.split(lab)

        # CLAHE no canal L
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        l_clahe = clahe.apply(l)

        result = cv2.merge([l_clahe, a, b])
        result = cv2.cvtColor(result, cv2.COLOR_LAB2RGB)
        return result

    return image
