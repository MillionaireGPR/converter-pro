"""Retestagem do Josef 24/09/2026 (DUTE recadastrada, FOLIA, PETRIN, Neo Festas).

Cada teste trava uma causa estrutural medida nos catálogos reais:
- Neo Festas: template que lê o preço DEPOIS do código num catálogo em que
  nome e preço vêm ANTES → nome virava "R$ 37,68 Disp." e preço do vizinho.
- Neo Festas: variação de cor por bolinha vetorial → cor no nome.
- PETRIN: selo EM BREVE trocado entre linhas → destroca.
- PETRIN: foto abaixo do código roubada pela linha de baixo / foto larga.
- FOLIA: posição da visão com escala errada → casa card por ORDEM.
- FOLIA: código miúdo lido errado → conferência por recorte do card.
- DUTE: dono de cada imagem da foto composta = código acima-à-esquerda.
"""
import copy
import json
import os
import tempfile

import fitz

import cv_extractor as cv
import gemini_extractor as ge


# ── Neo Festas: template desalinhado ──────────────────────────────────────

def _pagina_neo(inicio):
    blocos = []
    for i in range(4):
        cod = inicio + i
        blocos.append(
            f"BOLHA DE SABÃO\nMODELO {i}\nR$ {1 + i},57 Un.\nR$ 3{i},68 Disp. c/24 un.\n{cod}\n15cm | Plástico\n"
        )
    return "".join(blocos)


def test_template_com_preco_antes_do_codigo_cai_na_ia():
    tpl = {"CODE": r"(\d{6})", "NOME": r"(?:^|\n)([A-Z][A-Z\s]+?)(?=\n\d{6})",
           "PRECO": r"R\$ ([\d,.]+) Un\.", "QTD": r"c/(\d+) un\.", "PRECO_FMT": "BR"}
    paginas = [_pagina_neo(149800 + 10 * p) for p in range(5)]
    produtos = ge._apply_template(paginas, tpl)
    motivo = ge._template_desalinhado(paginas, tpl, produtos)
    assert motivo and "ANTES" in motivo


def test_template_com_preco_depois_do_codigo_segue_no_template():
    tpl = {"CODE": r"CD: (BM\d{6})", "NOME": r"(?P<nome>[A-Z0-9\s]+?)\s*\nCD: \d{13}",
           "PRECO": r"B(\d+)B\d+", "QTD": r"CX: (\d+)", "PRECO_FMT": "CENTS"}
    paginas = [
        "".join(f"PRODUTO {i}\nCD: 7908733601170\nCD: BM36{p}{i:03d}\nCX: 30\nB{1000 + i}B{1100 + i}\n"
                for i in range(4))
        for p in range(5)
    ]
    produtos = ge._apply_template(paginas, tpl)
    assert ge._template_desalinhado(paginas, tpl, produtos) is None


# ── Neo Festas: cor da bolinha no nome ────────────────────────────────────

def test_cor_da_bolinha_vai_pro_nome_da_variacao(tmp_path):
    pdf = str(tmp_path / "bolinhas.pdf")
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    cores = [((0.97, 0.55, 0.62), "154571"), ((0.46, 0.70, 0.88), "154580"),
             ((0.95, 0.81, 0.0), "154563"), (None, "154555")]
    for i, (cor, cod) in enumerate(cores):
        x = 60 + i * 50
        shape = page.new_shape()
        shape.draw_circle((x + 15, 300), 7.5)
        if cor:
            shape.finish(fill=cor, color=None)
        else:
            shape.finish(color=(0, 0, 0), fill=None)
        shape.commit()
        page.insert_text((x, 320), cod, fontsize=9)
    doc.save(pdf)
    doc.close()
    produtos = [{"codigo": c, "nome": "TOPO BOLO ARCO POMPOM 21cm", "paginaOrigem": 1} for _, c in cores]
    ge._nomear_cores_por_bolinha(pdf, produtos)
    assert [p["nome"].rsplit(" ", 1)[-1] for p in produtos] == ["ROSA", "CLARO", "AMARELO", "BRANCO"]
    assert produtos[1]["nome"].endswith("AZUL CLARO")


def test_produto_unico_nao_ganha_cor(tmp_path):
    pdf = str(tmp_path / "unico.pdf")
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    shape = page.new_shape()
    shape.draw_circle((75, 300), 7.5)
    shape.finish(fill=(0.9, 0.1, 0.1), color=None)
    shape.commit()
    page.insert_text((60, 320), "111111", fontsize=9)
    doc.save(pdf)
    doc.close()
    produtos = [{"codigo": "111111", "nome": "BALÃO", "paginaOrigem": 1}]
    ge._nomear_cores_por_bolinha(pdf, produtos)
    assert produtos[0]["nome"] == "BALÃO"


