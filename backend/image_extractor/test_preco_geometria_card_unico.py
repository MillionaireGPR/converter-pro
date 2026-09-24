"""Regressão Petrin RD1820 (Josef, 23/09/2026).

O único preço do card estava 13pt abaixo da assinatura (tolerância 12pt).
A conferência tratava isso como ambíguo e a IA mantinha o preço do vizinho
RD1819. Agora um preço ÚNICO no card, do qual nenhum outro código está mais
perto, é aceito. Dois preços no card (Fortal UND + caixa) seguem sem mexer.
"""
import copy
import os
import tempfile

import fitz

import gemini_extractor as ge


def _preco(v):
    return f"R$ {v:.2f}".replace(".", ",")


def _catalogo(path, ultima_pagina):
    doc = fitz.open()
    produtos, cod = [], 1000
    for pg in range(1, 21):
        page = doc.new_page(width=595, height=842)
        for r in range(2):
            for c in range(2):
                cod += 1
                x0, y0 = 40 + c * 280, 120 + r * 300
                preco = round(3 + (cod % 17) * 1.5, 2)
                page.insert_text((x0, y0), f"RD{cod}", fontsize=10)
                page.insert_text((x0 + 110, y0 - 10), _preco(preco), fontsize=10)
                produtos.append({"codigo": f"RD{cod}", "preco": preco, "paginaOrigem": pg})
    page = doc.new_page(width=595, height=842)
    for x, y, texto in ultima_pagina:
        page.insert_text((x, y), texto, fontsize=10)
    doc.save(path)
    doc.close()
    return produtos


def test_preco_unico_um_pouco_fora_da_janela_corrige_troca_com_vizinho():
    pdf = os.path.join(tempfile.mkdtemp(), "petrin_rd1820.pdf")
    # RD1820 à esquerda: preço 12,80 com dy=+5 (assinatura dy=-10 → 15pt de desvio)
    # RD1819 à direita: preço 19,00 exatamente na assinatura
    produtos = _catalogo(pdf, [
        (40, 120, "RD1820"), (170, 125, _preco(12.8)),
        (320, 120, "RD1819"), (430, 110, _preco(19.0)),
    ])
    produtos += [
        {"codigo": "RD1820", "preco": 19.0, "paginaOrigem": 21},
        {"codigo": "RD1819", "preco": 19.0, "paginaOrigem": 21},
    ]
    fixed, avisos = ge._verify_prices_by_geometry(pdf, copy.deepcopy(produtos))
    by = {p["codigo"]: p for p in fixed}
    assert by["RD1820"]["preco"] == 12.8
    assert by["RD1819"]["preco"] == 19.0
    assert [a["codigo"] for a in avisos] == ["RD1820"]


def test_card_com_dois_precos_continua_sem_mexer():
    pdf = os.path.join(tempfile.mkdtemp(), "fortal_like.pdf")
    produtos = _catalogo(pdf, [
        (40, 120, "FT100"), (170, 125, _preco(2.28)), (170, 140, _preco(13.68)),
    ])
    produtos.append({"codigo": "FT100", "preco": 2.28, "paginaOrigem": 21})
    fixed, avisos = ge._verify_prices_by_geometry(pdf, copy.deepcopy(produtos))
    assert {p["codigo"]: p for p in fixed}["FT100"]["preco"] == 2.28
    assert avisos == []


def test_em_breve_perde_preco_do_vizinho_mesmo_com_valor_igual_ou_de_por():
    """Josef 24/09/2026: RD1020 (EM BREVE) com o R$ 2,20 do RD1021, que tem o
    mesmo valor; RD1098-1 (EM BREVE) com o "POR R$ 8,00" do card DE/POR do
    RD1602. Sem preço na região do próprio card → fica sem preço."""
    pdf = os.path.join(tempfile.mkdtemp(), "petrin_em_breve.pdf")
    produtos = _catalogo(pdf, [
        (40, 120, "RD1020"),
        (320, 120, "RD1021"), (430, 110, _preco(2.2)),
        (40, 420, "RD1098-1"),
        (320, 420, "RD1602"), (430, 405, _preco(16.0)), (480, 405, _preco(8.0)),
    ])
    produtos += [
        {"codigo": "RD1020", "preco": 2.2, "paginaOrigem": 21},
        {"codigo": "RD1021", "preco": 2.2, "paginaOrigem": 21},
        {"codigo": "RD1098-1", "preco": 16.0, "precoPromocional": 8.0, "promocional": True, "paginaOrigem": 21},
        {"codigo": "RD1602", "preco": 16.0, "precoPromocional": 8.0, "promocional": True, "paginaOrigem": 21},
    ]
    fixed, _avisos = ge._verify_prices_by_geometry(pdf, copy.deepcopy(produtos))
    by = {p["codigo"]: p for p in fixed}
    assert by["RD1020"]["preco"] is None
    assert by["RD1021"]["preco"] == 2.2
    assert by["RD1098-1"]["preco"] is None
    assert by["RD1098-1"]["precoPromocional"] is None and by["RD1098-1"]["promocional"] is False
    assert by["RD1602"]["preco"] == 16.0 and by["RD1602"]["precoPromocional"] == 8.0
