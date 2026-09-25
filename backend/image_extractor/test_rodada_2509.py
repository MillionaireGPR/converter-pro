"""Retestagem do Josef 25/09/2026 (DUTE, PETRIN, Neo Festas, FOLIA).

Cada teste trava uma causa estrutural medida nos catálogos reais:
- DUTE: foto composta recortada da página renderizada trazia linha
  tracejada, texto da ficha e barra do rodapé → render só com as imagens.
- DUTE: ícone de característica (som/luz) repetido no catálogo entrava na foto.
- PETRIN: foto recortada pelo PDF (clip) com retângulo declarado enorme
  derrubava a foto do vizinho como "selo" (RD1333).
- PETRIN: bloco do código ia até o fim da página e pegava a estante de
  outro produto (RD1715).
- Neo Festas: foto à esquerda do texto → vizinho na mesma altura ganhava.
- Neo Festas: vários códigos de cor no mesmo card → cascata de fotos.
- Neo Festas: "104736*" (asterisco = poucas unidades) e código lido errado
  que não existe no texto do PDF.
- FOLIA: letra comida no nome ("ABRIOR") corrigida pela releitura do card.
"""
import numpy as np
import fitz

import cv_extractor as cv
import gemini_extractor as ge


def _png(cor, w=60, h=60, alpha=False):
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, w, h), alpha)
    pix.set_rect(pix.irect, tuple(cor) + ((255,) if alpha else ()))
    return pix.tobytes("png")


