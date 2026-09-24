"""Regressão BM36 (Josef, 23/09/2026) no caminho TEMPLATE.

1. BM361548 não tem a linha "CD: <EAN>" que ancora o NOME sintetizado e
   pegava o nome do PRÓXIMO produto ("KIT ALIMENTAÇÃO INFANTIL SAPO...").
   O lado do nome (antes/depois do código) agora é medido no catálogo.
2. Os ímãs "CD: GH-1" / "CD: GH-2BI" ficavam fora: o CODE regex aprendido
   na amostra só cobria BM/WC. Códigos com o mesmo rótulo e preço no bloco
   entram; a linha "CD: <EAN>" (sem preço até o próximo código) não.
"""
import gemini_extractor as ge

TPL = {
    "CODE": r"CD: (BM\d{6}|WC\d{6,7})",
    "NOME": r"(?P<nome>[A-Z0-9\s.,\/&-]+?)\s*\nCD: \d{13}",
    "PRECO": r"B(\d+)B\d+",
    "QTD": r"CX: (\d+)",
    "PRECO_FMT": "CENTS",
}


def _bloco(nome, codigo, preco, ean="7908733601170"):
    ean_linha = f"CD: {ean}\n" if ean else ""
    return f"{nome} \n{ean_linha}CD: {codigo} \nCX: 30\nB{preco}B{preco + 100}\n"


def _pagina(blocos):
    return "".join(blocos)


def test_produto_sem_ean_nao_pega_nome_do_vizinho():
    blocos = [_bloco(f"PRODUTO NORMAL {i}", f"BM36{1000 + i}", 1000 + i) for i in range(12)]
    blocos.insert(6, _bloco("COLHER INOX BALEIA C/6 PCS DOURADA", "BM361548", 2880, ean=None))
    produtos = {p["codigo"]: p for p in ge._apply_template([_pagina(blocos)], TPL)}
    assert produtos["BM361548"]["nome"] == "COLHER INOX BALEIA C/6 PCS DOURADA"
    assert produtos["BM361548"]["preco"] == 28.8
    for i in range(12):
        assert produtos[f"BM36{1000 + i}"]["nome"] == f"PRODUTO NORMAL {i}"


def test_codigo_fora_do_padrao_com_mesmo_rotulo_entra():
    blocos = [_bloco(f"PRODUTO NORMAL {i}", f"BM36{1000 + i}", 1000 + i) for i in range(20)]
    blocos.insert(3, _bloco("ENFEITE PARA GELADEIRA COM IMA", "GH-1", 543, ean="6952073300010"))
    blocos.insert(4, _bloco("ENFEITE DE GELADEIRA COM IMA 21X16CM", "GH-2BI", 543, ean="6952073300027"))
    produtos = {p["codigo"]: p for p in ge._apply_template([_pagina(blocos)], TPL)}
    assert produtos["GH-1"]["preco"] == 5.43
    assert produtos["GH-1"]["nome"] == "ENFEITE PARA GELADEIRA COM IMA"
    assert produtos["GH-2BI"]["nome"] == "ENFEITE DE GELADEIRA COM IMA 21X16CM"
    # a linha de EAN tem o mesmo rótulo, mas não tem preço antes do próximo código
    assert not any(c.isdigit() and len(c) == 13 for c in produtos)
    assert len(produtos) == 22


def test_rotulo_generico_demais_nao_inventa_produto():
    # CODE sem rótulo com letras: não há como separar código de outra linha.
    tpl = dict(TPL, CODE=r"^(BM\d{6})")
    texto = "BM361000\nCX: 30\nB1000B1100\nXYZ-9\nCX: 30\nB2000B2100\n"
    produtos = ge._apply_template([texto], tpl)
    assert [p["codigo"] for p in produtos] == ["BM361000"]


def test_prefixo_do_codigo():
    assert ge._prefixo_do_codigo(r"CD: (BM\d{6}|WC\d{6,7})") == "CD: "
    assert ge._prefixo_do_codigo(r"(?:C[OÓ]D)\.?:?\s*(?P<c>\w+)") == r"(?:C[OÓ]D)\.?:?\s*"
    assert ge._prefixo_do_codigo(r"[(]x[)]") is None
