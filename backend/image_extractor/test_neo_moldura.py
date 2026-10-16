"""Neo Festas, Teste 10 (fotos): casamento pela moldura do cartão. PDFs sintéticos."""
import fitz
import numpy as np

import importlib.util
import os

# módulo próprio: outros testes trocam funções de `cv_extractor` (ex.
# _extract_perfect_image) sem restaurar
_spec = importlib.util.spec_from_file_location(
    "cv_moldura", os.path.join(os.path.dirname(__file__), "cv_extractor.py"))
cv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cv)


def _png(arr):
    h, w = arr.shape[:2]
    return fitz.Pixmap(fitz.csRGB, w, h, arr.astype(np.uint8).tobytes(), False).tobytes("png")


def _cor(rgb, w=40, h=40):
    a = np.full((h, w, 3), 255, np.uint8)
    a[4:-4, 4:-4] = rgb
    return a


def _imgs(page):
    out = []
    for info in page.get_image_info(xrefs=True):
        r = fitz.Rect(info["bbox"])
        out.append({"rect": r, "xref": info["xref"], "area": r.width * r.height,
                    "cx": (r.x0 + r.x1) / 2, "cy": (r.y0 + r.y1) / 2})
    return out


def _cartao(page, y, fotos, codigos):
    """Moldura em (20,y)-(126,y+106), fotos dentro, códigos à direita com bolinha."""
    page.draw_rect(fitz.Rect(20, y, 126, y + 106), color=(0, 0, 0), radius=0.05)
    for k, rgb in enumerate(fotos):
        x0 = 24 + k * 34
        page.insert_image(fitz.Rect(x0, y + 30, x0 + 32, y + 62), stream=_png(_cor(rgb)))
    out = []
    for k, (cod, rgb) in enumerate(codigos):
        x = 150 + k * 50
        page.draw_circle(fitz.Point(x + 5, y + 40), 5, color=None, fill=[c / 255 for c in rgb])
        page.insert_text(fitz.Point(x + 14, y + 44), cod, fontsize=7)
        out.append({"sku": cod, "spatialContext": {"x": x + 25, "y": y + 41, "page": 1}})
    return out


def test_cada_codigo_fica_com_a_foto_da_cor_da_sua_bolinha(tmp_path):
    doc = fitz.open()
    p = doc.new_page(width=540, height=720)
    verm, azul, amar = (220, 30, 30), (30, 60, 220), (240, 220, 20)
    skus = _cartao(p, 20, [verm, azul, amar], [("111", amar), ("222", verm), ("333", azul)])
    skus += _cartao(p, 140, [(20, 160, 60)], [("444", (20, 160, 60))])
    path = tmp_path / "p.pdf"
    doc.save(path)
    doc = fitz.open(path)
    page = doc[0]
    sc = 2.0
    pix = page.get_pixmap(matrix=fitz.Matrix(sc, sc))
    raster = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3).copy()
    imgs = _imgs(page)
    res = cv._casar_por_moldura(doc, page, raster, sc, imgs, imgs, skus)
    assert set(res) == {"111", "222", "333", "444"}
    assert res["222"]["rect"].x0 < 30          # vermelho = 1ª foto
    assert 55 < res["333"]["rect"].x0 < 62     # azul = 2ª
    assert res["111"]["rect"].x0 > 90          # amarelo = 3ª
    assert res["444"]["rect"].y0 > 140         # cartão de baixo, não o vizinho


def test_sem_moldura_nao_liga(tmp_path):
    doc = fitz.open()
    p = doc.new_page(width=540, height=720)
    p.insert_image(fitz.Rect(24, 50, 56, 82), stream=_png(_cor((200, 0, 0))))
    p.insert_text(fitz.Point(150, 60), "555", fontsize=7)
    path = tmp_path / "p.pdf"
    doc.save(path)
    doc = fitz.open(path)
    page = doc[0]
    raster = np.full((1440, 1080, 3), 255, np.uint8)
    imgs = _imgs(page)
    assert cv._casar_por_moldura(doc, page, raster, 2.0, imgs, imgs,
                                 [{"sku": "555", "spatialContext": {"x": 160, "y": 58, "page": 1}}]) == {}


def test_menor_custo_evita_a_escolha_gulosa():
    # guloso pegaria (0,0)=1 e deixaria (1,1)=50; o ótimo é 2+3
    assert cv._menor_custo([[1, 2], [3, 50]]) == [1, 0]
