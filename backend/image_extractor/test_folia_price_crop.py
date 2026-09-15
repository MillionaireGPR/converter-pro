# -*- coding: utf-8 -*-
"""
Trava o corte da faixa de preço/specs do card da Folia (15/09/2026).

Josef, depois do PR #135 (que resolveu o CASAMENTO foto<->SKU): "as imagens
estão capturando valor também, não pode. Precisa ser somente a imagem pra não
ter divergência nas alterações de preço" — a foto vinha com o preço IMPRESSO
dentro dela; se o preço for reajustado depois, a imagem salva mostra um valor
que já não é mais o real.

Cada card da Folia é UMA imagem rasterizada só (sem texto/preço via PDF por
cima — é tudo a mesma arte, ver #14.9), então o corte tem que ser por PIXEL:
acha a faixa de baixo (specs + etiqueta de preço) pela cor navy que ela
compartilha com a borda do card, e devolve só o que vem antes dela.

Roda com: python -m pytest test_folia_price_crop.py -q
"""
import numpy as np
import pytest

from cv_extractor import _crop_folia_price_band

NAVY = (55, 89, 116)  # medido no catálogo real (mesma cor da borda e da faixa)
BRANCO = (250, 250, 250)


def _card(h=384, w=384, faixa_frac=0.84, cor_faixa=NAVY, texto_extra=None):
    """Card sintético: borda navy fininha, 'foto' branca no meio, faixa navy
    no fim (com um retângulo claro simulando a etiqueta de preço à direita)."""
    img = np.full((h, w, 3), BRANCO, dtype=np.uint8)
    img[0:3, :] = cor_faixa  # borda superior: é dela que o código lê a cor navy
    topo = int(h * faixa_frac)
    img[topo:, :] = cor_faixa
    # etiqueta de preço: retângulo claro na METADE DIREITA da faixa —
    # é o que confundia a versão ingênua do detector (fração de navy da
    # linha inteira caía abaixo do limiar mesmo dentro da faixa).
    img[topo + 4: h - 4, int(w * 0.6): w - 8] = BRANCO
    if texto_extra:
        for y in texto_extra:
            img[y, int(w * 0.1):int(w * 0.4)] = BRANCO  # 1 linha de "letra branca"
    return img


def test_corta_a_faixa_e_preserva_a_foto():
    img = _card()
    out = _crop_folia_price_band(img)
    assert out.shape[0] < img.shape[0]
    # nada da faixa (nem a etiqueta clara nem o fundo navy) deve sobrar —
    # ignora só as 3 linhas do topo, que são a borda do card, preservada de
    # propósito (o corte mexe apenas na faixa de BAIXO).
    assert np.all(out[3:] == BRANCO), "sobrou pixel da faixa (navy ou etiqueta) na foto"


def test_etiqueta_de_preco_nao_engana_a_deteccao():
    """A etiqueta ocupa boa parte da largura à direita — sem restringir a
    detecção à metade esquerda, a linha inteira "parece" pouco navy mesmo
    estando dentro da faixa, e o corte para cedo demais (sobra preço)."""
    img = _card(faixa_frac=0.80)
    out = _crop_folia_price_band(img)
    altura_esperada = int(384 * 0.80)
    assert abs(out.shape[0] - altura_esperada) <= 6


def test_uma_linha_clara_isolada_dentro_da_foto_nao_e_confundida_com_a_faixa():
    """Uma letra grande ou detalhe branco do produto perto da faixa não pode
    disparar o corte sozinho — a aresta de cima da faixa exige DUAS linhas
    seguidas de navy quase puro, e uma linha clara isolada não forma isso."""
    topo = int(384 * 0.84)
    img = _card(faixa_frac=0.84, texto_extra=[topo - 20])  # 1 linha clara isolada, ANTES da faixa
    out = _crop_folia_price_band(img)
    assert abs(out.shape[0] - topo) <= 6


def test_texto_largo_dentro_da_faixa_nao_corta_cedo_demais():
    """Regressão real (15/09/2026, card 'BRINQUEDO MUSICAL EDUCATIVO'): um
    nome de produto largo o bastante faz VÁRIAS linhas seguidas, dentro da
    própria faixa, caírem com pouca fração de navy — o algoritmo antigo
    (que procurava o FIM da faixa varrendo de baixo pra cima) confundia isso
    com "a foto recomeçou" e parava cedo, sobrando texto visível. A versão
    atual procura a ARESTA DE CIMA da faixa varrendo de cima pra baixo, que
    não sofre desse problema."""
    h, w = 384, 384
    topo = int(h * 0.84)
    img = _card(h=h, w=w, faixa_frac=0.84)
    # simula um nome de produto largo: várias linhas de "letra branca" que
    # cobrem quase toda a metade esquerda da faixa, logo abaixo do topo dela.
    for y in range(topo + 4, topo + 30):
        img[y, 0:int(w * 0.50)] = BRANCO
    out = _crop_folia_price_band(img)
    assert abs(out.shape[0] - topo) <= 3, (
        f"cortou em {out.shape[0]}, esperado perto de {topo} — "
        "sobrou texto da faixa na foto"
    )


def test_layout_fora_do_padrao_devolve_a_imagem_original():
    """Sem faixa navy identificável (produto/catálogo fora do template usual),
    o corte tem que falhar para o lado seguro: devolver a imagem inteira, não
    arriscar cortar a foto ao meio."""
    img = np.full((300, 300, 3), BRANCO, dtype=np.uint8)  # sem faixa nenhuma
    out = _crop_folia_price_band(img)
    assert out.shape == img.shape
    assert np.array_equal(out, img)


def test_faixa_fora_da_faixa_plausivel_de_altura_e_ignorada():
    """Se a 'faixa' aparente ficar fora de 55%-97% da altura, é sinal de
    detecção errada (ex: card quase todo navy) — não corta."""
    img = _card(faixa_frac=0.30)  # navy dominando quase a imagem toda
    out = _crop_folia_price_band(img)
    assert out.shape == img.shape


@pytest.mark.parametrize("h,w", [(400, 400), (413, 400), (390, 386), (500, 480)])
def test_funciona_em_tamanhos_diferentes_de_card(h, w):
    """O catálogo real tem cards de 384 a 413px — a proporção é o que importa,
    não um tamanho fixo em pixels."""
    img = _card(h=h, w=w, faixa_frac=0.84)
    out = _crop_folia_price_band(img)
    assert out.shape[1] == w
    assert 0.80 * h <= out.shape[0] <= 0.88 * h


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
