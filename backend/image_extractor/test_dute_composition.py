"""Regressao do catalogo real Dute Toys de 08/09/2026.

O PDF monta cada foto comercial com varios objetos independentes (embalagem,
brinquedo e acessorios). O bug salvava so o objeto cujo centro ficava mais
perto do codigo. As coordenadas abaixo foram medidas nas paginas 11, 95 e 141
do arquivo real enviado pelo Gabriel.
"""
import os
import sys

import fitz
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import cv_extractor as cv


failures = []


def check(name, condition, detail=""):
    print(f"  [{'OK' if condition else 'FALHA'}] {name}" + (f" -- {detail}" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def image(xref, x0, y0, x1, y1):
    rect = fitz.Rect(x0, y0, x1, y1)
    return {
        "xref": xref,
        "rect": rect,
        "cx": (x0 + x1) / 2,
        "cy": (y0 + y1) / 2,
        "area": rect.width * rect.height,
    }


def sku(code, x, y):
    return {"sku": code, "name": code, "spatialContext": {"x": x, "y": y}}


def fake_extract(_doc, _image, _raster, _width, _height, _scale):
    return np.zeros((10, 10, 3), dtype=np.uint8)


def fake_save(array, code, _folder):
    height, width = array.shape[:2]
    return f"{code}__{width}x{height}.jpg"


cv._extract_perfect_image = fake_extract
cv._save_image = fake_save


print("PAGINA 11 -- quatro produtos; o primeiro tem cinco elementos")
raster_11 = np.zeros((595, 855, 3), dtype=np.uint8)
skus_11 = [
    sku("DT10023", 36.0, 103.0),
    sku("DT10013", 447.0, 104.0),
    sku("DT10015", 36.0, 355.0),
    sku("DT10016", 448.0, 355.0),
]
images_11 = [
    # DT10023: tres icones + tambor + embalagem.
    image(6147, 166.6, 54.0, 198.1, 102.3),
    image(6146, 204.8, 54.6, 236.5, 103.1),
    image(6143, 168.4, 59.6, 195.5, 86.7),
    image(286, 231.0, 54.1, 429.5, 297.0),
    image(284, 116.7, 155.6, 239.3, 288.9),
    # Um elemento em cada outro bloco prova que nao houve mistura.
    image(300, 510.0, 70.0, 810.0, 270.0),
    image(301, 100.0, 330.0, 410.0, 550.0),
    image(302, 500.0, 330.0, 820.0, 550.0),
]
matches_11, unmatched_11 = cv._match_via_grid(
    None, None, raster_11,
    [0.0, 19.8, 94.4, 283.2, 504.6, 595.0],
    [0.0, 42.5, 441.3, 855.0],
    skus_11, images_11, 1.0, "tmp", 11, supplier_id="Dute Toys",
)
by_sku_11 = {item["sku"]: item for item in matches_11}
check("os quatro SKUs continuam associados", len(matches_11) == 4, f"matches={len(matches_11)} unmatched={unmatched_11}")
check(
    "DT10023 vira a composicao inteira, nao o icone 44x68",
    by_sku_11.get("DT10023", {}).get("local_path") == "DT10023__313x243.jpg",
    str(by_sku_11.get("DT10023")),
)
check("DT10023 usa o novo caminho Dute", by_sku_11.get("DT10023", {}).get("match_type") == "dute_composition")


print("PAGINA 12 -- desenho em triangulo: um produto em cima e dois embaixo")
raster_12 = np.zeros((595, 855, 3), dtype=np.uint8)
matches_12, unmatched_12 = cv._match_via_grid(
    None, None, raster_12,
    [0.0, 20.0, 283.0, 558.0, 595.0],
    [0.0, 164.0, 428.0, 855.0],
    [
        sku("DT10293", 185.9, 106.6),
        sku("DT10272", 56.0, 319.0),
        sku("DT10368", 472.9, 319.0),
    ],
    [
        image(304, 252.4, 125.3, 391.4, 256.4),
        image(306, 398.7, 99.5, 695.5, 260.2),
        image(298, 243.7, 269.2, 415.0, 534.3),
        image(302, 106.9, 352.5, 232.1, 526.9),
        image(293, 564.1, 291.9, 836.6, 524.2),
        image(297, 445.5, 407.1, 564.7, 529.2),
    ],
    1.0, "tmp", 12, supplier_id="Dute Toys",
)
check("os tres produtos triangulares recebem imagem", len(matches_12) == 3 and not unmatched_12, str(unmatched_12))
_, ranges_116 = cv._dute_axis_partitions(
    [103.5, 366.0],
    [0.0, 20.3, 111.1, 232.9, 297.0, 420.9, 558.4, 595.0],
    595.0,
    45.0,
)
check(
    "pagina 116 usa a linha antes do codigo, nao uma linha dentro da foto",
    ranges_116 == [(0.0, 297.0), (297.0, 595.0)],
    str(ranges_116),
)


print("PAGINA 95 -- a divisoria visual fica em x=428, nao no meio dos codigos")
centers_95, ranges_95 = cv._dute_axis_partitions(
    [69.7, 453.4], [0.0, 164.4, 428.0, 631.5, 716.9, 855.0], 855.0, 80.0
)
check("grade escolhe x=428 como divisoria", ranges_95 == [(0.0, 428.0), (428.0, 855.0)], str(ranges_95))

raster_95 = np.zeros((595, 855, 3), dtype=np.uint8)
matches_95, unmatched_95 = cv._match_via_grid(
    None, None, raster_95,
    [0.0, 19.5, 558.2, 595.0],
    [0.0, 164.4, 428.0, 631.5, 716.9, 855.0],
    [sku("DT10142", 69.7, 184.5), sku("DT10036", 453.4, 191.4)],
    [
        image(400, 236.0, 143.0, 411.0, 370.0),
        image(401, 126.0, 248.0, 241.0, 471.0),
        image(402, 650.0, 106.0, 782.0, 485.0),
        image(403, 522.0, 257.0, 652.0, 469.0),
    ],
    1.0, "tmp", 95, supplier_id="DUTE",
)
by_sku_95 = {item["sku"]: item for item in matches_95}
check("os dois produtos ficam separados", len(matches_95) == 2 and not unmatched_95, str(unmatched_95))
check("peca esquerda em x=323 continua com DT10142", by_sku_95.get("DT10142", {}).get("local_path") == "DT10142__285x328.jpg", str(by_sku_95.get("DT10142")))
check("pecas direitas formam DT10036", by_sku_95.get("DT10036", {}).get("local_path") == "DT10036__260x379.jpg", str(by_sku_95.get("DT10036")))


print("REGRESSAO -- outro fornecedor continua no algoritmo antigo")
other_matches, _ = cv._match_via_grid(
    None, None, np.zeros((400, 400, 3), dtype=np.uint8),
    [0.0, 400.0], [0.0, 200.0, 400.0],
    [sku("OUTRO1", 50.0, 250.0)],
    [image(501, 20.0, 100.0, 120.0, 200.0), image(502, 20.0, 10.0, 120.0, 60.0)],
    1.0, "tmp", 1, supplier_id="Outro Fornecedor",
)
check("fornecedor nao-Dute nao entra na composicao por celula", other_matches[0]["match_type"] == "col_match", str(other_matches[0]))


print("PAGINA 142 -- imagem gigante nao pode esconder os dois outros produtos")
raster_142 = np.zeros((595, 855, 3), dtype=np.uint8)
huge_left = image(4289, 119.6, 127.4, 888.5, 572.7)
huge_right = image(4289, 492.8, 28.9, 1261.8, 474.2)
matches_142, unmatched_142 = cv._match_via_grid(
    None, None, raster_142,
    [0.0, 20.0, 258.9, 437.8, 560.2, 595.0],
    [0.0, 227.1, 410.7, 855.0],
    [
        sku("DTY0999", 239.0, 108.0),
        sku("DT10148", 55.0, 320.0),
        sku("DT10147", 460.0, 316.0),
    ],
    [
        huge_left,
        huge_right,
        image(4307, 522.8, 50.4, 654.9, 249.7),
        image(4305, 353.0, 87.2, 501.9, 169.5),
        image(4303, 208.1, 275.4, 419.1, 528.7),
        image(4299, 88.5, 421.5, 205.3, 519.0),
        image(4291, 442.5, 405.3, 540.5, 507.4),
    ],
    1.0, "tmp", 142, supplier_id="Dute Toys",
)
check(
    "fallback recupera os tres SKUs da pagina 142",
    len(matches_142) == 3 and not unmatched_142,
    f"matches={matches_142} unmatched={unmatched_142}",
)

matches_missing, unmatched_missing = cv._match_via_grid(
    None, None, np.zeros((200, 200, 3), dtype=np.uint8),
    [0.0, 200.0], [0.0, 100.0, 200.0],
    [sku("DUTE-OK", 20.0, 100.0), {"sku": "DUTE-SEM-COORD"}],
    [image(600, 30.0, 40.0, 150.0, 150.0)],
    1.0, "tmp", 1, supplier_id="Dute Toys",
)
check(
    "SKU Dute sem coordenada continua aparecendo no relatorio de falhas",
    len(matches_missing) == 1
    and unmatched_missing == [{"sku": "DUTE-SEM-COORD", "page": 1, "reason": "no_coords"}],
    str(unmatched_missing),
)


if failures:
    print(f"RESULTADO: {len(failures)} FALHA(S): {failures}")
    raise SystemExit(1)

print("RESULTADO: TODOS OS TESTES PASSARAM")
