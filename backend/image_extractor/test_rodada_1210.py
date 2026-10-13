"""Teste 10 do Josef (12/10/2026) — dados. PDFs sintéticos, sem rede."""
import fitz

import cv_extractor as cv
import gemini_extractor as ge


def _pdf(tmp_path, paginas, nome="c.pdf"):
    doc = fitz.open()
    for desenhar in paginas:
        desenhar(doc.new_page(width=600, height=800))
    path = tmp_path / nome
    doc.save(path)
    return str(path)


def _texto(linhas, x=40, y0=60, passo=16):
    def desenhar(page):
        for i, ln in enumerate(linhas):
            page.insert_text((x, y0 + i * passo), ln, fontsize=10)
    return desenhar


def test_nome_do_arquivo_mantem_o_ponto():
    assert cv._nome_arquivo_do_codigo("1.6M") == "1.6M"
    assert cv._nome_arquivo_do_codigo("CF001/L12") == "CF001_L12"


def test_hifen_de_silaba_junta_a_palavra():
    vocab = {"MOTO": 3, "TAM": 2}
    assert ge._limpar_nome_template("CARRO C/ CONTROLE RE-\nMOTO", vocab) == "CARRO C/ CONTROLE REMOTO"
    assert ge._limpar_nome_template("BOLA BRASIL-\nTAM 5.", vocab) == "BOLA BRASIL - TAM 5."


def test_qtd_do_template_aceita_caixa_de_1_digito():
    tpl = {"CODE": r"^([A-Z]{2}\d{4})", "NOME": r"(?s)^[A-Z]{2}\d{4}[-\s]+(.+?)\n",
           "PRECO": r"(\d{1,3},\d{2})$", "QTD": r"CX(\d{2,3})(?:JG|KIT)?", "PRECO_FMT": "BR"}
    prods = ge._apply_template(["TP2028- JOGO 6PC TACA\n170ml CX8JG 29,95\n"], tpl)
    assert prods[0]["quantidadeCaixa"] == 8


def test_mesmo_codigo_com_variantes_vira_codigo_impresso():
    tpl = {"CODE": r"^(GK\d{4})", "NOME": r"(?s)^GK\d{4}\n(.+?)\n",
           "PRECO": r"R\$(\d{1,3},\d{2})", "QTD": r"Quant: (\d+)", "PRECO_FMT": "BR"}
    paginas = [
        "GK2924 - CINZA\nPULA PULA C/ LUZ E SOM\nQuant: 24 PC/CX\nPreco: R$58,17\n",
        "GK2924 - PRETO\nPULA PULA C/ LUZ E SOM\nQuant: 24 PC/CX\nPreco: R$58,17\n",
    ]
    prods = ge._apply_template(paginas, tpl)
    assert {p["codigo"] for p in prods} == {"GK2924 - CINZA", "GK2924 - PRETO"}
    assert all(p["nome"] == "PULA PULA C/ LUZ E SOM" for p in prods)


def test_cor_diferente_da_bolinha_sai_do_nome(tmp_path):
    def desenhar(page):
        page.insert_text((300, 60), "FESTAO METALIZADO", fontsize=10)
        page.insert_text((300, 76), "R$ 1,29 Un.", fontsize=10)
        for i, (cod, cor) in enumerate([("122157", (0.93, 0.75, 0.1)), ("122165", (0.7, 0.7, 0.7))]):
            x = 300 + i * 60
            page.draw_circle((x + 15, 100), 7, color=None, fill=cor)
            page.insert_text((x, 125), cod, fontsize=8)
    pdf = _pdf(tmp_path, [desenhar])
    prods = [
        {"codigo": "122157", "nome": "FESTAO METALIZADO VERDE ***CORES***", "paginaOrigem": 1},
        {"codigo": "122165", "nome": "FESTAO METALIZADO PRATA ***CORES***", "paginaOrigem": 1},
        {"codigo": "1", "nome": "X ***CORES***"}, {"codigo": "2", "nome": "Y ***CORES***"},
    ]
    ge._nomes_pelo_texto_da_pagina(pdf, prods)
    assert prods[0]["nome"] == "FESTAO METALIZADO ***CORES***"   # bolinha dourada ≠ VERDE
    assert prods[1]["nome"] == "FESTAO METALIZADO PRATA ***CORES***"  # bolinha prata = PRATA


def test_rotulo_acima_do_codigo_destroca_variantes(tmp_path):
    pdf = _pdf(tmp_path, [_texto(["ARVORE DE", "NATAL 90cm", "R$ 17,95 Un.", "VERDE", "119822", "NEVADO", "119709"])])
    prods = [
        {"codigo": "119709", "nome": "ARVORE DE NATAL 90cm VERDE ***CORES***", "paginaOrigem": 1},
        {"codigo": "119822", "nome": "ARVORE DE NATAL 90cm NEVADO ***CORES***", "paginaOrigem": 1},
    ]
    ge._nomes_pelo_texto_da_pagina(pdf, prods)
    assert prods[0]["nome"] == "ARVORE DE NATAL 90cm NEVADO ***CORES***"
    assert prods[1]["nome"] == "ARVORE DE NATAL 90cm VERDE ***CORES***"


def test_medida_no_nome_quando_a_linha_do_nome_tem_a_medida(tmp_path):
    pdf = _pdf(tmp_path, [_texto(["LV1027", "Pote hermetico redondo | 350ml", "Cx. 72 pcs",
                                  "LV1028", "Pote hermetico redondo | 550ml", "Cx. 72 pcs"])])
    prods = [
        {"codigo": "LV1027", "nome": "Pote hermetico redondo", "observacoes": "350ml, c/ tampa", "paginaOrigem": 1},
        {"codigo": "LV1028", "nome": "Pote hermetico redondo", "observacoes": "550ml, c/ tampa", "paginaOrigem": 1},
    ]
    ge._nomes_iguais_com_medida(pdf, prods)
    assert [p["nome"] for p in prods] == ["Pote hermetico redondo | 350ml", "Pote hermetico redondo | 550ml"]


