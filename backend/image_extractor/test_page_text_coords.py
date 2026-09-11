# -*- coding: utf-8 -*-
"""
Trava o texto COM COORDENADA que a IA lê (11/09/2026).

Sem ele, `page.get_text()` entrega a página em ordem de leitura e o catálogo
em grade perde a relação preço↔produto: no Dute Toys os 4 códigos saem em
sequência e os selos de preço vêm todos soltos depois, sem nada dizendo de
quem é cada um. Medido com a API real do Gemini nas págs 5-10 do catálogo do
cliente: texto puro acertou 12/24 preços, com coordenada acertou 24/24. No
TUKA TOYS o texto puro trocou os 4 preços da amostra entre si; com coordenada,
os 4 certos.

Roda com: python -m pytest test_page_text_coords.py -q
"""
import re

import fitz
import pytest

from gemini_extractor import COORD_PROMPT_HINT, page_text_for_ai


def _pagina(desenhar):
    """PDF de 1 página em memória, montado pelo teste."""
    doc = fitz.open()
    pagina = doc.new_page(width=595, height=842)
    desenhar(pagina)
    return pagina


def test_cada_trecho_sai_com_sua_coordenada():
    pagina = _pagina(lambda p: p.insert_text((72, 100), "DT10019"))
    linha = page_text_for_ai(pagina).splitlines()[0]
    assert re.match(r"^\[\d+,\d+\] DT10019$", linha), linha


def test_precos_de_colunas_diferentes_nao_viram_um_texto_so():
    """O bug que trocava os preços do Dute: dois selos na mesma altura, em
    colunas opostas, colavam num trecho único e perdiam a posição."""
    def desenhar(p):
        p.insert_text((43, 290), "R$ 5,00")    # coluna esquerda
        p.insert_text((459, 290), "R$ 5,50")   # coluna direita

    saida = page_text_for_ai(_pagina(desenhar))
    assert "[43,2" in saida.replace("R$ 5,00", "") or "R$ 5,00" in saida
    linhas = [l for l in saida.splitlines() if "R$" in l]
    assert len(linhas) == 2, f"os dois preços tinham que ficar separados: {linhas}"
    esq = next(l for l in linhas if "5,00" in l)
    dir_ = next(l for l in linhas if "5,50" in l)
    x_esq = int(re.match(r"\[(\d+),", esq).group(1))
    x_dir = int(re.match(r"\[(\d+),", dir_).group(1))
    assert x_dir - x_esq > 300, "as colunas precisam continuar distinguíveis pelo X"


def test_rotulo_e_valor_colados_continuam_juntos():
    """Trechos vizinhos na mesma linha são um campo só — quebrar 'IPI 6,5%'
    em dois só aumentaria o texto sem informar nada."""
    def desenhar(p):
        p.insert_text((36, 121), "IPI")
        p.insert_text((52, 121), "6,5%")

    saida = page_text_for_ai(_pagina(desenhar))
    assert any("IPI 6,5%" in l for l in saida.splitlines()), saida


def test_ordem_e_a_da_leitura_humana_nao_a_do_arquivo():
    """O PDF pode guardar o preço depois de tudo; a saída tem que trazer o que
    está mais ACIMA primeiro, que é como a página é lida de verdade."""
    def desenhar(p):
        p.insert_text((36, 400), "DT10020")   # inserido primeiro, mas embaixo
        p.insert_text((36, 100), "R$ 9,00")   # inserido depois, mas em cima

    linhas = page_text_for_ai(_pagina(desenhar)).splitlines()
    assert "R$ 9,00" in linhas[0]
    assert "DT10020" in linhas[1]


def test_pagina_sem_texto_nao_quebra():
    assert page_text_for_ai(_pagina(lambda p: None)) == ""


def test_prompt_explica_as_coordenadas_a_ia():
    """A coordenada só serve se a IA souber o que fazer com ela."""
    assert "[X,Y]" in COORD_PROMPT_HINT
    assert "coluna" in COORD_PROMPT_HINT.lower()
    # E precisa impedir o modelo de despejar a coordenada dentro do JSON.
    assert "não as copie" in COORD_PROMPT_HINT.lower()


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
