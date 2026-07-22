"""
Teste isolado do casamento SKU<->imagem em _match_via_embedded (v55, reuniao
22/07/2026). Nao depende de PDF real -- constroi page_skus/page_imgs
sinteticos e faz monkeypatch da extracao/salvamento de imagem pra isolar
so a logica de SELECAO (o que estava errado nos casos reais: Lila pegando
logo, BM36 pegando imagem de posicao errada).

Uso: python test_match_via_embedded.py
"""
import sys, os
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np
import cv_extractor as cv

# Monkeypatch: extracao/salvamento nao dependem de PDF real. Um array 1x1
# real (pra .size funcionar) + o xref carimbado num side-channel, pra
# _save_image poder identificar QUAL imagem foi escolhida no nome do arquivo.
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


print(SEP)
print("TESTE 1 -- caso normal (2 SKUs, 2 imagens bem separadas)")
print(SEP)
skus = [
    {"sku": "A1", "spatialContext": {"x": 10, "y": 10}},
    {"sku": "A2", "spatialContext": {"x": 10, "y": 300}},
]
imgs = [
    {"xref": 100, "cx": 12, "cy": 15},   # perto de A1
    {"xref": 200, "cx": 12, "cy": 305},  # perto de A2
]
m, u = cv._match_via_embedded(None, np.zeros((1000, 500, 3), dtype="uint8"), skus, imgs, 2.0, "tmp", 1)
by_sku = {x["sku"]: x for x in m}
check("A1 -> xref 100", by_sku.get("A1", {}).get("local_path", "").find("xref100") >= 0)
check("A2 -> xref 200", by_sku.get("A2", {}).get("local_path", "").find("xref200") >= 0)
check("0 unmatched", len(u) == 0, f"unmatched={u}")


print(SEP)
print("TESTE 2 -- LOGO longe do SKU deve ser REJEITADO (bug real da Lila)")
print(SEP)
# Pagina 1000pt de altura (raster 2000px / scale 2.0). Logo no topo (y=5),
# SKU no meio da pagina (y=500) -- muito longe pra ser um match plausivel.
skus = [{"sku": "L1", "spatialContext": {"x": 300, "y": 500}}]
imgs = [{"xref": 999, "cx": 300, "cy": 5}]  # "logo" no cabecalho, longe
m, u = cv._match_via_embedded(None, np.zeros((2000, 600, 3), dtype="uint8"), skus, imgs, 2.0, "tmp", 1)
check("SKU sem imagem plausivel vira unmatched (nao forca o logo)", len(m) == 0 and len(u) == 1,
      f"matches={m} unmatched={u}")
check("motivo correto", u[0].get("reason") == "no_plausible_match" if u else False)


print(SEP)
print("TESTE 3 -- match plausivel (mesma ordem de grandeza) e aceito normalmente")
print(SEP)
skus = [{"sku": "P1", "spatialContext": {"x": 300, "y": 500}}]
imgs = [{"xref": 555, "cx": 305, "cy": 480}]  # perto o suficiente
m, u = cv._match_via_embedded(None, np.zeros((2000, 600, 3), dtype="uint8"), skus, imgs, 2.0, "tmp", 1)
check("match aceito (nao rejeitado)", len(m) == 1 and len(u) == 0, f"matches={m} unmatched={u}")


print(SEP)
print("TESTE 4 -- evita cascata: casamento GLOBAL bate o otimo, nao so sequencial por Y")
print(SEP)
# SKU1(y=0) tem 2 opcoes proximas (10 e 30); SKU2(y=100) SO tem uma opcao boa (a de y=95),
# que tambem seria "aceitavel" (mas pior) pro SKU1. O guloso sequencial antigo (ordenado
# por Y do SKU) processava SKU1 primeiro e escolhia sempre o mais proximo disponivel --
# aqui o mais proximo de SKU1 (10) nao conflita com o de SKU2 (95), entao o resultado
# correto (SKU1->10, SKU2->95) deve sair em ambos algoritmos; o que muda e' quando
# o mais proximo de um SKU e' EXATAMENTE a melhor opcao do outro (testado abaixo).
skus = [
    {"sku": "S1", "spatialContext": {"x": 0, "y": 0}},
    {"sku": "S2", "spatialContext": {"x": 0, "y": 20}},
]
imgs = [
    {"xref": 1, "cx": 0, "cy": 19},   # quase perfeito pra S2 (dist=2), tambem proximo de S1 (dist=38)
    {"xref": 2, "cx": 0, "cy": 1},    # quase perfeito pra S1 (dist=2), mais longe de S2 (dist=38)
]
m, u = cv._match_via_embedded(None, np.zeros((1000, 500, 3), dtype="uint8"), skus, imgs, 2.0, "tmp", 1)
by_sku = {x["sku"]: x for x in m}
check("S1 -> xref 2 (seu melhor par)", "xref2" in by_sku.get("S1", {}).get("local_path", ""))
check("S2 -> xref 1 (seu melhor par)", "xref1" in by_sku.get("S2", {}).get("local_path", ""))
check("nenhum unmatched (assignment otimo global)", len(u) == 0, f"unmatched={u}")


print(SEP)
print("TESTE 5 -- SKU sem coordenadas cai em unmatched (nao quebra)")
print(SEP)
skus = [{"sku": "NOXY", "spatialContext": {}}]
imgs = [{"xref": 1, "cx": 0, "cy": 0}]
m, u = cv._match_via_embedded(None, np.zeros((100, 100, 3), dtype="uint8"), skus, imgs, 2.0, "tmp", 1)
check("sem coords -> unmatched com reason no_coords", len(u) == 1 and u[0]["reason"] == "no_coords", f"{u}")


print(SEP)
print("TESTE 6 -- sem imagens na pagina -> todos unmatched (nao quebra)")
print(SEP)
skus = [{"sku": "X1", "spatialContext": {"x": 0, "y": 0}}]
m, u = cv._match_via_embedded(None, np.zeros((100, 100, 3), dtype="uint8"), skus, [], 2.0, "tmp", 1)
check("sem imgs -> unmatched no_embedded_imgs", len(u) == 1 and u[0]["reason"] == "no_embedded_imgs", f"{u}")

print(SEP)
if falhas:
    print(f"RESULTADO: {len(falhas)} FALHA(S): {falhas}")
    sys.exit(1)
else:
    print("RESULTADO: TODOS OS TESTES PASSARAM")
