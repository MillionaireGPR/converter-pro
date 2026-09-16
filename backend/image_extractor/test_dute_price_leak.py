# -*- coding: utf-8 -*-
"""
Trava o vazamento de preço/texto nas composições Dute (16/09/2026).

Josef reportou o mesmo defeito da Folia (#138, 15/09), agora no Dute: "Dute
gerou relatório de erros e as imagens várias pegaram o preço junto também".

Causa raiz nº 1 (espaço morto): o Dute monta a foto de um produto com VÁRIOS
objetos de imagem separados (embalagem + brinquedo). Quando esses objetos
ficam na diagonal (um em cima à direita, outro embaixo à esquerda), o
retângulo que os envolve sobra espaço morto no canto oposto — e é exatamente
ali que o preço e o título do produto estão desenhados como TEXTO da página
(não imagem). Recortar só a união (raster cru) trazia esse texto junto,
porque o recorte é da página renderizada, não das imagens em si.

Causa raiz nº 2 (retângulo mal posicionado): a página 34 do catálogo real
(coleção "livro sensorial") tem imagens cujo retângulo declarado no PDF é
muito maior que a página e chega a começar em coordenada negativa (deformação
de uma transformação de rotação/escala). Ao entrar na união, esse retângulo
gigante engolia o produto vizinho inteiro — inclusive o preço dele.

Roda com: python -m pytest test_dute_price_leak.py -q
"""
import fitz
import numpy as np
import pytest

from cv_extractor import _crop_composition_masked, _filtrar_imagens_fora_da_pagina

BRANCO = 255
FOTO_A = (200, 60, 60)   # "embalagem" - vermelho
FOTO_B = (60, 140, 60)   # "brinquedo" - verde
PRECO = (255, 200, 0)    # pixel que representa o texto "R$ x,xx" no espaço morto


def _imagem(xref, x0, y0, x1, y1):
    rect = fitz.Rect(x0, y0, x1, y1)
    return {
        "xref": xref,
        "rect": rect,
        "cx": (x0 + x1) / 2,
        "cy": (y0 + y1) / 2,
        "area": rect.width * rect.height,
    }


def test_espaco_morto_entre_fotos_diagonais_vira_branco():
    """Regressão real: DTY1364 (pág. 171) — box embaixo-esquerda, brinquedo
    em cima-direita. O preço ficava desenhado no canto SUPERIOR-ESQUERDO do
    retângulo união, que não pertence a nenhuma das duas fotos."""
    raster = np.full((300, 300, 3), BRANCO, dtype=np.uint8)

    foto_a = _imagem(1, 20.0, 150.0, 120.0, 280.0)   # baixo-esquerda
    foto_b = _imagem(2, 150.0, 20.0, 280.0, 150.0)   # cima-direita
    raster[150:280, 20:120] = FOTO_A
    raster[20:150, 150:280] = FOTO_B
    # "preço" no canto morto (superior-esquerdo da união), fora das duas fotos
    raster[30:50, 30:90] = PRECO

    out = _crop_composition_masked([foto_a, foto_b], raster, 300, 300, 1.0)

    assert out is not None
    # a cor do preço não pode sobreviver em NENHUM pixel do resultado
    assert not np.any(np.all(out == PRECO, axis=-1)), "preço vazou pro espaço morto"
    # as duas fotos continuam presentes
    assert np.any(np.all(out == FOTO_A, axis=-1))
    assert np.any(np.all(out == FOTO_B, axis=-1))


def test_fotos_lado_a_lado_sem_espaco_morto_ficam_intactas():
    """Quando as fotos já formam um retângulo cheio (lado a lado, sem
    diagonal), não deve sobrar nenhuma faixa branca artificial cortando o
    meio da composição."""
    raster = np.full((200, 400, 3), BRANCO, dtype=np.uint8)
    foto_a = _imagem(1, 0.0, 0.0, 200.0, 200.0)
    foto_b = _imagem(2, 200.0, 0.0, 400.0, 200.0)
    raster[0:200, 0:200] = FOTO_A
    raster[0:200, 200:400] = FOTO_B

    out = _crop_composition_masked([foto_a, foto_b], raster, 400, 200, 1.0)

    assert np.all(out[:, 0:200] == FOTO_A)
    assert np.all(out[:, 200:400] == FOTO_B)


def test_retangulo_mal_posicionado_e_descartado_da_composicao():
    """Regressão real: página 34 (livro sensorial) — imagem com retângulo
    que começa fora da página (transformação de rotação/escala malformada)
    engolia o produto vizinho inteiro, preço incluso. Uma foto de produto de
    verdade fica quase inteira dentro da página; a maioria fora da página é
    sinal de que não é uma foto de produto confiável."""
    page_w, page_h = 800.0, 600.0

    foto_legitima = _imagem(1, 100.0, 100.0, 300.0, 300.0)  # 100% na página
    foto_deformada = _imagem(2, -400.0, -300.0, 400.0, 500.0)  # maioria fora

    mantidas = _filtrar_imagens_fora_da_pagina([foto_legitima, foto_deformada], page_w, page_h)

    xrefs = {img["xref"] for img in mantidas}
    assert 1 in xrefs, "foto legítima não pode ser descartada"
    assert 2 not in xrefs, "retângulo majoritariamente fora da página deveria ser descartado"


def test_foto_que_sangra_um_pouco_a_borda_da_pagina_e_mantida():
    """Regressão real: página 152, DTY1109 — foto legítima que sangra ~11%
    para fora da margem esquerda (efeito de design intencional). Não pode
    ser descartada junto com as imagens realmente deformadas."""
    page_w, page_h = 854.39, 594.96
    foto_com_sangria = _imagem(1, -51.07, 5.50, 428.89, 283.49)  # ~89% em página

    mantidas = _filtrar_imagens_fora_da_pagina([foto_com_sangria], page_w, page_h)

    assert len(mantidas) == 1


def test_pagina_so_com_imagens_deformadas_fica_sem_nenhuma_candidata():
    """Sem rede de segurança "devolve tudo se esvaziar" aqui: perder a foto
    (SKU cai no relatório de não-casados) é preferível a devolver uma foto
    com o preço do produto vizinho dentro."""
    page_w, page_h = 800.0, 600.0
    so_deformadas = [
        _imagem(1, -400.0, -300.0, 400.0, 500.0),
        _imagem(2, 500.0, 550.0, 1200.0, 1100.0),
    ]

    mantidas = _filtrar_imagens_fora_da_pagina(so_deformadas, page_w, page_h)

    assert mantidas == []


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
