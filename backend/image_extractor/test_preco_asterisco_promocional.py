"""Regressão BM36 (retestagem do Josef 22/09): preço com asterisco de rodapé
marcando promocional ("B8460*B10152**") sumia da exportação — o PRECO regex
sintetizado nunca viu essa variante na amostra e não batia com o "*" no meio,
então o produto ficava sem `preco` e caía como erro. Texto real da página 37
do catálogo BM36 (BM362346, "BOWL C/6 PORCELANA FASELIS 16CM")."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import gemini_extractor as ge

TPL = {
    "CODE": r"CD:\s*([A-Z0-9]{5,})\s*\n",
    "PRECO": r"B(\d+)B\d+",
    "QTD": r"CX:\s*(\d+)",
    "PRECO_FMT": "CENTS",
}

PAGE_37_RAW = (
    "COZINHA & UD\nPag: 005\n"
    "BOWL C/6 PORCELANA FASELIS 16CM BM36 \n"
    "CD: 7898712746896\nCD: BM362346 \nCX: 1\nB8460*B10152**\n"
    "BOWL C/6 PORCELANA SERRA 16CM BM3623 \n"
    "CD: 7898712746865\nCD: BM362343 \nCX: 1\nB8460B10152\n"
)


def test_preco_com_asterisco_promocional_sobrevive():
    # extract_via_template aplica .replace("*", "") no texto de cada página
    # ANTES de rodar os regex — é esse passo que este teste protege.
    page_texts = [PAGE_37_RAW.replace("*", "")]
    produtos = ge._apply_template(page_texts, TPL)
    alvo = next(p for p in produtos if p["codigo"] == "BM362346")
    assert alvo.get("preco") == 84.60, alvo


def test_sem_o_fix_o_preco_some(monkeypatch=None):
    # Prova o bug: SEM remover o "*" antes do regex, o produto fica sem preço.
    page_texts = [PAGE_37_RAW]
    produtos = ge._apply_template(page_texts, TPL)
    alvo = next(p for p in produtos if p["codigo"] == "BM362346")
    assert "preco" not in alvo, "regressão: o bug do asterisco deveria reproduzir aqui"


if __name__ == "__main__":
    test_preco_com_asterisco_promocional_sobrevive()
    test_sem_o_fix_o_preco_some()
    print("OK: preço com asterisco de rodapé sobrevive ao template (fix), e o bug reproduz sem ele")
