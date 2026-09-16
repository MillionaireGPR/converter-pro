# -*- coding: utf-8 -*-
"""
Trava os sinais de layout que o sistema passou a MEDIR em vez de assumir
(16/09/2026 — catálogos PETRIN, LEVIVAN e FORTAL).

Contexto: cada fornecedor novo vinha virando um `if fornecedor == X` no
código, e o que já funcionava quebrava quando o layout do próximo não batia
com a premissa embutida. Estes testes travam as três medições genéricas que
substituíram essas premissas.

Roda com: python -m pytest test_layout_autodetect.py -q
"""
import fitz
import numpy as np
import pytest

from cv_extractor import _avaliar_direcao, _costurar_tiles
from gemini_extractor import _sanear_codigo_duplo


def _img(xref, x0, y0, x1, y1):
    r = fitz.Rect(x0, y0, x1, y1)
    return {"xref": xref, "rect": r, "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2,
            "area": r.width * r.height}


def _sku(code, x, y):
    return {"sku": code, "name": code, "spatialContext": {"x": x, "y": y}}


# ── Fatias contíguas (LEVIVAN LV1052) ────────────────────────────────────────

def test_fatias_contiguas_da_mesma_foto_viram_uma_imagem_so():
    """LV1052 (pág. 20): o exportador cortou a foto do conjunto em duas tiras
    coladas — mesma faixa Y, bordas se encostando. Salvar só uma delas era o
    'ta pegando só parte do produto' do Josef."""
    esquerda = _img(885, 27.8, 373.5, 241.2, 660.3)
    direita = _img(884, 240.4, 373.5, 553.2, 660.3)

    out = _costurar_tiles([esquerda, direita])

    assert len(out) == 1
    costurada = out[0]
    assert costurada.get("tiles")
    assert costurada["rect"].x0 == pytest.approx(27.8, abs=0.1)
    assert costurada["rect"].x1 == pytest.approx(553.2, abs=0.1)


def test_ordem_das_fatias_no_pdf_nao_importa():
    """O PDF lista as fatias em ordem arbitrária; a da direita pode vir
    primeiro. Foi o que fez a primeira versão do costurador não disparar."""
    direita = _img(884, 240.4, 373.5, 553.2, 660.3)
    esquerda = _img(885, 27.8, 373.5, 241.2, 660.3)

    assert len(_costurar_tiles([direita, esquerda])) == 1


def test_dois_produtos_lado_a_lado_nao_sao_costurados():
    """Num layout de duas colunas sempre há um vão entre as fotos. Costurar
    aqui juntaria dois produtos diferentes numa imagem só."""
    prod_a = _img(1, 20.0, 100.0, 200.0, 300.0)
    prod_b = _img(2, 320.0, 100.0, 500.0, 300.0)  # vão de 120pt

    assert len(_costurar_tiles([prod_a, prod_b])) == 2


def test_imagens_na_mesma_coluna_mas_faixas_diferentes_nao_sao_costuradas():
    de_cima = _img(1, 20.0, 100.0, 200.0, 300.0)
    de_baixo = _img(2, 20.0, 305.0, 200.0, 500.0)

    assert len(_costurar_tiles([de_cima, de_baixo])) == 2


# ── Orientação do layout (PETRIN) ────────────────────────────────────────────

def test_layout_petrin_e_explicado_por_foto_abaixo_do_codigo():
    """PETRIN: código + nome + specs no topo do bloco, foto embaixo. Sob a
    hipótese 'foto acima' a primeira linha da página fica órfã (não há nada
    acima dela além do cabeçalho), então ela explica MENOS SKUs."""
    skus = [_sku("RD1444", 28.3, 70.9), _sku("RD1904", 221.5, 69.9),
            _sku("RD1561", 429.4, 71.4)]
    fotos = [_img(162, 83.7, 164.8, 200.3, 393.5),
             _img(166, 294.5, 175.8, 394.2, 395.9),
             _img(170, 481.5, 165.2, 555.7, 392.1)]

    n_acima, _ = _avaliar_direcao(skus, fotos, "acima")
    n_abaixo, _ = _avaliar_direcao(skus, fotos, "abaixo")

    assert n_abaixo == 3
    assert n_acima < n_abaixo


def test_layout_classico_continua_sendo_explicado_por_foto_acima():
    """Catálogo clássico (foto em cima, legenda embaixo) — LEVIVAN mede assim
    em 23 de 23 páginas. Não pode ser reinterpretado."""
    skus = [_sku("LV1007", 40.0, 250.0), _sku("LV1008", 330.0, 250.0)]
    fotos = [_img(896, 24.0, 52.0, 290.0, 229.0),
             _img(892, 315.0, 45.0, 561.0, 232.0)]

    n_acima, _ = _avaliar_direcao(skus, fotos, "acima")
    n_abaixo, _ = _avaliar_direcao(skus, fotos, "abaixo")

    assert n_acima == 2
    assert n_abaixo < n_acima


# ── Código duplo no mesmo card (FORTAL) ──────────────────────────────────────

def test_dois_codigos_separados_por_barra_viram_um_produto_so():
    """FORTAL imprime 'TL03 | 2063-5' num span só. Saía com os dois códigos
    colados no campo Código — ou, pior, virava dois produtos inexistentes."""
    produtos = _sanear_codigo_duplo([
        {"codigo": "TL03 | 2063-5", "nome": "CABIDE", "observacoes": ""},
    ])

    assert produtos[0]["codigo"] == "TL03"
    assert "2063-5" in produtos[0]["observacoes"]


def test_codigo_normal_nao_e_tocado():
    produtos = _sanear_codigo_duplo([
        {"codigo": "ZLX-2507", "nome": "MOCHILA", "observacoes": "27x36x14cm"},
    ])

    assert produtos[0]["codigo"] == "ZLX-2507"
    assert produtos[0]["observacoes"] == "27x36x14cm"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
