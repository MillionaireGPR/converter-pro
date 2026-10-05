"""Conferência do Josef de 29/09/2026 (Teste 9) — regressões da rodada.

Cada teste reproduz o formato do catálogo real em miniatura (texto ou PDF
gerado), sem rede.
"""
import fitz
import pytest

import gemini_extractor as ge


# ── template: nome ────────────────────────────────────────────────────────

GIRA_TPL = {
    "CODE": r"^([A-Z]{2}\d{3,4})",
    # sintetizado esperando o preço numa linha própria; na GIRA nova o preço
    # vem na mesma linha da caixa → o NOME nunca casava
    "NOME": r"(?s)^[A-Z]{2}\d{3,4}[-–]?\s*(.+?)\n(?:.+?CX\d+.*?\n)?\s*\d{1,2},\d{2}",
    "PRECO": r"\s*(\d{1,2},\d{2})\s*$",
    "QTD": r"CX(\d+)",
    "PRECO_FMT": "BR",
}


def test_gira_nome_da_propria_linha_e_sem_separador():
    txt = ("CASA E COZINHA\nTP1637- POTE VIDRO TAMPA DE BAMBU\n14*9cm       CX30     7,45\n"
           "TP1951 – KIT 3 POTES DE VIDRO\n  3 CORES    CX12     14,95\n"
           "KIT\nTP1823- JOGO 6 BOWLS VIDRO\n12*7*5cm    CX20JG        9,95\n")
    ps = {p["codigo"]: p for p in ge._apply_template([txt], GIRA_TPL)}
    assert ps["TP1637"]["nome"] == "POTE VIDRO TAMPA DE BAMBU"   # não "CASA E COZINHA"
    assert ps["TP1951"]["nome"] == "KIT 3 POTES DE VIDRO"        # não o do vizinho
    assert ps["TP1823"]["nome"] == "JOGO 6 BOWLS VIDRO"          # não "KIT"
    assert ps["TP1951"]["preco"] == 14.95 and ps["TP1951"]["quantidadeCaixa"] == 12


GOAL_TPL = {
    "CODE": r"^([A-Z]{2}\d{4})",
    "NOME": r"(?s)^[A-Z]{2}\d{4}\s*\n(.+?)\nQuant:",
    "PRECO": r"Preço:\s*R\$([\d.,]+)",
    "QTD": r"Quant:\s*(\d+)\s*PÇ/CX",
    "PRECO_FMT": "BR",
}

GOAL_TXT = (
    "Brinquedos\nGK2211\nBONECA C/ CASA E\nACESSÓRIOS\nQuant: 60 PÇ/CX\nPreço: R$24,99\n"
    "• Embalagem: Caixa\nGK3570\nBONECA COM HELI-\nCOPTERO\nQuant: 90 PÇ/CX\nPreço: R$16,50\n"
    "• Embalagem: Caixa\nGK0173-0\nBOLA TAM.5\nQuant: 60 PÇ/CX\nPreço: R$ 16,50\n"
    "GK3670\nBOLA DE FUTEBOL BRASIL-\nTAM 5.\nQuant: 60 PÇ/CX\nPreço: R$16,50\n"
    "GK2924 - PRETO\nPULA PULA C/ LUZ E SOM\nQuant: 24 PÇ/CX\nPreço: R$58,17\n"
)


def test_goal_nome_em_duas_linhas_hifen_e_sufixo_do_codigo():
    ps = {p["codigo"]: p for p in ge._apply_template([GOAL_TXT], GOAL_TPL)}
    assert ps["GK2211"]["nome"] == "BONECA C/ CASA E ACESSÓRIOS"   # não "Brinquedos"
    assert ps["GK3570"]["nome"] == "BONECA COM HELICOPTERO"        # palavra quebrada
    assert ps["GK3670"]["nome"] == "BOLA DE FUTEBOL BRASIL - TAM 5."  # hífen separador
    assert "GK0173-0" in ps and ps["GK0173-0"]["nome"] == "BOLA TAM.5"
    assert ps["GK0173-0"]["preco"] == 16.5                          # "R$ 16,50" com espaço
    assert ps["GK2924"]["nome"] == "PULA PULA C/ LUZ E SOM PRETO"


def test_asterisco_entre_digitos_fica():
    assert ge._ASTERISCO_SOLTO_RE.sub("", "PETISQUEIRA 49*15*1.2 B8460*B10152**") == \
        "PETISQUEIRA 49*15*1.2 B8460B10152"


# ── dedup ─────────────────────────────────────────────────────────────────

def test_dedup_mesmo_codigo_outro_produto():
    ps = [
        {"codigo": "5085", "nome": "MARMITA TERMICA", "preco": 31.92, "paginaOrigem": 42},
        {"codigo": "5085", "nome": "CABIDEIRO SIMPLES", "preco": 60.0, "paginaOrigem": 81},
        {"codigo": "5085", "nome": "MARMITA TERMICA", "preco": 31.92, "paginaOrigem": 99},
        {"codigo": "VTK-1", "nome": "URSOS 80 CM", "preco": 150.0, "paginaOrigem": 9},
        {"codigo": "VTK-1", "nome": "URSOS 80 CM", "preco": 174.0, "paginaOrigem": 10},
    ]
    out = ge._dedup_codigo_nome(ps)
    assert [(p["codigo"], p["paginaOrigem"]) for p in out] == [("5085", 42), ("5085", 81), ("VTK-1", 9), ("VTK-1", 10)]


