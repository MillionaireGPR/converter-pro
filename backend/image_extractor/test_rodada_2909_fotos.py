"""Teste 9 do Josef (29/09/2026) — fotos. Miniaturas sintéticas, sem rede."""
import fitz
import numpy as np

import cv_extractor as cv


def test_folia_moldura_e_etiqueta_saem():
    navy = np.array([40, 60, 110])
    img = np.full((300, 300, 3), 255, np.uint8)
    img[:, :6] = navy; img[:, -6:] = navy; img[:6, :] = navy     # moldura
    img[285:, 230:290] = 20                                       # ponta da etiqueta
    out = cv._aparar_moldura_e_etiqueta(img, navy)
    assert out.shape[0] < 290 and out.shape[1] <= 288
    assert not (np.abs(out.astype(int) - navy).sum(axis=-1) < 60).any(axis=0).all()
    assert out.min() > 100                                         # sem pedaço escuro


def test_moldura_ausente_nao_corta():
    img = np.full((300, 300, 3), 255, np.uint8)
    img[100:200, 100:200] = 30
    out = cv._aparar_moldura_e_etiqueta(img, np.array([40, 60, 110]))
    assert out.shape == img.shape


def _pagina(tmp_path, desenhar):
    doc = fitz.open()
    page = doc.new_page(width=600, height=800)
    desenhar(page)
    path = tmp_path / "p.pdf"
    doc.save(path)
    return fitz.open(path)


def _png(cor, w=60, h=60, ruido=False):
    arr = np.full((h, w, 3), cor, np.uint8)
    if ruido:
        arr = np.random.default_rng(1).integers(0, 255, (h, w, 3), dtype=np.uint8)
    pix = fitz.Pixmap(fitz.csRGB, w, h, arr.tobytes(), False)
    return pix.tobytes("png")


def test_decoracao_fundo_etiqueta_e_canto(tmp_path):
    def desenhar(page):
        page.insert_image(fitz.Rect(0, 0, 600, 800), stream=_png((30, 40, 90)))          # fundo liso
        page.insert_image(fitz.Rect(40, 300, 190, 380), stream=_png((220, 30, 30)))      # etiqueta
        page.insert_text((60, 345), "R$37,50", fontsize=22)
        page.insert_image(fitz.Rect(500, 0, 600, 100), stream=_png((200, 0, 0)))         # canto
        page.insert_image(fitz.Rect(280, 200, 580, 560), stream=_png(0, ruido=True))      # foto
    doc = _pagina(tmp_path, desenhar)
    page = doc[0]
    infos = {tuple(round(v) for v in i["bbox"]): i["xref"] for i in page.get_image_info(xrefs=True)}
    dec = {b: cv._e_decoracao(page, fitz.Rect(b), x) for b, x in infos.items()}
    assert dec[(0, 0, 600, 800)] is True
    assert dec[(40, 300, 190, 380)] is True
    assert dec[(500, 0, 600, 100)] is True
    assert dec[(280, 200, 580, 560)] is False


def test_codigo_em_breve_vira_ancora_fantasma(tmp_path):
    doc = _pagina(tmp_path, lambda p: [p.insert_text((40, 100), "DT10116"), p.insert_text((40, 400), "DT10115")])
    skus = [{"sku": "DT10116", "spatialContext": {"x": 50, "y": 98, "page": 1}}]
    f = cv._codigos_fantasmas(doc[0], skus)
    assert [x["sku"] for x in f] == ["DT10115"] and f[0]["_fantasma"] is True