def test_card_com_nome_repetido_nao_ganha_medida(tmp_path):
    pdf = _pdf(tmp_path, [_texto(["BOLHA DE SABAO PATO", "R$ 1,65 Un.", "149780", "26cm",
                                  "BOLHA DE SABAO PATO", "R$ 1,57 Un.", "149829", "15cm"])])
    prods = [
        {"codigo": "149780", "nome": "BOLHA DE SABAO PATO", "observacoes": "26cm", "paginaOrigem": 1},
        {"codigo": "149829", "nome": "BOLHA DE SABAO PATO", "observacoes": "15cm", "paginaOrigem": 1},
    ]
    ge._nomes_iguais_com_medida(pdf, prods)
    assert [p["nome"] for p in prods] == ["BOLHA DE SABAO PATO"] * 2


def test_codigo_repetido_mesmo_preco_vira_uma_linha(tmp_path):
    pdf = _pdf(tmp_path, [_texto(["TIARA TEAM BRIDE", "R$ 2,96 Un.", "151734"]),
                          _texto(["GU0144 TAPETE RETANG. 5,95", "GU0144 TAPETE OVAL 5,95"])])
    prods = [
        {"codigo": "151734", "nome": "TIARA TEAM BRIDE ***CORES***", "preco": 2.96, "paginaOrigem": 1},
        {"codigo": "151734", "nome": "TIARA TEAM BRIDE DOURADA ***CORES***", "preco": 2.96, "paginaOrigem": 1},
        {"codigo": "GU0144", "nome": "TAPETE RETANG.", "preco": 5.95, "paginaOrigem": 2},
        {"codigo": "GU0144", "nome": "TAPETE OVAL", "preco": 5.95, "paginaOrigem": 2},
    ]
    out = ge._unificar_codigo_repetido(pdf, prods)
    assert [p["nome"] for p in out if p["codigo"] == "151734"] == ["TIARA TEAM BRIDE ***CORES***"]
    assert len([p for p in out if p["codigo"] == "GU0144"]) == 2   # impresso 2x na página


def test_caixa_pelo_preco_do_kit_e_caixa_sem_apoio(tmp_path):
    pdf = _pdf(tmp_path, [_texto(["BOLA NATAL PLANA", "R$ 1,68 Un.", "R$ 20,16 Kit c/12 un.", "152781",
                                  "BALOES LETRAS", "R$ 1,16 Un.", "A", "157007"])])
    prods = [
        {"codigo": "152781", "nome": "BOLA NATAL PLANA", "preco": 1.68, "quantidadeCaixa": 1, "paginaOrigem": 1},
        {"codigo": "157007", "nome": "BALOES LETRAS A", "preco": 1.16, "quantidadeCaixa": 5, "paginaOrigem": 1},
    ]
    ge._caixa_pelo_texto(pdf, prods)
    assert [p["quantidadeCaixa"] for p in prods] == [12, 1]


def test_preco_do_pacote_impresso(tmp_path):
    pdf = _pdf(tmp_path, [_texto(["FITILHO BRANCO", "5mm - 10m", "R$ 4,89 Pct. c/10 rolos", "153508"])])
    prods = [{"codigo": "153508", "nome": "FITILHO BRANCO", "preco": 0.489, "paginaOrigem": 1}]
    ge._preco_do_pacote_impresso(pdf, prods)
    assert prods[0]["preco"] == 4.89


def test_ipi_sem_a_palavra_ipi_sai_e_ipi_do_bloco_entra(tmp_path):
    pdf = _pdf(tmp_path, [
        _texto(["Garrafa", "22,5", "7", "7", "COD GE0001", "R$7,99"]),
        _texto(["COLAR HAVAIANO", "IPI de 13% ja incluso", "R$ 4,89 Un.", "137553"]),
    ])
    prods = [
        {"codigo": "GE0001", "nome": "Garrafa", "preco": 7.99, "ipi": 7, "paginaOrigem": 1},
        {"codigo": "137553", "nome": "COLAR HAVAIANO", "preco": 4.89, "ipi": 0, "paginaOrigem": 2},
    ]
    ge._ipi_pelo_texto(pdf, prods)
    assert [p["ipi"] for p in prods] == [0, 13.0]


def test_promocao_sem_selo_na_pagina_desmarca(tmp_path):
    pdf = _pdf(tmp_path, [_texto(["Acucareiro Off-white", "COD PHA4504", "R$12,99", "R$ 6,99"]),
                          _texto(["TOALHA", "YM-09", "R$ 5,95", "OFF 20%"])])
    prods = [
        {"codigo": "PHA4504", "preco": 6.99, "promocional": True, "paginaOrigem": 1},
        {"codigo": "YM-09", "preco": 5.95, "promocional": True, "paginaOrigem": 2},
    ]
    ge._promocao_sem_selo(pdf, prods)
    assert [p["promocional"] for p in prods] == [False, True]


def test_em_breve_com_preco_isolado():
    prods = [{"codigo": f"RD{i}", "emBreve": True, "preco": None} for i in range(30)]
    prods.append({"codigo": "RD2108", "emBreve": True, "preco": 9.0})
    ge._em_breve_com_preco_isolado(prods)
    assert prods[-1]["emBreve"] is False
    poucos = [{"codigo": "DV003", "emBreve": True, "preco": 37.37}]
    ge._em_breve_com_preco_isolado(poucos)
    assert poucos[0]["emBreve"] is True
