"""Regressão: conferência do preço pela GEOMETRIA da página (18/09/2026).

Petrin (relatório real do Josef, 17/09): a IA trocava preços entre produtos
vizinhos — 2 códigos com os preços cruzados, e um código "EM BREVE" (sem
preço) ficando com o preço do vizinho da direita enquanto o dono ficava sem.
Medido no catálogo real inteiro: 62 preços errados, o Josef pegou 12.

`_verify_prices_by_geometry` mede a posição código→preço no PRÓPRIO catálogo
(nunca por nome de fornecedor) e só corrige quando é inequívoco. O que este
teste trava:
  1. Petrin-like: troca entre vizinhos e preço "roubado" são corrigidos.
  2. Fortal-like (2 preços por card: UND + total da caixa): NÃO mexe — a
     primeira versão desfazia o fix do preço unitário em 105 produtos.
  3. Layout sem padrão de posição (preços agrupados): NÃO mexe.
"""
import copy
import os
import tempfile

import fitz

import gemini_extractor as ge


def _pdf(path, pages):
    doc = fitz.open()
    for items in pages:
        page = doc.new_page(width=595, height=842)
        for x, y, texto in items:
            page.insert_text((x, y), texto, fontsize=10)
    doc.save(path)
    doc.close()


def _preco(v):
    return f"R$ {v:.2f}".replace(".", ",")


tmp = tempfile.mkdtemp()

# ── 1) Petrin-like: preço 110pt à direita e 10pt ACIMA do código ──
pages, produtos, cod = [], [], 1000
for pg in range(1, 25):
    items = []
    for r in range(2):
        for c in range(2):
            cod += 1
            x0, y0 = 40 + c * 280, 120 + r * 300
            code = f"RD{cod}"
            preco = round(3 + (cod % 17) * 1.5, 2)
            items.append((x0, y0, code))
            items.append((x0 + 110, y0 - 10, _preco(preco)))
            produtos.append({"codigo": code, "preco": preco, "paginaOrigem": pg})
    pages.append(items)

# página 25: linha com código "EM BREVE" à esquerda (sem preço) e produto normal à direita
pages.append([
    (40, 120, "RD9001"), (320, 120, "RD9002"), (430, 110, _preco(46.0)),
])
produtos += [
    {"codigo": "RD9001", "preco": 46.0, "paginaOrigem": 25},   # IA "roubou" o preço do vizinho
    {"codigo": "RD9002", "preco": None, "paginaOrigem": 25},   # e deixou o dono sem preço
]
# página 26: dois produtos com os preços trocados entre si
pages.append([
    (40, 120, "RD9003"), (150, 110, _preco(12.8)),
    (320, 120, "RD9004"), (430, 110, _preco(5.0)),
])
produtos += [
    {"codigo": "RD9003", "preco": 5.0, "paginaOrigem": 26},
    {"codigo": "RD9004", "preco": 12.8, "paginaOrigem": 26},
]
pdf1 = os.path.join(tmp, "petrin_like.pdf")
_pdf(pdf1, pages)

fixed, avisos = ge._verify_prices_by_geometry(pdf1, copy.deepcopy(produtos))
by = {p["codigo"]: p for p in fixed}
assert by["RD9001"]["preco"] is None, by["RD9001"]   # em breve: perde o preço roubado
assert by["RD9002"]["preco"] == 46.0, by["RD9002"]   # dono recebe o preço
assert by["RD9003"]["preco"] == 12.8, by["RD9003"]   # troca desfeita
assert by["RD9004"]["preco"] == 5.0, by["RD9004"]
assert len(avisos) == 4, avisos
# os 96 produtos que já estavam certos não podem mudar
originais = {p["codigo"]: p["preco"] for p in produtos if not p["codigo"].startswith("RD9")}
assert all(by[c]["preco"] == v for c, v in originais.items())

# ── 2) Fortal-like: UND + total da caixa no mesmo card, IA acertou o UND ──
pages2, produtos2, n = [], [], 0
for pg in range(1, 21):
    items = []
    for c in range(2):
        n += 1
        x0, y0 = 40 + c * 280, 120
        code = f"BDZ-{2000 + n}"
        items.append((x0, y0, code))
        items.append((x0 + 35, y0 + 42, "R$ 7,20"))    # UND
        items.append((x0 + 43, y0 + 57, "R$ 72,00"))   # total da caixa
        produtos2.append({"codigo": code, "preco": 7.2, "paginaOrigem": pg})
    pages2.append(items)
pdf2 = os.path.join(tmp, "fortal_like.pdf")
_pdf(pdf2, pages2)
fixed2, avisos2 = ge._verify_prices_by_geometry(pdf2, copy.deepcopy(produtos2))
assert avisos2 == [], avisos2
assert all(p["preco"] == 7.2 for p in fixed2)

# ── 3) Layout sem padrão (preços agrupados no rodapé, posição varia) ──
pages3, produtos3 = [], []
for pg in range(1, 21):
    items = [(40, 100, f"AB{pg:04d}"), (300, 100, f"CD{pg:04d}")]
    items += [(50 + pg * 9, 780, _preco(10.0 + pg)), (400 - pg * 7, 800, _preco(20.0 + pg))]
    pages3.append(items)
    produtos3 += [
        {"codigo": f"AB{pg:04d}", "preco": 20.0 + pg, "paginaOrigem": pg},
        {"codigo": f"CD{pg:04d}", "preco": 10.0 + pg, "paginaOrigem": pg},
    ]
pdf3 = os.path.join(tmp, "agrupado.pdf")
_pdf(pdf3, pages3)
fixed3, avisos3 = ge._verify_prices_by_geometry(pdf3, copy.deepcopy(produtos3))
assert avisos3 == [], avisos3

# ── 4) Falha segura: PDF inexistente devolve os preços da IA intactos ──
p_in = [{"codigo": "X1", "preco": 1.0, "paginaOrigem": 1}]
p_out, av = ge._verify_prices_by_geometry(os.path.join(tmp, "nao_existe.pdf"), copy.deepcopy(p_in))
assert p_out == p_in and av == []

print("OK: conferência de preço por geometria corrige troca entre vizinhos e não mexe em Fortal/agrupado")