def _img(x0, y0, x1, y1, xref=0):
    r = fitz.Rect(x0, y0, x1, y1)
    return {"xref": xref, "rect": r, "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2, "area": r.width * r.height}


def _sku(code, x, y):
    return {"sku": code, "spatialContext": {"x": x, "y": y, "width": 34, "height": 12}}


# ── Neo Festas: texto ─────────────────────────────────────────────────────

def test_asterisco_de_poucas_unidades_sai_do_codigo():
    produtos = [{"codigo": "104736*"}, {"codigo": " 123846* "}, {"codigo": "118508"}]
    ge._limpar_marcador_do_codigo(produtos)
    assert [p["codigo"] for p in produtos] == ["104736", "123846", "118508"]


def _pdf_texto(tmp_path, paginas):
    pdf = str(tmp_path / "texto.pdf")
    doc = fitz.open()
    for linhas in paginas:
        page = doc.new_page(width=595, height=842)
        for i, linha in enumerate(linhas):
            page.insert_text((40, 60 + 14 * i), linha, fontsize=9)
    doc.save(pdf)
    doc.close()
    return pdf


def test_codigo_que_nao_existe_no_pdf_volta_pro_impresso(tmp_path):
    pdf = _pdf_texto(tmp_path, [
        ["BALOES PARTY 62x28cm", "R$ 1,56 Un.", "128430 128422",
         "BALOES BABY 65x44cm", "R$ 2,77 Un.", "Flutua c/gas helio", "128465 128473"],
        ["MINI CAIXOTE DE MADEIRA", "R$ 3,10 Un.", "146927"],
    ])
    produtos = [
        {"codigo": "128430", "nome": "BALÕES PARTY 62x28cm", "paginaOrigem": 1},
        {"codigo": "128422", "nome": "BALÕES PARTY 62x28cm", "paginaOrigem": 1},
        {"codigo": "132331", "nome": "BALOES BABY 65x44cm", "paginaOrigem": 1},
        {"codigo": "170331", "nome": "BALOES BABY 65x44cm", "paginaOrigem": 1},
        {"codigo": "146927", "nome": "MINI CAIXOTE DE MADEIRA", "paginaOrigem": None},
    ]
    ge._conferir_codigos_pelo_texto(pdf, produtos)
    assert [p["codigo"] for p in produtos] == ["128430", "128422", "128465", "128473", "146927"]
    assert produtos[4]["paginaOrigem"] == 2


def test_codigo_fora_do_texto_sem_nome_perto_fica_como_esta(tmp_path):
    pdf = _pdf_texto(tmp_path, [["BALOES PARTY", "128430", "OUTRA COISA", "999999"]])
    produtos = [{"codigo": "128430", "nome": "BALOES PARTY", "paginaOrigem": 1},
                {"codigo": "132331", "nome": "BALOES BABY", "paginaOrigem": 1}]
    ge._conferir_codigos_pelo_texto(pdf, produtos)
    assert produtos[1]["codigo"] == "132331"


def test_cor_da_bolinha_mesmo_com_cores_so_em_parte_do_grupo(tmp_path):
    pdf = str(tmp_path / "bolinhas.pdf")
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    for x, cor, cod in ((130, (0.75, 0.75, 0.75), "128430"), (170, (0.92, 0.71, 0.0), "128422")):
        shape = page.new_shape()
        shape.draw_circle((x + 14, 88), 7.5)
        shape.finish(fill=cor, color=None)
        shape.commit()
        page.insert_text((x, 105), cod, fontsize=9)
    doc.save(pdf)
    doc.close()
    produtos = [{"codigo": "128430", "nome": "BALÕES PARTY 62x28cm", "paginaOrigem": 1},
                {"codigo": "128422", "nome": "BALÕES PARTY 62x28cm CORES", "paginaOrigem": 1}]
    ge._nomear_cores_por_bolinha(pdf, produtos)
    assert [p["nome"] for p in produtos] == ["BALÕES PARTY 62x28cm PRATA", "BALÕES PARTY 62x28cm AMARELO"]


# ── FOLIA: nome corrigido pela releitura do card ──────────────────────────

def test_letra_comida_no_nome_corrigida_pela_releitura():
    assert ge._corrigir_letras_pelo_relido("KIT ABRIOR + ROLHA", "KIT ABRI DOR + ROLHA") == "KIT ABRIDOR + ROLHA"


def test_releitura_nao_mexe_em_numero_plural_acento_ou_duas_palavras():
    assert ge._corrigir_letras_pelo_relido("ESTEIRA 19CM", "ESTEIRA 20CM") is None
    assert ge._corrigir_letras_pelo_relido("RALOS DE PIA", "RALO DE PIA") is None
    assert ge._corrigir_letras_pelo_relido("RALOS DE PIA 2 PEÇAS", "RALO DE DE PIA 2 PEÇAS") is None
    assert ge._corrigir_letras_pelo_relido("KIT 4 PEÇAS", "KIT 4 PECAS") == "KIT 4 PEÇAS"
    assert ge._corrigir_letras_pelo_relido("POTE X CORES", "POTE X") is None


# ── Neo Festas: foto ao lado do texto e vários códigos por card ───────────

def _grade(monkeypatch, tmp_path, skus, imgs, v_coords):
    usados = {}
    monkeypatch.setattr(cv, "_extract_perfect_image",
                        lambda doc, img, *a, **k: np.full((4, 4, 3), imgs.index(img) + 1, np.uint8))
    monkeypatch.setattr(cv, "_save_image",
                        lambda arr, code, out: usados.setdefault(code, int(arr[0, 0, 0]) - 1) and f"{code}.jpg" or f"{code}.jpg")
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    raster = np.full((842, 595, 3), 255, np.uint8)
    cv._match_via_grid(doc, page, raster, [0.0, 842.0], v_coords, skus, imgs, 1.0, str(tmp_path), 1,
                       orientacao="acima")
    return usados


def test_foto_a_esquerda_do_texto_nao_vai_pro_vizinho(monkeypatch, tmp_path):
    # Neo Festas pág. 6 (coordenadas reais): foto à esquerda do código, card
    # vizinho com foto na mesma altura
    imgs = [_img(47, 19, 100, 119), _img(318, 22, 413, 114), _img(44, 139, 102, 233), _img(320, 136, 412, 236)]
    skus = [_sku("156345", 154, 68), _sku("129780", 447, 58), _sku("158410", 153, 186), _sku("150266", 447, 173)]
    usados = _grade(monkeypatch, tmp_path, skus, imgs, [0.0, 130.0, 300.0, 425.0, 595.0])
    assert usados == {"156345": 0, "129780": 1, "158410": 2, "150266": 3}


def test_varios_codigos_no_mesmo_card_dividem_a_foto(monkeypatch, tmp_path):
    # Neo Festas pág. 13: 2 bolinhas de cor (2 códigos) no card do sousplat;
    # o 2º código pegava a foto do castiçal de baixo e o castiçal ficava sem.
    imgs = [_img(318, 22, 413, 114), _img(320, 136, 412, 236),
            _img(22, 700, 124, 800), _img(318, 705, 413, 800)]
    skus = [_sku("160741", 440, 92), _sku("160750", 480, 92), _sku("160539", 447, 186),
            _sku("160776", 145, 765), _sku("160768", 185, 765), _sku("160210", 447, 740)]
    usados = _grade(monkeypatch, tmp_path, skus, imgs, [0.0, 130.0, 300.0, 425.0, 595.0])
    assert usados == {"160741": 0, "160750": 0, "160539": 1, "160776": 2, "160768": 2, "160210": 3}


def test_codigo_da_ponta_da_fileira_de_cores_nao_pega_foto_do_vizinho(monkeypatch, tmp_path):
    # Neo Festas pág. 9 (coordenadas reais): BOLA DE VINIL 35cm com 9 códigos
    # em 2 fileiras de bolinhas; os da ponta direita ficam mais perto da foto
    # do CORAÇÃO do card vizinho do que da foto das bolas
    bolas, coracao = _img(27, 488, 128, 588), _img(326, 509, 428, 568)
    codigos = [("123838", 149, 554), ("123862", 179, 554), ("123790", 209, 554), ("123803", 239, 554),
               ("123854", 268, 554), ("148237", 149, 583), ("123846", 178, 583), ("123870", 209, 583),
               ("123811", 239, 583)]
    skus = [_sku(c, x, y) for c, x, y in codigos] + [_sku("131504", 457, 538)]
    usados = _grade(monkeypatch, tmp_path, skus, [bolas, coracao], [0.0, 130.0, 425.0, 595.0])
    assert {c: usados[c] for c, _, _ in codigos} == {c: 0 for c, _, _ in codigos}
    assert usados["131504"] == 1


# ── PETRIN ────────────────────────────────────────────────────────────────

def test_bloco_do_codigo_para_no_proximo_codigo_de_qualquer_coluna():
    # PETRIN pág. 85: RD1715 sozinho na coluna da direita; a estante do RD2131
    # (lá embaixo, maior imagem) ganhava do cabide
    skus = [_sku("RD1716", 48, 51), _sku("RD1715", 318, 51), _sku("RD1377", 48, 253), _sku("RD2131", 48, 668)]
    cabide = _img(421, 43, 573, 124)
    imgs = [cabide, _img(428, 134, 539, 195), _img(283, 244, 563, 588), _img(389, 593, 596, 843)]
    assert cv._foto_principal_da_celula(skus[1], skus, imgs, set(), 595, 842) is cabide


def test_foto_recortada_pelo_pdf_usa_a_parte_visivel(tmp_path):
    # PETRIN pág. 140: JPEG de 4 coletes com clip mostrando só 1; o
    # retângulo declarado cobria a foto do RD1333
    pdf = str(tmp_path / "clip.pdf")
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_image(fitz.Rect(439, 592, 576, 740), stream=_png((40, 120, 220)))
    page.insert_image(fitz.Rect(120, 460, 643, 834), stream=_png((240, 130, 20), 120, 90))
    # envolve o desenho da 2ª imagem num clip (160..276 x 567..739)
    xref = page.get_contents()[-1]
    corpo = doc.xref_stream(xref)
    doc.update_stream(xref, b"q 160 102.9 116 172 re W n\n" + corpo + b"\nQ")
    doc.save(pdf)
    doc.close()
    doc = fitz.open(pdf)
    imgs = cv._get_page_embedded_images(doc[0], set())
    recortadas = [i for i in imgs if i.get("recortada")]
    assert len(recortadas) == 1 and len(imgs) == 2
    grande = recortadas[0]
    assert abs(grande["rect"].x1 - 276) < 3 and abs(grande["rect"].y0 - 567) < 3
    assert not cv._descartar_selos(imgs, "t") or len(cv._descartar_selos(imgs, "t")) == 2


# ── DUTE: foto composta sem o que a página desenha em volta ───────────────

def test_foto_composta_sem_texto_linha_e_fundo(tmp_path):
    pdf = str(tmp_path / "dute.pdf")
    doc = fitz.open()
    page = doc.new_page(width=854, height=595)
    page.insert_image(page.rect, stream=_png((230, 230, 250)))            # fundo decorado
    page.insert_image(fitz.Rect(100, 100, 300, 300), stream=_png((200, 30, 30)))   # caixa
    page.insert_image(fitz.Rect(320, 150, 450, 300), stream=_png((30, 160, 30)))   # brinquedo
    page.draw_line((80, 200), (480, 200), color=(0.3, 0.3, 0.3), dashes="[4] 0", width=2)
    page.insert_text((130, 180), "Dimensoes 21x8x46cm", fontsize=14)
    doc.save(pdf)
    doc.close()
    doc = fitz.open(pdf)
    page = doc[0]
    imgs = [i for i in cv._get_page_embedded_images(page, set()) if i["rect"].width < 400]
    raster = np.frombuffer(page.get_pixmap(colorspace=fitz.csRGB).samples, np.uint8).reshape(595, 854, 3)
    out = cv._crop_composition_masked(imgs, raster, 854, 595, 1.0, page=page)
    assert out is not None
    # dentro da caixa, onde havia texto e linha: só a cor da caixa
    assert (np.abs(out[80:110, 30:190].astype(int) - (200, 30, 30)).max(axis=2) < 40).all()
    # entre as duas fotos, fora dos retângulos: branco, sem fundo decorado
    assert (out[10:40, 205:215] == 255).all()


def test_icone_repetido_no_catalogo_sai_da_foto_composta(tmp_path):
    pdf = str(tmp_path / "icones.pdf")
    doc = fitz.open()
    xref_icone = xref_nota = 0
    for pg in range(3):
        page = doc.new_page(width=854, height=595)
        page.insert_image(fitz.Rect(100, 80, 400, 400), stream=_png((200, 30 + 40 * pg, 30)))
        if not xref_icone:
            xref_icone = page.insert_image(fitz.Rect(420, 100, 452, 148), stream=_png((130, 60, 160)))
            xref_nota = page.insert_image(fitz.Rect(424, 106, 448, 130), stream=_png((250, 250, 250), 20, 20))
        else:
            page.insert_image(fitz.Rect(420, 100, 452, 148), xref=xref_icone)
            page.insert_image(fitz.Rect(424, 106, 448, 130), xref=xref_nota)
    doc.save(pdf)
    doc.close()
    doc = fitz.open(pdf)
    imgs = cv._get_page_embedded_images(doc[0], set())
    icones = cv._icones_de_caracteristica(doc, imgs)
    assert {i["xref"] for i in imgs if id(i) in icones} == {xref_icone, xref_nota}
    assert all(id(i) not in icones for i in imgs if i["rect"].width > 200)


# ── Retestagem 2 (25/09 à tarde) ──────────────────────────────────────────

def test_pecas_finas_encostadas_viram_uma_foto(tmp_path):
    # Neo pág. 71: VARETA = 10 imagens de ~12pt lado a lado (descartadas por
    # terem <20pt); SUPORTE = 2 hastes com 7pt de vão
    pdf = str(tmp_path / "varetas.pdf")
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    for i in range(10):
        page.insert_image(fitz.Rect(17 + 10.5 * i, 20, 29 + 10.5 * i, 115), stream=_png((25 * i, 90, 200), 12, 90), keep_proportion=False)
    page.insert_image(fitz.Rect(51, 371, 65, 471), stream=_png((200, 200, 200), 14, 100))
    page.insert_image(fitz.Rect(72, 371, 86, 471), stream=_png((200, 200, 200), 14, 100))
    page.insert_image(fitz.Rect(300, 300, 312, 400), stream=_png((0, 0, 0), 12, 100))  # fio solto
    doc.save(pdf)
    doc.close()
    imgs = cv._get_page_embedded_images(fitz.open(pdf)[0], set())
    juntas = sorted((len(i["tiles"]), [round(v) for v in i["rect"]]) for i in imgs if i.get("montar"))
    assert juntas == [(2, [51, 371, 86, 471]), (10, [17, 20, 124, 115])]
    assert len(imgs) == 2


def test_grade_de_fotos_de_cor_casa_por_ordem():
    # Neo pág. 11 (coordenadas reais): 12 fotos 4×3 e 12 códigos em lista
    xs, ys = (312, 347, 382), (507, 557, 608, 659)
    imgs = [_img(x, y, x + 33, y + 29) for y in ys for x in xs]
    codigos = ["153230", "153184", "153192", "153206", "153290", "153214",
               "153249", "153222", "148563", "148555", "158151", "158143"]
    skus = [dict(_sku(c, 452, 511 + 16 * k), name="MINI FLOR ROSA EVA") for k, c in enumerate(codigos)]
    grade = cv._variantes_em_grade(skus, imgs)
    assert [grade[c] for c in codigos] == imgs


def test_grade_nao_casa_quando_a_conta_nao_bate_ou_nome_difere():
    imgs = [_img(30, 20, 64, 68), _img(64, 20, 98, 68), _img(99, 20, 131, 68)]
    skus = [dict(_sku("A1", 160, 40), name="MINI FLOR"), dict(_sku("A2", 200, 40), name="MINI FLOR")]
    assert cv._variantes_em_grade(skus, imgs) == {}
    skus.append(dict(_sku("B1", 240, 40), name="MOLDURA PLASTICA"))
    assert cv._variantes_em_grade(skus, imgs) == {}


def test_png_cinza_com_mascara_fica_com_fundo_branco():
    import types
    cinza = np.zeros((10, 10), np.uint8)
    mascara = np.zeros((10, 10), np.uint8)
    mascara[4:6, 4:6] = 255
    doc = types.SimpleNamespace(extract_image=lambda x: {"image": __import__("cv2").imencode(".png", mascara)[1].tobytes()})
    rgb = cv._decode_with_white_bg(cinza, doc, 7)
    assert rgb[0, 0].tolist() == [255, 255, 255] and rgb[5, 5].tolist() == [0, 0, 0]


def test_grade_com_codigo_desalinhado_por_rotulo_de_duas_linhas():
    # Neo pág. 88 (coordenadas reais): ROSA MAGENTA (149748, y=811) e
    # CORAÇÕES (149683, y=801) — foto de cima = rosas, de baixo = corações
    rosas, coracoes = _img(341, 724, 407, 774), _img(341, 773, 407, 823)
    skus = [dict(_sku("149748", 464, 811), name="JOGOS AMERICANOS DE PAPEL"),
            dict(_sku("149683", 533, 801), name="JOGOS AMERICANOS DE PAPEL")]
    grade = cv._variantes_em_grade(skus, [rosas, coracoes])
    assert grade["149748"] is rosas and grade["149683"] is coracoes


def test_segundo_codigo_do_card_divide_a_foto_mais_perta(monkeypatch, tmp_path):
    # Neo pág. 69: BALÃO TAÇAS (1 foto, 2 códigos); o boneco de neve 150pt
    # acima, na mesma coluna, não tem código na página
    tacas, boneco = _img(30, 480, 130, 580), _img(30, 330, 130, 420)
    skus = [_sku("126942", 150, 560), _sku("126934", 205, 560), _sku("145548", 450, 400)]
    foto_145548 = _img(320, 340, 420, 440)
    usados = _grade(monkeypatch, tmp_path, skus, [tacas, boneco, foto_145548], [0.0, 130.0, 300.0, 425.0, 595.0])
    assert usados["126942"] == 0 and usados["126934"] == 0


def test_lista_vertical_de_codigos_com_pouco_espaco_mantem_a_ordem():
    # Neo pág. 11: 12 códigos um embaixo do outro a cada 16pt (e listas
    # com 12pt) — cada um é uma linha
    imgs = [_img(312 + 35 * (k % 3), 507 + 50 * (k // 3), 345 + 35 * (k % 3), 536 + 50 * (k // 3)) for k in range(6)]
    skus = [dict(_sku(f"C{k}", 452, 511 + 12 * k), name="SAIA TULE") for k in range(6)]
    grade = cv._variantes_em_grade(skus, imgs)
    assert [grade[f"C{k}"] for k in range(6)] == imgs
