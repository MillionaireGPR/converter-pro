"""Teste 10 do Josef (12/10/2026) — fotos. PDFs sintéticos, sem rede."""
import fitz
import numpy as np

import cv_extractor as cv


def _png(arr):
    h, w = arr.shape[:2]
    return fitz.Pixmap(fitz.csRGB, w, h, arr.astype(np.uint8).tobytes(), False).tobytes("png")


def _doc(tmp_path, desenhar):
    doc = fitz.open()
    desenhar(doc.new_page(width=540, height=720))
    path = tmp_path / "p.pdf"
    doc.save(path)
    return fitz.open(path)


def _imgs(page):
    out = []
    for info in page.get_image_info(xrefs=True):
        r = fitz.Rect(info["bbox"])
        out.append({"rect": r, "xref": info["xref"], "area": r.width * r.height,
                    "cx": (r.x0 + r.x1) / 2, "cy": (r.y0 + r.y1) / 2})
    return out


def _sku(cod, x, y):
    return {"sku": cod, "spatialContext": {"x": x, "y": y, "width": 30, "height": 10, "page": 1}}


def test_imagem_com_fotos_empilhadas_e_fatiada_por_codigo(tmp_path):
    # 3 "fotos" separadas por faixas brancas, num arquivo só (GIRA Papelaria pág. 9)
    arr = np.full((300, 200, 3), 255, np.uint8)
    rng = np.random.default_rng(1)
    for y0 in (0, 105, 210):
        arr[y0:y0 + 90] = rng.integers(0, 200, (90, 200, 3))
    doc = _doc(tmp_path, lambda p: p.insert_image(fitz.Rect(12, 144, 227, 467), stream=_png(arr)))
    skus = [_sku("TP2088", 247, 181), _sku("TP2089", 247, 294), _sku("TP2090", 247, 405)]
    fat = cv._fatias_por_codigos_empilhados(doc, _imgs(doc[0]), skus, set())
    assert set(fat) == {"TP2088", "TP2089", "TP2090"}
    cortes = sorted(f["fatia"] for f in fat.values())
    assert cortes[0][0] == 0.0 and cortes[-1][1] == 1.0
    assert 0.28 < cortes[0][1] < 0.36 and 0.63 < cortes[1][1] < 0.71


def test_foto_continua_com_lista_de_cores_nao_e_fatiada(tmp_path):
    arr = np.random.default_rng(2).integers(0, 255, (300, 120, 3))
    doc = _doc(tmp_path, lambda p: p.insert_image(fitz.Rect(20, 100, 140, 400), stream=_png(arr)))
    skus = [_sku(f"13562{i}", 160, 130 + 60 * i) for i in range(4)]
    assert cv._fatias_por_codigos_empilhados(doc, _imgs(doc[0]), skus, set()) == {}


def test_foto_que_encosta_de_borda_na_foto_de_grupo_nao_e_selo():
    grupo = {"rect": fitz.Rect(48, 110, 461, 385), "xref": 1}
    mala = {"rect": fitz.Rect(19, 377, 117, 525), "xref": 2}
    selo = {"rect": fitz.Rect(400, 330, 440, 370), "xref": 3}   # pequeno, SOBRE a foto
    for i in (grupo, mala, selo):
        i["area"] = i["rect"].width * i["rect"].height
    mantidas = cv._descartar_selos([grupo, mala, selo], "teste")
    assert mala in mantidas and selo not in mantidas
