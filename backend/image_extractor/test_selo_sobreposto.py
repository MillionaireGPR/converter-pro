"""
Selos/tags sobrepostos a foto (reuniao com o Josef, 20/08/2026 -- catalogo GIRA).

Relato: tags "PROMOCIONAL", "OFERTA" e "NOVIDADE" saindo como se fossem a
imagem do produto. Elas ficam SOBREPOSTAS a foto real, entao o centro delas
chega a ficar mais perto do texto do codigo do que o centro da foto grande --
e o casamento por proximidade escolhia a tag.

O caminho de GRID ja tinha filtro de selo desde 22/07 (test_match_via_grid_badge).
O caminho por PROXIMIDADE (_match_via_embedded), usado por Lila, BM36 e GIRA,
nao tinha nenhum -- era por ali que a tag passava.

Medidas reais do PDF "CATALOGO 2026 UTILIDADES - GIRA IMPORTS", pagina 4:
  - foto do produto (xref 61): x0=11.9 y0=398.5 w=166.1 h=209.3  (area ~34763)
  - selo "KIT"    (xref 63): x0=118.0 y0=570.7 w=51.4 h=25.9     (area ~1331, ~4%)

Uso: python test_selo_sobreposto.py
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
    print(f"  [{'OK' if cond else 'FALHA'}] {nome}" + (f" -- {detalhe}" if detalhe and not cond else ""))
    if not cond:
        falhas.append(nome)


def make_img(xref, x0, y0, w, h):
    rect = fitz.Rect(x0, y0, x0 + w, y0 + h)
    return {"xref": xref, "rect": rect, "cx": x0 + w / 2, "cy": y0 + h / 2, "area": w * h}


FOTO = make_img(61, 11.9, 398.5, 166.1, 209.3)          # area ~34763
SELO_KIT = make_img(63, 118.0, 570.7, 51.4, 25.9)       # area ~1331 (~4% da foto)
OUTRAS = [
    make_img(59, 187.7, 99.7, 165.8, 211.0),
    make_img(57, 12.7, 97.1, 164.3, 211.1),
    make_img(51, 362.3, 100.3, 165.8, 208.3),
]
# SKU logo ABAIXO da foto (foto termina em y=607.8) -- e por isso que o selo,
# que fica no canto inferior da foto, ganhava por distancia.
SKU = [{"sku": "TP2014", "name": "KIT 3PC UTENSILIOS SILICONE",
        "spatialContext": {"x": 95.0, "y": 620.0}}]
RASTER = np.zeros((900, 600, 3), dtype="uint8")


def rodar_embedded(page_imgs, skus=None):
    m, u = cv._match_via_embedded(None, RASTER, skus or SKU, list(page_imgs), 1.0, "tmp", 4)
    return {x["sku"]: x for x in m}, u


print(SEP)
print("TESTE 1 -- o selo vencia por proximidade; agora o SKU casa com a foto")
print(SEP)
por_sku, u = rodar_embedded([FOTO, SELO_KIT] + OUTRAS)
check("TP2014 tem match", "TP2014" in por_sku, f"unmatched={u}")
if "TP2014" in por_sku:
    path = por_sku["TP2014"].get("local_path", "")
    check("TP2014 -> foto real (xref61), NAO o selo (xref63)", "xref61" in path, f"path={path}")

# Prova de que o cenario e real: sem o filtro, o selo ganharia mesmo.
d_selo = abs(SELO_KIT["cy"] - 620.0) * 2 + abs(SELO_KIT["cx"] - 95.0)
d_foto = abs(FOTO["cy"] - 620.0) * 2 + abs(FOTO["cx"] - 95.0)
check("sem filtro o selo estaria mais perto que a foto (bug era real)",
      d_selo < d_foto, f"selo={d_selo:.0f} foto={d_foto:.0f}")


print(SEP)
print("TESTE 2 -- faixa 'OFERTA' grande demais pro filtro de tamanho, mas sobreposta")
print(SEP)
# 160x40 = 6400 -> 18% da maior imagem da pagina: passa no corte de 15%.
# So a regra de sobreposicao pega (esta dentro da foto e tem <50% da area dela).
FAIXA_OFERTA = make_img(77, 14.0, 500.0, 160.0, 40.0)
por_sku2, u2 = rodar_embedded([FOTO, FAIXA_OFERTA] + OUTRAS)
check("TP2014 -> foto real, nao a faixa OFERTA",
      "TP2014" in por_sku2 and "xref61" in por_sku2["TP2014"].get("local_path", ""),
      f"match={por_sku2.get('TP2014')} unmatched={u2}")


print(SEP)
print("TESTE 3 -- pagina sem selo: nada muda")
print(SEP)
por_sku3, _ = rodar_embedded([FOTO] + OUTRAS)
check("TP2014 continua casando com a foto real",
      "TP2014" in por_sku3 and "xref61" in por_sku3["TP2014"].get("local_path", ""))


print(SEP)
print("TESTE 4 -- catalogo de miniaturas: todas pequenas e parecidas, nenhuma cai")
print(SEP)
# Risco de regressao: se o corte fosse por tamanho ABSOLUTO, um catalogo de
# lista com miniaturas de 40x40 perderia tudo. O corte e relativo a maior da
# propria pagina, entao miniaturas parecidas sobrevivem.
minis = [make_img(100 + i, 20.0, 100.0 + i * 60, 40.0, 40.0) for i in range(4)]
mantidas = cv._descartar_selos(minis, "Teste")
check("as 4 miniaturas continuam disponiveis", len(mantidas) == 4, f"sobraram {len(mantidas)}")


print(SEP)
print("TESTE 5 -- fail-safe: filtro nunca esvazia a pagina")
print(SEP)
# Foto grande com um unico selo dentro: se o filtro derrubasse os dois, o
# produto ficaria sem imagem -- pior que arriscar o selo.
so_selo_dentro = [FOTO, SELO_KIT]
mantidas5 = cv._descartar_selos(so_selo_dentro, "Teste")
check("sobra pelo menos uma imagem", len(mantidas5) >= 1, f"sobraram {len(mantidas5)}")
check("a que sobra e a foto, nao o selo",
      len(mantidas5) == 1 and mantidas5[0]["xref"] == 61,
      f"xrefs={[m['xref'] for m in mantidas5]}")


print(SEP)
if falhas:
    print(f"RESULTADO: {len(falhas)} FALHA(S): {falhas}")
    sys.exit(1)
print("RESULTADO: TODOS OS TESTES PASSARAM")
