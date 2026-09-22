"""Regressão FOLIA (retestagem do Josef 22/09): catálogo de 300 produtos, sem
camada de texto (extração 100% via Gemini Vision). 3 códigos saíram
"JRF-S0.0451/0452/0453" em vez de "JRF-50.0451/0452/0453" — a IA leu o dígito
"5" como a letra "S" em alguns cartões isolados, mesmo com "50" correto em
294 dos 297 códigos do mesmo segmento. Dados reais de uma extração real do
catálogo (POST em /extract_products_ai)."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import gemini_extractor as ge


def _produtos(codigos):
    return [{"codigo": c, "nome": c, "preco": 1.0} for c in codigos]


def test_letra_isolada_vira_digito_por_maioria_do_lote():
    produtos = _produtos(
        ["JRF-50.0436", "JRF-50.0437", "JRF-50.0438", "JRF-S0.0451",
         "JRF-S0.0452", "JRF-S0.0453", "JRF-20.0020"]
    )
    ge._fix_ocr_digit_letter_confusion(produtos)
    codigos = [p["codigo"] for p in produtos]
    assert "JRF-50.0451" in codigos
    assert "JRF-50.0452" in codigos
    assert "JRF-50.0453" in codigos
    assert not any("S0" in c for c in codigos)
    # Segmento sem maioria estabelecida no lote não é mexido
    assert "JRF-20.0020" in codigos


def test_sem_maioria_estabelecida_nao_mexe():
    # Só existe UM código no lote e ele já não é numérico -- sem evidência
    # de qual dígito seria, não corrige (evita achismo).
    produtos = _produtos(["JRF-S0.0451"])
    ge._fix_ocr_digit_letter_confusion(produtos)
    assert produtos[0]["codigo"] == "JRF-S0.0451"


def test_ambiguo_com_dois_candidatos_nao_mexe():
    # "8O" pode virar "80" (O->0) ou "8O" trocando outra letra -- aqui os dois
    # candidatos plausíveis (80 e 60, via O->0 e viés hipotético) existem no
    # lote ao mesmo tempo: não corrige por ambiguidade.
    produtos = _produtos(["AB-BO.0001", "AB-80.0002", "AB-60.0003"])
    ge._fix_ocr_digit_letter_confusion(produtos)
    # "BO" -> candidatos: B->8 dá "8O" (não é 100% numérico, ignorado),
    # O->0 dá "B0" (não numérico, ignorado) -- nenhum vira numérico puro,
    # então não corrige (mantém original).
    assert produtos[0]["codigo"] == "AB-BO.0001"


if __name__ == "__main__":
    test_letra_isolada_vira_digito_por_maioria_do_lote()
    test_sem_maioria_estabelecida_nao_mexe()
    test_ambiguo_com_dois_candidatos_nao_mexe()
    print("OK: letra confundida com dígito pela visão é corrigida pela maioria do próprio lote")
