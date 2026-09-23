"""Regressão BM36 (retestagem do Josef 17/09): em catálogo com foto ACIMA do
código, a foto do cartão de BAIXO (começa 22pt depois do código) ganhava da foto
do próprio cartão (42pt acima do código) porque a distância era em valor
absoluto — o elefante saía com a foto do abacaxi, e assim em rodízio. Geometria
real da página 84 do catálogo, coluna da direita."""
import os
import sys

import fitz
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import cv_extractor as cv


def img(xref, x0, y0, x1, y1):
    r = fitz.Rect(x0, y0, x1, y1)
    return {"xref": xref, "rect": r, "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2, "area": r.width * r.height}


def sku(code, x, y):
    return {"sku": code, "name": code, "spatialContext": {"x": x, "y": y, "width": 27.0, "height": 6.0}}


_ultimo = {}


def _fake_extract(_doc, image, _raster, _w, _h, _scale):
    _ultimo["xref"] = image["xref"]
    return np.zeros((10, 10, 3), dtype=np.uint8)


def _fake_save(_arr, code, _folder):
    _usado[code] = _ultimo["xref"]
    return f"{code}.jpg"


_usado = {}
cv._extract_perfect_image = _fake_extract
cv._save_image = _fake_save

skus = [sku("WC409938", 432, 216), sku("WC409917", 432, 384), sku("WC409929", 432, 547), sku("WC409934", 432, 709)]
imgs = [
    img(1024, 413, 107, 540, 175),   # WC409938
    img(1027, 409, 245, 540, 339),   # WC409917 (elefante)
    img(1029, 427, 403, 534, 497),   # WC409929 (abacaxi) — começa DEPOIS do código do elefante
    img(1032, 413, 569, 534, 662),   # WC409934 (dog)
]
raster = np.zeros((842, 595, 3), dtype=np.uint8)
matches, unmatched = cv._match_via_grid(
    None, None, raster, [0.0, 842.0], [0.0, 595.0], skus, imgs, 1.0, "tmp", 84,
)
assert not unmatched, unmatched
esperado = {"WC409938": 1024, "WC409917": 1027, "WC409929": 1029, "WC409934": 1032}
assert _usado == esperado, _usado
print("OK: cada cartão fica com a foto de cima dele (não a do cartão de baixo)")
