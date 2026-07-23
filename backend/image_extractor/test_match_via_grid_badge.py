"""
Teste isolado do fix de selo/badge em _match_via_grid (v56, reuniao
22/07/2026 -- catalogo GIRA, produto TP2014 "KIT 3PC UTENSILIOS").

Usa as MEDIDAS REAIS extraidas do PDF real (pagina 4, "CATALOGO 2026
UTILIDADES - GIRA IMPORTS"):
  - foto real do produto (xref 61): x0=11.9 y0=398.5 w=166.1 h=209.3 (area~34763)
  - selo "KIT" sobreposto (xref 63): x0=118 y0=570.7 w=51.4 h=25.9 (area~1331, ~4% da foto)

Sem o fix, o texto do SKU (que fica logo abaixo da foto, portanto com Y
maior que o selo, que fica no canto inferior) tem MENOR distancia Y ate o
selo do que ate a foto -- o antigo "pega o mais proximo" escolhia o selo.

Uso: python test_match_via_grid_badge.py
"""
import sys, os
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np
import fitz
import cv_extractor as cv

_last_xref = {}

def _fake_extract(doc, img_info, raster, w, h, scale):
    arr = np.zeros((1, 1, 3), dtype="uint8")
    _last_xref[id(arr)] = img_info["xref"]
    return arr

def _fake_save(arr, sku, folder):
    return f"{sku}__xref{_last_xref.get(id(arr), '?')}.jpg"

cv._extract_perfect_image = _fake_extract
cv._save_image = _fake_save

SEP = "-" * 60
falhas = []

def check(nome, cond, detalhe=""):
    status = "OK" if cond else "FALHA"
    print(f"  [{status}] {nome}" + (f" -- {detalhe}" if detalhe and not cond else ""))
    if not cond:
        falhas.append(nome)


def make_img(xref, x0, y0, w, h):
    rect = fitz.Rect(x0, y0, x0 + w, y0 + h)
    return {"xref": xref, "rect": rect, "cx": x0 + w / 2, "cy": y0 + h / 2, "area": w * h}


print(SEP)
print("TESTE 1 -- selo (badge) descartado; SKU casa com a foto real (nao o selo)")
print(SEP)
# Medidas reais do PDF: foto real (xref 61) + selo "KIT" (xref 63) na mesma celula.
foto_real = make_img(61, 11.9, 398.5, 166.1, 209.3)   # area ~34763
selo_kit = make_img(63, 118.0, 570.7, 51.4, 25.9)      # area ~1331 (~4% da foto)
# outras 5 fotos da pagina (mesma area aprox.) para o clustering de colunas ter massa critica
outras_fotos = [
    make_img(59, 187.7, 99.7, 165.8, 211.0),
    make_img(57, 12.7, 97.1, 164.3, 211.1),
    make_img(51, 362.3, 100.3, 165.8, 208.3),
    make_img(55, 189.8, 400.3, 161.5, 210.3),
    make_img(53, 367.8, 395.9, 161.3, 210.3),
]
page_imgs = [foto_real, selo_kit] + outras_fotos

# SKU "TP2014" na mesma coluna/x da foto_real, texto logo abaixo da foto
# (foto termina em y=398.5+209.3=607.8; texto do preco/nome vem em seguida).
skus = [{"sku": "TP2014", "name": "KIT 3PC UTENSILIOS SILICONE", "spatialContext": {"x": 95.0, "y": 620.0}}]

raster = np.zeros((900, 600, 3), dtype="uint8")
m, u = cv._match_via_grid(None, None, raster, [], [], skus, page_imgs, 1.0, "tmp", 4)

by_sku = {x["sku"]: x for x in m}
check("TP2014 tem match", "TP2014" in by_sku, f"unmatched={u}")
if "TP2014" in by_sku:
    path = by_sku["TP2014"].get("local_path", "")
    check("TP2014 -> foto real (xref61), NAO o selo (xref63)", "xref61" in path, f"path={path}")


print(SEP)
print("TESTE 2 -- sem selo na pagina, comportamento normal inalterado")
print(SEP)
page_imgs2 = [foto_real] + outras_fotos
m2, u2 = cv._match_via_grid(None, None, raster, [], [], skus, page_imgs2, 1.0, "tmp", 4)
by_sku2 = {x["sku"]: x for x in m2}
check("TP2014 ainda casa com a foto real sem o selo presente",
      "TP2014" in by_sku2 and "xref61" in by_sku2["TP2014"].get("local_path", ""))


print(SEP)
if falhas:
    print(f"RESULTADO: {len(falhas)} FALHA(S): {falhas}")
    sys.exit(1)
else:
    print("RESULTADO: TODOS OS TESTES PASSARAM")
