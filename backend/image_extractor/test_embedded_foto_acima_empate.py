"""Regressão VAESO (teste real 21/09): página 25, 7 cartões (1 foto grande + 6
miniaturas 3x2), foto ACIMA do código. O código de cada cartão de cima fica
quase equidistante da miniatura de cima (a dele) e da de baixo; a distância
absoluta escolhia a de baixo — todas as cores saíam trocadas e o 7º item ficava
sem foto. Geometria real da página."""
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
    return {"sku": code, "name": code, "spatialContext": {"x": x, "y": y, "width": 59.0, "height": 12.0}}


_ultimo, _usado = {}, {}
cv._extract_perfect_image = lambda _d, image, *_a: (_ultimo.update(xref=image["xref"]) or np.zeros((10, 10, 3), dtype=np.uint8))
cv._save_image = lambda _arr, code, _folder: (_usado.__setitem__(code, _ultimo["xref"]) or f"{code}.jpg")

skus = [
    sku("PUMF0001", 491, 506), sku("PUMF0002", 123, 644), sku("PUMF0003", 294, 644), sku("PUMF0004", 464, 644),
    sku("PUMF0005", 123, 777), sku("PUMF0006", 294, 777), sku("PUMF0007", 464, 777),
]
imgs = [
    img(1, 59, 155, 536, 486),
    img(2, 73, 550, 182, 604), img(3, 243, 550, 352, 604), img(4, 413, 550, 524, 604),
    img(5, 72, 683, 182, 737), img(6, 243, 683, 352, 737), img(7, 413, 683, 524, 737),
]
raster = np.zeros((842, 595, 3), dtype=np.uint8)
matches, unmatched = cv._match_via_embedded(None, raster, skus, imgs, 1.0, "tmp", 25, orientacao="acima")
assert not unmatched, unmatched
esperado = {"PUMF0001": 1, "PUMF0002": 2, "PUMF0003": 3, "PUMF0004": 4, "PUMF0005": 5, "PUMF0006": 6, "PUMF0007": 7}
assert _usado == esperado, _usado
print("OK: cada cartão fica com a miniatura de cima dele (foto acima do código)")
