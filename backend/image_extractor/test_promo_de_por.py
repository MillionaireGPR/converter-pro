"""Regressão Petrin (retestagem do Josef 22/09): card com rótulo impresso
"DE R$16,00 POR R$8,00 PREÇO FINAL" — a IA devolvia R$35,00 (preço de um
produto vizinho, RD1604) pro RD1602, e dava o par DE/POR certo pro RD1098-1,
que fica bem mais longe na página (ela seguiu a ORDEM do texto lido, não a
posição). Geometria real da página 163 do catálogo real."""
import os
import sys

import fitz

sys.path.insert(0, os.path.dirname(__file__))
import gemini_extractor as ge


def _pdf_pagina_163(path):
    """`insert_text` posiciona pela BASELINE; `get_text("dict")` devolve o
    bbox pelo TOPO do texto (~11pt acima da baseline em fontsize 10). As
    coordenadas abaixo já somam esse deslocamento pra reproduzir os mesmos
    bbox.y0 medidos na página 163 real (DE/POR em y=341, preços em y=352-353,
    RD1602 em y=369 etc. — ver comentário de `_fix_labeled_promo_price`)."""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    OFF = 11
    linhas = [
        (28, 59 + OFF, "RD1098-1"),
        (28, 72 + OFF, "BOLSA / ESTEIRA DE PRAIA"),
        (29, 369 + OFF, "RD1602"),
        (29, 382 + OFF, "BANCO DOBRAVEL"),
        (28, 623 + OFF, "RD1604"),
        (28, 636 + OFF, "ASSENTO DOBRAVEL"),
        (139, 610 + OFF, "R$ 35,00"),
        (90, 352 + OFF, "R$ 16,00"),
        (149, 353 + OFF, "R$ 8,00"),
        (98, 341 + OFF, "DE"),
        (149, 341 + OFF, "POR"),
        (250, 341 + OFF, "PRECO FINAL"),
    ]
    for x, y, texto in linhas:
        page.insert_text((x, y), texto, fontsize=10)
    doc.save(path)
    doc.close()


def test_rotulo_de_por_vai_pro_codigo_mais_perto_nao_pro_primeiro_da_pagina(tmp_path):
    pdf_path = str(tmp_path / "petrin163.pdf")
    _pdf_pagina_163(pdf_path)

    produtos = [
        {"codigo": "RD1098-1", "paginaOrigem": 1, "preco": 16.0, "precoPromocional": 8.0},
        {"codigo": "RD1602", "paginaOrigem": 1, "preco": 35.0, "precoPromocional": None},
        {"codigo": "RD1604", "paginaOrigem": 1, "preco": 35.0, "precoPromocional": None},
    ]
    ge._fix_labeled_promo_price(pdf_path, produtos)
    by_code = {p["codigo"]: p for p in produtos}

    assert by_code["RD1602"]["preco"] == 16.0
    assert by_code["RD1602"]["precoPromocional"] == 8.0
    assert by_code["RD1602"]["promocional"] is True
    # RD1604 não tem rótulo DE/POR perto dele -- mantém intacto
    assert by_code["RD1604"]["preco"] == 35.0
    assert by_code["RD1604"]["precoPromocional"] is None


def test_sem_rotulo_de_por_nao_mexe_em_nada(tmp_path):
    pdf_path = str(tmp_path / "sem_promo.pdf")
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((28, 100), "AB0001", fontsize=10)
    page.insert_text((28, 130), "R$ 9,00", fontsize=10)
    doc.save(pdf_path)
    doc.close()

    produtos = [{"codigo": "AB0001", "paginaOrigem": 1, "preco": 9.0, "precoPromocional": None}]
    ge._fix_labeled_promo_price(pdf_path, produtos)
    assert produtos[0]["preco"] == 9.0
    assert produtos[0]["precoPromocional"] is None
