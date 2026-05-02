"""
Teste de validacao ponta a ponta do cv_extractor com PDF GIRA.
Roda deteccao de grid nas primeiras 3 paginas e reporta resultados.
"""
import sys, os
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(__file__))

import fitz
import cv2
import numpy as np
from cv_extractor import _cluster_coords, _count_segments_per_cluster

PDF_PATH = r"C:\Users\Gabriel Pantoni\OneDrive\Desktop\IQC PERSONALITE\Clientes e Projetos\MICHELLE RIBEIRO NUNES DUARTE\Conversor de Documentos\Catalogos modelos de Fornecedor\CATALOGO GIRA IMPORTS.pdf"
OUTPUT_DIR = "temp/test_cv_output"
os.makedirs(OUTPUT_DIR, exist_ok=True)

SCALE = 2.0
TEST_PAGES = [2, 5, 10]  # Testar páginas 2, 5, 10 (1-based)

doc = fitz.open(PDF_PATH)
total_pages = len(doc)
print(f"[TEST] PDF: {total_pages} páginas, {doc.load_page(0).rect.width:.0f}x{doc.load_page(0).rect.height:.0f}pt")
print("=" * 60)

for page_num in TEST_PAGES:
    if page_num > total_pages:
        continue

    page = doc.load_page(page_num - 1)
    mat = fitz.Matrix(SCALE, SCALE)
    pix = page.get_pixmap(matrix=mat)
    # Converter pixmap para numpy array corretamente
    raster = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)

    if pix.n == 4:
        raster = cv2.cvtColor(raster, cv2.COLOR_RGBA2RGB)
    elif pix.n == 3:
        raster = raster.copy()  # já é RGB

    height, width = raster.shape[:2]
    gray = cv2.cvtColor(raster, cv2.COLOR_RGB2GRAY)

    min_h_length = int(width * 0.15)
    min_v_length = int(height * 0.15)

    edges = cv2.Canny(gray, 50, 150)
    lines = cv2.HoughLinesP(
        edges, rho=1, theta=np.pi / 180, threshold=60,
        minLineLength=max(50, min_h_length // 3), maxLineGap=20
    )

    h_lines_raw, v_lines_raw = [], []

    if lines is not None:
        for line in lines:
            x1, y1, x2, y2 = line[0]
            dx, dy = x2 - x1, y2 - y1
            angle = np.arctan2(dy, dx) * 180 / np.pi
            if angle < 0:
                angle += 180
            seg_len = np.sqrt(dx*dx + dy*dy)
            if (angle < 2 or angle > 178) and seg_len >= min_h_length:
                h_lines_raw.append(((y1 + y2) / 2, min(x1, x2), max(x1, x2)))
            elif (88 < angle < 92) and seg_len >= min_v_length:
                v_lines_raw.append(((x1 + x2) / 2, min(y1, y2), max(y1, y2)))

    h_coords = _cluster_coords([l[0] for l in h_lines_raw], tolerance=40)
    v_coords = _cluster_coords([l[0] for l in v_lines_raw], tolerance=40)

    if h_lines_raw and h_coords:
        h_counts = _count_segments_per_cluster(h_lines_raw, h_coords, tolerance=40)
        h_coords = [c for c, cnt in zip(h_coords, h_counts) if cnt >= 2]
    if v_lines_raw and v_coords:
        v_counts = _count_segments_per_cluster(v_lines_raw, v_coords, tolerance=40)
        v_coords = [c for c, cnt in zip(v_coords, v_counts) if cnt >= 2]

    # Adicionar bordas da página
    h_coords = sorted(set([0.0] + list(h_coords) + [float(height)]))
    v_coords = sorted(set([0.0] + list(v_coords) + [float(width)]))

    n_cells = max(0, (len(h_coords) - 1)) * max(0, (len(v_coords) - 1))

    print(f"\n[Pagina {page_num}] {width}x{height}px")
    print(f"   Linhas detectadas: {len(h_lines_raw)} H, {len(v_lines_raw)} V (>={min_h_length}px)")
    print(f"   Grid após clustering: {len(h_coords)} H, {len(v_coords)} V = {n_cells} células")

    if h_coords:
        print(f"   H-lines (Y): {[f'{y:.0f}' for y in sorted(h_coords)[:10]]}{'...' if len(h_coords) > 10 else ''}")
    if v_coords:
        print(f"   V-lines (X): {[f'{x:.0f}' for x in sorted(v_coords)[:10]]}{'...' if len(v_coords) > 10 else ''}")

    # Salvar imagem com grid visualizado
    debug_img = cv2.cvtColor(raster, cv2.COLOR_RGB2BGR).copy()

    for y in h_coords:
        cv2.line(debug_img, (0, int(y)), (width, int(y)), (0, 0, 255), 2)  # vermelho
    for x in v_coords:
        cv2.line(debug_img, (int(x), 0), (int(x), height), (0, 255, 0), 2)  # verde

    # Numerar células
    cell_count = 0
    for i in range(len(sorted(h_coords)) - 1):
        for j in range(len(sorted(v_coords)) - 1):
            hy, hyn = sorted(h_coords)[i], sorted(h_coords)[i+1]
            vx, vxn = sorted(v_coords)[j], sorted(v_coords)[j+1]
            cx = int((vx + vxn) / 2)
            cy = int((hy + hyn) / 2)
            cell_count += 1
            cv2.putText(debug_img, str(cell_count), (cx - 10, cy),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 0), 2)

    out_path = os.path.join(OUTPUT_DIR, f"debug_page{page_num}.jpg")
    cv2.imwrite(out_path, debug_img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    print(f"   ✅ Debug salvo em: {out_path}")

doc.close()
print("\n" + "=" * 60)
print(f"[TEST] Imagens de debug salvas em: {os.path.abspath(OUTPUT_DIR)}")
