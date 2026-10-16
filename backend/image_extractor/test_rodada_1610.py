"""Teste 11 do Josef (16/10/2026) — DUTE sem planilha. Sem rede."""
import gemini_extractor as ge


def test_qtd_opcional_que_nao_casa_nao_derruba_o_template():
    # DUTE 13/10: o QTD sintetizado tinha o grupo opcional; quando não casava,
    # fm.group(1) era None e o TypeError derrubava a conversão inteira
    tpl = {"CODE": r"^(DT\d{5})", "NOME": r"(?s)^DT\d{5}\n(.+?)\n",
           "PRECO": r"R\$\s*([\d.,]+)", "QTD": r"Quant\. na caixa(?:\n(\d+))?", "PRECO_FMT": "BR"}
    prods = ge._apply_template(["DT10374\nCHOCALHO SENSORIAL\nQuant. na caixa\nR$ 20,00\n"], tpl)
    assert prods[0]["codigo"] == "DT10374"
    assert prods[0].get("quantidadeCaixa") is None


def test_erro_no_template_segue_para_o_texto(tmp_path, monkeypatch):
    import fitz
    doc = fitz.open()
    for _ in range(31):
        doc.new_page().insert_text((40, 60), "DT10374\nCHOCALHO\nR$ 20,00", fontsize=10)
    pdf = str(tmp_path / "c.pdf")
    doc.save(pdf)

    def quebra(*a, **k):
        raise TypeError("template quebrado")

    monkeypatch.setattr(ge, "extract_via_template", quebra)
    monkeypatch.setattr(ge, "_ensure_supplier_profile", lambda *a, **k: None)
    monkeypatch.setattr(ge, "camada_de_texto_inutil", lambda *a, **k: False)
    monkeypatch.setattr(ge, "extract_with_fallback_text_chunked",
                        lambda *a, **k: {"success": True, "produtos": [], "model": "texto"})
    monkeypatch.setattr(ge, "extract_products_with_gemini",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("visão do PDF inteiro")))
    assert ge._extract_with_fallback_impl(pdf, "X", "")["model"] == "texto"


def test_codigo_com_mais_digitos_que_o_template_nao_e_cortado():
    tpl = {"CODE": r"CD: (WC\d{6})", "NOME": "NONE", "PRECO": r"B(\d{4})B\d{4}B\d{4}",
           "QTD": r"CX: (\d+)", "PRECO_FMT": "CENTS"}
    prods = ge._apply_template(["CD: 7898681267538\nCD: WC4010003 \nCX: 60\nB2760B3312B3643\n"], tpl)
    assert [p["codigo"] for p in prods] == ["WC4010003"]


def test_muito_mais_caixas_que_codigos_derruba_o_template():
    paginas = ["CD: BM361601\nCX: 50\n" + "".join(f"CD: WC40{i:05d}\nCX: 10\n" for i in range(12))]
    tpl = {"CODE": r"CD: (BM\d{6})", "QTD": r"CX: (\d+)"}
    assert ge._codigos_fora_do_template(paginas, tpl, [{"codigo": "BM361601"}])
    assert ge._codigos_fora_do_template(["CD: BM361601\nCX: 50\n"], tpl, [{"codigo": "BM361601"}]) is None


def test_produto_sem_preco_com_preco_no_bloco_rele_a_pagina():
    goal = {"PRECO": r"Preço:\s*R\$?\s*([\d.,]+)"}
    assert ge._paginas_com_preco_perdido(
        ["GK3733\nKIT COELHOS\nQuant: 36 PÇ/CX\nPreço: 48,34\n"], goal, [{"codigo": "GK3733", "paginaOrigem": 1}]) == {1}
    bm36 = {"PRECO": r"B(\d{4})B\d{4}B\d{4}"}
    assert ge._paginas_com_preco_perdido(
        ["CD: BM361542\nCX: 50\nB990B1188B1307\n"], bm36, [{"codigo": "BM361542", "paginaOrigem": 1}]) == {1}
    # EM BREVE sem preço impresso não gasta releitura
    assert ge._paginas_com_preco_perdido(
        ["DT10133\nEM BREVE\nQuant 12\n"], {"PRECO": r"R\$ ([\d,]+)"}, [{"codigo": "DT10133", "paginaOrigem": 1}]) == set()


def test_prefixo_prom50_vira_promocao():
    prods = ge._prefixo_promocional_no_nome([{"nome": "(PROM50%)COLHER CAFÉ"}, {"nome": "(PRO50%)ENF.TORRE"}, {"nome": "GARFO"}])
    assert [(p["nome"], p.get("promocional")) for p in prods] == [
        ("COLHER CAFÉ", True), ("ENF.TORRE", True), ("GARFO", None)]


def test_codigo_so_numero_impresso_assim_nao_ganha_prefixo(tmp_path):
    import fitz
    doc = fitz.open()
    doc.new_page().insert_text((40, 60), "CD: 439890\nCD: BM123456", fontsize=10)
    pdf = str(tmp_path / "c.pdf")
    doc.save(pdf)
    prods = [{"codigo": f"BM{100000 + i}"} for i in range(12)] + [{"codigo": "439890"}, {"codigo": "123456"}]
    ge._fix_missing_code_prefix(prods, pdf)
    assert prods[-2]["codigo"] == "439890"
    assert prods[-1]["codigo"] == "BM123456"


