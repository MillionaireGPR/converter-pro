"""Regressão Petrin (retestagem do Josef 17/09): em catálogo com foto ABAIXO do
código, o casamento por coluna de X pegava o detalhe/zoom perto do código em vez
da foto principal (RD1748 saía com o círculo de zoom; RD1543 com a foto do
produto vizinho). Geometria real das páginas 6 e 11 do catálogo."""
import os
import sys

import fitz

sys.path.insert(0, os.path.dirname(__file__))
import cv_extractor as cv


def img(xref, x0, y0, x1, y1):
    r = fitz.Rect(x0, y0, x1, y1)
    return {"xref": xref, "rect": r, "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2, "area": r.width * r.height}


def sku(code, x, y):
    return {"sku": code, "spatialContext": {"x": x, "y": y, "width": 39.0, "height": 12.0}}


# Página 6: RD1445 (esq) e RD1748 (dir) na mesma linha, RD1811 acima.
p6_skus = [sku("RD1811", 141, 80), sku("RD1445", 48, 441), sku("RD1748", 337, 441)]
p6_imgs = [
    img(257, 124, 555, 223, 756),   # garrafa RD1445
    img(252, 18, 599, 107, 757),    # caixa RD1445
    img(258, 291, 565, 377, 654),   # zoom RD1748 (perto do código)
    img(254, 387, 588, 452, 754),   # caixa RD1748
    img(260, 477, 484, 559, 765),   # garrafa RD1748 (longe em X)
    img(262, 342, 69, 482, 369),    # RD1811
]
usadas = set()
f = cv._foto_principal_da_celula(p6_skus[2], p6_skus, p6_imgs, usadas, 595.0, 842.0)
assert f["xref"] == 260, f["xref"]
e = cv._foto_principal_da_celula(p6_skus[1], p6_skus, p6_imgs, usadas, 595.0, 842.0)
assert e["xref"] in (257, 252), e["xref"]

# Página 11: RD1543 sozinho na linha; a foto larga começa ACIMA do código.
p11_skus = [sku("RD1764", 47, 308), sku("RD1543", 47, 492), sku("RD1658", 47, 660)]
p11_imgs = [
    img(476, 300, 469, 583, 622),   # manteigueira (larga, começa acima do código)
    img(527, 188, 546, 301, 614),   # detalhe
    img(514, 285, 669, 474, 802),   # RD1658
    img(537, 363, 266, 568, 417),   # RD1764
]
m = cv._foto_principal_da_celula(p11_skus[1], p11_skus, p11_imgs, set(), 595.0, 842.0)
assert m["xref"] == 476, m["xref"]

# Imagem já usada é ignorada; célula vazia devolve None (cai no caminho antigo).
assert cv._foto_principal_da_celula(p11_skus[1], p11_skus, p11_imgs, {476, 527}, 595.0, 842.0) is None

print("OK: foto principal da célula (catálogo com foto abaixo do código)")
