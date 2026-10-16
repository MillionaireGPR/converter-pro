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