# ── PETRIN: selo EM BREVE trocado entre linhas ────────────────────────────

def _preco(v):
    return f"R$ {v:.2f}".replace(".", ",")


def test_selo_em_breve_trocado_entre_linhas_e_destrocado():
    pdf = os.path.join(tempfile.mkdtemp(), "petrin_selo.pdf")
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
    # linha de cima: EM BREVE (sem preço); linha de baixo: com preço
    page.insert_text((40, 120), "RD1033", fontsize=10)
    page.insert_text((320, 120), "RD1382", fontsize=10)
    page.insert_text((40, 420), "RD1546", fontsize=10)
    page.insert_text((150, 410), _preco(18.0), fontsize=10)
    page.insert_text((320, 420), "RD1547", fontsize=10)
    page.insert_text((430, 410), _preco(18.0), fontsize=10)
    doc.save(pdf)
    doc.close()
    produtos += [
        {"codigo": "RD1033", "preco": None, "emBreve": False, "paginaOrigem": 21},
        {"codigo": "RD1382", "preco": None, "emBreve": False, "paginaOrigem": 21},
        {"codigo": "RD1546", "preco": 18.0, "emBreve": True, "paginaOrigem": 21},
        {"codigo": "RD1547", "preco": 18.0, "emBreve": True, "paginaOrigem": 21},
    ]
    fixed, _ = ge._verify_prices_by_geometry(pdf, copy.deepcopy(produtos))
    by = {p["codigo"]: p for p in fixed}
    assert by["RD1033"]["emBreve"] and by["RD1382"]["emBreve"]
    assert not by["RD1546"]["emBreve"] and not by["RD1547"]["emBreve"]
    assert by["RD1546"]["preco"] == 18.0


# ── FOLIA: casar card por ordem ───────────────────────────────────────────

def test_folia_casa_card_pela_ordem_mesmo_com_escala_errada():
    cards = []
    for r, cy in enumerate((246, 442, 639)):
        for c, cx in enumerate((103, 298, 493)):
            cards.append({"cx": cx, "cy": cy, "rect": fitz.Rect(cx - 95, cy - 95, cx + 95, cy + 95), "id": (r, c)})
    skus = []
    for r, y in enumerate((173, 304, 434)):          # escala comprimida da visão
        for c, x in enumerate((107, 298, 488)):
            skus.append({"sku": f"S{r}{c}", "spatialContext": {"x": x, "y": y}})
    pares = cv._folia_cards_por_ordem(skus, cards)
    assert pares is not None
    assert all(s["sku"] == f"S{card['id'][0]}{card['id'][1]}" for s, card in pares)


def test_folia_ordem_nao_decide_quando_conta_nao_bate():
    cards = [{"cx": 100, "cy": 100, "rect": fitz.Rect(0, 0, 190, 190)}]
    skus = [{"sku": "A", "spatialContext": {"x": 1, "y": 1}}, {"sku": "B", "spatialContext": {"x": 2, "y": 2}}]
    assert cv._folia_cards_por_ordem(skus, cards) is None


# ── FOLIA: conferência do código pelo recorte do card ─────────────────────

class _RespostaFalsa:
    def __init__(self, texto):
        self.text = texto


class _ModeloFalso:
    resposta = ""

    def __init__(self, *_a, **_k):
        pass

    def generate_content(self, *_a, **_k):
        return _RespostaFalsa(self.resposta)


def test_codigo_miudo_corrigido_pelo_recorte_do_card(monkeypatch, tmp_path):
    pdf = str(tmp_path / "cards.pdf")
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 50, 50), False)
    pix.set_rect(pix.irect, (200, 120, 60))
    for i in range(3):
        page.insert_image(fitz.Rect(10 + i * 195, 200, 190 + i * 195, 390), pixmap=pix)
    doc.save(pdf)
    doc.close()
    _ModeloFalso.resposta = json.dumps({"cards": [
        {"i": 1, "codigo": "JRF-50.0365", "nome": "FORMA DE HAMBURGUER"},
        {"i": 2, "codigo": "JRF-50.0848", "nome": "ESPREMEDOR DE LARANJA"},
        {"i": 3, "codigo": "JRF-50.0040", "nome": "PRENDEDOR DE EMBALAGENS"},
    ]})
    import types
    falso = types.SimpleNamespace(GenerativeModel=_ModeloFalso, GenerationConfig=lambda **k: None)
    monkeypatch.setattr(ge, "genai", falso)
    produtos = [
        {"codigo": "JRF-50.0385", "nome": "FORMA DE HAMBURGUER"},
        {"codigo": "JRF-50.0848", "nome": "ESPREMEDOR DE LARANJA"},
        {"codigo": "JRF-50.0847", "nome": "PRENDEDOR DE EMBALAGENS"},
    ]
    ge._conferir_codigos_por_card(pdf, 1, produtos, "modelo")
    assert [p["codigo"] for p in produtos] == ["JRF-50.0365", "JRF-50.0848", "JRF-50.0040"]


