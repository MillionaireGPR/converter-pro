"""Prefixo de código que a IA tira (achado na Goal Kids: "GK1234" saía "1234").
O prefixo é medido na maioria do próprio lote, não vem de uma tabela por nome
de fornecedor (23/09/2026)."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import gemini_extractor as ge


def _lote(codigos):
    return [{"codigo": c} for c in codigos]


def test_completa_prefixo_da_maioria_do_lote():
    produtos = _lote([f"GK{n:04d}" for n in range(1000, 1012)] + ["1050", "1051"])
    ge._fix_missing_code_prefix(produtos)
    codigos = [p["codigo"] for p in produtos]
    assert "GK1050" in codigos and "GK1051" in codigos
    assert not any(c.isdigit() for c in codigos)


def test_catalogo_que_mistura_numerico_e_prefixo_nao_e_tocado():
    # Fortal tem códigos só-número de verdade ao lado de "BDZ-2523": sem
    # maioria de 80% de um prefixo, nada muda.
    produtos = _lote(["BDZ-2523", "BDZ-2524", "5085", "5086", "5087", "TL03"] * 3)
    antes = [p["codigo"] for p in produtos]
    ge._fix_missing_code_prefix(produtos)
    assert [p["codigo"] for p in produtos] == antes


def test_numero_com_outra_quantidade_de_digitos_nao_ganha_prefixo():
    produtos = _lote([f"GK{n:04d}" for n in range(1000, 1012)] + ["123456"])
    ge._fix_missing_code_prefix(produtos)
    assert produtos[-1]["codigo"] == "123456"


def test_separador_da_maioria_e_mantido():
    produtos = _lote([f"AB-{n:04d}" for n in range(2000, 2012)] + ["2050"])
    ge._fix_missing_code_prefix(produtos)
    assert produtos[-1]["codigo"] == "AB-2050"
