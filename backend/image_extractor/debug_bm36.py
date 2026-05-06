"""Diagnóstico de estrutura do catálogo BM36."""
import sys, os, re
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

import fitz

PDF = (
    r"C:\Users\Gabriel Pantoni\OneDrive\Desktop\IQC PERSONALITE"
    r"\Clientes e Projetos\MICHELLE RIBEIRO NUNES DUARTE"
    r"\Conversor de Documentos\Catalogos modelos de Fornecedor"
    r"\CATALAGO GERAL BM36 (CÓDIGOS INICIADOS POR BM) e WORD CLASSIC (INICIADO POR WC) (2).pdf"
)
OUTPUT = "temp/debug_bm36"
os.makedirs(OUTPUT, exist_ok=True)

doc = fitz.open(PDF)
print(f"Total páginas: {len(doc)}")
print(f"Tamanho página 1: {doc.load_page(0).rect}")

SKU_PAT = re.compile(r"^(BM|WC)\d{4,8}$")

# Analisar detalhadamente páginas 4 e 6
for pg_num in [2, 4, 6]:
    if pg_num > len(doc):
        continue
    page = doc.load_page(pg_num - 1)
    print(f"\n=== PÁGINA {pg_num} ===")
    print(f"Rect: {page.rect}")

    # Imagens
    imgs = page.get_images(full=True)
    seen = set()
    img_rects = []
    for img_info in imgs:
        xref = img_info[0]
        if xref in seen:
            continue
        seen.add(xref)
        rects = page.get_image_rects(xref)
        if not rects:
            continue
        r = rects[0]
        iw, ih = r.width, r.height
        area = iw * ih
        print(f"  IMG xref={xref}: rect=({r.x0:.0f},{r.y0:.0f})-({r.x1:.0f},{r.y1:.0f}) size={iw:.0f}x{ih:.0f}")
        img_rects.append(r)

    print(f"  Total imagens brutas: {len(imgs)} | únicas visíveis: {len(img_rects)}")

    # SKUs com posição
    words = page.get_text("words")
    skus_found = []
    for w in words:
        x0, y0, x1, y1, text = w[0], w[1], w[2], w[3], w[4]
        if SKU_PAT.match(text.strip()):
            skus_found.append((text.strip(), (x0+x1)/2, (y0+y1)/2))
            print(f"  SKU {text.strip()}: pos=({(x0+x1)/2:.0f}, {(y0+y1)/2:.0f})")

    print(f"  Total SKUs: {len(skus_found)} | Imagens válidas: {len(img_rects)}")
    print(f"  Razão imgs/SKUs: {len(img_rects)/max(1, len(skus_found)):.2f}")

    # Verificar quais SKUs têm imagem próxima
    page_w, page_h = page.rect.width, page.rect.height
    valid_imgs = []
    for img_info in imgs:
        xref = img_info[0]
        rects = page.get_image_rects(xref)
        if not rects:
            continue
        r = rects[0]
        iw, ih = r.width, r.height
        if iw < 20 or ih < 20:
            continue
        if iw > page_w * 0.85 and ih > page_h * 0.85:
            continue
        valid_imgs.append(r)

    print(f"  Imagens válidas (após filtro tamanho): {len(valid_imgs)}")

    # Exportar debug visual
    import numpy as np, cv2
    mat = fitz.Matrix(1.5, 1.5)
    pix = page.get_pixmap(matrix=mat)
    raster = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n).copy()
    if pix.n == 4:
        raster = cv2.cvtColor(raster, cv2.COLOR_RGBA2RGB)
    debug = cv2.cvtColor(raster, cv2.COLOR_RGB2BGR)
    scale = 1.5
    for r in valid_imgs:
        x0, y0, x1, y1 = int(r.x0*scale), int(r.y0*scale), int(r.x1*scale), int(r.y1*scale)
        cv2.rectangle(debug, (x0, y0), (x1, y1), (0, 255, 0), 2)
    for (text, cx, cy) in skus_found:
        cv2.circle(debug, (int(cx*scale), int(cy*scale)), 6, (0, 0, 255), -1)
        cv2.putText(debug, text, (int(cx*scale)+8, int(cy*scale)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0,0,255), 1)
    out = os.path.join(OUTPUT, f"debug_pg{pg_num}.jpg")
    cv2.imwrite(out, debug, [cv2.IMWRITE_JPEG_QUALITY, 80])
    print(f"  Debug salvo: {out}")

doc.close()
