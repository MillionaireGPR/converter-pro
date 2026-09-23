"""Regressão: aviso de nome duplicado no lote (GIRA, 16/09/2026).

Confirmado direto no status.json de um job real de produção (GIRA
Utilidades): GU0132/TP1679/TP2003, todos "KIT 6 PORTA-COPOS BAMBU", saíram
com os preços rotacionados entre si (GU0132 pegou o preço do TP1679, TP1679
o do TP2003, TP2003 o do GU0132). O prompt já pede atenção redobrada nesse
caso, mas isso sozinho não garante acerto -- por isso o resultado também
fica marcado, pra dar pra auditar sem precisar do catálogo de novo.
"""
import gemini_extractor as ge


def test_marca_grupo_de_nome_identico():
    produtos = [
        {"codigo": "GU0132", "nome": "KIT 6 PORTA-COPOS BAMBU", "preco": 8.45},
        {"codigo": "TP1679", "nome": "KIT 6 PORTA-COPOS BAMBU", "preco": 5.45},
        {"codigo": "TP2003", "nome": "KIT 6 PORTA-COPOS BAMBU", "preco": 6.95},
        {"codigo": "TP1892", "nome": "BLOCO 100FLS FORMAS", "preco": 2.45},
    ]
    avisos = ge._marcar_nomes_duplicados(produtos)
    assert len(avisos) == 1
    assert avisos[0]["nome"] == "KIT 6 PORTA-COPOS BAMBU"
    assert set(avisos[0]["codigos"]) == {"GU0132", "TP1679", "TP2003"}


def test_nomes_diferentes_nao_geram_aviso():
    produtos = [
        {"codigo": "A1", "nome": "PRODUTO A", "preco": 10},
        {"codigo": "B1", "nome": "PRODUTO B", "preco": 20},
    ]
    assert ge._marcar_nomes_duplicados(produtos) == []


def test_comparacao_de_nome_ignora_maiusculas_minusculas():
    produtos = [
        {"codigo": "X1", "nome": "kit beleza", "preco": 5},
        {"codigo": "X2", "nome": "KIT BELEZA", "preco": 7},
    ]
    avisos = ge._marcar_nomes_duplicados(produtos)
    assert len(avisos) == 1
    assert set(avisos[0]["codigos"]) == {"X1", "X2"}


def test_extract_with_fallback_anexa_avisos_ao_resultado(monkeypatch):
    produtos = [
        {"codigo": "GU0132", "nome": "KIT 6 PORTA-COPOS BAMBU", "preco": 8.45},
        {"codigo": "TP1679", "nome": "KIT 6 PORTA-COPOS BAMBU", "preco": 5.45},
    ]
    monkeypatch.setattr(
        ge, "_extract_with_fallback_impl",
        lambda pdf_path, supplier="", client_rules="": {"success": True, "produtos": produtos},
    )
    monkeypatch.setattr(ge, "_fix_missing_code_prefix", lambda produtos: produtos)
    monkeypatch.setattr(ge, "_fix_labeled_unit_prices", lambda pdf_path, produtos: produtos)

    resultado = ge.extract_with_fallback("catalogo.pdf", supplier="GIRA")
    assert len(resultado["avisosNomeDuplicado"]) == 1
    assert set(resultado["avisosNomeDuplicado"][0]["codigos"]) == {"GU0132", "TP1679"}


print("OK: nomes duplicados no lote ficam sinalizados no resultado do job")
