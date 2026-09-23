"""Regressão BM36 (retestagem do Josef 22/09): WC410004 (pág. 119) saía sem
foto. O PDF desenha a MESMA imagem embutida (mesmo xref) em 2 posições da
página — FRASCO CREME 80ML (WC410003) e FRASCO CREME 100ML (WC410004) usam o
xref 1340 duas vezes, uma por célula. O dedup de `_match_via_grid` marcava a
imagem como "usada" pelo XREF: assim que WC410003 reivindicava sua célula, a
foto de WC410004 (mesmo xref, posição diferente) contava como já usada e o
produto ficava sem imagem ("no_img_in_col"). Geometria real da página 119."""
import os
import sys

import fitz

sys.path.insert(0, os.path.dirname(__file__))
import cv_extractor as cv


def img(xref, x0, y0, x1, y1):
    r = fitz.Rect(x0, y0, x1, y1)
    return {"xref": xref, "rect": r, "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2, "area": r.width * r.height}


def sku(code, x, y):
    return {"sku": code, "name": code, "spatialContext": {"x": x, "y": y, "width": 34.6, "height": 7.9}}


skus = [
    sku("WC409669", 89.6, 298.1),
    sku("WC410000", 374.4, 298.1),
    sku("WC410001", 89.3, 541.8),
    sku("WC410002", 374.4, 541.8),
    sku("WC410003", 89.4, 785.8),
    sku("WC410004", 374.4, 785.8),
]
imgs = [
    img(1336, 75.0, 77.5, 273.7, 276.2),
    img(1337, 359.8, 77.5, 558.5, 276.2),
    img(1338, 74.8, 321.2, 273.5, 519.9),
    img(1339, 359.8, 321.2, 558.5, 519.9),
    img(1340, 74.8, 565.1, 273.6, 763.9),   # WC410003 — MESMO xref que a de baixo
    img(1340, 359.8, 565.1, 558.6, 763.9),  # WC410004 — mesmo xref, posição diferente
]
raster = None  # não usado: monkeypatch dos extratores abaixo


def _fake_extract(_doc, image, _raster, _w, _h, _scale):
    return __import__("numpy").zeros((10, 10, 3), dtype="uint8")


_usado = {}


def _fake_save(_arr, code, _folder):
    _usado[code] = True
    return f"{code}.jpg"


cv._extract_perfect_image = _fake_extract
cv._save_image = _fake_save


def test_ambos_frascos_com_mesmo_xref_recebem_foto():
    matches, unmatched = cv._match_via_grid(
        None, None, __import__("numpy").zeros((842, 595, 3), dtype="uint8"),
        [0.0, 842.0], [0.0, 595.0], skus, imgs, 1.0, "tmp", 119,
    )
    assert not unmatched, unmatched
    assert _usado.get("WC410003") and _usado.get("WC410004")


if __name__ == "__main__":
    test_ambos_frascos_com_mesmo_xref_recebem_foto()
    print("OK: xref duplicado em 2 posições não faz o 2º produto perder a foto")
