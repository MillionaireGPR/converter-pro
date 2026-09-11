# -*- coding: utf-8 -*-
"""
Trava a detecção de catálogo SEM produtos na camada de texto (11/09/2026).

Incidente FOLIA BRINQUEDOS: o PDF tem camada de texto, mas ela só contém a
marca d'água de fundo ("FOLIA IMPORTS · UTILIDADES E BRINQUEDOS", ladrilhada)
— código, nome e preço fazem parte da ARTE. O texto das páginas 5, 10 e 20 é
byte a byte o mesmo. O caminho text-chunked então "achou" 18 produtos cujos
códigos eram os NÚMEROS DE PÁGINA (18, 19, 20, 30, 31…), e o cliente recebeu
"18 produtos / 0 importados com sucesso / 18 erros".

O critério NÃO pode ser volume de texto: o TUKA TOYS tem ~100 chars úteis por
página e extrai 335 produtos sem problema. O que separa os casos é a presença
de SINAL de produto (um preço ou um código).

Medido nos catálogos reais do cliente:
    FOLIA    0/45   páginas com sinal  ( 0%) → visão
    FORTAL  86/108  páginas com sinal  (80%) → texto
    DUTE   191/197  páginas com sinal  (97%) → texto
    TUKA   177/178  páginas com sinal  (99%) → texto

Roda com: python -m pytest test_camada_texto.py -q
"""
import fitz
import pytest

from gemini_extractor import (
    MIN_PAGINAS_COM_SINAL_FRAC,
    camada_de_texto_inutil,
    texto_util_por_pagina,
)

MARCA_DAGUA = "FOLIA IMPORTS UTILIDADES E BRINQUEDOS"


def _doc(paginas):
    """PDF em memória: `paginas` é uma lista de listas de linhas."""
    doc = fitz.open()
    for linhas in paginas:
        pagina = doc.new_page(width=595, height=842)
        for i, linha in enumerate(linhas):
            pagina.insert_text((50, 60 + i * 18), linha)
    return doc


def test_marca_dagua_repetida_nao_conta_como_texto_util():
    """Era ela que dava a ilusão de que o PDF da FOLIA tinha texto."""
    doc = _doc([[MARCA_DAGUA, "5"] for _ in range(10)])
    uteis = texto_util_por_pagina(doc)
    assert all(MARCA_DAGUA not in t for t in uteis), uteis


def test_catalogo_so_com_marca_dagua_vai_pra_visao():
    # Exatamente a FOLIA: moldura repetida + o número da página, nada mais.
    doc = _doc([[MARCA_DAGUA, str(n)] for n in range(1, 21)])
    assert camada_de_texto_inutil(doc) is True


def test_pagina_enxuta_com_preco_e_codigo_continua_no_texto():
    """O TUKA tem pouquíssimo texto por página e funciona — não pode ir
    pra visão só por ser enxuto."""
    doc = _doc([
        [MARCA_DAGUA, f"Cód. VTK-33-231{n:02d}-35U", "Cx. com 204 UN.", f"1{n},50", "cada"]
        for n in range(20)
    ])
    assert camada_de_texto_inutil(doc) is False


def test_so_preco_ja_basta_de_sinal():
    doc = _doc([[MARCA_DAGUA, f"R$ {n},90"] for n in range(10, 20)])
    assert camada_de_texto_inutil(doc) is False


def test_so_codigo_ja_basta_de_sinal():
    doc = _doc([[MARCA_DAGUA, f"DT100{n}"] for n in range(10, 20)])
    assert camada_de_texto_inutil(doc) is False


def test_linha_identica_em_toda_pagina_e_moldura_mesmo_parecendo_produto():
    """Consequência deliberada de tirar a moldura ANTES de procurar sinal: um
    rodapé fixo (CNPJ, telefone, "a partir de R$ 9,90") não pode fazer um
    catálogo de arte passar por catálogo com texto — foi para não depender
    desse tipo de acidente que a moldura sai primeiro."""
    doc = _doc([[MARCA_DAGUA, "CNPJ 12.345.678/0001-99", str(n)] for n in range(1, 21)])
    assert camada_de_texto_inutil(doc) is True


def test_minoria_de_paginas_com_texto_nao_salva_o_catalogo():
    """Duas páginas de condições comerciais no fim não fazem de um catálogo
    de arte um catálogo com texto."""
    paginas = [[MARCA_DAGUA, str(n)] for n in range(1, 19)]
    paginas += [[MARCA_DAGUA, "Pedido mínimo R$ 500,00", "Prazo 30,00 dias"]] * 2
    assert camada_de_texto_inutil(_doc(paginas)) is True


def test_pdf_vazio_vai_pra_visao_em_vez_de_estourar():
    assert camada_de_texto_inutil(fitz.open()) is True


def test_limite_deixa_margem_folgada_entre_os_casos_reais():
    """FOLIA ficou em 0% e o pior caso bom (FORTAL) em 80%: o limite tem que
    viver bem longe dos dois."""
    assert 0.05 < MIN_PAGINAS_COM_SINAL_FRAC < 0.70


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
