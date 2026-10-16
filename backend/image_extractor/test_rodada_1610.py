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
