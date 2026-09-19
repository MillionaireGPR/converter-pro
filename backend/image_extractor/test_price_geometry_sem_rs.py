"""Regressão GIRA (Josef 17/09): catálogo SEM "R$" (preço solto no fim da linha
"10cm  CX50  6,95") não tinha tokens de preço, então a conferência por geometria
nunca rodava e 3 produtos de nome idêntico saíam com os preços em rodízio."""
import os
import sys

import fitz

sys.path.insert(0, os.path.dirname(__file__))
import gemini_extractor as ge


def pagina(linhas):
    doc = fitz.open()
    pg = doc.new_page()
    for y, txt in linhas:
        pg.insert_text((40, y), txt, fontsize=10)
    return pg


sem_rs = pagina([
    (100, "GU0132- KIT 6 PORTA-COPOS BAMBU"),
    (114, "10cm  CX50  6,95"),
    (200, "TP1679 - KIT 6 PORTA-COPOS BAMBU"),
    (214, "13,5*34cm  CX48  8,45"),
    (300, "TP2003- MEDIDAS 1,5x2,5"),
])
vals = sorted(t["val"] for t in ge._page_price_tokens(sem_rs))
assert vals == [6.95, 8.45], vals  # dimensão "13,5*34cm" e "1,5x2,5" não viram preço

com_rs = pagina([(100, "ABC123 PRODUTO"), (114, "R$ 12,80"), (130, "CX 10  3,25")])
vals = [t["val"] for t in ge._page_price_tokens(com_rs)]
assert vals == [12.8], vals  # com "R$" na página, o comportamento antigo não muda

print("OK: preço sem R$ no fim da linha é reconhecido; dimensão não")