# ── releitura do card ────────────────────────────────────────────────────

@pytest.mark.parametrize("pagina,card,esperado", [
    ("KIT COZINHA HORA DO LANCHE!", "KIT COZINHA", "KIT COZINHA"),
    ("CAIXA REGISTRADORA", "CAIXA REGISTRADORA A PILHA", "CAIXA REGISTRADORA A PILHA"),
    ("BLOCOS DE MONTAR - SAPATOS", "BLOCO DE MONTAR - SAPATOS", "BLOCO DE MONTAR - SAPATOS"),
    ("ABRIDOR DE GARRAFA", "ABRIODOR DE GARRAFA", None),   # grafia nova: não é este caso
    ("PANO", "PANO MULTIUSO - 25 UNIDADES - 24X20CM", None),  # nome de 1 palavra não cresce
])
def test_nome_do_card_por_palavras(pagina, card, esperado):
    assert ge._nome_do_card_por_palavras(pagina, card) == esperado


def test_card_mais_perto_desempata_nomes_iguais():
    rects = [fitz.Rect(10, 100, 200, 300), fitz.Rect(210, 100, 400, 300)]
    cands = [{"i": 1, "codigo": "JRF-50.0851"}, {"i": 2, "codigo": "JRF-50.0852"}]
    p = {"spatialContext": {"x": 300, "y": 842 - 290}}   # Y de baixo pra cima
    assert ge._card_mais_perto(p, cands, rects, 842)[0]["codigo"] == "JRF-50.0852"


# ── PDFs em miniatura ─────────────────────────────────────────────────────

def _pdf(tmp_path, itens):
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    for x, y, txt in itens:
        page.insert_text((x, y), txt, fontsize=9)
    path = tmp_path / "c.pdf"
    doc.save(path)
    return str(path)


def test_selo_off_vai_para_o_codigo_abaixo(tmp_path):
    # FORTAL: selo no alto da foto do card de baixo; a IA prendeu no de cima
    pdf = _pdf(tmp_path, [
        (163, 245, "018-01-GR"), (205, 312, "R$ 40,32"),
        (167, 345, "OFF"), (185, 345, "30%"),
        (163, 482, "F-10"), (186, 549, "R$ 73,92"),
    ])
    ps = [
        {"codigo": "018-01-GR", "paginaOrigem": 1, "preco": 40.32, "promocional": True, "observacoes": "21cm | OFF 30%"},
        {"codigo": "F-10", "paginaOrigem": 1, "preco": 73.92, "promocional": False},
    ]
    ge._conferir_selos_off(pdf, ps)
    assert ps[0]["promocional"] is False and "OFF" not in (ps[0]["observacoes"] or "")
    assert ps[1]["promocional"] is True


def test_selo_ja_com_desconto_abaixo_do_preco(tmp_path):
    # Lila: "JÁ COM DESCONTO" logo abaixo do preço do card
    pdf = _pdf(tmp_path, [
        (94, 720, "CÓD: LH426"), (253, 720, "R$ 18,00"), (243, 733, "JÁ COM DESCONTO"),
        (333, 720, "CÓD: LH881"), (477, 720, "R$10,00"),
    ])
    ps = [
        {"codigo": "LH426", "paginaOrigem": 1, "preco": 18.0, "promocional": False},
        {"codigo": "LH881", "paginaOrigem": 1, "preco": 10.0, "promocional": True},
    ]
    ge._conferir_selos_off(pdf, ps)
    assert ps[0]["promocional"] is True and ps[1]["promocional"] is False


def test_preco_un_abaixo_do_codigo(tmp_path):
    # Neo pág. 23: lista "código / R$x,xxUn." — a IA usava o preço de cima
    pdf = _pdf(tmp_path, [
        (137, 630, "R$ 5,98"),
        (155, 665, "135623"), (155, 673, "R$2,99Un."),
        (155, 689, "135631"), (155, 697, "R$3,33Un."),
    ])
    ps = [
        {"codigo": "135623", "paginaOrigem": 1, "preco": 5.98},
        {"codigo": "135631", "paginaOrigem": 1, "preco": 2.99},
    ]
    ge._preco_un_abaixo_do_codigo(pdf, ps)
    assert [p["preco"] for p in ps] == [2.99, 3.33]


def test_preco_do_jogo_quando_a_conta_fecha(tmp_path):
    pdf = _pdf(tmp_path, [(133, 625, "R$ 89,76 Jg. c/02 un."), (133, 649, "160873")])
    ps = [{"codigo": "160873", "paginaOrigem": 1, "preco": 44.88}]
    ge._preco_un_abaixo_do_codigo(pdf, ps)
    assert ps[0]["preco"] == 89.76


def test_atributos_do_bloco_tuka(tmp_path):
    itens, y, ps = [], 60, []
    for i in range(4):
        cod = f"62-3343-{20 + i}"
        itens += [(40, y, f"Cód. {cod}"), (40, y + 12, "Cx. com 96 UN."), (40, y + 24, "MÍN. 12 PÇS"), (40, y + 36, f"{20 + i} CM")]
        ps.append({"codigo": cod, "paginaOrigem": 1, "nome": "PANDAS", "preco": 9.0, "observacoes": None})
        y += 60
    pdf = _pdf(tmp_path, itens)
    ge._completar_atributos_do_bloco(pdf, ps)
    assert ps[0]["nome"] == "PANDAS 20 CM"
    assert ps[0]["observacoes"] == "MÍN. 12 PÇS; 20 CM"