def test_selo_de_texto_fica_com_o_codigo_mais_perto(tmp_path):
    import fitz
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((40, 200), "AGUARDANDO REPOSIÇÃO", fontsize=8)
    page.insert_text((40, 206), "CD: WC411111", fontsize=8)
    page.insert_text((220, 690), "CD: BM363057", fontsize=8)
    pdf = str(tmp_path / "c.pdf")
    doc.save(pdf)
    prods = [{"codigo": "WC411111", "nome": "DIFUSOR ***AGUARDANDO REPOSIÇÃO***", "paginaOrigem": 1},
             {"codigo": "BM363057", "nome": "REFIL ***AGUARDANDO REPOSIÇÃO***", "paginaOrigem": 1}]
    ge._marcador_de_selo_do_vizinho(pdf, prods)
    assert prods[0]["nome"] == "DIFUSOR ***AGUARDANDO REPOSIÇÃO***"
    assert prods[1]["nome"] == "REFIL"


def _pdf_texto(tmp_path, linhas, nome="n.pdf"):
    import fitz
    doc = fitz.open()
    page = doc.new_page(width=600, height=1400)
    for i, ln in enumerate(linhas):
        page.insert_text((40, 40 + i * 14), ln, fontsize=9)
    path = str(tmp_path / nome)
    doc.save(path)
    return path


def test_preco_unico_da_linha_do_codigo_vale(tmp_path):
    pdf = _pdf_texto(tmp_path, ["PEGA BALAO", "R$ 0,89 Un.", "R$ 21,25 Pct. c/24 un.", "148300",
                                "TRANSPARENTE | R$ 44,50 c/50un. | 156566",
                                "10cm | R$34,90 c/50un. | 131296"])
    prods = [{"codigo": "148300", "preco": 0.89, "paginaOrigem": 1},
             {"codigo": "156566", "preco": 0.89, "paginaOrigem": 1},
             {"codigo": "131296", "preco": 0.698, "paginaOrigem": 1}]
    ge._preco_do_pacote_impresso(pdf, prods)
    assert [p["preco"] for p in prods] == [0.89, 44.5, 34.9]


def test_caixa_e_o_numero_de_pacotes_do_kit(tmp_path):
    pdf = _pdf_texto(tmp_path, ["RAQUETE", "R$ 14,90 Pct. c/ 02 raquetes", "R$ 59,60 Kit c/04 pct.", "150266",
                                "BANDEIRINHA", "R$ 6,28 Pct.", "R$ 37,68 c/06 pct.", "10 bandeiras",
                                "ARGENTINA | 145262", "CANADA | 119628"])
    prods = [{"codigo": "150266", "preco": 14.9, "quantidadeCaixa": 2, "paginaOrigem": 1},
             {"codigo": "145262", "preco": 6.28, "quantidadeCaixa": 1, "paginaOrigem": 1},
             {"codigo": "119628", "preco": 6.28, "quantidadeCaixa": 1, "paginaOrigem": 1}]
    ge._caixa_do_kit_impresso(pdf, prods)
    assert [p["quantidadeCaixa"] for p in prods] == [4, 6, 6]


def test_tarja_esgotado_em_texto_e_do_codigo_mais_perto(tmp_path):
    import fitz
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((40, 100), "135801 R$ 7,97Un.", fontsize=9)
    page.insert_text((40, 300), "135828 R$ 5,97Un.", fontsize=9)
    page.insert_text((45, 108), "ESGOTADO", fontsize=9)
    pdf = str(tmp_path / "e.pdf")
    doc.save(pdf)
    prods = [{"codigo": "135801", "nome": "CORTINA", "preco": 7.97, "paginaOrigem": 1},
             {"codigo": "135828", "nome": "CORTINA", "preco": 5.97, "paginaOrigem": 1, "emBreve": True}]
    ge._marcador_de_selo_do_vizinho(pdf, prods)
    assert prods[0].get("esgotado") is True
    assert not prods[1].get("esgotado") and prods[1]["emBreve"] is False


def test_cores_so_em_produto_com_mais_de_uma_cor():
    prods = [{"codigo": c, "nome": n, "paginaOrigem": 1} for c, n in (
        ("1", "FITILHO 5mm VERMELHO ***CORES***"), ("2", "FITILHO 5mm AZUL ***CORES***"),
        ("3", "DENTADURA BRANCA ***CORES***"), ("4", "DENTADURA CORES SORTIDAS ***CORES***"),
        ("5", "PRESÉPIO OURO VELHO P/MESA ***CORES***"))]
    ge._cores_so_em_variantes(prods)
    nomes = {p["codigo"]: (p["nome"], p.get("observacoes")) for p in prods}
    assert nomes["1"] == ("FITILHO 5mm ***CORES***", "Cor: VERMELHO")
    assert nomes["2"] == ("FITILHO 5mm ***CORES***", "Cor: AZUL")
    assert nomes["3"][0] == "DENTADURA BRANCA"
    assert nomes["5"][0] == "PRESÉPIO OURO VELHO P/MESA"
