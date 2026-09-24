"""Regressão FOLIA recadastrada (Josef, 23/09/2026).

A leitura por visão devolve posição aproximada pra cada produto. O detector
de "grade de cards" usava "SKU sem posição" como prova de que o código não
existe como texto — com a posição da visão, a grade não era detectada e o
card inteiro (com preço) ia pra exportação. O sinal agora é o TEXTO do PDF.
"""
import os
import tempfile

import fitz
import numpy as np
import cv2

import cv_extractor as cv


def _png(cor):
    img = np.full((200, 200, 3), cor, dtype=np.uint8)
    return cv2.imencode(".png", img)[1].tobytes()


def _pdf(path, com_texto):
    doc = fitz.open()
    for pg in range(3):
        page = doc.new_page(width=595, height=842)
        for i in range(3):
            rect = fitz.Rect(20 + i * 190, 200, 20 + i * 190 + 180, 380)
            page.insert_image(rect, stream=_png((40 * i + 10 * pg, 90, 160)))
            if com_texto:
                page.insert_text((rect.x0, rect.y1 + 12), f"JRF-50.{pg}{i:03d}", fontsize=9)
    doc.save(path)
    doc.close()


def _skus():
    return [
        {"sku": f"JRF-50.{pg}{i:03d}", "page": pg + 1,
         "spatialContext": {"x": 100.0, "y": 300.0, "page": pg + 1}}
        for pg in range(3) for i in range(3)
    ]


def test_grade_detectada_mesmo_com_posicao_vinda_da_visao():
    pdf = os.path.join(tempfile.mkdtemp(), "cards.pdf")
    _pdf(pdf, com_texto=False)
    doc = fitz.open(pdf)
    assert cv._detectar_grade_de_cards(doc, _skus(), set(), set()) is True


def test_catalogo_com_codigo_em_texto_nao_e_grade():
    pdf = os.path.join(tempfile.mkdtemp(), "texto.pdf")
    _pdf(pdf, com_texto=True)
    doc = fitz.open(pdf)
    assert cv._detectar_grade_de_cards(doc, _skus(), set(), set()) is False