# ── PETRIN: foto abaixo do código ─────────────────────────────────────────

def _img(x0, y0, x1, y1):
    r = fitz.Rect(x0, y0, x1, y1)
    return {"xref": 0, "rect": r, "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2, "area": r.width * r.height}


def _sku(code, x, y):
    return {"sku": code, "spatialContext": {"x": x, "y": y, "width": 39, "height": 12}}


def test_foto_abaixo_nao_e_roubada_pela_linha_de_baixo(monkeypatch):
    # Petrin pág. 62: 2 linhas, cada produto com a foto ~130pt ABAIXO do código
    salvos = []
    monkeypatch.setattr(cv, "_extract_perfect_image", lambda *a, **k: __import__("numpy").ones((5, 5, 3), "uint8"))
    monkeypatch.setattr(cv, "_save_image", lambda img, code, out: salvos.append(code) or f"{code}.jpg")
    # imagens reais da pág. 62 (frascos + caixa de cada produto)
    imgs = [_img(420, 220, 573, 372), _img(98, 608, 261, 758), _img(90, 211, 318, 365), _img(386, 583, 527, 760),
            _img(360, 257, 417, 365), _img(31, 654, 88, 752), _img(30, 243, 84, 355), _img(323, 651, 372, 754)]
    skus = [_sku("RD1891", 48, 84), _sku("RD1889", 343, 85), _sku("RD1890", 48, 469), _sku("RD1892", 344, 470)]
    import numpy as np
    raster = np.zeros((842, 595, 3), "uint8")
    matches, unmatched = cv._match_via_embedded(None, raster, skus, imgs, 1.0, "out", 62, orientacao="abaixo")
    assert not unmatched
    fotos = {m["sku"]: m for m in matches}
    assert set(fotos) == {"RD1891", "RD1889", "RD1890", "RD1892"}


def test_foto_larga_logo_abaixo_do_codigo(monkeypatch):
    # Petrin pág. 184: guarda-chuva aberto de 296pt, centro longe do código
    monkeypatch.setattr(cv, "_extract_perfect_image", lambda *a, **k: __import__("numpy").ones((5, 5, 3), "uint8"))
    monkeypatch.setattr(cv, "_save_image", lambda img, code, out: f"{code}.jpg")
    import numpy as np
    imgs = [_img(308, 178, 604, 412)]
    skus = [_sku("RD1147", 370, 73)]
    matches, unmatched = cv._match_via_embedded(None, np.zeros((842, 854, 3), "uint8"), skus, imgs, 1.0, "out", 184,
                                                orientacao="abaixo")
    assert [m["sku"] for m in matches] == ["RD1147"] and not unmatched


# ── DUTE: dono de cada imagem da foto composta ────────────────────────────

def test_dute_dono_de_cada_imagem():
    # pág. 17 e 179 do catálogo real (coordenadas medidas)
    skus = [_sku("DT10052", 56, 108), _sku("DT10232", 469, 108), _sku("DT10421", 233, 334)]
    imgs = {"caixa_10052": _img(117, 128, 219, 279), "painel_10052": _img(220, 37, 417, 278),
            "trem_10421": _img(381, 308, 682, 527), "caixa_10421": _img(217, 408, 381, 531),
            "rodape": _img(20, 557, 841, 596)}
    donos = cv._dute_dono_de_cada_imagem(skus, list(imgs.values()), 854.0)
    dono = {nome: donos.get(id(img), {}).get("sku") for nome, img in imgs.items()}
    assert dono == {"caixa_10052": "DT10052", "painel_10052": "DT10052",
                    "trem_10421": "DT10421", "caixa_10421": "DT10421", "rodape": None}

    skus = [_sku("DT10095", 78, 105), _sku("DT10096", 489, 105), _sku("DT10097", 228, 390)]
    patinhos = _img(554, 339, 706, 510)
    donos = cv._dute_dono_de_cada_imagem(skus, [patinhos], 854.0)
    assert donos[id(patinhos)]["sku"] == "DT10097"
