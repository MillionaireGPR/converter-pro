"""
Teste E2E: usa SKUs reais extraidos do PDF GIRA para validar cv_extractor.
"""
import sys, os
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(__file__))

import fitz, re
from cv_extractor import extract_cells_via_cv

PDF_PATH = r"C:\Users\Gabriel Pantoni\OneDrive\Desktop\IQC PERSONALITE\Clientes e Projetos\MICHELLE RIBEIRO NUNES DUARTE\Conversor de Documentos\Catalogos modelos de Fornecedor\CATALOGO GIRA IMPORTS.pdf"
OUTPUT_DIR = "temp/test_e2e_output"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# --- Extrair posicoes reais de SKUs das paginas 2, 5, 10 ---
doc = fitz.open(PDF_PATH)
page_heights = {}
skus_list = []
TEST_PAGES = [2, 5, 10]

for pg_num in TEST_PAGES:
    page = doc.load_page(pg_num - 1)
    page_h = page.rect.height
    page_heights[pg_num] = page_h
    words = page.get_text("words")
    for w in words:
        x0, y0, x1, y1, text = w[0], w[1], w[2], w[3], w[4]
        if re.match(r"^[A-Z]{2,3}\d{3,4}$", text):
            pymupdf_y = (y0 + y1) / 2
            # Simular coordenadas como vieram do PDF.js (Y-up):
            pdfjs_y = page_h - pymupdf_y
            skus_list.append({
                "sku": text,
                "name": f"Produto {text}",
                "spatialContext": {
                    "x": (x0 + x1) / 2,
                    "y": pdfjs_y,   # ainda em coordenadas PDF.js
                    "page": pg_num,
                    "width": x1 - x0,
                    "height": y1 - y0,
                }
            })

doc.close()
print(f"[E2E] {len(skus_list)} SKUs encontrados nas paginas {TEST_PAGES}")

# --- Converter Y antes de chamar cv_extractor (mesmo que main.py faz) ---
converted = 0
for sku in skus_list:
    sc = sku.get("spatialContext")
    if sc and sc.get("y") is not None:
        page_h = page_heights.get(sc.get("page"), 720)
        sc["y"] = page_h - sc["y"]  # converte PDF.js -> PyMuPDF
        converted += 1

print(f"[E2E] {converted} coordenadas Y convertidas")

# --- Rodar extracao ---
print(f"[E2E] Iniciando extracao OpenCV...")
matches, unmatched = extract_cells_via_cv(PDF_PATH, skus_list, OUTPUT_DIR)

# --- Resultado ---
print("\n" + "=" * 60)
print(f"[E2E] RESULTADO FINAL:")
print(f"  Matches:   {len(matches)}/{len(skus_list)} SKUs ({100*len(matches)/max(1,len(skus_list)):.1f}%)")
print(f"  Unmatched: {len(unmatched)}")

if unmatched:
    print(f"\n  SKUs sem match:")
    for u in unmatched:
        print(f"    - {u.get('sku')} (p{u.get('page')}): {u.get('reason')}")

print(f"\n  Imagens salvas em: {os.path.abspath(OUTPUT_DIR)}")
print(f"  Arquivos gerados:")
for m in matches:
    path = m.get("local_path", "?")
    exists = os.path.exists(path)
    size = os.path.getsize(path) // 1024 if exists else 0
    print(f"    - {m['sku']} (p{m['page']}): {os.path.basename(path)} [{size}KB] {'OK' if exists else 'FALTANDO'}")
