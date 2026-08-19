"""
Teste do casamento em MATRIZ COR x TAMANHO (achado real: catalogo VAESO
"Catalogo Vaeso 026 - AGOSTO 2026", pagina 28, relatado pelo Josef em
19/08/2026 -- "nas opcoes com diversidade de cores ele ta trocando os de
cima pelos de baixo").

Layout real da pagina (medidas extraidas do PDF):
    [foto Rose  x=69-117 y=439-470]  ...  KM0002 (x=327 y=454)  KG0002 (x=453 y=454)
    [foto Transp x=69-117 y=500-530] ...  KM0003                KG0003
    ... 6 cores x 2 tamanhos = 12 codigos, mas so 6 miniaturas

Causa raiz: o casamento e 1:1 (cada foto serve UM codigo). Com 6 fotos para
12 codigos, metade ficava sem imagem -- e o codigo que sobrava puxava a
miniatura da linha VIZINHA (a "troca de cima por baixo"). Medido no PDF
real: 7 de 14 codigos casavam antes; 14 de 14 depois.

Fix: uma passada extra, so para quem ficou sem imagem, que aceita a foto
cuja faixa vertical CONTEM o Y do codigo (mesma linha visual) -- permitindo
compartilhar a mesma miniatura entre os codigos daquela linha.

Uso: python test_match_matriz_cor_tamanho.py
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


def img(xref, x0, y0, x1, y1):
    rect = fitz.Rect(x0, y0, x1, y1)
    return {"xref": xref, "rect": rect, "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2,
            "area": (x1 - x0) * (y1 - y0)}

def sku(code, x, y):
    return {"sku": code, "spatialContext": {"page": 28, "x": x, "y": y}}


print("TESTE 1 -- matriz cor x tamanho: 1 miniatura serve os 2 codigos da linha")
print(SEP)

# Geometria REAL da pagina 28 do catalogo VAESO.
page_imgs = [
    img(823, 69, 439, 117, 470),   # Rose
    img(829, 69, 500, 117, 530),   # Transparente
    img(835, 69, 561, 117, 592),   # Pistache
]
page_skus = [
    sku("KM0002", 349, 454), sku("KG0002", 474, 454),   # linha Rose
    sku("KM0003", 349, 515), sku("KG0003", 474, 515),   # linha Transparente
    sku("KM0004", 349, 576), sku("KG0004", 474, 576),   # linha Pistache
]
raster = np.zeros((842, 595, 3), dtype="uint8")

matches, unmatched = cv._match_via_embedded(None, raster, page_skus, page_imgs, 1.0, "/tmp", 28)
por_sku = {m["sku"]: m["final_image_name"] for m in matches}

check("todos os 6 codigos receberam imagem", len(matches) == 6 and len(unmatched) == 0,
      f"matches={len(matches)} unmatched={[u['sku'] for u in unmatched]}")

# O par da MESMA linha tem que dividir a MESMA miniatura...
for a, b, xref in [("KM0002", "KG0002", 823), ("KM0003", "KG0003", 829), ("KM0004", "KG0004", 835)]:
    check(f"{a} e {b} compartilham a miniatura da propria linha (xref {xref})",
          f"xref{xref}" in por_sku.get(a, "") and f"xref{xref}" in por_sku.get(b, ""),
          f"{a}->{por_sku.get(a)} {b}->{por_sku.get(b)}")

# ...e NAO pode pegar a da linha vizinha (o bug relatado).
check("KG0002 NAO pegou a miniatura da linha de baixo (xref 829)",
      "xref829" not in por_sku.get("KG0002", ""), f"KG0002->{por_sku.get('KG0002')}")
check("KM0003 NAO pegou a miniatura da linha de cima (xref 823)",
      "xref823" not in por_sku.get("KM0003", ""), f"KM0003->{por_sku.get('KM0003')}")

print(SEP)
print("TESTE 2 -- pagina normal (1 foto por produto) segue 1:1, sem compartilhar")
print(SEP)

# Layout classico: fotos ACIMA de cada codigo, em colunas distintas.
page_imgs2 = [img(101, 50, 100, 200, 260), img(102, 300, 100, 450, 260)]
page_skus2 = [sku("AA1", 125, 290), sku("BB2", 375, 290)]

matches2, unmatched2 = cv._match_via_embedded(None, raster, page_skus2, page_imgs2, 1.0, "/tmp", 1)
por_sku2 = {m["sku"]: m["final_image_name"] for m in matches2}

check("2 matches", len(matches2) == 2, f"{len(matches2)}")
check("AA1 -> foto da sua coluna (xref101)", "xref101" in por_sku2.get("AA1", ""), f"{por_sku2.get('AA1')}")
check("BB2 -> foto da sua coluna (xref102)", "xref102" in por_sku2.get("BB2", ""), f"{por_sku2.get('BB2')}")
check("cada foto usada UMA vez (nao virou compartilhada por engano)",
      por_sku2.get("AA1") != por_sku2.get("BB2"))

print(SEP)
if falhas:
    print(f"RESULTADO: {len(falhas)} FALHA(S) -- {falhas}")
    sys.exit(1)
print("RESULTADO: TODOS OS TESTES PASSARAM")
